/**
 * Sahifani tahlilga tayyorlash: yuklash → qiyshiqlikni tuzatish → ishchi
 * o'lchamga keltirish → binarizatsiya.
 *
 * Bitta joyda saqlanadi, chunki quvurning har bir bosqichi (to'r detektsiyasi,
 * shtrix-kod dekodlash, OCR) xuddi shu deskew qilingan rasmdan foydalanishi
 * kerak — aks holda koordinatalar mos kelmaydi.
 *
 * DIQQAT — sharp quvurining tartibi: `.rotate(burchak)` `.extract()` dan KEYIN
 * bajariladi, chaqiruv tartibidan qat'i nazar. Ya'ni `sharp(x).rotate(a).extract(b)`
 * kesmani AYLANTIRILMAGAN rasmdan oladi. Shuning uchun aylantirilgan piksellarni
 * bir marta xom buferga materializatsiya qilamiz va kesmalarni o'shandan olamiz.
 * Bu bir vaqtning o'zida tezlikni ham hal qiladi: aks holda har bir katak
 * kesmasi uchun butun sahifa qaytadan aylantirilar edi.
 */
import sharp, { type Sharp } from 'sharp';
import { loadImage } from '../image/load.js';
import { binarize, otsuThreshold } from './binarize.js';
import { estimateSkew } from './deskew.js';

/** To'r va OCR uchun ishchi kenglik (~300 DPI A4). */
export const WORK_WIDTH = 2481;

/** Qiyshiqlikni baholash shu kenglikda bajariladi — aniqlik yetarli, ~20x tez. */
const SKEW_WIDTH = 760;

/** Shundan kichik burchak uchun aylantirish qilinmaydi (interpolyatsiya shtrix-kodni buzadi). */
const MIN_CORRECTION_DEG = 0.06;

export interface PreparedPage {
  /** Deskew qilingan to'liq ruxsatdagi RGB piksellar. */
  fullData: Buffer;
  fullWidth: number;
  fullHeight: number;
  /** Ishchi o'lchamdagi kulrang piksellar. */
  gray: Buffer;
  /** Ishchi o'lchamdagi binarizatsiya (1 = siyoh). */
  bin: Uint8Array;
  width: number;
  height: number;
  /** Tuzatilgan burchak (gradus, manbadagi qiyshiqlik). */
  skewDeg: number;
  otsu: number;
}

export async function preparePage(path: string): Promise<PreparedPage> {
  const { image } = await loadImage(path);

  // 1) Kichraytirilgan nusxada qiyshiqlikni baholaymiz.
  const probe = await image
    .clone()
    .grayscale()
    .resize({ width: SKEW_WIDTH, kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const skew = estimateSkew(binarize(probe.data), probe.info.width, probe.info.height);

  // 2) To'liq ruxsatda tuzatib, XOM BUFERGA materializatsiya qilamiz.
  //    Shear modelida musbat burchak kontentning o'ngga pastga qiyshayganini
  //    bildiradi, sharp esa musbat burchakda soat yo'nalishi bo'yicha
  //    aylantiradi — shuning uchun ishorani teskari qilamiz.
  const angle = Math.abs(skew.angleDeg) >= MIN_CORRECTION_DEG ? -skew.angleDeg : 0;
  const rotated = await (angle === 0 ? image.clone() : image.clone().rotate(angle, { background: '#ffffff' }))
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const fullWidth = rotated.info.width;
  const fullHeight = rotated.info.height;

  // 3) Ishchi o'lchamdagi kulrang + binarizatsiya (aylantirilgan buferdan).
  const work = await sharp(rotated.data, {
    raw: { width: fullWidth, height: fullHeight, channels: 3 },
    limitInputPixels: false,
  })
    .grayscale()
    .resize({ width: WORK_WIDTH, kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const otsu = otsuThreshold(work.data);

  return {
    fullData: rotated.data,
    fullWidth,
    fullHeight,
    gray: work.data,
    bin: binarize(work.data, otsu),
    width: work.info.width,
    height: work.info.height,
    skewDeg: -angle,
    otsu,
  };
}

/** Deskew qilingan to'liq ruxsatdagi rasm ustida yangi sharp quvuri. */
export function fullImage(page: PreparedPage): Sharp {
  return sharp(page.fullData, {
    raw: { width: page.fullWidth, height: page.fullHeight, channels: 3 },
    limitInputPixels: false,
  });
}

/** Deskew qilingan rasmning ishchi o'lchamdagi rangli nusxasi (debug/PDF uchun). */
export function workImage(page: PreparedPage): Sharp {
  return fullImage(page).resize({ width: WORK_WIDTH, kernel: 'lanczos3' });
}
