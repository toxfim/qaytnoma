/**
 * To'liq quvur: sahifalar → hujjatlar → PDF → Google Sheets.
 *
 * Quvur BOSQICHMA-BOSQICH ishlaydi va har bir bosqichda xatoni yutib
 * yubormaydi: Sheets ga yozib bo'lmasa ham PDF saqlanadi va natija
 * qaytariladi, shunda skanerlangan qog'oz behuda ketmaydi.
 */
import { join } from 'node:path';
import type { InvoiceDocument } from '@barcodeer/shared';
import { OcrEngine } from '../ocr/engine.js';
import { extractPage, type PageExtraction } from './extract-page.js';
import { groupIntoDocuments } from './group.js';
import { validateDocument } from './validate.js';
import { markDuplicates } from './dedupe.js';
import { SkuDictionary } from '../store/sku-dictionary.js';
import { SkuCatalogue } from '../store/sku-catalogue.js';
import { SkuResolver } from '../store/sku-resolver.js';
import { DocumentIndex } from '../store/index-log.js';
import { PendingQueue } from '../store/pending-batch.js';
import { fetchCatalogue, type CatalogueSource } from '../input/catalogue-sheet.js';
import { writeDocumentPdf } from '../output/pdf.js';
import { SheetsWriter, type SheetsCredentials } from '../output/sheets.js';
import { looksLikeValidSku } from '../ocr/sku.js';

export interface CatalogueOptions extends CatalogueSource {
  credentials: SheetsCredentials;
  /** Katalog shundan eski bo'lsa avtomatik yangilanadi. */
  maxAgeHours: number;
}

export interface RunOptions {
  /**
   * Qayta ishlanadigan sahifa rasmlari (tartib muhim).
   *
   * `AsyncIterable` berilsa (skaner oqimi), sahifalar kelishi bilan qayta
   * ishlanadi — skaner keyingi varaqni o'qiyotgan paytda. To'plamning umumiy
   * vaqti "skan + qayta ishlash" emas, ikkalasidan kattasiga yaqin bo'ladi.
   */
  pages: Iterable<string> | AsyncIterable<string>;
  /**
   * Tayyor OCR dvigateli. Berilsa qayta ishlatiladi va YOPILMAYDI — tray
   * ilova uni isitilgan holda saqlaydi (worker'larni yuklash ~2.4 s).
   */
  ocr?: OcrEngine;
  /** Tesseract til fayllari papkasi. */
  tessdataPath: string;
  /** SKU lug'ati, katalog va indeks saqlanadigan papka. */
  dataDir: string;
  /** PDF arxivi ildizi. */
  invoicesRoot: string;
  /** Sheets yozuvchisi. Berilmasa Sheets bosqichi o'tkazib yuboriladi. */
  sheets?: SheetsWriter;
  /** Uzum katalogi. Berilmasa SKU faqat OCR dan olinadi. */
  catalogue?: CatalogueOptions;
  /** Skanerlash vaqti (PDF papkasi nomi shundan olinadi). */
  scannedAt?: Date;
  /** Jarayon haqida xabar berish. */
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { type: 'catalogue'; entries: number; refreshed: boolean }
  | { type: 'page'; index: number; total: number; path: string }
  | { type: 'grouped'; documents: number }
  | { type: 'pdf'; docId: string; path: string }
  | { type: 'sheets'; rows: number; flagged: number; skipped: number }
  | { type: 'recovered'; rows: number; batches: number }
  | { type: 'warning'; message: string };

export interface RunResult {
  documents: InvoiceDocument[];
  orphanPages: number;
  /** Sheets ga yozilgan qatorlar; Sheets o'tkazib yuborilgan bo'lsa 0. */
  rowsAppended: number;
  /** `⚠` bilan belgilangan qatorlar. */
  flaggedRows: number;
  /**
   * `Ид документа + ШК` juftligi allaqachon yozilgan bo'lgani uchun
   * o'tkazib yuborilgan qatorlar (takroriy skan).
   */
  rowsSkipped: number;
  /**
   * Oldingi skanerlashlarda Sheets ga yozilmay qolgan va SHU safar
   * yozilgan qatorlar (`store/pending-batch.ts`).
   */
  rowsRecovered: number;
  /** Hali ham navbatda turgan — yozilmagan qatorlar. */
  rowsPending: number;
  /** SKU si katalogdan yoki tasdiqlangan lug'atdan olingan qatorlar. */
  skuResolved: number;
  /** SKU si faqat OCR dan olingan qatorlar. */
  skuFromOcr: number;
  catalogueEntries: number;
  elapsedMs: number;
  /** To'xtatmagan, lekin e'tibor talab qiladigan muammolar. */
  warnings: string[];
}

export async function runPipeline(opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const scannedAt = opts.scannedAt ?? new Date();
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    opts.onProgress?.({ type: 'warning', message });
  };

  // OCR worker'lari darhol yuklana boshlaydi — bu katalog sinxronizatsiyasi
  // va birinchi sahifaning skanerlanishi bilan bir vaqtda ketadi.
  const ownOcr = opts.ocr === undefined;
  const ocr = opts.ocr ?? new OcrEngine({ langPath: opts.tessdataPath });
  const warm = ocr.warmUp().catch(() => {});

  const dictionary = await SkuDictionary.open(join(opts.dataDir, 'sku-map.json'));
  const index = await DocumentIndex.open(join(opts.dataDir, 'documents.jsonl'));
  const pending = await PendingQueue.open(join(opts.dataDir, 'pending-batches.json'));
  const catalogue = await syncCatalogue(opts, scannedAt, warn);
  const resolver = new SkuResolver(catalogue, dictionary);

  // SKU si ma'lum shtrix-kodlar uchun OCR umuman chaqirilmaydi.
  const knownSku = (barcode: string) => resolver.resolve(barcode, null).trusted;

  // --- Sahifalarni o'qish (kelishi bilan) ---
  const total = Array.isArray(opts.pages) ? opts.pages.length : undefined;
  let extracted: PageExtraction[];
  try {
    await warm;
    extracted = [];
    let i = 0;
    for await (const path of opts.pages) {
      opts.onProgress?.({ type: 'page', index: i, total: total ?? i + 1, path });
      extracted.push(await extractPage(path, i, ocr, { knownSku }));
      i++;
    }
  } finally {
    if (ownOcr) await ocr.close();
  }

  const { documents, orphanPages } = groupIntoDocuments(extracted, { scannedAt });
  opts.onProgress?.({ type: 'grouped', documents: documents.length });
  if (orphanPages.length > 0) {
    warn(`${orphanPages.length} ta sahifa hech qanday hujjatga bog'lanmadi (sarlavha topilmadi)`);
  }

  // --- SKU: katalog > tasdiqlangan > OCR ---
  const trustedBarcodes = new Set<string>();
  let skuFromOcr = 0;
  for (const doc of documents) {
    for (const item of doc.items) {
      const resolved = resolver.resolve(item.itemBarcode, item.sku);
      item.sku = resolved.sku;

      if (resolved.trusted) {
        trustedBarcodes.add(item.itemBarcode);
      } else if (resolved.source === 'ocr') {
        skuFromOcr++;
        // Ishonarli ko'rinishdagi OCR natijasini keyingi safar uchun eslab qolamiz.
        if (resolved.sku && looksLikeValidSku(resolved.sku)) {
          dictionary.recordOcr(item.itemBarcode, resolved.sku, scannedAt);
        }
      }
    }
  }
  await dictionary.save();

  // --- Validatsiya ---
  const knownDocIds = index.docIds();
  for (const doc of documents) {
    validateDocument(doc, { knownDocIds, skuFromDictionary: trustedBarcodes });
  }

  // Sarlavha tekshiruvi va mavjud `Ид + ШК` kalitlarini o'qish (tarmoq)
  // PDF yozish (disk) bilan bir vaqtda ketadi.
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
      .filter((b): b is Buffer => b !== undefined)
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

  // --- Takror qatorlar: Ид + ШК allaqachon yozilgan bo'lsa tashlab ketiladi ---
  // Manba — Sheets'ning o'zi; Sheets o'chiq bo'lsa lokal indeks.
  let rowsSkipped = 0;
  let rowsRecovered = 0;
  let sheetsError: Error | undefined;
  const existing = existingKeys ? await existingKeys : index.rowKeys();
  if (existing instanceof Error) {
    sheetsError = existing;
  } else {
    // Navbat AVVAL bo'shatiladi: undagi qatorlar oldinroq skanerlangan,
    // shuning uchun jadvalda ham oldinroq turishi kerak. Bu tartib takror
    // tekshiruvi uchun ham to'g'ri — `markDuplicates` `existing` to'plamini
    // to'ldirib boradi, ya'ni shu to'plamda takrorlangan hujjat ushlanadi.
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
  const flaggedRows = countFlagged(documents);

  // --- Google Sheets ---
  let rowsAppended = 0;
  if (sheets) {
    try {
      if (sheetsError) throw sheetsError;
      const res = await sheets.appendDocuments(documents);
      rowsAppended = res.rowsAppended;
      opts.onProgress?.({
        type: 'sheets',
        rows: res.rowsAppended,
        flagged: res.flaggedRows,
        skipped: res.rowsSkipped,
      });
    } catch (err) {
      const message = (err as Error).message;
      // Qatorlar yo'qolmaydi: navbatga tushadi va keyingi muvaffaqiyatli
      // skanerlashda avtomatik yoziladi.
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
  }

  // --- Lokal indeks ---
  try {
    await index.append(documents);
  } catch (err) {
    warn(`Lokal indeksga yozib bo'lmadi: ${(err as Error).message}`);
  }

  return {
    documents,
    orphanPages: orphanPages.length,
    rowsAppended,
    flaggedRows,
    rowsSkipped,
    rowsRecovered,
    rowsPending: pending.rowCount,
    skuResolved: trustedBarcodes.size,
    skuFromOcr,
    catalogueEntries: catalogue.size,
    elapsedMs: Date.now() - started,
    warnings,
  };
}

/**
 * Oldin yozilmay qolgan hujjatlarni Sheets ga yozadi.
 *
 * Xato bo'lsa navbat SAQLANIB QOLADI va joriy to'plamni yozish davom etadi —
 * eski to'plamning muammosi yangi skanni to'sib qo'ymasligi kerak.
 *
 * @returns yozilgan qatorlar soni
 */
async function flushPending(
  pending: PendingQueue,
  sheets: SheetsWriter,
  existing: Set<string>,
  opts: RunOptions,
  warn: (message: string) => void,
): Promise<number> {
  const documents = pending.documents();
  if (documents.length === 0) return 0;

  const batches = pending.size;
  try {
    // Oradan vaqt o'tgan: qatorlar qo'lda yoki boshqa kompyuterdan
    // yozilgan bo'lishi mumkin — shuning uchun qaytadan tekshiriladi.
    markDuplicates(documents, existing);
    const res = await sheets.appendDocuments(documents);
    await pending.clear();
    opts.onProgress?.({ type: 'recovered', rows: res.rowsAppended, batches });
    return res.rowsAppended;
  } catch (err) {
    warn(
      `Navbatdagi ${pending.rowCount} ta qator hali ham yozilmadi: ${(err as Error).message}`,
    );
    return 0;
  }
}

/**
 * Katalogni ochadi va kerak bo'lsa yangilaydi.
 *
 * Yangilash muvaffaqiyatsiz bo'lsa ish to'xtamaydi: eski katalog bo'lsa
 * o'shandan foydalaniladi, bo'lmasa SKU OCR dan olinadi va qatorlar
 * tekshirishga belgilanadi.
 */
async function syncCatalogue(
  opts: RunOptions,
  now: Date,
  warn: (message: string) => void,
): Promise<SkuCatalogue> {
  const catalogue = await SkuCatalogue.open(join(opts.dataDir, 'sku-catalogue.json'));

  if (!opts.catalogue) {
    if (catalogue.size === 0) {
      warn('Uzum katalogi sozlanmagan — SKU faqat OCR dan olinadi (aniqlik ~47%)');
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

    if (fetched.conflicts.length > 0) {
      warn(
        `Katalogda ${fetched.conflicts.length} ta ziddiyatli shtrix-kod: ${fetched.conflicts[0]}`,
      );
    }
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
      if (item.duplicate) continue; // yozilmaydi — belgilanmaydi ham
      if (docHasError || item.issues.length > 0) count++;
    }
  }
  return count;
}
