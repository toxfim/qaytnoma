/**
 * Sahifani modelga berib, tuzilgan ma'lumot olish.
 *
 * Bu ilovaning butun "miyasi" shu yerda: deterministik quvurdagi deskew →
 * to'r topish → katak kesish → ZXing → Tesseract zanjiri o'rniga bitta
 * so'rov turadi.
 *
 * SO'ROVGA NIMA KIRADI VA NEGA: hujjat shabloni QAT'IY (`CLAUDE.md` dagi
 * "Document anatomy"), shuning uchun modelga uni to'liq aytib berish eng
 * arzon aniqlik manbai — ustunlar tartibi, shtrix-kod 13 xonali ekani,
 * qo'lyozma tuzatishlar hisobga olinmasligi. Bularsiz model ustunlarni
 * o'zicha nomlaydi va `Сумма` ni `Кол-во` deb o'qib yuboradi.
 *
 * NIMA TEKSHIRILADI: model javobiga ISHONILMAYDI. Shtrix-kod 13 xonali
 * bo'lishi shart, qator raqamlari ketma-ket bo'lishi kerak, miqdorlar
 * yig'indisi `Итого` ga teng chiqishi kerak. Bu uchtasi — modelning eng
 * ehtimolli xatolari (qatorni tushirib qoldirish, raqamni chalkashtirish)
 * ustidan mustaqil nazorat.
 */
import { docIdFromNumber, parseDocDate } from '@barcodeer/core';
import { ITEM_BARCODE_RE } from '@barcodeer/shared';
import type { GeminiClient, TokenUsage } from './client.js';

/**
 * Javob sxemasi.
 *
 * Sonlar `integer` sifatida so'raladi — matn bo'lsa `"3 5"` kabi shovqinni
 * yana qo'lda tahlil qilishga to'g'ri kelardi. O'qib bo'lmagan qiymat uchun
 * `nullable`, ammo post-tahlilda `0` ham "o'qilmagan" deb qabul qilinadi:
 * miqdor hech qachon nol bo'lmaydi.
 */
const PAGE_SCHEMA = {
  type: 'object',
  properties: {
    isHeaderPage: { type: 'boolean' },
    docNumber: { type: 'string', nullable: true },
    docDate: { type: 'string', nullable: true },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          no: { type: 'integer' },
          sku: { type: 'string' },
          barcode: { type: 'string' },
          quantity: { type: 'integer', nullable: true },
        },
        required: ['no', 'sku', 'barcode', 'quantity'],
      },
    },
    totalQuantity: { type: 'integer', nullable: true },
  },
  required: ['isHeaderPage', 'rows'],
} as const;

const SYSTEM = `Siz Uzum Market "Возврат товаров комитенту" hujjatining skanerlangan sahifasini o'qiysiz. Shablon qat'iy, quyida to'liq tasvirlangan.

SAHIFA TURLARI
- Sarlavha sahifasi: yuqorida "Возврат товаров комитенту" sarlavhasi, o'ng yuqorida shtrix-kod, "Номер документа" (masalan 163307), "Дата составления" (masalan 2026-03-05 19:38), keyin "Комитент" va "Комиссионер" bloklari, undan keyin mahsulot jadvali.
- Davomi sahifasi: sarlavha ham, shtrix-kod ham, bloklar ham YO'Q — sahifa to'g'ridan-to'g'ri jadval bilan boshlanadi va qator raqamlari oldingi sahifadan davom etadi (masalan 14 dan). Bunday sahifada isHeaderPage=false, docNumber va docDate=null.

JADVAL USTUNLARI (chapdan o'ngga, doim shu tartibda)
№ | SKU товара | Описание товара | Штрих-код | Закупочная цена (сум) | Кол-во (шт.) | Сумма (сум)

MAYDONLAR
- no: "№" ustunidagi qator raqami. Har bir qatorni oling, birortasini ham tushirib qoldirmang.
- sku: "SKU товара" ustuni. Segmentlar defis bilan ajratiladi va lotin hamda kirill harflari ARALASH keladi (NOVYGOD-CIF0001-АЛЫЙ, ACENTT-NOTE14S-ЛАВАНД-8I128GB). Katakda ikki qatorga bo'lingan bo'lsa bitta satrga ulang, bo'shliq qo'ymang.
- barcode: "Штрих-код" ustuni — ROPPA-ROSA 13 ta raqam (masalan 1000076316479). Bu "Закупочная цена" emas; narx ustuni undan o'ngda va odatda kichikroq son.
- quantity: "Кол-во (шт.)" ustuni — musbat butun son (1, 3, 24, 55 bo'lishi mumkin).
- totalQuantity: jadval ostidagi "Итого" qatoridagi umumiy miqdor.

QAT'IY QOIDALAR
1. FAQAT CHOP ETILGAN qiymatni oling. Ko'k ruchkadagi hamma narsa — belgilar, ustidan chizilgan raqamlar, yoniga yozilgan qo'lyozma raqam, "ИЗВ" yozuvi, imzolar va dumaloq muhr — E'TIBORGA OLINMAYDI. Raqam ustidan chizilgan bo'lsa ham, chop etilgan raqam olinadi.
2. Hech narsani TAXMIN QILMANG. O'qib bo'lmasa quantity uchun null qaytaring. Shtrix-kodni to'ldirib yubormang.
3. Qatorlar sahifadagi tartibda, birortasi ham tushib qolmasin. Jadvalning eng oxirgi qatori ham kiradi.
4. "Итого" qatorining o'zi mahsulot qatori EMAS — u rows ga kirmaydi.
5. Narx (Закупочная цена) va Сумма ustunlari kerak emas.`;

const PROMPT =
  'Shu sahifadagi barcha mahsulot qatorlarini va sahifa turini aniqlang. ' +
  'Sarlavha sahifasi bo`lsa "Номер документа" va "Дата составления" ni ham qaytaring.';

/** Model o'qigan bitta qator. */
export interface AiRow {
  /** `№` ustunidagi raqam — ketma-ketlikni tekshirish uchun. */
  no: number | null;
  sku: string | null;
  /** 13 xonali bo'lmasa `null` — qator albatta tekshiruvga tushadi. */
  barcode: string | null;
  quantity: number | null;
}

export interface AiPage {
  isHeaderPage: boolean;
  /** `15-0000163307` — raqamdan qayta tiklanadi. */
  docId: string | null;
  docNumber: string | null;
  docDate: string | null;
  rows: AiRow[];
  totalQuantity: number | null;
  /** Modelning xom javobidagi qatorlar soni — filtrdan oldin. */
  rawRowCount: number;
}

/**
 * Sahifani o'qiydi.
 *
 * `maxOutputTokens` ataylab keng (8192): eng katta o'lchangan sahifada 26
 * qator bor va har biri ~40 token oladi. Chegara kichik bo'lsa javob
 * `MAX_TOKENS` bilan uzilib qoladi va sahifa BUTUNLAY yo'qoladi — bu esa
 * model xatosidan ko'ra yomonroq, chunki hech qanday belgi qolmaydi.
 */
export async function readPage(client: GeminiClient, jpeg: Buffer): Promise<AiPage> {
  const raw = await client.ask<RawPage>({
    system: SYSTEM,
    prompt: PROMPT,
    images: [{ mimeType: 'image/jpeg', data: jpeg }],
    schema: PAGE_SCHEMA,
    maxOutputTokens: 8192,
  });

  const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
  const rows: AiRow[] = rawRows.map((row) => {
    const digits = String(row?.barcode ?? '').replace(/\D/g, '');
    return {
      no: positive(row?.no),
      sku: String(row?.sku ?? '').replace(/\s+/g, '') || null,
      barcode: ITEM_BARCODE_RE.test(digits) ? digits : null,
      quantity: positive(row?.quantity),
    };
  });

  const docNumber =
    String(raw.docNumber ?? '')
      .replace(/\D/g, '')
      .replace(/^0+/, '') || null;

  return {
    isHeaderPage: raw.isHeaderPage === true,
    docId: docNumber ? docIdFromNumber(docNumber) : null,
    docNumber,
    // Sana `parse.ts` orqali o'tadi: shakli to'g'ri, ammo qiymati mumkin
    // bo'lmagan sana (2026-13-45) rad etiladi.
    docDate: parseDocDate(String(raw.docDate ?? '')),
    rows,
    totalQuantity: positive(raw.totalQuantity),
    rawRowCount: rawRows.length,
  };
}

/** `null`, `0` va manfiy qiymatlar — hammasi "o'qilmadi". */
function positive(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

export type { TokenUsage };

interface RawPage {
  isHeaderPage?: boolean;
  docNumber?: string | null;
  docDate?: string | null;
  totalQuantity?: number | null;
  rows?: { no?: number; sku?: string; barcode?: string; quantity?: number | null }[];
}
