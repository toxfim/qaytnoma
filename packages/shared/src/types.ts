/**
 * Barcodeer domen tiplari.
 *
 * Hujjat anatomiyasi uchun `CLAUDE.md` ga qarang: birinchi sahifada hujjat
 * shtrix-kodi (Code128, `15-0000163307`) va sarlavha bloklari bo'ladi; davomi
 * sahifalarda faqat jadval takrorlanadi. Shuning uchun sahifalarni hujjatlarga
 * guruhlash FAQAT hujjat shtrix-kodi orqali aniqlanadi.
 */

/** Piksel koordinatalaridagi to'rtburchak (rasm chap-yuqori burchagidan). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** ZXing dekodlagan bitta shtrix-kod. */
export interface BarcodeHit {
  /** Dekodlangan matn, masalan `15-0000163307` yoki `1000076316479`. */
  text: string;
  /** ZXing format nomi: `Code128`, `EAN-13`, ... */
  format: string;
  /** O'ralgan to'rtburchak — jadval qatorini bog'lash uchun asosiy anchor. */
  box: Box;
}

/** Skanerlangan yoki hot folder'dan olingan bitta sahifa rasmi. */
export interface ScanPage {
  /** To'plamdagi 0-dan boshlangan tartib raqami. */
  index: number;
  /** Diskdagi rasm yo'li (BMP/PNG/TIFF). */
  path: string;
  width: number;
  height: number;
  dpi: number;
}

export type IssueCode =
  | 'NO_DOC_BARCODE'
  | 'DOC_ID_FORMAT'
  | 'DOC_NUMBER_MISSING'
  | 'DOC_NUMBER_MISMATCH'
  | 'DOC_ID_MISMATCH'
  | 'DOC_DATE_MISSING'
  | 'DOC_DATE_FORMAT'
  | 'BARCODE_LENGTH'
  | 'BARCODE_CHECKSUM'
  | 'SKU_MISSING'
  | 'SKU_UNCONFIRMED'
  | 'QTY_MISSING'
  | 'QTY_INVALID'
  | 'ROW_COUNT_MISMATCH'
  | 'TOTAL_QTY_MISMATCH'
  | 'TOTALS_MISSING'
  | 'DUPLICATE_DOC'
  | 'DUPLICATE_ROW'
  | 'COLUMN_DETECTION_FALLBACK'
  | 'VLM_SOURCED';

export type IssueSeverity = 'error' | 'warn';

/** Validatsiya muammosi. Bittasi ham bo'lsa qator `⚠` bilan belgilanadi. */
export interface Issue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  /** Qaysi maydonga tegishli: `quantity`, `sku`, `docNumber`, ... */
  field?: string;
  /** Jadvaldagi qator raqami (`№` ustuni), agar tegishli bo'lsa. */
  rowNumber?: number;
}

/** Jadvalning bitta mahsulot qatori. */
export interface LineItem {
  /** `№` ustuni. OCR bo'lmasa — jadvaldagi tartib bo'yicha hisoblangan qiymat. */
  rowNumber: number | null;
  /** `SKU товара` — lotin+kirill aralash, whitelist qo'llanmaydi. */
  sku: string | null;
  /** `Штрих-код` — OCR emas, dekodlangan shtrix-koddan olinadi. */
  itemBarcode: string;
  /** `Кол-во` — faqat chop etilgan qiymat; qo'lyozma tuzatishlar hisobga olinmaydi. */
  quantity: number | null;
  /** OCR xom natijasi — diagnostika uchun (`3 5` kabi shovqinni ko'rish). */
  quantityRaw: string | null;
  /**
   * Qiymat qayerdan olindi.
   *
   * `vlm` — deterministik yo'l muvaffaqiyatsiz bo'lgani uchun til modeli
   * o'qigan. Bunday qiymat jadvalga yoziladi, ammo har doim `⚠` bilan
   * belgilanadi (`VLM_SOURCED`): model taxmin qilishi mumkin, dekoder esa
   * yo'q. `undefined` — model umuman ishlatilmagan.
   */
  quantitySource?: 'ocr' | 'vlm';
  skuSource?: 'ocr' | 'vlm';
  /** Qator qaysi sahifada topilgani (to'plamdagi indeks). */
  pageIndex: number;
  issues: Issue[];
  /**
   * `Ид документа + ШК` juftligi allaqachon yozilgan — qator Sheets'ga
   * yozilmaydi, faqat `_log` da qayd etiladi (`pipeline/dedupe.ts`).
   */
  duplicate?: boolean;
}

/** `Итого` qatoridan olingan jami qiymatlar. */
export interface DocumentTotals {
  quantity: number | null;
  sum: number | null;
}

/** Bitta to'liq hujjat (bir yoki bir necha sahifa). */
export interface InvoiceDocument {
  /** `Ид документа` — Code128 qiymati, masalan `15-0000163307`. */
  docId: string;
  /** `Номер документа` — hujjatda chop etilgan raqam, masalan `163307`. */
  docNumber: string | null;
  /** `Дата составления`, masalan `2026-03-05 19:38`. */
  docDate: string | null;
  pages: ScanPage[];
  items: LineItem[];
  totals: DocumentTotals;
  /** Hujjat darajasidagi muammolar (qator darajasidagilar `items[].issues` da). */
  issues: Issue[];
  /**
   * Dekodlangan shtrix-kod chop etilgan `Номер документа` ga mos kelmadi.
   * Ikki mustaqil manba bir-biriga zid — qator albatta tekshirilishi kerak.
   */
  docIdMismatch?: boolean;
  /** Skanerlangan vaqt (ISO 8601). */
  scannedAt: string;
  /** Saqlangan PDF yo'li, yozilgandan keyin to'ldiriladi. */
  pdfPath?: string;
}

/** Bitta skanerlash seansining natijasi. */
export interface BatchResult {
  documents: InvoiceDocument[];
  /** Hech bir hujjatga tegishli bo'lmagan sahifalar (birinchi sahifada shtrix-kod topilmadi). */
  orphanPages: ScanPage[];
  totalPages: number;
  elapsedMs: number;
}

/** Google Sheets asosiy varaqdagi ustunlar tartibi. */
export const SHEET_HEADERS = [
  'Номер документа',
  'Ид документа',
  'Дата составления',
  'СКУ',
  'ШК',
  'Кол-во',
] as const;

/** Diagnostika varag'i (`_log` tab) ustunlari. */
export const LOG_SHEET_HEADERS = [
  'Скан. время',
  'Ид документа',
  'Номер документа',
  '№ строки',
  'Поле',
  'Код',
  'Уровень',
  'Сообщение',
  'PDF',
] as const;
