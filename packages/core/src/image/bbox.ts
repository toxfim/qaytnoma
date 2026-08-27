/**
 * Katak ichidagi siyohning haqiqiy chegarasini topish.
 *
 * NEGA kerak: jadval katagi mazmunidan ancha katta (`Кол-во` katagida bitta
 * raqam, atrofi bo'sh). Tesseract'ga bunday rasm berilsa, u o'lchamdan DPI ni
 * noto'g'ri baholaydi ("Invalid resolution 25 dpi") va yakka ingichka `1` ni
 * umuman ko'rmay o'tib ketadi. Mazmunni qirqib, standart balandlikka
 * keltirsak, Tesseract ancha barqaror ishlaydi.
 */
import sharp from 'sharp';

export interface ContentBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Katakda umuman siyoh topilmadi. */
  empty: boolean;
}

/**
 * Kulrang buferdagi qorong'i piksellarning chegara to'rtburchagi.
 *
 * Yakka shovqin nuqtalari chegarani cho'zib yubormasligi uchun qator/ustun
 * bo'yicha proyeksiya ishlatiladi: qatorda kamida `minPixels` ta qorong'i
 * piksel bo'lishi kerak.
 */
export function contentBox(
  gray: Buffer | Uint8Array,
  width: number,
  height: number,
  opts: { threshold?: number; minPixels?: number } = {},
): ContentBox {
  const threshold = opts.threshold ?? 128;
  const minPixels = opts.minPixels ?? 2;

  const rowCounts = new Int32Array(height);
  const colCounts = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) {
      if (gray[off + x]! < threshold) {
        rowCounts[y]!++;
        colCounts[x]!++;
      }
    }
  }

  const top = firstAbove(rowCounts, minPixels);
  const bottom = lastAbove(rowCounts, minPixels);
  const left = firstAbove(colCounts, minPixels);
  const right = lastAbove(colCounts, minPixels);

  if (top < 0 || left < 0) return { x: 0, y: 0, width, height, empty: true };

  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1, empty: false };
}

function firstAbove(counts: Int32Array, min: number): number {
  for (let i = 0; i < counts.length; i++) if (counts[i]! >= min) return i;
  return -1;
}

function lastAbove(counts: Int32Array, min: number): number {
  for (let i = counts.length - 1; i >= 0; i--) if (counts[i]! >= min) return i;
  return -1;
}

/**
 * Katak kesmasiga tushib qolgan jadval chiziqlarini oqartiradi.
 *
 * NEGA KERAK: kesma chegaralari to'rdan olinadi, ammo qog'ozdagi qoldiq
 * qiyshiqlik tufayli sahifaning pastki qatorlarida ustun chizig'i katak ichiga
 * kirib qoladi. O'lchov: shunday kataklarda mazmun chegarasi 20x54 piksel
 * (yakka raqam) o'rniga 173x260 (chiziq + raqam) bo'lib chiqdi va Tesseract
 * bo'sh natija qaytardi — sahifadagi oxirgi uch qatorning miqdori yo'qoldi.
 *
 * Mezon: to'liq qora ustun yoki qator chiziqdir. Raqam hech qachon katakning
 * butun balandligi yoki kengligi bo'ylab cho'zilmaydi — yakka `1` uchun bu
 * ulush ~0.28 ni tashkil qiladi.
 */
export function suppressLines(
  gray: Buffer,
  width: number,
  height: number,
  opts: { threshold?: number; minFill?: number } = {},
): Buffer {
  // Oston yuqoriroq (160): chiziq skanda kulrangroq chiqishi mumkin.
  // Ulush pastroq (0.55): qoldiq qiyshiqlik tufayli chiziq katakning faqat
  // bir qismini egallashi mumkin. Raqam uchun bu ulush ~0.28 dan oshmaydi,
  // shuning uchun chegara xavfsiz.
  const threshold = opts.threshold ?? 160;
  const minFill = opts.minFill ?? 0.55;

  const colCounts = new Int32Array(width);
  const rowCounts = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) {
      if (gray[off + x]! < threshold) {
        colCounts[x]!++;
        rowCounts[y]!++;
      }
    }
  }

  const out = Buffer.from(gray);
  for (let x = 0; x < width; x++) {
    if (colCounts[x]! < height * minFill) continue;
    for (let y = 0; y < height; y++) out[y * width + x] = 255;
  }
  for (let y = 0; y < height; y++) {
    if (rowCounts[y]! < width * minFill) continue;
    out.fill(255, y * width, y * width + width);
  }
  return out;
}

export interface OcrPrepOptions {
  /** Natijadagi maqsad balandlik (piksel). Tesseract ~30-50 px x-balandlikni yaxshi ko'radi. */
  targetHeight?: number;
  /** Mazmun atrofidagi oq hoshiya (piksel). */
  margin?: number;
  /** Binarizatsiya ostonasi; 0 = binarizatsiya qilinmaydi. */
  threshold?: number;
  /** Maksimal kattalashtirish koeffitsienti. */
  maxScale?: number;
  /**
   * Kesmaga tushib qolgan jadval chiziqlarini oqartirish (standart: yoqilgan).
   * `suppressLines` ga qarang.
   */
  removeLines?: boolean;
}

/**
 * Kulrang katak buferini OCR uchun tayyorlaydi:
 * mazmun bo'yicha qirqish → standart balandlikka masshtablash → oq hoshiya →
 * binarizatsiya → 300 DPI metama'lumoti.
 *
 * `null` qaytarsa — katak bo'sh, OCR chaqirishning hojati yo'q.
 */
export async function prepareForOcr(
  gray: Buffer,
  width: number,
  height: number,
  opts: OcrPrepOptions = {},
): Promise<Buffer | null> {
  const targetHeight = opts.targetHeight ?? 72;
  const margin = opts.margin ?? 20;
  const threshold = opts.threshold ?? 160;
  const maxScale = opts.maxScale ?? 4;

  const cleaned = (opts.removeLines ?? true) ? suppressLines(gray, width, height) : gray;

  const box = contentBox(cleaned, width, height);
  if (box.empty) return null;

  // Mazmun atrofida ozgina asl kontekst qoldiramiz — harflarning yupqa
  // chekkalari qirqilib ketmasligi uchun.
  const pad = 4;
  const left = Math.max(0, box.x - pad);
  const top = Math.max(0, box.y - pad);
  const w = Math.min(width - left, box.width + pad * 2);
  const h = Math.min(height - top, box.height + pad * 2);

  const scale = Math.min(maxScale, Math.max(1, targetHeight / h));

  let pipe = sharp(cleaned, { raw: { width, height, channels: 1 } }).extract({
    left,
    top,
    width: w,
    height: h,
  });

  if (scale > 1.01) {
    pipe = pipe.resize({ width: Math.round(w * scale), kernel: 'lanczos3' });
  }

  pipe = pipe.normalize();
  if (threshold > 0) pipe = pipe.threshold(threshold);

  return pipe
    .extend({ top: margin, bottom: margin, left: margin, right: margin, background: '#ffffff' })
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();
}
