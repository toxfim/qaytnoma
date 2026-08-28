/**
 * Validatsiya qoidalari.
 *
 * Muhim tamoyil (`CLAUDE.md`): marshrutlash HUJJAT bo'yicha emas, MAYDON
 * bo'yicha — faqat muammoli katak `needs_review` ga tushadi, qolgan qatorlar
 * normal yoziladi.
 *
 * `EAN-13` nazorat yig'indisi TEKSHIRILMAYDI: real skanlarda mahsulot
 * kodlari Code128 bo'lib chiqdi (13 xonali raqam, lekin EAN-13 emas),
 * shuning uchun `CLAUDE.md` dagi dastlabki taxmin o'rniga faqat uzunlik
 * va raqamlilik tekshiriladi.
 */
import {
  DOC_DATE_RE,
  DOC_ID_RE,
  ITEM_BARCODE_RE,
  type InvoiceDocument,
  type Issue,
} from '@barcodeer/shared';
import { looksLikeValidSku } from '../ocr/sku.js';

export interface ValidateOptions {
  /** Ushbu ID lar allaqachon qayta ishlangan (takroriy skan tekshiruvi). */
  knownDocIds?: ReadonlySet<string>;
  /**
   * SKU lug'atdan (inson tasdiqlagan) olingan shtrix-kodlar.
   *
   * Bu ro'yxatga kirmagan qatorlarning SKU si OCR dan olingan, OCR aniqligi
   * esa o'lchov bo'yicha ~50% — shuning uchun ular tekshirishga belgilanadi.
   */
  skuFromDictionary?: ReadonlySet<string>;
  /**
   * Tasdiqlanmagan SKU larni belgilash (standart: yoqilgan).
   *
   * Boshida deyarli barcha qatorlar belgilanadi; lug'at to'lgani sari
   * belgilar kamayib boradi. O'chirilsa, noto'g'ri SKU jimgina yozilishi
   * mumkin — shuning uchun ataylab standart holatda yoqilgan.
   */
  flagUnconfirmedSku?: boolean;
}

/** Hujjatni tekshiradi va muammolarni `doc.issues` / `item.issues` ga yozadi. */
export function validateDocument(doc: InvoiceDocument, opts: ValidateOptions = {}): void {
  doc.issues = [];

  // ---- Hujjat darajasi ----
  if (!doc.docId) {
    doc.issues.push(issue('NO_DOC_BARCODE', 'error', 'Hujjat shtrix-kodi topilmadi', 'docId'));
  } else if (!DOC_ID_RE.test(doc.docId)) {
    doc.issues.push(
      issue('DOC_ID_FORMAT', 'error', `Hujjat ID formati noto'g'ri: ${doc.docId}`, 'docId'),
    );
  }

  if (!doc.docNumber) {
    doc.issues.push(issue('DOC_NUMBER_MISSING', 'error', 'Hujjat raqami o`qilmadi', 'docNumber'));
  }

  // Shtrix-kod ham, chop etilgan raqam ham o'qilgan bo'lsa, ular bir xil
  // qiymatni bildirishi shart. Zid bo'lsa qaysi biri to'g'riligini bilib
  // bo'lmaydi — hujjat albatta ko'zdan kechirilishi kerak.
  if (doc.docIdMismatch) {
    doc.issues.push(
      issue(
        'DOC_ID_MISMATCH',
        'error',
        'Shtrix-kod va chop etilgan hujjat raqami bir-biriga mos kelmadi',
        'docId',
      ),
    );
  }

  if (!doc.docDate) {
    doc.issues.push(issue('DOC_DATE_MISSING', 'warn', 'Tuzilgan sana o`qilmadi', 'docDate'));
  } else if (!DOC_DATE_RE.test(doc.docDate)) {
    doc.issues.push(
      issue('DOC_DATE_FORMAT', 'warn', `Sana formati noto'g'ri: ${doc.docDate}`, 'docDate'),
    );
  }

  if (doc.docId && opts.knownDocIds?.has(doc.docId)) {
    doc.issues.push(
      issue('DUPLICATE_DOC', 'warn', `Bu hujjat allaqachon qayta ishlangan: ${doc.docId}`, 'docId'),
    );
  }

  // ---- Qator darajasi ----
  for (const item of doc.items) {
    item.issues = [];

    if (!ITEM_BARCODE_RE.test(item.itemBarcode)) {
      item.issues.push(
        issue(
          'BARCODE_LENGTH',
          'error',
          `Mahsulot shtrix-kodi 13 xonali emas: ${item.itemBarcode}`,
          'itemBarcode',
          item.rowNumber,
        ),
      );
    }

    if (item.quantity === null) {
      item.issues.push(
        issue('QTY_MISSING', 'error', 'Miqdor o`qilmadi', 'quantity', item.rowNumber),
      );
    } else if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      item.issues.push(
        issue(
          'QTY_INVALID',
          'error',
          `Miqdor musbat butun son emas: ${item.quantity}`,
          'quantity',
          item.rowNumber,
        ),
      );
    }

    const fromDict = opts.skuFromDictionary?.has(item.itemBarcode) ?? false;
    if (!item.sku) {
      item.issues.push(issue('SKU_MISSING', 'error', 'SKU o`qilmadi', 'sku', item.rowNumber));
    } else if (fromDict) {
      // Lug'atdagi tasdiqlangan qiymat — tekshirish shart emas.
    } else if (!looksLikeValidSku(item.sku)) {
      item.issues.push(
        issue(
          'SKU_MISSING',
          'warn',
          `SKU kutilgan shaklga mos emas: ${item.sku}`,
          'sku',
          item.rowNumber,
        ),
      );
    } else if (opts.flagUnconfirmedSku ?? true) {
      item.issues.push(
        issue(
          'SKU_UNCONFIRMED',
          'warn',
          `SKU OCR dan olingan va hali tasdiqlanmagan: ${item.sku}`,
          'sku',
          item.rowNumber,
        ),
      );
    }
  }

  // ---- Yig'indi tekshiruvi ----
  // Bu eng kuchli tekshiruv: alohida kataklardagi OCR xatosi bu yerda
  // albatta ko'rinadi.
  const readable = doc.items.filter((i) => i.quantity !== null);
  const sumQty = readable.reduce((acc, i) => acc + (i.quantity ?? 0), 0);

  if (doc.totals.quantity === null) {
    doc.issues.push(
      issue('TOTALS_MISSING', 'warn', '`Итого` qatoridagi miqdor o`qilmadi', 'totals'),
    );
  } else if (sumQty !== doc.totals.quantity) {
    // Tekshiruv o'qilmagan kataklar bo'lsa ham BAJARILADI. Ilgari u shunday
    // holatda o'tkazib yuborilardi va aynan eng xavfli vaziyatda — qator
    // butunlay yo'qolganda — jim qolardi: 26 qatordan 25 tasi o'qilib,
    // yig'indi 166 o'rniga 112 chiqqanda hech qanday ogohlantirish bo'lmagan.
    const unreadable = doc.items.length - readable.length;
    doc.issues.push(
      issue(
        'TOTAL_QTY_MISMATCH',
        'error',
        `Miqdorlar yig'indisi (${sumQty}) \`Итого\` qiymatiga (${doc.totals.quantity}) mos kelmadi` +
          (unreadable > 0 ? `; ${unreadable} ta katak o'qilmadi` : '') +
          `. Yo'qolgan qator bo'lishi mumkin.`,
        'totals',
      ),
    );
  }

  if (doc.items.length === 0) {
    doc.issues.push(issue('ROW_COUNT_MISMATCH', 'error', 'Hujjatda birorta qator topilmadi'));
  }
}

/** Qatorda `needs_review` ga sabab bo'ladigan muammo bormi. */
export function rowNeedsReview(doc: InvoiceDocument, index: number): boolean {
  const item = doc.items[index];
  if (!item) return true;
  // Takror qator yozilmaydi — tekshiruvga ham tushmaydi.
  if (item.duplicate) return false;
  // Hujjat darajasidagi xatolar barcha qatorlarga tegishli.
  return item.issues.length > 0 || doc.issues.some((i) => i.severity === 'error');
}

function issue(
  code: Issue['code'],
  severity: Issue['severity'],
  message: string,
  field?: string,
  rowNumber?: number | null,
): Issue {
  const result: Issue = { code, severity, message };
  if (field) result.field = field;
  if (rowNumber != null) result.rowNumber = rowNumber;
  return result;
}
