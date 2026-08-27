/**
 * Sarlavha sahifasidan hujjat maydonlarini ajratish.
 *
 * USUL: kichik kataklarni geometriya bilan topish o'rniga, sahifaning
 * yuqori-o'ng hududini BITTA blok sifatida o'qib, qiymatlarni regex bilan
 * ajratamiz. `Номер документа` / `Дата составления` qutisining chegaralarini
 * ishonchli topish hujjatdan hujjatga beqaror bo'lib chiqdi, hududdagi
 * qiymatlar esa formati bo'yicha bir-biridan aniq ajraladi.
 *
 * ENG MUHIM QOIDA — hujjat raqami boshida NOL BO'LMAYDI.
 *
 * Buning sababi tuzilishda: hujjat ID si `15-` + roppa-rosa 10 raqam, chop
 * etilgan raqam esa o'sha 10 raqamdan boshidagi nollar olib tashlangani
 * (`15-0000163307` → `163307`). Demak chop etilgan raqam hech qachon noldan
 * boshlanmaydi.
 *
 * Bu qoida real xatoni tuzatdi: so'ngan shtrix-kod ostidagi matn OCR'da
 * parchalanib `15-0000164 33` bo'lib chiqqanda, "eng uzun raqamlar guruhi"
 * qoidasi `0000164` ni tanlab, hujjat raqamini `164` deb yozgan edi. Nol bilan
 * boshlangan guruhlarni rad etsak, faqat haqiqiy `163307` qoladi.
 *
 * QO'SHIMCHA FOYDA: hujjat ID si shtrix-kodning o'zi o'qilmasa ham, chop
 * etilgan raqamdan qayta tiklanadi (`docIdFromNumber`). Real skanda
 * `15-0000163307` shtrix-kodining o'ng 30% i chop etishda so'ngan va hech
 * qanday dekoder uni o'qiy olmaydi — ammo raqam yonidagi katakda toza turadi.
 */
import { DOC_ID_RE } from '@barcodeer/shared';

/**
 * Sarlavha hududi: sahifaning yuqori-o'ng burchagi.
 *
 * Balandlik ataylab tor (11%): pastroqda `Комитент` bloki boshlanadi va undagi
 * telefon raqami (`998200249347`) hujjat raqami sifatida qabul qilinib
 * ketardi. O'lchangan joylashuv: sarlavha qutisi 1.6%..9%, `Комитент` bloki
 * esa 10.4% dan boshlanadi.
 */
export const HEADER_REGION = {
  xFrac: 0.3,
  yFrac: 0,
  widthFrac: 0.7,
  heightFrac: 0.11,
} as const;

/** Hujjat ID sidagi raqamlar soni (`15-` prefiksidan keyin). */
const DOC_ID_DIGITS = 10;

/** Hujjat ID sining doimiy prefiksi. */
const DOC_ID_PREFIX = '15';

export interface HeaderFields {
  /** Matndan topilgan `15-0000163307` (shtrix-kod osti). Ishonchsizroq manba. */
  docIdFromText: string | null;
  /** `163307` — chop etilgan hujjat raqami. Eng barqaror o'qiladigan maydon. */
  docNumber: string | null;
  /** `2026-03-05 19:38`. */
  docDate: string | null;
}

const DOC_ID_IN_TEXT = /\b(\d{2})[-\s]?(\d{10})\b/;
const DATE_IN_TEXT = /\b(\d{4})[-\s](\d{2})[-\s](\d{2})[\s]+(\d{1,2})[:\s](\d{2})/;

/**
 * Sarlavha hududining OCR matnidan maydonlarni ajratadi.
 *
 * Tartib muhim: avval ID va sana topiladi va matndan olib tashlanadi, shundan
 * keyingina qolgan raqamlar orasidan hujjat raqami qidiriladi.
 */
export function parseHeaderFields(raw: string): HeaderFields {
  // OCR satr uzilishlarini bo'shliqqa aylantiramiz — qiymatlar bir satrda emas.
  let text = raw.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  let docIdFromText: string | null = null;
  const idMatch = text.match(DOC_ID_IN_TEXT);
  if (idMatch) {
    const candidate = `${idMatch[1]}-${idMatch[2]}`;
    if (DOC_ID_RE.test(candidate)) {
      docIdFromText = candidate;
      text = text.replace(idMatch[0], ' ');
    }
  }

  let docDate: string | null = null;
  const dateMatch = text.match(DATE_IN_TEXT);
  if (dateMatch) {
    const [, y, mo, d, h, mi] = dateMatch;
    docDate = `${y}-${mo}-${d} ${h!.padStart(2, '0')}:${mi}`;
    text = text.replace(dateMatch[0], ' ');
  }

  return { docIdFromText, docNumber: extractDocNumber(text), docDate };
}

/**
 * Qolgan matndan hujjat raqamini ajratadi.
 *
 * Nomzod bo'lish sharti: 4..10 raqam VA boshida nol yo'q. Ikkinchi shart
 * shtrix-kod matnining parchalarini (`0000164`) rad etadi. Bir nechta nomzod
 * qolsa eng uzuni tanlanadi — chunki qisqaroq guruhlar odatda o'sha raqamning
 * OCR'da bo'linib ketgan bo'laklari.
 */
function extractDocNumber(text: string): string | null {
  const groups = text.match(/\d+/g);
  if (!groups) return null;

  let best: string | null = null;
  for (const g of groups) {
    if (g.length < 4 || g.length > DOC_ID_DIGITS) continue;
    if (g.startsWith('0')) continue;
    if (!best || g.length > best.length) best = g;
  }
  return best;
}

/**
 * Hujjat ID sidan chop etilgan raqamni hosil qiladi:
 * `15-0000163307` → `163307`.
 */
export function docNumberFromId(docId: string): string {
  const digits = docId.slice(3);
  return digits.replace(/^0+/, '') || '0';
}

/**
 * Chop etilgan raqamdan hujjat ID sini qayta tiklaydi:
 * `163307` → `15-0000163307`.
 *
 * Shtrix-kod o'qilmagan hollarda ID ni to'ldirish uchun — `Ид документа`
 * ustuni bo'sh qolmasligi kerak, chunki u PDF nomi va takroriy skanerlashni
 * aniqlash uchun kalit hisoblanadi.
 */
export function docIdFromNumber(docNumber: string): string | null {
  const digits = docNumber.replace(/\D/g, '');
  if (!digits || digits.length > DOC_ID_DIGITS) return null;
  return `${DOC_ID_PREFIX}-${digits.padStart(DOC_ID_DIGITS, '0')}`;
}
