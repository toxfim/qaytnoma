/**
 * SKU ni ikki o'tishda o'qish (lotin + kirill).
 *
 * Uzum SKU tuzilishi qat'iy:
 *   `NOVYGOD-CIF0001-АЛЫЙ`            -> lotin, lotin, KIRILL
 *   `ACENTT-NOTE14S-ЛАВАНД-8I128GB`   -> lotin, lotin, KIRILL, lotin
 *   `YATILAR-ERSELKA-ЗЕЛЕН-150sm`     -> lotin, lotin, KIRILL, lotin
 *
 * Ya'ni faqat UCHINCHI segment (rang) kirill bo'ladi. `rus+eng` bilan bitta
 * o'tish 13.9% aniqlik berdi — kirill va lotinda bir xil ko'rinadigan harflar
 * (С/C, Е/E, Р/P, В/B, Н/H, М/M, Т/T) doimiy adashdi. Har bir o'tishga o'z
 * alifbosini majburlash aniqlikni 47.2% ga ko'tardi va, muhimi, rang
 * segmentidagi xatolarni butunlay yo'q qildi.
 */

export interface SkuReadResult {
  /** Birlashtirilgan yakuniy qiymat. */
  sku: string | null;
  /** Lotin o'tishining xom natijasi — diagnostika uchun. */
  latin: string | null;
  /** Kirill o'tishining xom natijasi. */
  cyrillic: string | null;
}

/** Rang segmentining indeksi (0 dan boshlab). */
const COLOR_SEGMENT_INDEX = 2;

/**
 * Ikki o'tish natijasini birlashtiradi: barcha segmentlar lotin o'tishidan,
 * faqat rang segmenti kirill o'tishidan olinadi.
 */
export function mergeSkuPasses(latin: string | null, cyrillic: string | null): string | null {
  if (!latin) return cyrillic;

  const latinParts = latin.split('-');
  const cyrillicParts = cyrillic ? cyrillic.split('-') : [];

  const colorFromCyrillic = cyrillicParts[COLOR_SEGMENT_INDEX];
  if (!colorFromCyrillic || latinParts.length <= COLOR_SEGMENT_INDEX) return latin;

  // Segmentlar soni mos kelmasa kirill o'tishi boshqacha bo'lingan degani —
  // bunday holatda unga ishonmaymiz.
  if (cyrillicParts.length !== latinParts.length) return latin;

  const merged = [...latinParts];
  merged[COLOR_SEGMENT_INDEX] = colorFromCyrillic;
  return merged.join('-');
}

/**
 * SKU ning ishonchliligini baholaydi.
 *
 * Kutilgan shakl: kamida 3 segment, birinchi ikkitasi faqat lotin/raqam,
 * uchinchisi faqat kirill. Bunga mos kelmasa OCR adashgan bo'lishi ehtimoli
 * yuqori va qator `needs_review` ga tushishi kerak.
 */
export function looksLikeValidSku(sku: string | null): boolean {
  if (!sku) return false;
  const parts = sku.split('-');
  if (parts.length < 3) return false;

  const latinish = /^[A-Za-z0-9]+$/;
  const cyrillicish = /^[А-ЯЁа-яё]+$/;

  if (!latinish.test(parts[0]!)) return false;
  if (!latinish.test(parts[1]!)) return false;
  if (!cyrillicish.test(parts[2]!)) return false;
  return true;
}
