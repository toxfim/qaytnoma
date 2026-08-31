/**
 * Gemini ni QUVURNING ZAXIRASI sifatida ishlatish.
 *
 * TAMOYIL: model deterministik bosqichlarni ALMASHTIRMAYDI. Shtrix-kod
 * dekoderi 36/36 ishlaydi, katalog SKU ni 100% beradi, Tesseract esa
 * `Кол-во` ni 97.2% o'qiydi — bularni modelga topshirish aniqlikni
 * pasaytiradi va har sahifaga pul to'laydi. Model faqat quvur ANIQ
 * MUVAFFAQIYATSIZ bo'lgan joyda chaqiriladi:
 *
 *   1. `assist` — katak o'qilmadi (`quantity === null`) yoki OCR variantlari
 *      bir-biriga zid chiqdi. Faqat o'sha kataklarning kesmasi yuboriladi.
 *   2. `rescue` — sahifada jadval to'ri umuman topilmadi. Hozir bunday
 *      sahifa BUTUNLAY yo'qoladi: qatorlar ham, ogohlantirish ham yo'q,
 *      chunki qator topilmagani "qator yo'q" dan farq qilmaydi. Butun
 *      sahifa modelga beriladi.
 *
 * MODELDAN KELGAN QIYMAT ISHONCHSIZ deb belgilanadi (`VLM_SOURCED`), ya'ni
 * qator jadvalga yoziladi, lekin `⚠` bilan — inson ko'zdan kechiradi.
 * Qiymatsiz qator (hozirgi holat) foydalanuvchi uchun ham, tekshiruv uchun
 * ham yomonroq.
 */
import { ITEM_BARCODE_RE } from '@barcodeer/shared';
import type { GeminiClient, ImagePart, TokenUsage } from './gemini.js';
import { emptyUsage } from './gemini.js';
import { parseDocDate, parseQuantity } from '../ocr/parse.js';
import { docIdFromNumber } from '../ocr/header-fields.js';

/**
 * Bitta so'rovdagi kataklar soni.
 *
 * Ko'proq rasm — kamroq so'rov, ammo model tartibni chalkashtirish ehtimoli
 * oshadi. 8 ta o'lchov bo'yicha xavfsiz chegara: bitta sahifada shuncha
 * o'qilmagan katak bo'lishi allaqachon g'ayrioddiy holat.
 */
const CELL_BATCH = 8;

/** Kataklar uchun javob sxemasi — imkon qadar qisqa. */
const CELLS_SCHEMA = {
  type: 'object',
  properties: {
    values: { type: 'array', items: { type: 'string' } },
  },
  required: ['values'],
} as const;

const PAGE_SCHEMA = {
  type: 'object',
  properties: {
    docNumber: { type: 'string' },
    docDate: { type: 'string' },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sku: { type: 'string' },
          barcode: { type: 'string' },
          quantity: { type: 'string' },
        },
        required: ['sku', 'barcode', 'quantity'],
      },
    },
    totalQuantity: { type: 'string' },
  },
  required: ['rows'],
} as const;

const CELL_SYSTEM =
  'Siz skanerlangan jadval kataklarini o`qiysiz. Faqat CHOP ETILGAN qiymatni ' +
  'qaytaring, qo`lyozma tuzatish yoki belgilarni e`tiborsiz qoldiring. ' +
  'O`qib bo`lmasa bo`sh satr qaytaring. Taxmin qilmang.';

const PAGE_SYSTEM =
  'Siz Uzum Market "Возврат товаров комитенту" hujjatining skanerlangan ' +
  'sahifasini o`qiysiz. Jadval ustunlari: № | SKU товара | Описание товара | ' +
  'Штрих-код | Закупочная цена | Кол-во | Сумма. Har bir mahsulot qatoridan ' +
  'SKU, 13 xonali shtrix-kod va Кол-во ni oling. Qo`lyozma tuzatishlarni ' +
  'e`tiborsiz qoldiring — faqat chop etilgan qiymat kerak. O`qib bo`lmagan ' +
  'maydonda bo`sh satr qaytaring, taxmin qilmang.';

/** VLM o'qigan bitta qator. */
export interface VlmRow {
  sku: string | null;
  barcode: string | null;
  quantity: number | null;
}

export interface VlmPage {
  docId: string | null;
  docNumber: string | null;
  docDate: string | null;
  rows: VlmRow[];
  totalQuantity: number | null;
}

/** O'qish uchun berilgan katak. */
export interface VlmCell {
  /** Chaqiruvchining kaliti — natija shu bo'yicha qaytariladi. */
  id: string;
  png: Buffer;
}

export class VlmReader {
  #usage = emptyUsage();
  #errors: string[] = [];

  constructor(private readonly client: GeminiClient) {}

  get usage(): TokenUsage {
    return this.#usage;
  }

  /** To'xtatmagan, ammo qayd etilishi kerak bo'lgan xatolar. */
  get errors(): readonly string[] {
    return this.#errors;
  }

  get model(): string {
    return this.client.model;
  }

  /**
   * Raqamli kataklarni o'qiydi (`Кол-во`, `Итого`).
   *
   * Natija — `id → son`. O'qilmagan katak xaritaga TUSHMAYDI, shunda
   * chaqiruvchi "model ham o'qiy olmadi" holatini ajrata oladi.
   */
  async readQuantityCells(cells: readonly VlmCell[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (let i = 0; i < cells.length; i += CELL_BATCH) {
      const batch = cells.slice(i, i + CELL_BATCH);
      const texts = await this.#readCellBatch(
        batch,
        `Har bir rasmda jadvalning "Кол-во" katagi bor — butun musbat son. ` +
          `${batch.length} ta rasm uchun ${batch.length} ta qiymatni SHU TARTIBDA qaytaring.`,
      );
      if (!texts) continue;

      batch.forEach((cell, index) => {
        const value = parseQuantity(texts[index] ?? '');
        if (value !== null) out.set(cell.id, value);
      });
    }
    return out;
  }

  /**
   * SKU kataklarini o'qiydi.
   *
   * Bu yerda model Tesseract'dan tabiiy ravishda kuchli: SKU da lotin va
   * kirill aralashadi (`NOVYGOD-CIF0001-АЛЫЙ`) va ikki o'tishli whitelist
   * usuli 47% da to'xtagan. Katalog bilmagan mahsulotlar uchun ishlatiladi.
   */
  async readSkuCells(cells: readonly VlmCell[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < cells.length; i += CELL_BATCH) {
      const batch = cells.slice(i, i + CELL_BATCH);
      const texts = await this.#readCellBatch(
        batch,
        'Har bir rasmda "SKU товара" katagi bor. Segmentlar defis bilan ajratiladi, ' +
          'lotin va kirill harflari ARALASH keladi (masalan NOVYGOD-CIF0001-АЛЫЙ). ' +
          'Katakda ikki qatorga bolingan bolsa bitta satrga ulang. ' +
          `${batch.length} ta rasm uchun ${batch.length} ta qiymatni SHU TARTIBDA qaytaring.`,
      );
      if (!texts) continue;

      batch.forEach((cell, index) => {
        const value = (texts[index] ?? '').replace(/\s+/g, '');
        if (value) out.set(cell.id, value);
      });
    }
    return out;
  }

  /**
   * Butun sahifani o'qiydi — jadval to'ri topilmagan sahifalar uchun.
   *
   * Shtrix-kod bu yerda ham tekshiriladi: 13 xonali bo'lmasa `null` qilinadi,
   * ya'ni qator albatta tekshiruvga tushadi. Katalog esa keyinroq shtrix-kodni
   * mustaqil tasdiqlaydi — 23 000 yozuvda yo'q kod modelning xatosi ekanini
   * ko'rsatadi.
   */
  async readPage(jpeg: Buffer): Promise<VlmPage | null> {
    const res = await this.#ask<RawPage>({
      system: PAGE_SYSTEM,
      prompt:
        'Sahifadagi barcha mahsulot qatorlarini qaytaring. Sarlavha bo`lsa ' +
        '"Номер документа" va "Дата составления" ni ham oling.',
      images: [{ mimeType: 'image/jpeg', data: jpeg }],
      schema: PAGE_SCHEMA,
      maxOutputTokens: 4096,
    });
    if (!res) return null;

    const rows: VlmRow[] = (res.rows ?? []).map((row) => {
      const barcode = (row.barcode ?? '').replace(/\D/g, '');
      return {
        sku: (row.sku ?? '').replace(/\s+/g, '') || null,
        barcode: ITEM_BARCODE_RE.test(barcode) ? barcode : null,
        quantity: parseQuantity(row.quantity ?? ''),
      };
    });

    const docNumber = (res.docNumber ?? '').replace(/\D/g, '').replace(/^0+/, '') || null;
    return {
      docId: docNumber ? docIdFromNumber(docNumber) : null,
      docNumber,
      docDate: parseDocDate(res.docDate ?? ''),
      rows,
      totalQuantity: parseQuantity(res.totalQuantity ?? ''),
    };
  }

  async #readCellBatch(batch: readonly VlmCell[], prompt: string): Promise<string[] | null> {
    const res = await this.#ask<{ values?: unknown }>({
      system: CELL_SYSTEM,
      prompt,
      images: batch.map((c): ImagePart => ({ mimeType: 'image/png', data: c.png })),
      schema: CELLS_SCHEMA,
      maxOutputTokens: 256,
    });
    if (!res) return null;

    const values = Array.isArray(res.values) ? res.values : [];
    // Model tartibni yoki sonni buzsa — butun to'plamni rad etamiz.
    // Noto'g'ri joyga tushgan qiymat o'qilmagan katakdan xavfliroq.
    if (values.length !== batch.length) {
      this.#note(`Gemini ${batch.length} ta katakka ${values.length} ta javob qaytardi`);
      return null;
    }
    return values.map((v) => (typeof v === 'string' ? v.trim() : ''));
  }

  /** So'rovni yuboradi; xato bo'lsa quvurni TO'XTATMAYDI. */
  async #ask<T>(opts: Parameters<GeminiClient['ask']>[0]): Promise<T | null> {
    try {
      const { value, usage } = await this.client.ask<T>(opts);
      this.#usage = {
        requests: this.#usage.requests + usage.requests,
        inputTokens: this.#usage.inputTokens + usage.inputTokens,
        outputTokens: this.#usage.outputTokens + usage.outputTokens,
        thoughtTokens: this.#usage.thoughtTokens + usage.thoughtTokens,
        totalTokens: this.#usage.totalTokens + usage.totalTokens,
      };
      return value;
    } catch (err) {
      this.#note((err as Error).message);
      return null;
    }
  }

  #note(message: string): void {
    // Bir xil xato har katak uchun takrorlanmasin.
    if (!this.#errors.includes(message) && this.#errors.length < 5) this.#errors.push(message);
  }
}

interface RawPage {
  docNumber?: string;
  docDate?: string;
  totalQuantity?: string;
  rows?: { sku?: string; barcode?: string; quantity?: string }[];
}
