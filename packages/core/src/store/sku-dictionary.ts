/**
 * `ШК → СКУ` lug'ati.
 *
 * NEGA KERAK: mahsulot shtrix-kodi 100% ishonchli dekodlanadi, SKU esa
 * OCR bilan atigi ~50% aniqlikda o'qiladi (kirill/lotin ko'rinishi bir xil
 * harflar va `0`/`O`, `6`/`B` chalkashligi — `ocr/engine.ts` ga qarang).
 *
 * Shtrix-kod bilan SKU o'rtasida 1:1 bog'lanish bor: bir xil shtrix-kod
 * har doim bir xil mahsulotni bildiradi. Demak SKU bir marta to'g'ri
 * aniqlangandan keyin, keyingi barcha skanlarda uni OCR qilish shart emas —
 * lug'atdan olinadi va 100% to'g'ri bo'ladi.
 *
 * Shunday qilib aniqlik vaqt o'tishi bilan o'sadi: birinchi uchrashuvda qator
 * `needs_review` ga tushadi, tasdiqlangandan keyin esa doimiy to'g'ri bo'ladi.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface SkuEntry {
  sku: string;
  /** `ocr` — OCR taklifi, hali tasdiqlanmagan; `confirmed` — inson tasdiqlagan. */
  source: 'ocr' | 'confirmed';
  /** Necha marta uchradi — ishonchni baholash uchun. */
  seen: number;
  /** Oxirgi marta uchragan vaqt (ISO). */
  lastSeen: string;
}

export interface SkuLookup {
  sku: string;
  confirmed: boolean;
}

/**
 * Diskda JSON sifatida saqlanadigan lug'at.
 *
 * Yozish ATOMAR: avval `.tmp` fayl yoziladi, keyin o'rniga qo'yiladi —
 * dastur yozish paytida to'xtab qolsa lug'at buzilmasin.
 */
export class SkuDictionary {
  #entries = new Map<string, SkuEntry>();
  #dirty = false;

  private constructor(private readonly path: string) {}

  static async open(path: string): Promise<SkuDictionary> {
    const dict = new SkuDictionary(path);
    try {
      const raw = await readFile(path, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [barcode, entry] of Object.entries(parsed as Record<string, SkuEntry>)) {
          if (entry && typeof entry.sku === 'string') dict.#entries.set(barcode, entry);
        }
      }
    } catch (err) {
      // Fayl yo'q — bo'sh lug'at bilan boshlaymiz. Buzilgan fayl bo'lsa ham
      // ishni to'xtatmaymiz, lekin ustiga yozib yubormaslik uchun xabar beramiz.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`SKU lug'atini o'qib bo'lmadi (${path}): ${(err as Error).message}`);
      }
    }
    return dict;
  }

  get size(): number {
    return this.#entries.size;
  }

  lookup(barcode: string): SkuLookup | null {
    const entry = this.#entries.get(barcode);
    if (!entry) return null;
    return { sku: entry.sku, confirmed: entry.source === 'confirmed' };
  }

  /**
   * OCR taklifini yozib qo'yadi.
   *
   * Tasdiqlangan yozuvning ustiga YOZILMAYDI — inson tuzatgan qiymat
   * har doim OCR dan ustun turadi.
   */
  recordOcr(barcode: string, sku: string, now = new Date()): void {
    const existing = this.#entries.get(barcode);
    if (existing?.source === 'confirmed') {
      existing.seen++;
      existing.lastSeen = now.toISOString();
      this.#dirty = true;
      return;
    }
    this.#entries.set(barcode, {
      sku,
      source: 'ocr',
      seen: (existing?.seen ?? 0) + 1,
      lastSeen: now.toISOString(),
    });
    this.#dirty = true;
  }

  /** Inson tasdiqlagan qiymat — eng yuqori ustuvorlik. */
  confirm(barcode: string, sku: string, now = new Date()): void {
    const existing = this.#entries.get(barcode);
    this.#entries.set(barcode, {
      sku,
      source: 'confirmed',
      seen: (existing?.seen ?? 0) + 1,
      lastSeen: now.toISOString(),
    });
    this.#dirty = true;
  }

  /** Faqat o'zgarish bo'lgan bo'lsa diskka yozadi. */
  async save(): Promise<void> {
    if (!this.#dirty) return;
    await mkdir(dirname(this.path), { recursive: true });

    const obj: Record<string, SkuEntry> = {};
    for (const [barcode, entry] of [...this.#entries].sort(([a], [b]) => a.localeCompare(b))) {
      obj[barcode] = entry;
    }

    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
    await rename(tmp, this.path);
    this.#dirty = false;
  }
}
