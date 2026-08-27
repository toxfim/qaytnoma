/**
 * Jadval ustunlarini aniqlash.
 *
 * NEGA QAT'IY INDEKS ISHLAMAYDI: dastlab ustunlar chapdan sanalardi
 * (`№`=0, `SKU`=1, `Описание`=2, `ШК`=3, ...). Bu jadvalning chap chegarasi
 * doim topiladi degan taxminga tayanardi. Real, kuchli qiyshaygan skanda
 * chap chegara topilmadi va BARCHA indekslar bittaga siljidi: `ШК` deb narx
 * ustuni o'qildi, hech bir qator shtrix-kod bermadi va sahifadagi 9 qatordan
 * atigi 3 tasi Sheets'ga tushdi — jimgina ma'lumot yo'qotish.
 *
 * BARQAROR BELGI: `Описание товара` — jadvaldagi eng keng ustun, va `Штрих-код`
 * har doim uning o'ng qo'shnisi. Bu nisbat shablon o'zgarmagani uchun har doim
 * saqlanadi va chetdagi chegara yo'qolsa ham buzilmaydi.
 *
 * O'lchangan ustun kengliklari (ishchi o'lchamda, piksel):
 *   toza skan   [ 78, 390, 721, 422, 218, 157, 197]  -> eng keng = 2, ШК = 3
 *   qiyshiq skan[369, 682, 399, 206, 148, 186]       -> eng keng = 1, ШК = 2
 */
import type { TableGrid } from './grid.js';

export interface ColumnMap {
  rowNumber: number | null;
  sku: number | null;
  description: number;
  barcode: number;
  price: number | null;
  quantity: number | null;
  sum: number | null;
}

/** `Описание` ustunidan boshqa ustunlarga nisbiy siljish. */
const OFFSETS = {
  rowNumber: -2,
  sku: -1,
  description: 0,
  barcode: 1,
  price: 2,
  quantity: 3,
  sum: 4,
} as const;

/**
 * To'rdagi ustunlarni eng keng ustun (`Описание товара`) bo'yicha xaritalaydi.
 *
 * Chegaradan chiqib ketgan ustunlar uchun `null` qaytariladi — masalan `Сумма`
 * skan chetida kesilgan bo'lsa yoki jadvalning chap chegarasi topilmagan
 * bo'lsa. Chaqiruvchi `null` ni tekshirishi va o'sha maydonni o'tkazib
 * yuborishi kerak.
 */
export function resolveColumns(grid: TableGrid): ColumnMap | null {
  const count = grid.columnEdges.length - 1;
  if (count < 3) return null;

  let widest = 0;
  let widestWidth = -1;
  for (let i = 0; i < count; i++) {
    const width = grid.columnEdges[i + 1]! - grid.columnEdges[i]!;
    if (width > widestWidth) {
      widestWidth = width;
      widest = i;
    }
  }

  const at = (offset: number): number | null => {
    const index = widest + offset;
    return index >= 0 && index < count ? index : null;
  };

  const barcode = at(OFFSETS.barcode);
  if (barcode === null) return null;

  return {
    rowNumber: at(OFFSETS.rowNumber),
    sku: at(OFFSETS.sku),
    description: widest,
    barcode,
    price: at(OFFSETS.price),
    quantity: at(OFFSETS.quantity),
    sum: at(OFFSETS.sum),
  };
}

/**
 * Shtrix-kod ustunini boshqa nomzod bilan almashtirib, xaritani qayta quradi.
 *
 * Kenglik qoidasi ishlamay qolgan holat uchun zaxira: quvur `ШК` ustunida
 * hech qanday shtrix-kod topmasa, qo'shni ustunlarni sinab ko'radi.
 */
export function shiftColumns(grid: TableGrid, barcodeIndex: number): ColumnMap | null {
  const count = grid.columnEdges.length - 1;
  if (barcodeIndex < 0 || barcodeIndex >= count) return null;

  const description = barcodeIndex - OFFSETS.barcode;
  const at = (offset: number): number | null => {
    const index = description + offset;
    return index >= 0 && index < count ? index : null;
  };

  return {
    rowNumber: at(OFFSETS.rowNumber),
    sku: at(OFFSETS.sku),
    description,
    barcode: barcodeIndex,
    price: at(OFFSETS.price),
    quantity: at(OFFSETS.quantity),
    sum: at(OFFSETS.sum),
  };
}

/** Sinab ko'rish tartibi: avval taklif qilingan ustun, keyin qo'shnilari. */
export function barcodeCandidates(grid: TableGrid, preferred: number): number[] {
  const count = grid.columnEdges.length - 1;
  const order = [preferred, preferred + 1, preferred - 1, preferred + 2, preferred - 2];
  return order.filter((i, at) => i >= 0 && i < count && order.indexOf(i) === at);
}
