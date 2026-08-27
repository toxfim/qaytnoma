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
 * Bir nechta raqam guruhi topilsa (masalan chop etilgan qiymat yonida
 * o'chirilmagan qo'lyozma qoldig'i), eng UZUN guruh tanlanadi: `55` kabi
 * ko'p xonali qiymatlar real, bitta adashgan raqam esa odatda shovqin.
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
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]} ${direct[4]}:${direct[5]}`;

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
    if (DOC_DATE_RE.test(candidate)) return candidate;
  }
  return null;
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
