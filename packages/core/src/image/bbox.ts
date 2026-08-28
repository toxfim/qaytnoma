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

/**
 * Katakdagi yakka shovqin dog'larini oqartiradi.
 *
 * NEGA KERAK: `removeBlueInk` ko'k qo'lyozmani olib tashlaydi, ammo qalam
 * bosimi kuchli bo'lgan joylarda mayda kulrang qoldiq nuqtalar qoladi. Ular
 * o'zi zararsiz, lekin `contentBox` ni cho'zib yuboradi va ZARARI SHUNDA:
 * `prepareForOcr` masshtabni mazmun balandligidan hisoblaydi, shuning uchun
 * katta bo'lib qolgan chegara masshtablashni butunlay o'chiradi va raqam
 * Tesseract'ga original ~25 px balandlikda boradi — u esa bo'sh natija
 * qaytaradi.
 *
 * O'lchangan holat (15-0006740693): olti katakda raqam ko'z bilan toza
 * ko'rinardi, ammo mazmun chegarasi 7x23 o'rniga 50x79 gacha cho'zilgan va
 * oltalasi ham o'qilmagan. Ular `Итого` bilan farqning 30 birligini tashkil
 * qilardi.
 *
 * MEZON: raqamlar katakda bir xil balandlikda turadi, shovqin esa ancha
 * pastroq. Shuning uchun eng baland komponentga nisbatan `minHeightFrac` dan
 * past bo'lgan komponentlar o'chiriladi. Bu mezon SKU/tavsif kataklariga
 * TO'G'RI KELMAYDI (u yerda `i` nuqtasi va apostrof qonuniy ravishda kichik),
 * shuning uchun `prepareForOcr` da bu bosqich standart holda o'chiq.
 */
export function denoiseSpecks(
  gray: Buffer,
  width: number,
  height: number,
  opts: { threshold?: number; minHeightFrac?: number; minPixels?: number } = {},
): Buffer {
  const threshold = opts.threshold ?? 160;
  const minHeightFrac = opts.minHeightFrac ?? 0.45;
  const minPixels = opts.minPixels ?? 4;

  // Bog'langan komponentlar (8-qo'shnilik), iterativ to'ldirish — rekursiya
  // chuqurligi katta kataklarda stekni to'ldirib yuborardi.
  const labels = new Int32Array(width * height).fill(-1);
  const stack: number[] = [];
  interface Comp { top: number; bottom: number; pixels: number }
  const comps: Comp[] = [];

  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== -1 || gray[start]! >= threshold) continue;
    const id = comps.length;
    const comp: Comp = { top: height, bottom: -1, pixels: 0 };
    labels[start] = id;
    stack.push(start);

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const y = (idx / width) | 0;
      const x = idx - y * width;
      comp.pixels++;
      if (y < comp.top) comp.top = y;
      if (y > comp.bottom) comp.bottom = y;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const n = ny * width + nx;
          if (labels[n] !== -1 || gray[n]! >= threshold) continue;
          labels[n] = id;
          stack.push(n);
        }
      }
    }
    comps.push(comp);
  }

  if (comps.length === 0) return gray;

  let maxHeight = 0;
  for (const c of comps) {
    const h = c.bottom - c.top + 1;
    if (c.pixels >= minPixels && h > maxHeight) maxHeight = h;
  }
  if (maxHeight === 0) return gray;

  const minHeight = maxHeight * minHeightFrac;
  const drop = comps.map((c) => c.pixels < minPixels || c.bottom - c.top + 1 < minHeight);
  if (!drop.some(Boolean)) return gray;

  const out = Buffer.from(gray);
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i]!;
    if (id >= 0 && drop[id]!) out[i] = 255;
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
  /**
   * Yakka shovqin dog'larini oqartirish (standart: O'CHIQ). Faqat mazmuni
   * bir xil balandlikdagi kataklar — `Кол-во`, `Итого` — uchun yoqing.
   * `denoiseSpecks` ga qarang.
   */
  denoise?: boolean;
  /**
   * Gorizontal cho'zish koeffitsienti (standart: 1 — cho'zilmaydi).
   *
   * NEGA KERAK: Tesseract yonma-yon turgan ingichka gliflarni — amalda `11` ni —
   * bitta belgi deb ko'radi va `1` qaytaradi. Masshtabni oshirish yordam
   * bermaydi (80..260 px balandlikda natija bir xil), gliflarni gorizontal
   * AJRATISH esa hal qiladi: o'lchangan `Итого` katagida 1.0x da `"1"` (ishonch
   * 52), 1.5x da `"11"` (ishonch 94). 3.0x da natija yana yo'qoladi — harflar
   * o'z shaklidan uzoqlashadi.
   */
  stretchX?: number;
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

  let cleaned = (opts.removeLines ?? true) ? suppressLines(gray, width, height) : gray;
  if (opts.denoise) cleaned = denoiseSpecks(cleaned, width, height);

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
  const stretchX = opts.stretchX ?? 1;

  let pipe = sharp(cleaned, { raw: { width, height, channels: 1 } }).extract({
    left,
    top,
    width: w,
    height: h,
  });

  if (scale > 1.01 || stretchX !== 1) {
    // `fit: 'fill'` — cho'zishda balandlik saqlanishi shart, aks holda sharp
    // nisbatni tiklab cho'zishni bekor qiladi.
    pipe = pipe.resize({
      width: Math.round(w * scale * stretchX),
      height: Math.round(h * scale),
      fit: 'fill',
      kernel: 'lanczos3',
    });
  }

  pipe = pipe.normalize();
  if (threshold > 0) pipe = pipe.threshold(threshold);

  return pipe
    .extend({ top: margin, bottom: margin, left: margin, right: margin, background: '#ffffff' })
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();
}
