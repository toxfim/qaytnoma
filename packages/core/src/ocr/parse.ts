/**
 * OCR xom natijasini domen qiymatlariga aylantirish.
 *
 * `Кол-во` uchun foydalanuvchi qoidasi: qo'lyozma tuzatishlar hisobga
 * olinmaydi, va agar OCR'ga `ИЗВ` kabi qo'shimcha belgilar tushib qolsa —
 * regex bilan faqat raqam ajratib olinadi. Ko'k siyoh oldindan o'chirilgani
 * uchun bu ikkinchi himoya qatlami.
 */
import { DOC_DATE_RE } from '@barcodeer/shared';

/**
 * Katakdagi butun musbat sonni ajratadi.
 *
 * BO'SHLIQLAR AVVAL OLIB TASHLANADI, chunki Tesseract bitta sonning
 * raqamlarini ajratib yuborishi odatiy hol: `11` ko'pincha `1 1` bo'lib
 * keladi (`ocr/engine.ts` dagi PSM izohiga qarang). Ya'ni `5 34` → `534`.
 * Bu xavfsiz tomonga qaraydi: noto'g'ri birlashtirilgan qiymat `Итого`
 * yig'indisiga mos kelmaydi va qator tekshiruvga belgilanadi, jimgina
 * kichraytirilgan miqdor esa e'tibordan chetda qolardi.
 *
 * Bo'shliqdan boshqa belgi bilan ajralgan guruhlar (masalan `3 ИЗВ 5`)
 * saqlanadi va ular ichidan eng UZUNI tanlanadi: ko'p xonali qiymat real,
 * bitta adashgan raqam esa odatda shovqin.
 */
export function parseQuantity(raw: string): number | null {
  const groups = raw.replace(/[\s ]/g, '').match(/\d+/g);
  if (!groups || groups.length === 0) return null;

  let best = groups[0]!;
  for (const g of groups) if (g.length > best.length) best = g;

  const value = Number.parseInt(best, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Hujjat raqami: faqat raqamlar, boshidagi nollar olib tashlanadi. */
export function parseDocNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  const trimmed = digits.replace(/^0+/, '');
  return trimmed || '0';
}

/**
 * `Дата составления` — `2026-03-05 19:38`.
 *
 * OCR ba'zan oxiridagi ikki nuqtani qo'shib yuboradi (hujjatda `19:38:` deb
 * chop etilgan) va bo'shliqlarni yo'qotadi — ikkalasi ham normallashtiriladi.
 */
export function parseDocDate(raw: string): string | null {
  const cleaned = raw.replace(/[^\d\-: ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/:$/, '');

  const direct = cleaned.match(DOC_DATE_RE);
  if (direct) {
    const value = `${direct[1]}-${direct[2]}-${direct[3]} ${direct[4]}:${direct[5]}`;
    if (isPlausibleDocDate(value)) return value;
  }

  // Ajratgichlar yo'qolgan holat: 12 ta raqamni tartib bo'yicha yig'amiz.
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length >= 12) {
    const [y, mo, d, h, mi] = [
      digits.slice(0, 4),
      digits.slice(4, 6),
      digits.slice(6, 8),
      digits.slice(8, 10),
      digits.slice(10, 12),
    ];
    const candidate = `${y}-${mo}-${d} ${h}:${mi}`;
    if (isPlausibleDocDate(candidate)) return candidate;
  }
  return null;
}

/**
 * Sana shakli TO'G'RI, lekin qiymatlari mumkin bo'lgan oraliqdami.
 *
 * `DOC_DATE_RE` faqat raqamlar sonini tekshiradi, shuning uchun OCR
 * shovqinidan tug'ilgan `2026-13-45 99:99` ham "to'g'ri format" hisoblanardi
 * va hujjatga o'sha holda yozilardi. Bunday qiymat `null` bo'lgani afzal:
 * o'shanda `extract-page.ts` dagi ovoz berish boshqa o'qishni tanlaydi, u ham
 * bo'lmasa validatsiya `DOC_DATE_MISSING` beradi va qator ko'zdan kechiriladi.
 *
 * Yil oralig'i ataylab keng (2000..2100): hujjatlar sanasi kelajakda ham
 * to'g'ri qolishi kerak, ammo `9026` kabi OCR xatosi rad etiladi.
 */
export function isPlausibleDocDate(value: string): boolean {
  const m = value.match(DOC_DATE_RE);
  if (!m) return false;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];

  if (y < 2000 || y > 2100) return false;
  if (mo < 1 || mo > 12) return false;
  if (h > 23 || mi > 59) return false;

  // Oydagi kunlar soni — kabisa yili bilan.
  const daysInMonth = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d >= 1 && d <= daysInMonth[mo - 1]!;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * SKU normallashtirish.
 *
 * SKU katakda ikki-uch qatorga bo'linadi (`NOVYGOD-CIF0001-` + `АЛЫЙ`).
 * Uzum shablonida uzilish har doim defisda bo'ladi, shuning uchun qatorlarni
 * ajratgichsiz ulaymiz; defis bilan tugamagan qatorlarni esa defis bilan
 * qo'shamiz — bosma uzilish belgisi skanda yo'qolishi mumkin.
 *
 * Belgilar whitelist'i QO'LLANMAYDI: SKU da lotin va kirill aralashadi.
 */
export function normalizeSku(raw: string): string | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/[\s ]+/g, ' ').trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  let out = '';
  for (const line of lines) {
    if (out === '') out = line;
    else if (out.endsWith('-')) out += line;
    else out += line.startsWith('-') ? line : `-${line}`;
  }

  // Ichkaridagi bo'shliqlar OCR shovqini — haqiqiy SKU da bo'shliq yo'q.
  out = out.replace(/\s+/g, '');
  return out || null;
}

/** `Итого` katagidagi jami son (bo'shliqlar bilan ajratilgan bo'lishi mumkin). */
export function parseTotal(raw: string): number | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}
