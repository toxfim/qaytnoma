/**
 * AI quvuri: sahifalar → Gemini → hujjatlar → PDF → Google Sheets.
 *
 * Deterministik ilova bilan FARQI bitta bosqichda: `extractPage` (deskew →
 * to'r → ZXing → Tesseract) o'rniga sahifa rasmi to'g'ridan-to'g'ri modelga
 * beriladi. Undan keyingi hamma narsa — guruhlash, SKU ni katalogdan olish,
 * validatsiya, PDF, takror tekshiruvi, Sheets, navbat — `@barcodeer/core`
 * dan qayta ishlatiladi. Bu ataylab: solishtirish faqat O'QISH bosqichida
 * bo'lishi kerak, aks holda ikki ilovaning natijasi boshqa sabablarga ko'ra
 * ham farq qilib, taqqoslash ma'nosini yo'qotadi.
 *
 * MODELGA ISHONMASLIK — bu yerdagi asosiy tamoyil. Uchta mustaqil nazorat:
 *   1. shtrix-kod 13 xonali bo'lishi shart (`page-reader.ts`) va katalogda
 *      topilishi kerak — 23 000 yozuvli katalogda yo'q kod modelning
 *      xatosini ochib beradi;
 *   2. `№` ustunidagi qator raqamlari uzluksiz bo'lishi kerak — tushib
 *      qolgan qator shu yerda ko'rinadi;
 *   3. miqdorlar yig'indisi `Итого` ga teng chiqishi kerak (core'dagi
 *      validatsiya).
 */
import { join } from 'node:path';
import {
  DocumentIndex,
  PendingQueue,
  SheetsWriter,
  SkuCatalogue,
  fetchCatalogue,
  groupIntoDocuments,
  markDuplicates,
  validateDocument,
  writeDocumentPdf,
  type CatalogueOptions,
  type PageExtraction,
} from '@barcodeer/core';
import type { InvoiceDocument } from '@barcodeer/shared';
import { GeminiClient, emptyUsage, type TokenUsage } from '../gemini/client.js';
import { estimateUsd, imageTokens } from '../gemini/cost.js';
import { readPage, type AiPage } from '../gemini/page-reader.js';
import { prepareForModel } from './prepare.js';

export interface AiRunOptions {
  /** Qayta ishlanadigan sahifa rasmlari (tartib muhim). */
  pages: Iterable<string> | AsyncIterable<string>;
  client: GeminiClient;
  /** Katalog, indeks va navbat saqlanadigan papka. */
  dataDir: string;
  /** PDF arxivi ildizi. */
  invoicesRoot: string;
  /** Berilmasa Sheets bosqichi o'tkazib yuboriladi. */
  sheets?: SheetsWriter;
  /** Uzum katalogi. Berilmasa SKU faqat modeldan olinadi. */
  catalogue?: CatalogueOptions;
  /** Modelga yuboriladigan rasm kengligi. */
  pageWidth?: number;
  scannedAt?: Date;
  onProgress?: (event: AiProgressEvent) => void;
}

export type AiProgressEvent =
  | { type: 'catalogue'; entries: number; refreshed: boolean }
  | { type: 'page'; index: number; rows: number; tokens: number; ms: number }
  | { type: 'grouped'; documents: number }
  | { type: 'pdf'; docId: string; path: string }
  | { type: 'sheets'; rows: number; flagged: number; skipped: number }
  | { type: 'recovered'; rows: number }
  | { type: 'warning'; message: string };

export interface AiRunResult {
  documents: InvoiceDocument[];
  orphanPages: number;
  pagesRead: number;
  /** Model o'qiy olmagan sahifalar — ular butunlay yo'qoladi. */
  pagesFailed: number;
  rowsAppended: number;
  flaggedRows: number;
  rowsSkipped: number;
  rowsRecovered: number;
  rowsPending: number;
  /** SKU si katalogdan olingan qatorlar (ishonchli). */
  skuFromCatalogue: number;
  /** SKU si faqat modeldan olingan qatorlar (tekshiruvga belgilanadi). */
  skuFromModel: number;
  catalogueEntries: number;
  usage: TokenUsage;
  /** Taxminiy narx (AQSh dollari). */
  usd: number;
  elapsedMs: number;
  warnings: string[];
}

export async function runAiPipeline(opts: AiRunOptions): Promise<AiRunResult> {
  const started = Date.now();
  const scannedAt = opts.scannedAt ?? new Date();
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    opts.onProgress?.({ type: 'warning', message });
  };

  const index = await DocumentIndex.open(join(opts.dataDir, 'documents.jsonl'));
  const pending = await PendingQueue.open(join(opts.dataDir, 'pending-batches.json'));
  const catalogue = await syncCatalogue(opts, scannedAt, warn);

  // --- Sahifalarni o'qish (kelishi bilan) ---
  //
  // KETMA-KET, ataylab: sahifalar skanerdan ~3 s oralig'ida keladi, bitta
  // so'rov esa shunga yaqin vaqt oladi — ya'ni skanerlash va o'qish tabiiy
  // ravishda ustma-ust tushadi. Parallellik bu yerda tezlik bermaydi,
  // ammo tartibni saqlash uchun buferlashni talab qilardi.
  const extracted: PageExtraction[] = [];
  let pagesFailed = 0;
  let pageIndex = 0;

  for await (const path of opts.pages) {
    const at = Date.now();
    const images = await prepareForModel(path, { width: opts.pageWidth });
    const before = opts.client.usage.totalTokens;

    let page: AiPage | null = null;
    try {
      page = await readPage(opts.client, images.model);
    } catch (err) {
      pagesFailed++;
      warn(`${pageIndex + 1}-sahifani model o'qiy olmadi: ${(err as Error).message}`);
    }

    if (page) {
      const gap = rowNumberGap(page);
      if (gap) warn(`${pageIndex + 1}-sahifada qator raqamlari uzilgan: ${gap}`);
      extracted.push(toPageExtraction(page, path, pageIndex, images));
      opts.onProgress?.({
        type: 'page',
        index: pageIndex,
        rows: page.rows.length,
        tokens: opts.client.usage.totalTokens - before,
        ms: Date.now() - at,
      });
    }
    pageIndex++;
  }

  const { documents, orphanPages } = groupIntoDocuments(extracted, { scannedAt });
  opts.onProgress?.({ type: 'grouped', documents: documents.length });
  if (orphanPages.length > 0) {
    warn(`${orphanPages.length} ta sahifa hech qanday hujjatga bog'lanmadi (sarlavha topilmadi)`);
  }

  // --- SKU: katalog modelning taklifidan ustun ---
  const trustedBarcodes = new Set<string>();
  let skuFromModel = 0;
  for (const doc of documents) {
    for (const item of doc.items) {
      const fromCatalogue = item.itemBarcode ? catalogue.lookup(item.itemBarcode) : null;
      if (fromCatalogue) {
        item.sku = fromCatalogue;
        trustedBarcodes.add(item.itemBarcode);
      } else {
        // Katalog bilmagan shtrix-kod ikki narsani anglatishi mumkin:
        // mahsulot yangi, yoki model kodni xato o'qigan. Ikkalasida ham
        // qator inson ko'zidan o'tishi kerak.
        skuFromModel++;
      }
    }
  }

  // --- Validatsiya ---
  const knownDocIds = index.docIds();
  for (const doc of documents) {
    validateDocument(doc, { knownDocIds, skuFromDictionary: trustedBarcodes });
  }

  // Sarlavha tekshiruvi va mavjud kalitlarni o'qish PDF yozish bilan
  // bir vaqtda ketadi.
  const sheets = opts.sheets;
  const existingKeys = sheets
    ? sheets
        .ensureHeaders()
        .then(() => sheets.readRowKeys())
        .catch((err: Error) => err)
    : undefined;

  // --- PDF ---
  const pagesByIndex = new Map(extracted.map((p) => [p.pageIndex, p]));
  for (const doc of documents) {
    const jpegs = doc.pages
      .map((p) => pagesByIndex.get(p.index)?.archiveJpeg)
      .filter((b): b is Buffer => b !== undefined && b.length > 0)
      .map((jpeg) => ({ jpeg }));

    if (jpegs.length === 0) continue;
    try {
      const written = await writeDocumentPdf({
        root: opts.invoicesRoot,
        date: scannedAt,
        name: doc.docId || `nomalum_${doc.pages[0]?.index ?? 0}`,
        pages: jpegs,
      });
      doc.pdfPath = written.path;
      opts.onProgress?.({ type: 'pdf', docId: doc.docId, path: written.path });
    } catch (err) {
      warn(`PDF saqlanmadi (${doc.docId}): ${(err as Error).message}`);
    }
  }

  // --- Takror qatorlar ---
  let rowsSkipped = 0;
  let rowsRecovered = 0;
  let sheetsError: Error | undefined;
  const existing = existingKeys ? await existingKeys : index.rowKeys();
  if (existing instanceof Error) {
    sheetsError = existing;
  } else {
    if (sheets && pending.size > 0) {
      rowsRecovered = await flushPending(pending, sheets, existing, opts, warn);
    }
    const dup = markDuplicates(documents, existing);
    rowsSkipped = dup.skipped;
    if (dup.skipped > 0) {
      const detail = [...dup.byDocument].map(([id, n]) => `${id}: ${n}`).join(', ');
      warn(`${dup.skipped} ta qator allaqachon yozilgan — o'tkazib yuborildi (${detail})`);
    }
  }

  // --- Google Sheets ---
  let rowsAppended = 0;
  let flaggedRows = 0;
  if (sheets) {
    try {
      if (sheetsError) throw sheetsError;
      const res = await sheets.appendDocuments(documents);
      rowsAppended = res.rowsAppended;
      flaggedRows = res.flaggedRows;
      opts.onProgress?.({
        type: 'sheets',
        rows: res.rowsAppended,
        flagged: res.flaggedRows,
        skipped: res.rowsSkipped,
      });
    } catch (err) {
      const message = (err as Error).message;
      try {
        await pending.add(documents, message, scannedAt);
        warn(
          `Google Sheets ga yozib bo'lmadi: ${message}. ` +
            `Qatorlar navbatga saqlandi va keyingi skanerlashda yoziladi.`,
        );
      } catch (queueErr) {
        warn(
          `Google Sheets ga yozib bo'lmadi: ${message}. ` +
            `Navbatga ham saqlanmadi: ${(queueErr as Error).message}`,
        );
      }
    }
  } else {
    flaggedRows = countFlagged(documents);
  }

  try {
    await index.append(documents);
  } catch (err) {
    warn(`Lokal indeksga yozib bo'lmadi: ${(err as Error).message}`);
  }

  const usage = opts.client.usage;
  return {
    documents,
    orphanPages: orphanPages.length,
    pagesRead: extracted.length,
    pagesFailed,
    rowsAppended,
    flaggedRows,
    rowsSkipped,
    rowsRecovered,
    rowsPending: pending.rowCount,
    skuFromCatalogue: trustedBarcodes.size,
    skuFromModel,
    catalogueEntries: catalogue.size,
    usage,
    usd: estimateUsd(usage, opts.client.model),
    elapsedMs: Date.now() - started,
    warnings,
  };
}

/**
 * Model javobini core'ning sahifa formatiga o'giradi.
 *
 * Shu adapter tufayli guruhlash, qator raqamlash, validatsiya, takror
 * tekshiruvi va Sheets yozuvchisi o'zgarishsiz qayta ishlatiladi.
 *
 * Shtrix-kodi o'qilmagan qator `''` bilan qoladi — validatsiya uni
 * `BARCODE_LENGTH` xatosi bilan belgilaydi va takror tekshiruvi bunday
 * qatorni chetlab o'tadi.
 */
function toPageExtraction(
  page: AiPage,
  path: string,
  pageIndex: number,
  images: { archive: Buffer; width: number; height: number; skewDeg: number },
): PageExtraction {
  return {
    path,
    pageIndex,
    isHeaderPage: page.isHeaderPage && page.docId !== null,
    skewDeg: images.skewDeg,
    docId: page.docId,
    docNumber: page.docNumber,
    docDate: page.docDate,
    docIdFromBarcode: false,
    docIdMismatch: false,
    headerEvidenceMissing: page.isHeaderPage && page.docId === null,
    columns: null,
    rows: page.rows.map((row, i) => ({
      bandIndex: i,
      itemBarcode: row.barcode ?? '',
      sku: row.sku,
      skuLatin: null,
      skuCyrillic: null,
      quantity: row.quantity,
      quantityRaw: row.quantity === null ? null : String(row.quantity),
      // Bu ilovada BARCHA qiymatlar modeldan keladi, shuning uchun har
      // qatorni "model o'qigan" deb belgilash ma'lumot bermaydi — faqat
      // `⚠` ustunini foydasiz qilib qo'yadi. Ishonch mustaqil
      // nazoratlardan olinadi: katalog, qator raqamlari va `Итого`.
      quantityAgreement: 1,
    })),
    totals: {
      quantity: page.totalQuantity,
      sum: null,
      quantityCandidates: page.totalQuantity === null ? [] : [page.totalQuantity],
    },
    gridFound: page.rows.length > 0,
    vlmRescued: true,
    width: images.width,
    height: images.height,
    archiveJpeg: images.archive,
  };
}

/**
 * `№` ustunidagi raqamlar uzluksizmi.
 *
 * Modelning eng ehtimolli xatosi — qatorni butunlay tushirib qoldirish, va
 * u hech qanday xato bermaydi: 26 qator o'rniga 25 qator qaytadi, hammasi
 * "to'g'ri" ko'rinadi. Raqamlar ketma-ketligi buni darhol ochib beradi.
 * `Итого` bilan tekshiruv ham buni tutadi, ammo faqat `Итого` o'qilgan
 * bo'lsa; bu tekshiruv esa har doim ishlaydi.
 */
export function rowNumberGap(page: AiPage): string | null {
  const numbers = page.rows.map((r) => r.no).filter((n): n is number => n !== null);
  if (numbers.length < 2) return null;
  for (let i = 1; i < numbers.length; i++) {
    const prev = numbers[i - 1]!;
    const next = numbers[i]!;
    if (next !== prev + 1) return `${prev} → ${next}`;
  }
  return null;
}

async function flushPending(
  pending: PendingQueue,
  sheets: SheetsWriter,
  existing: Set<string>,
  opts: AiRunOptions,
  warn: (message: string) => void,
): Promise<number> {
  const documents = pending.documents();
  if (documents.length === 0) return 0;
  try {
    markDuplicates(documents, existing);
    const res = await sheets.appendDocuments(documents);
    await pending.clear();
    opts.onProgress?.({ type: 'recovered', rows: res.rowsAppended });
    return res.rowsAppended;
  } catch (err) {
    warn(`Navbatdagi ${pending.rowCount} ta qator hali ham yozilmadi: ${(err as Error).message}`);
    return 0;
  }
}

/** Katalogni ochadi va kerak bo'lsa yangilaydi. */
async function syncCatalogue(
  opts: AiRunOptions,
  now: Date,
  warn: (message: string) => void,
): Promise<SkuCatalogue> {
  const catalogue = await SkuCatalogue.open(join(opts.dataDir, 'sku-catalogue.json'));

  if (!opts.catalogue) {
    if (catalogue.size === 0) {
      warn('Uzum katalogi sozlanmagan — SKU faqat modeldan olinadi va tekshirilmaydi');
    }
    return catalogue;
  }

  if (!catalogue.isStale(opts.catalogue.maxAgeHours, now)) {
    opts.onProgress?.({ type: 'catalogue', entries: catalogue.size, refreshed: false });
    return catalogue;
  }

  try {
    const { credentials, maxAgeHours, ...source } = opts.catalogue;
    void maxAgeHours;
    const fetched = await fetchCatalogue(source, credentials);
    await catalogue.replaceAll(fetched.entries, `${source.spreadsheetId}/${source.sheetName}`, now);
    opts.onProgress?.({ type: 'catalogue', entries: catalogue.size, refreshed: true });
  } catch (err) {
    warn(
      catalogue.size > 0
        ? `Katalog yangilanmadi, eskisi ishlatiladi (${catalogue.size} yozuv): ${(err as Error).message}`
        : `Katalogni yuklab bo'lmadi: ${(err as Error).message}`,
    );
  }

  return catalogue;
}

function countFlagged(documents: readonly InvoiceDocument[]): number {
  let count = 0;
  for (const doc of documents) {
    const docHasError = doc.issues.some((i) => i.severity === 'error');
    for (const item of doc.items) {
      if (item.duplicate) continue;
      if (docHasError || item.issues.length > 0) count++;
    }
  }
  return count;
}

/** Sahifa rasmi nechta tokenga tushishini oldindan aytadi — sozlash uchun. */
export function pageTokenCost(width: number, height: number): number {
  return imageTokens(width, height);
}

export { emptyUsage };
