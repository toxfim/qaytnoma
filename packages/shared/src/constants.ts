/** Hujjat shtrix-kodi formati: `15-0000163307`. */
export const DOC_ID_RE = /^\d{2}-\d{10}$/;

/** Mahsulot shtrix-kodi: 13 xonali. */
export const ITEM_BARCODE_RE = /^\d{13}$/;

/** `Дата составления` formati: `2026-03-05 19:38`. */
export const DOC_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

/**
 * Jadval ustunlari — chapdan o'ngga.
 * Nisbiy kengliklar `docs/EXAMPLE/example_document.png` (826 px keng) dan
 * o'lchangan va faqat ZAXIRA sifatida ishlatiladi: asosiy usul —
 * binarizatsiya qilingan rasmda vertikal chiziqlarni topish.
 */
export const TABLE_COLUMNS = [
  { key: 'rowNumber', label: '№' },
  { key: 'sku', label: 'SKU товара' },
  { key: 'description', label: 'Описание товара' },
  { key: 'barcode', label: 'Штрих-код' },
  { key: 'price', label: 'Закупочная цена (сум)' },
  { key: 'quantity', label: 'Кол-во (шт.)' },
  { key: 'sum', label: 'Сумма (сум)' },
] as const;

export type ColumnKey = (typeof TABLE_COLUMNS)[number]['key'];

/**
 * Ustun chegaralarining sahifa kengligiga nisbatan ulushi (zaxira rejim).
 * `example_document.png` (826x1169) dan piksel bo'yicha o'lchangan.
 */
export const COLUMN_FRACTIONS: Record<ColumnKey, [number, number]> = {
  rowNumber: [0.051, 0.094],
  sku: [0.094, 0.257],
  description: [0.257, 0.567],
  barcode: [0.567, 0.733],
  price: [0.733, 0.838],
  quantity: [0.838, 0.900],
  sum: [0.900, 0.957],
};

/**
 * Ko'k siyoh maskasi ostonasi: `B - max(R,G) > BLUE_INK_THRESHOLD` bo'lsa
 * piksel ko'k ruchka/muhr deb hisoblanadi va oqqa aylantiriladi.
 * Foydalanuvchi qarori: qo'lyozma tuzatishlar hisobga olinmaydi.
 */
export const BLUE_INK_THRESHOLD = 18;

/** OCR uchun ishchi ruxsat. 600 DPI skandan shu darajaga tushiriladi. */
export const WORKING_DPI = 300;

/**
 * Skanerlashning standart ruxsati.
 *
 * 300, 600 emas: 600 DPI skanlarni 300 ga tushirib o'lchanganda aniqlik
 * ZARRACHA o'zgarmadi (ikkala skan to'plamida ham 36/36 qator, 36/36 miqdor,
 * 3/3 hujjat maydoni), skanerlash esa ikki barobar, qayta ishlash esa
 * 17.5 s → 8.9 s/sahifa tezlashdi. To'r baribir 2481 px kenglikda ishlaydi,
 * OCR kesmalari esa standart balandlikka keltiriladi — 600 DPI dagi qo'shimcha
 * piksellar hech qayerda ishlatilmas edi.
 */
export const DEFAULT_SCAN_DPI = 300;
