/**
 * Bitta sahifadan barcha ma'lumotni ajratib olish.
 *
 * Bosqichlar tartibi ahamiyatli:
 *   1. sahifani tayyorlash (deskew + binarizatsiya)
 *   2. mahsulot jadvalining to'rini topish
 *   3. jadval boshlanish balandligiga qarab sahifa turini aniqlash
 *   4. sarlavha sahifasi bo'lsa — hujjat maydonlarini o'qish
 *   5. har bir qatordan shtrix-kod (dekoder), SKU va Кол-во (OCR) olish
 *   6. `Итого` qatorini o'qish
 */
import sharp from 'sharp';
import type { Box } from '@barcodeer/shared';
import { fullImage, preparePage, WORK_WIDTH, type PreparedPage } from '../layout/page.js';
import { detectItemTable, findHorizontalLines, type TableGrid } from '../layout/grid.js';
import {
  barcodeCandidates,
  resolveColumns,
  shiftColumns,
  type ColumnMap,
} from '../layout/columns.js';
import { BARCODE_CELL, NUMBER_CELL, SKU_CELL, cellBox, cropFull } from '../layout/cells.js';
import { acceptDocId, acceptItemBarcode, decodeCrop } from '../barcode/decode.js';
import { removeBlueInk } from '../image/ink.js';
import { prepareForOcr } from '../image/bbox.js';
import type { OcrEngine } from '../ocr/engine.js';
import {
  HEADER_REGION,
  docIdFromNumber,
  docNumberFromId,
  parseHeaderFields,
  type HeaderFields,
} from '../ocr/header-fields.js';
import { mergeSkuPasses } from '../ocr/sku.js';
import { normalizeSku, parseQuantity, parseTotal } from '../ocr/parse.js';

/**
 * Jadval sahifaning shu ulushidan pastda boshlansa — sarlavha sahifasi.
 * O'lchangan: sarlavha sahifalari 32.7% / 33.2% / 33.4%, davomi sahifasi 2.1%.
 */
const HEADER_PAGE_TABLE_TOP = 0.15;

/**
 * Arxiv PDF uchun rasm kengligi va sifati.
 * ~300 DPI A4 — keyinchalik qayta o'qish uchun yetarli, JPEG q80 da
 * sahifasiga ~300-500 KB.
 */
const ARCHIVE_WIDTH = WORK_WIDTH;
const ARCHIVE_QUALITY = 80;

/** OCR uchun uchta tayyorgarlik varianti — ular bo'yicha ovoz beriladi. */
const OCR_VARIANTS = [
  { targetHeight: 80, threshold: 160 },
  { targetHeight: 120, threshold: 0 },
  { targetHeight: 60, threshold: 190 },
] as const;

/**
 * Sarlavha hududi uchun binarizatsiya ostonalari.
 *
 * Bitta o'qishga tayanish beqaror bo'lib chiqdi: bir xil hujjatning ikki
 * skanida bir marta `163307`, ikkinchisida `165307` o'qildi. Bir necha
 * ostonada o'qib, har bir maydon bo'yicha alohida ovoz berish buni bartaraf
 * qiladi — o'lchovda 6 variantdan 5 tasi to'g'ri qiymatni bergan edi.
 */
const HEADER_THRESHOLDS = [170, 140, 195, 0] as const;

export interface ExtractedRow {
  /** Jadvaldagi band indeksi — diagnostika uchun. */
  bandIndex: number;
  itemBarcode: string;
  sku: string | null;
  skuLatin: string | null;
  skuCyrillic: string | null;
  quantity: number | null;
  quantityRaw: string | null;
  /** OCR variantlarining o'zaro mosligi (0..1) — past qiymat shubha belgisi. */
  quantityAgreement: number;
  /** Katak kesmasi PNG — `needs_review` UI uchun. */
  quantityCrop?: Buffer;
  skuCrop?: Buffer;
}

export interface ExtractedTotals {
  quantity: number | null;
  sum: number | null;
}

export interface PageExtraction {
  path: string;
  pageIndex: number;
  isHeaderPage: boolean;
  skewDeg: number;
  /** Sarlavha sahifasida to'ldiriladi. */
  docId: string | null;
  docNumber: string | null;
  docDate: string | null;
  /** Shtrix-kod dekoderi hujjat kodini o'qiy oldimi (so'nib qolgan bo'lsa yo'q). */
  docIdFromBarcode: boolean;
  /** Dekodlangan shtrix-kod chop etilgan raqamga mos kelmadi. */
  docIdMismatch: boolean;
  /** Jadval sarlavha sahifasidek joylashgan, ammo sana ham, shtrix-kod ham yo'q. */
  headerEvidenceMissing: boolean;
  /** Aniqlangan ustun xaritasi. */
  columns: ColumnMap | null;
  rows: ExtractedRow[];
  totals: ExtractedTotals;
  /** To'r topilmadi — sahifa mahsulot jadvalisiz (masalan faqat imzo sahifasi). */
  gridFound: boolean;
  width: number;
  height: number;
  /** Deskew qilingan sahifaning JPEG nusxasi — arxiv PDF uchun. */
  archiveJpeg: Buffer;
}

export interface ExtractOptions {
  /** Katak kesmalarini natijaga qo'shish (review UI uchun). Sekinlashtiradi. */
  keepCrops?: boolean;
}

export async function extractPage(
  path: string,
  pageIndex: number,
  ocr: OcrEngine,
  opts: ExtractOptions = {},
): Promise<PageExtraction> {
  const page = await preparePage(path);
  const grid = detectItemTable(page.bin, page.width, page.height);

  // Arxiv nusxasi deskew qilingan variantdan olinadi — foydalanuvchi PDF ni
  // ochganda to'g'rilangan sahifani ko'radi.
  const archiveJpeg = await fullImage(page)
    .resize({ width: ARCHIVE_WIDTH, kernel: 'lanczos3' })
    .jpeg({ quality: ARCHIVE_QUALITY, mozjpeg: true })
    .toBuffer();

  const base: PageExtraction = {
    path,
    pageIndex,
    isHeaderPage: false,
    skewDeg: page.skewDeg,
    docId: null,
    docNumber: null,
    docDate: null,
    docIdFromBarcode: false,
    docIdMismatch: false,
    headerEvidenceMissing: false,
    columns: null,
    rows: [],
    totals: { quantity: null, sum: null },
    gridFound: grid !== null,
    width: page.width,
    height: page.height,
    archiveJpeg,
  };

  if (!grid) {
    // Jadval yo'q — sahifa baribir sarlavhali bo'lishi mumkin (masalan bitta
    // qatorli hujjatda jadval juda kichik). Sarlavha maydonlarini sinab ko'ramiz.
    Object.assign(base, await readHeader(page, ocr));
    return base;
  }

  // Ustunlar QAT'IY indeks bilan emas, jadval tuzilishidan aniqlanadi —
  // chetdagi chegara topilmasa indekslar siljib ketadi (`layout/columns.ts`).
  const columns = await resolveColumnsForPage(page, grid);
  base.columns = columns;
  if (!columns) {
    base.gridFound = false;
    return base;
  }

  // Sarlavha sahifasi: jadval pastroqdan boshlanadi VA sarlavha dalili bor.
  // Faqat geometriyaga tayanish xavfli bo'lib chiqdi — to'r qisman topilganda
  // davomi sahifasi sarlavha deb qabul qilinib, narx qiymatidan (`5850`)
  // soxta hujjat raqami yasalgan edi.
  const looksLikeHeader = grid.bounds.y / page.height > HEADER_PAGE_TABLE_TOP;
  if (looksLikeHeader) {
    const header = await readHeader(page, ocr);
    // Sana yoki dekodlangan shtrix-kod — sarlavha sahifasining ishonchli dalili.
    // Davomi sahifalarida ikkalasi ham bo'lmaydi.
    if (header.docDate !== null || header.docIdFromBarcode) {
      base.isHeaderPage = true;
      Object.assign(base, header);
    } else {
      base.headerEvidenceMissing = true;
    }
  }

  base.rows = await readRows(page, grid, columns, ocr, opts);
  base.totals = await readTotals(page, grid, columns, ocr);
  return base;
}

/**
 * Ustun xaritasini aniqlaydi va shtrix-kod ustunini amalda tekshiradi.
 *
 * Kenglik qoidasi (`Описание` eng keng) barcha o'lchangan skanlarda ishladi,
 * ammo u jimgina xato qilsa butun sahifa yo'qoladi — shuning uchun bir nechta
 * bandda haqiqatan shtrix-kod o'qilishini tekshiramiz va kerak bo'lsa qo'shni
 * ustunga suramiz.
 */
async function resolveColumnsForPage(
  page: PreparedPage,
  grid: TableGrid,
): Promise<ColumnMap | null> {
  const initial = resolveColumns(grid);
  if (!initial) return null;

  const bandCount = grid.rowEdges.length - 1;
  // Sarlavha va `Итого` bandlarini chetlab o'tish uchun o'rtadan olamiz.
  const probes: number[] = [];
  for (const fraction of [0.35, 0.6, 0.85]) {
    const band = Math.min(bandCount - 1, Math.max(0, Math.round(bandCount * fraction)));
    if (!probes.includes(band)) probes.push(band);
  }

  for (const candidate of barcodeCandidates(grid, initial.barcode)) {
    let hits = 0;
    for (const band of probes) {
      const box = cellBox(grid, band, candidate, BARCODE_CELL);
      if (!box) continue;
      if (await decodeCrop(cropFull(page, box), { accept: acceptItemBarcode })) hits++;
    }
    if (hits > 0) {
      return candidate === initial.barcode ? initial : shiftColumns(grid, candidate);
    }
  }

  // Hech bir ustunda shtrix-kod topilmadi — jadval bo'lmasligi mumkin
  // (masalan faqat imzo sahifasi). Dastlabki xaritani qaytaramiz.
  return initial;
}

/**
 * Sarlavha hududidan hujjat maydonlarini o'qiydi.
 *
 * `Ид документа` ni aniqlash tartibi (ishonchlilik bo'yicha):
 *   1. dekodlangan shtrix-kod — aniq qiymat;
 *   2. chop etilgan `Номер документа` dan qayta tiklangan ID — raqam
 *      shtrix-kod ostidagi matndan ancha barqaror o'qiladi;
 *   3. shtrix-kod ostidagi matnning o'zi — eng oxirgi zaxira.
 */
async function readHeader(
  page: PreparedPage,
  ocr: OcrEngine,
): Promise<
  Pick<PageExtraction, 'docId' | 'docNumber' | 'docDate' | 'docIdFromBarcode' | 'docIdMismatch'>
> {
  const box: Box = {
    x: Math.round(page.width * HEADER_REGION.xFrac),
    y: Math.round(page.height * HEADER_REGION.yFrac),
    width: Math.round(page.width * HEADER_REGION.widthFrac),
    height: Math.round(page.height * HEADER_REGION.heightFrac),
  };

  // 1) Shtrix-kodni dekodlashga urinamiz — bu eng ishonchli manba.
  const decoded = await decodeCrop(cropFull(page, box), { accept: acceptDocId });

  // 2) Hududni bir necha ostonada o'qib, maydonlar bo'yicha ovoz beramiz.
  const ink = await removeBlueInk(cropFull(page, box));
  const readings: HeaderFields[] = [];
  for (const threshold of HEADER_THRESHOLDS) {
    let pipe = sharp(ink.data, {
      raw: { width: ink.width, height: ink.height, channels: 1 },
    }).normalize();
    if (threshold > 0) pipe = pipe.threshold(threshold);

    const png = await pipe.withMetadata({ density: 300 }).png().toBuffer();
    readings.push(parseHeaderFields((await ocr.read(png, 'headerBlock')).text));
  }

  const docNumber = vote(readings.map((r) => r.docNumber));
  const docDate = vote(readings.map((r) => r.docDate));
  const docIdFromText = vote(readings.map((r) => r.docIdFromText));

  const derived = docNumber ? docIdFromNumber(docNumber) : null;
  const docId = decoded?.text ?? derived ?? docIdFromText;

  // Shtrix-kod ham, raqam ham o'qilgan bo'lsa — ular mos kelishi shart.
  const mismatch = decoded !== null && derived !== null && decoded.text !== derived;

  return {
    docId,
    // Raqam ID dan hosil qilinadi, chunki ID (dekodlangan bo'lsa) aniqroq.
    docNumber: docId ? docNumberFromId(docId) : docNumber,
    docDate,
    docIdFromBarcode: decoded !== null,
    docIdMismatch: mismatch,
  };
}

/** Eng ko'p uchragan qiymatni qaytaradi; `null` lar hisobga olinmaydi. */
function vote<T extends string>(values: readonly (T | null)[]): T | null {
  const tally = new Map<T, number>();
  for (const v of values) {
    if (v === null) continue;
    tally.set(v, (tally.get(v) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestCount = 0;
  for (const [value, count] of tally) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Jadvalning har bir bandidan qator ma'lumotlarini o'qiydi. */
async function readRows(
  page: PreparedPage,
  grid: TableGrid,
  columns: ColumnMap,
  ocr: OcrEngine,
  opts: ExtractOptions,
): Promise<ExtractedRow[]> {
  const bandCount = grid.rowEdges.length - 1;
  const rows: ExtractedRow[] = [];

  for (let band = 0; band < bandCount; band++) {
    const barcodeBox = cellBox(grid, band, columns.barcode, BARCODE_CELL);
    if (!barcodeBox) continue;

    // Shtrix-kodli band = mahsulot qatori. Sarlavha va `Итого` bandlari
    // shu tekshiruvda tabiiy ravishda chetlab o'tiladi.
    const decoded = await decodeCrop(cropFull(page, barcodeBox), { accept: acceptItemBarcode });
    if (!decoded) continue;

    const row: ExtractedRow = {
      bandIndex: band,
      itemBarcode: decoded.text,
      sku: null,
      skuLatin: null,
      skuCyrillic: null,
      quantity: null,
      quantityRaw: null,
      quantityAgreement: 0,
    };

    // --- Кол-во ---
    const qtyBox =
      columns.quantity === null ? null : cellBox(grid, band, columns.quantity, NUMBER_CELL);
    if (qtyBox) {
      const ink = await removeBlueInk(cropFull(page, qtyBox));
      const variants = await Promise.all(
        OCR_VARIANTS.map((v) => prepareForOcr(ink.data, ink.width, ink.height, v)),
      );
      const voted = await ocr.readVoted(variants, 'digits');
      row.quantityRaw = voted.text;
      row.quantity = voted.text ? parseQuantity(voted.text) : null;
      row.quantityAgreement = voted.agreement;
      if (opts.keepCrops) row.quantityCrop = variants[0] ?? undefined;
    }

    // --- SKU: lotin + kirill o'tishlari ---
    const skuBox = columns.sku === null ? null : cellBox(grid, band, columns.sku, SKU_CELL);
    if (skuBox) {
      const ink = await removeBlueInk(cropFull(page, skuBox));
      const png = await prepareForOcr(ink.data, ink.width, ink.height, {
        targetHeight: 140,
        threshold: 160,
      });
      if (png) {
        const [latin, cyrillic] = await Promise.all([
          ocr.read(png, 'latin'),
          ocr.read(png, 'cyrillic'),
        ]);
        row.skuLatin = normalizeSku(latin.text);
        row.skuCyrillic = normalizeSku(cyrillic.text);
        row.sku = mergeSkuPasses(row.skuLatin, row.skuCyrillic);
        if (opts.keepCrops) row.skuCrop = png;
      }
    }

    rows.push(row);
  }

  return rows;
}

/**
 * `Итого` qatorini o'qiydi.
 *
 * `Итого` bandi mahsulot jadvalining to'riga KIRMAYDI: unda ustun chiziqlari
 * kamroq (`Итого:` yozuvi bir necha ustunni birlashtiradi), shuning uchun
 * `detectItemTable` uni ketma-ketlikka qo'shmaydi. Uni jadvalning pastki
 * chegarasidan keyingi birinchi gorizontal chiziqqacha bo'lgan band sifatida
 * alohida topamiz.
 */
async function readTotals(
  page: PreparedPage,
  grid: TableGrid,
  columns: ColumnMap,
  ocr: OcrEngine,
): Promise<ExtractedTotals> {
  const tableBottom = grid.rowEdges[grid.rowEdges.length - 1]!;
  const lines = findHorizontalLines(page.bin, page.width, page.height);
  const next = lines.find((l) => l.y > tableBottom + 4);
  if (!next) return { quantity: null, sum: null };

  const bandHeight = next.y - tableBottom;
  // Juda baland band — jadval tugagan, `Итого` yo'q.
  if (bandHeight > (grid.bounds.height / (grid.rowEdges.length - 1)) * 2.5) {
    return { quantity: null, sum: null };
  }

  const readCell = async (colIndex: number | null): Promise<number | null> => {
    if (colIndex === null) return null;
    const left = grid.columnEdges[colIndex];
    const right = grid.columnEdges[colIndex + 1];
    if (left === undefined) return null;

    const box: Box = {
      x: left + 4,
      y: tableBottom + Math.round(bandHeight * 0.15),
      width: (right ?? page.width - 8) - left - 8,
      height: Math.round(bandHeight * 0.7),
    };
    const ink = await removeBlueInk(cropFull(page, box));
    const variants = await Promise.all(
      OCR_VARIANTS.map((v) => prepareForOcr(ink.data, ink.width, ink.height, v)),
    );
    const voted = await ocr.readVoted(variants, 'digits');
    return voted.text ? parseTotal(voted.text) : null;
  };

  return {
    quantity: await readCell(columns.quantity),
    sum: await readCell(columns.sum),
  };
}
