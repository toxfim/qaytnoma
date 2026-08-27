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

/** Hujjat shtrix-kodi joylashgan hudud — sarlavha hududining o'ng qismi. */
const DOC_BARCODE_REGION = { xFrac: 0.66, yFrac: 0, widthFrac: 0.34, heightFrac: 0.11 } as const;

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
  /** `Итого` miqdorining barcha OCR o'qishlari — qatorlar bilan moslashtirish uchun. */
  quantityCandidates: number[];
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
  /**
   * Shtrix-kod bo'yicha SKU allaqachon ma'lummi (katalog yoki tasdiqlangan
   * lug'at). `true` qaytarsa SKU katagi OCR qilinmaydi — bu sahifasiga
   * ~3.5 s tejaydi (13 qator x 2 o'tish), natija esa baribir katalogdan olinadi.
   */
  knownSku?: (barcode: string) => boolean;
  /** Bir vaqtda qayta ishlanadigan qatorlar soni. */
  rowConcurrency?: number;
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
  // ochganda to'g'rilangan sahifani ko'radi. Kodlash asosiy yo'ldan tashqarida
  // (libvips o'z thread pool'ida) boshlanadi va faqat oxirida kutiladi.
  // `mozjpeg` yo'q: faylni ~10% kichraytirardi, ammo 3 barobar sekin (920 ms).
  const archivePromise = fullImage(page)
    .resize({ width: ARCHIVE_WIDTH, kernel: 'lanczos3' })
    .jpeg({ quality: ARCHIVE_QUALITY })
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
    totals: { quantity: null, sum: null, quantityCandidates: [] },
    gridFound: grid !== null,
    width: page.width,
    height: page.height,
    archiveJpeg: Buffer.alloc(0),
  };

  if (!grid) {
    // Jadval yo'q — sahifa baribir sarlavhali bo'lishi mumkin (masalan bitta
    // qatorli hujjatda jadval juda kichik). Sarlavha maydonlarini sinab ko'ramiz.
    Object.assign(base, await readHeader(page, ocr));
    base.archiveJpeg = await archivePromise;
    return base;
  }

  // Ustunlar QAT'IY indeks bilan emas, jadval tuzilishidan aniqlanadi —
  // chetdagi chegara topilmasa indekslar siljib ketadi (`layout/columns.ts`).
  const columns = await resolveColumnsForPage(page, grid);
  base.columns = columns;
  if (!columns) {
    base.gridFound = false;
    base.archiveJpeg = await archivePromise;
    return base;
  }

  // Sarlavha, qatorlar va `Итого` bir-biriga bog'liq emas — parallel o'qiladi.
  // Sarlavha `headerBlock` pool'ini, qatorlar `digits` pool'ini ishlatadi,
  // shuning uchun ular bir-birini kutmaydi.
  const looksLikeHeader = grid.bounds.y / page.height > HEADER_PAGE_TABLE_TOP;
  const [header, rows, totals] = await Promise.all([
    looksLikeHeader ? readHeader(page, ocr) : null,
    readRows(page, grid, columns, ocr, opts),
    readTotals(page, grid, columns, ocr),
  ]);

  // Sarlavha sahifasi: jadval pastroqdan boshlanadi VA sarlavha dalili bor.
  // Faqat geometriyaga tayanish xavfli bo'lib chiqdi — to'r qisman topilganda
  // davomi sahifasi sarlavha deb qabul qilinib, narx qiymatidan (`5850`)
  // soxta hujjat raqami yasalgan edi. Sana yoki dekodlangan shtrix-kod —
  // ishonchli dalil; davomi sahifalarida ikkalasi ham bo'lmaydi.
  if (header) {
    if (header.docDate !== null || header.docIdFromBarcode) {
      base.isHeaderPage = true;
      Object.assign(base, header);
    } else {
      base.headerEvidenceMissing = true;
    }
  }

  base.rows = rows;
  base.totals = reconcileTotals(totals, rows);
  base.archiveJpeg = await archivePromise;
  return base;
}

/**
 * `Итого` ni qatorlar yig'indisi bilan moslashtiradi.
 *
 * `Итого` katagi bir necha marta (3 variant x 2 PSM rejimi) o'qiladi. Ovoz
 * berish natijasi yig'indiga mos kelmasa, ammo o'qishlardan BIRI mos kelsa —
 * o'sha olinadi: qatorlar mustaqil o'qilgan, ularning yig'indisi bilan tasodifan
 * ustma-ust tushgan OCR xatosi ehtimoli juda kichik. Bu `11` → `1` kabi
 * misreading'lar butun hujjatni bekorga tekshiruvga belgilashining oldini oladi.
 * Hech bir o'qish mos kelmasa, ovoz berish natijasi qoladi va validatsiya
 * nomuvofiqlikni ko'rsatadi.
 */
function reconcileTotals(totals: ExtractedTotals, rows: readonly ExtractedRow[]): ExtractedTotals {
  if (rows.length === 0 || rows.some((r) => r.quantity === null)) return totals;
  const sum = rows.reduce((acc, r) => acc + (r.quantity ?? 0), 0);
  if (totals.quantity === sum) return totals;
  if (totals.quantityCandidates.includes(sum)) return { ...totals, quantity: sum };
  return totals;
}

/** Elementlarni cheklangan parallellikda, tartibni saqlab qayta ishlaydi. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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

  // Shtrix-kod faqat hududning o'ng qismida — butun sarlavha hududini
  // dekodlash (4 masshtabda) 2.3 s olardi, tor kesma esa bir necha yuz ms.
  const barcodeBox: Box = {
    x: Math.round(page.width * DOC_BARCODE_REGION.xFrac),
    y: Math.round(page.height * DOC_BARCODE_REGION.yFrac),
    width: Math.round(page.width * DOC_BARCODE_REGION.widthFrac),
    height: Math.round(page.height * DOC_BARCODE_REGION.heightFrac),
  };

  // Dekod va OCR bir vaqtda: ular turli resurslarni ishlatadi
  // (WASM ZXing vs Tesseract worker pool).
  const [decoded, readings] = await Promise.all([
    decodeCrop(cropFull(page, barcodeBox), { accept: acceptDocId }),
    readHeaderText(page, box, ocr),
  ]);

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

/** Sarlavha hududini bir necha ostonada PARALLEL o'qiydi. */
async function readHeaderText(page: PreparedPage, box: Box, ocr: OcrEngine): Promise<HeaderFields[]> {
  const ink = await removeBlueInk(cropFull(page, box));
  return Promise.all(
    HEADER_THRESHOLDS.map(async (threshold) => {
      let pipe = sharp(ink.data, {
        raw: { width: ink.width, height: ink.height, channels: 1 },
      }).normalize();
      if (threshold > 0) pipe = pipe.threshold(threshold);
      const png = await pipe.withMetadata({ density: 300 }).png().toBuffer();
      return parseHeaderFields((await ocr.read(png, 'headerBlock')).text);
    }),
  );
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
  const bands = Array.from({ length: bandCount }, (_, i) => i);

  // Qatorlar bir-biriga bog'liq emas — bir necha qator bir vaqtda o'qiladi.
  // Ketma-ket 13 qator ~2.2 s edi; parallel + worker pool bilan ancha kam.
  // Tartib `mapLimit` tomonidan saqlanadi.
  const results = await mapLimit(bands, opts.rowConcurrency ?? 4, async (band) => {
    const barcodeBox = cellBox(grid, band, columns.barcode, BARCODE_CELL);
    if (!barcodeBox) return null;

    // Shtrix-kodli band = mahsulot qatori. Sarlavha va `Итого` bandlari
    // shu tekshiruvda tabiiy ravishda chetlab o'tiladi.
    const decoded = await decodeCrop(cropFull(page, barcodeBox), { accept: acceptItemBarcode });
    if (!decoded) return null;

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

    // --- SKU: lotin + kirill o'tishlari — FAQAT katalogda yo'q bo'lsa ---
    const skuKnown = opts.knownSku?.(decoded.text) ?? false;
    const skuBox =
      skuKnown || columns.sku === null ? null : cellBox(grid, band, columns.sku, SKU_CELL);
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

    return row;
  });

  return results.filter((r): r is ExtractedRow => r !== null);
}

/**
 * `Итого` qatorining balandligi — sahifa balandligiga nisbatan.
 *
 * Shablonda bu qator har doim bitta matn qatori (~6 mm, 300 DPI da ~73 px,
 * ya'ni 0.021 x 3510). Uni jadval ostidan keyingi gorizontal chiziq orqali
 * topish ishonchsiz bo'lib chiqdi: qiyshiq skanda qatorning pastki chizig'i
 * so'lg'in bo'lib topilmadi va keyingi chiziq (imzo bloki, +279 px) olindi —
 * kesma `166` ning ostiga tushib ketdi. Endi chiziq faqat chegara sifatida
 * ishlatiladi, balandlik esa shablondan olinadi.
 */
const TOTALS_ROW_HEIGHT_FRAC = 0.021;

/**
 * `Итого` qatorini o'qiydi.
 *
 * `Итого` bandi mahsulot jadvalining to'riga KIRMAYDI: unda ustun chiziqlari
 * kamroq (`Итого:` yozuvi bir necha ustunni birlashtiradi), shuning uchun
 * `detectItemTable` uni ketma-ketlikka qo'shmaydi. U jadvalning pastki
 * chegarasidan boshlanadi; balandligi shablondan ma'lum.
 */
async function readTotals(
  page: PreparedPage,
  grid: TableGrid,
  columns: ColumnMap,
  ocr: OcrEngine,
): Promise<ExtractedTotals> {
  const empty: ExtractedTotals = { quantity: null, sum: null, quantityCandidates: [] };
  const tableBottom = grid.rowEdges[grid.rowEdges.length - 1]!;
  const templateHeight = Math.round(page.height * TOTALS_ROW_HEIGHT_FRAC);

  // Keyingi chiziq topilsa va u shablon balandligiga yaqin bo'lsa — aniqroq
  // qiymat sifatida ishlatamiz; bo'lmasa shablonning o'zi.
  const lines = findHorizontalLines(page.bin, page.width, page.height);
  const next = lines.find((l) => l.y > tableBottom + 4);
  const measured = next ? next.y - tableBottom : null;
  const bandHeight =
    measured !== null && measured <= templateHeight * 1.3 ? measured : templateHeight;
  if (tableBottom + bandHeight > page.height) return empty;

  const readCell = async (
    colIndex: number | null,
  ): Promise<{ value: number | null; candidates: number[] }> => {
    if (colIndex === null) return { value: null, candidates: [] };
    const left = grid.columnEdges[colIndex];
    const right = grid.columnEdges[colIndex + 1];
    if (left === undefined) return { value: null, candidates: [] };

    // Gorizontal inset `NUMBER_CELL` bilan bir xil sababdan katta (14%):
    // qiyshiq qog'ozda ustun chizig'i katak ichiga kirib, `11` ni `1` deb
    // o'qitardi — bu esa butun hujjatni bekorga tekshiruvga belgilardi.
    const cellRight = right ?? page.width;
    const inset = Math.round((cellRight - left) * 0.14);
    const box: Box = {
      x: left + inset,
      y: tableBottom + Math.round(bandHeight * 0.15),
      width: cellRight - left - inset * 2,
      height: Math.round(bandHeight * 0.7),
    };
    const ink = await removeBlueInk(cropFull(page, box));
    const variants = await Promise.all(
      OCR_VARIANTS.map((v) => prepareForOcr(ink.data, ink.width, ink.height, v)),
    );

    // Ikki PSM rejimida: PSM 8 takrorlangan ingichka gliflarni (`11`) birlashtirib
    // yuborishi mumkin, PSM 7 esa yakka raqamda zaifroq — birgalikda ishonchli.
    const [word, line] = await Promise.all([
      ocr.readVoted(variants, 'digits'),
      ocr.readVoted(variants, 'digitsLine'),
    ]);
    const candidates = [word.text, line.text]
      .map((t) => (t ? parseTotal(t) : null))
      .filter((n): n is number => n !== null);

    // Ikkalasi bir xil bo'lsa — aniq; farq qilsa PSM 8 (o'lchovda aniqroq) ustun,
    // `reconcileTotals` esa keyin qatorlar yig'indisiga qarab tanlaydi.
    const value = candidates[0] ?? null;
    return { value, candidates: [...new Set(candidates)] };
  };

  const [quantity, sum] = await Promise.all([readCell(columns.quantity), readCell(columns.sum)]);
  return { quantity: quantity.value, sum: sum.value, quantityCandidates: quantity.candidates };
}
