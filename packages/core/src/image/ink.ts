/**
 * Ko'k siyohni olib tashlash.
 *
 * Foydalanuvchi qarori: hujjatdagi QO'LYOZMA tuzatishlar hisobga olinmaydi —
 * faqat chop etilgan `Кол-во` qiymati Sheets'ga yoziladi. Uzum hujjatlarida
 * qo'lda yozilgan hamma narsa ko'k ruchkada: tasdiq belgilari (✓), tuzatilgan
 * raqamlar, `ИЗВ` kabi qisqartmalar, imzolar va dumaloq muhr.
 *
 * Shuning uchun OCR'dan oldin ko'k piksellarni oqqa aylantiramiz. Bu
 * `CLAUDE.md` da tasvirlangan "ko'k maskani chop etilgan raqam chegarasi
 * bilan cheklash" murakkabligini butunlay yo'q qiladi: qo'lyozmani aniqlash
 * emas, uni O'CHIRISH kerak.
 *
 * Mezon: `B - max(R, G) > threshold`. Neytral kulrang (chop etilgan matn,
 * qog'oz, shtrix-kod) uchun bu ayirma nolga yaqin, ko'k siyoh uchun esa
 * sezilarli — skaner qanchalik kulrang ko'rsatsa ham.
 */
import sharp, { type Sharp } from 'sharp';
import { BLUE_INK_THRESHOLD } from '@barcodeer/shared';

export interface InkRemovalStats {
  /** Oqartirilgan piksellar ulushi (0..1) — diagnostika uchun. */
  removedFraction: number;
}

export interface RemovedInk {
  /** Ko'ki olib tashlangan kulrang piksellar. */
  data: Buffer;
  width: number;
  height: number;
  stats: InkRemovalStats;
}

export interface InkOptions {
  /** `B - max(R,G)` ostonasi. Kichikroq = ko'proq ko'k olinadi. */
  threshold?: number;
  /**
   * Maskani kengaytirish radiusi (piksel).
   *
   * Kerak, chunki ko'k shtrixning cheti qog'oz bilan aralashib, ayirma
   * ostonadan pastga tushadi va OCR'ni chalg'itadigan kulrang "arvoh" qoldiradi.
   */
  dilate?: number;
  /**
   * Shundan ochroq piksellar oqqa aylantiriladi (0 = o'chirilgan).
   *
   * Chop etilgan matn ~30..90 oralig'ida, olib tashlangan siyohning qoldiq
   * izlari esa ~170..230 — bu bosqich ularni butunlay yo'qotadi.
   */
  cleanupAbove?: number;
}

/**
 * Rangli kesmadan ko'k siyohni olib tashlab, kulrang bufer qaytaradi.
 * Kirish RGB bo'lishi shart — shu sababli skanerlash `DataType = 3` (rang) da
 * bajariladi, garchi natijada kulrang ishlatilsa ham.
 */
export async function removeBlueInk(crop: Sharp, opts: InkOptions = {}): Promise<RemovedInk> {
  const threshold = opts.threshold ?? BLUE_INK_THRESHOLD;
  const dilate = opts.dilate ?? 2;
  const cleanupAbove = opts.cleanupAbove ?? 150;

  const { data, info } = await crop
    .clone()
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const pixels = width * height;

  // 1) Ko'k maskasi va kulrang qiymatlar.
  const mask = new Uint8Array(pixels);
  const gray = Buffer.allocUnsafe(pixels);
  for (let i = 0, p = 0; p < pixels; p++, i += 3) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (b - (r > g ? r : g) > threshold) mask[p] = 1;
    // ITU-R BT.601 luma — sharp'ning `grayscale()` bilan bir xil.
    gray[p] = (r * 299 + g * 587 + b * 114) / 1000;
  }

  // 2) Maskani kengaytiramiz (ajratilgan: avval gorizontal, keyin vertikal).
  const dilated = dilate > 0 ? dilateMask(mask, width, height, dilate) : mask;

  // 3) Qo'llash va qoldiq izlarni tozalash.
  const out = Buffer.allocUnsafe(pixels);
  let removed = 0;
  for (let p = 0; p < pixels; p++) {
    if (dilated[p] === 1) {
      out[p] = 255;
      removed++;
    } else {
      const v = gray[p]!;
      out[p] = cleanupAbove > 0 && v > cleanupAbove ? 255 : v;
    }
  }

  return {
    data: out,
    width,
    height,
    stats: { removedFraction: pixels > 0 ? removed / pixels : 0 },
  };
}

/** Ajratilgan maksimum-filtr (morfologik dilatatsiya). */
function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) {
      let hit = 0;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      for (let xx = x0; xx <= x1; xx++) {
        if (mask[off + xx] === 1) {
          hit = 1;
          break;
        }
      }
      tmp[off + x] = hit;
    }
  }

  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (let yy = y0; yy <= y1; yy++) {
        if (tmp[yy * width + x] === 1) {
          hit = 1;
          break;
        }
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

/** Ko'ki olib tashlangan buferni sharp quvuriga o'raydi. */
export function toSharp(ink: RemovedInk): Sharp {
  return sharp(ink.data, { raw: { width: ink.width, height: ink.height, channels: 1 } });
}
