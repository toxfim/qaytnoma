/**
 * Yozilmay qolgan hujjatlar navbati.
 *
 * MUAMMO: quvurning tamoyili — "skanerlangan qog'oz behuda ketmasin". Ammo
 * Sheets ga yozish bosqichi butunlay yiqilsa (internet yo'q, kalit muddati
 * tugagan, jadval o'chirilgan) qatorlar HECH QAYERGA yozilmasdi: ogohlantirish
 * chiqardi, PDF saqlanardi, lekin ma'lumot faqat lokal `documents.jsonl` da
 * diagnostika sifatida qolardi va uni Sheets ga qaytarish yo'li yo'q edi.
 * Foydalanuvchi buni ko'pincha ancha keyin sezadi — o'shanda qaysi qog'ozni
 * qayta skanerlash kerakligi ham noma'lum.
 *
 * YECHIM: yozilmagan hujjatlar shu navbatga tushadi va KEYINGI muvaffaqiyatli
 * skanerlashda avtomatik yoziladi. Navbat oddiy JSON fayl — hujjat obyekti
 * to'liq saqlanadi, shuning uchun `_log` yozuvlari va `⚠` belgilari ham
 * o'zgarishsiz tiklanadi.
 *
 * TAKROR YOZISHDAN HIMOYA: navbat bo'shatilishidan oldin hujjatlar Sheets'dagi
 * mavjud `Ид + ШК` kalitlariga qarab qaytadan tekshiriladi. Ya'ni qator
 * oradagi qo'lda kiritish yoki boshqa kompyuterdagi skan tufayli allaqachon
 * yozilgan bo'lsa, ikkinchi marta tushmaydi.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { InvoiceDocument } from '@barcodeer/shared';

/** Navbatdagi bitta yozuv. */
export interface PendingBatch {
  /** Yozishga urinilgan vaqt (ISO 8601). */
  queuedAt: string;
  /** Nima uchun yozilmagani — foydalanuvchiga ko'rsatish uchun. */
  reason: string;
  documents: InvoiceDocument[];
}

/**
 * Navbatning yuqori chegarasi.
 *
 * Sheets uzoq vaqt ishlamasa navbat cheksiz o'sib ketmasligi kerak: fayl
 * har skanerlashda to'liq o'qiladi. Chegaradan oshsa ENG ESKI yozuv
 * tashlanadi — yangi skanlar foydalanuvchining hozirgi ishi, eski
 * to'plamlarni esa qo'lda qayta skanerlash mumkin.
 */
const MAX_BATCHES = 50;

export class PendingQueue {
  #batches: PendingBatch[] = [];

  private constructor(
    private readonly path: string,
    batches: PendingBatch[],
  ) {
    this.#batches = batches;
  }

  static async open(path: string): Promise<PendingQueue> {
    let batches: PendingBatch[] = [];
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (Array.isArray(parsed)) batches = parsed as PendingBatch[];
    } catch {
      // Fayl yo'q yoki buzilgan — bo'sh navbat bilan davom etamiz. Buzilgan
      // navbat tufayli skanerlash to'xtab qolmasligi kerak.
    }
    return new PendingQueue(path, batches);
  }

  /** Navbatdagi to'plamlar soni. */
  get size(): number {
    return this.#batches.length;
  }

  /** Navbatdagi jami qatorlar soni (takror deb belgilanganlarisiz). */
  get rowCount(): number {
    let count = 0;
    for (const batch of this.#batches) {
      for (const doc of batch.documents) {
        count += doc.items.filter((i) => !i.duplicate).length;
      }
    }
    return count;
  }

  /** Barcha kutayotgan hujjatlar — bo'shatish uchun. */
  documents(): InvoiceDocument[] {
    return this.#batches.flatMap((b) => b.documents);
  }

  batches(): readonly PendingBatch[] {
    return this.#batches;
  }

  /** Yozilmagan hujjatlarni navbatga qo'shadi va darhol saqlaydi. */
  async add(
    documents: readonly InvoiceDocument[],
    reason: string,
    now = new Date(),
  ): Promise<void> {
    const keep = documents.filter((doc) => doc.items.some((i) => !i.duplicate));
    if (keep.length === 0) return;

    this.#batches.push({
      queuedAt: now.toISOString(),
      reason,
      // Nusxa: chaqiruvchi obyektni keyin o'zgartirsa navbat buzilmasin.
      documents: JSON.parse(JSON.stringify(keep)) as InvoiceDocument[],
    });
    if (this.#batches.length > MAX_BATCHES) {
      this.#batches = this.#batches.slice(-MAX_BATCHES);
    }
    await this.save();
  }

  /** Navbatni bo'shatadi (yozish muvaffaqiyatli bo'lgach). */
  async clear(): Promise<void> {
    if (this.#batches.length === 0) return;
    this.#batches = [];
    await this.save();
  }

  /**
   * Faylni ATOMAR yozadi: vaqtinchalik faylga yozib, keyin nomini almashtiradi.
   * Yozish paytida dastur to'xtab qolsa ham navbat yarim yozilgan holda
   * qolmaydi (`rename` bitta fayl tizimida atomar).
   */
  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(this.#batches, null, 2), 'utf8');
    await rename(tmp, this.path);
  }
}
