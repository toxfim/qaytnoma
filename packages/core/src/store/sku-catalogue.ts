/**
 * Uzum mahsulot katalogi: `Баркод → Скю`.
 *
 * NEGA BU HAL QILUVCHI: SKU ni OCR bilan o'qish aniqligi atigi ~47% (kirill va
 * lotin ko'rinishi bir xil harflar, `0`/`O`, `6`/`B` chalkashligi —
 * `docs/OCR-BENCHMARK.md`). Shtrix-kod esa 100% ishonchli dekodlanadi.
 *
 * Foydalanuvchining "Finance" jadvalidagi `Остаток Узум` varag'ida Uzum'ning
 * o'z ma'lumotlari bor: 23 066 ta noyob shtrix-kod, har biri bitta SKU ga
 * bog'langan, ziddiyatsiz. Sinovda skanerlangan 36 ta shtrix-kodning HAMMASI
 * shu katalogda topildi va SKU lari aynan mos keldi.
 *
 * Shu sababli SKU ning asosiy manbai — katalog; OCR faqat katalogda yo'q
 * mahsulotlar uchun taklif sifatida qoladi.
 *
 * Katalog ALOHIDA faylda saqlanadi (`sku-catalogue.json`), o'rganilgan va
 * inson tasdiqlagan qiymatlardan (`sku-map.json`) ajratilgan holda: katalog
 * katta (~2 MB) va faqat sinxronizatsiyada yoziladi, ikkinchisi esa kichik va
 * har skanerlashda yangilanadi.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface CatalogueFile {
  syncedAt: string;
  source: string;
  entries: Record<string, string>;
}

export class SkuCatalogue {
  #entries = new Map<string, string>();
  #syncedAt: string | null = null;
  #source = '';

  private constructor(private readonly path: string) {}

  static async open(path: string): Promise<SkuCatalogue> {
    const catalogue = new SkuCatalogue(path);
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<CatalogueFile>;
      if (parsed.entries) {
        for (const [barcode, sku] of Object.entries(parsed.entries)) {
          if (sku) catalogue.#entries.set(barcode, sku);
        }
      }
      catalogue.#syncedAt = parsed.syncedAt ?? null;
      catalogue.#source = parsed.source ?? '';
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Katalogni o'qib bo'lmadi (${path}): ${(err as Error).message}`);
      }
    }
    return catalogue;
  }

  get size(): number {
    return this.#entries.size;
  }

  get syncedAt(): string | null {
    return this.#syncedAt;
  }

  get source(): string {
    return this.#source;
  }

  lookup(barcode: string): string | null {
    return this.#entries.get(barcode) ?? null;
  }

  /** Katalog `maxAgeHours` dan eski yoki umuman bo'sh bo'lsa. */
  isStale(maxAgeHours: number, now = new Date()): boolean {
    if (this.#entries.size === 0 || !this.#syncedAt) return true;
    const age = now.getTime() - new Date(this.#syncedAt).getTime();
    return !Number.isFinite(age) || age > maxAgeHours * 3600_000;
  }

  /** Katalogni to'liq almashtiradi (sinxronizatsiya natijasi). */
  async replaceAll(entries: ReadonlyMap<string, string>, source: string, now = new Date()): Promise<void> {
    this.#entries = new Map(entries);
    this.#syncedAt = now.toISOString();
    this.#source = source;

    await mkdir(dirname(this.path), { recursive: true });

    const obj: Record<string, string> = {};
    for (const [barcode, sku] of [...this.#entries].sort(([a], [b]) => a.localeCompare(b))) {
      obj[barcode] = sku;
    }
    const payload: CatalogueFile = { syncedAt: this.#syncedAt, source, entries: obj };

    // Atomar yozish — sinxronizatsiya paytida to'xtab qolsa katalog buzilmasin.
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(payload), 'utf8');
    await rename(tmp, this.path);
  }
}
