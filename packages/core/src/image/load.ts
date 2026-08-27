/**
 * Rasm yuklash: BMP (o'z dekoderimiz) va sharp qo'llab-quvvatlaydigan
 * hamma narsa (PNG / JPEG / TIFF / WEBP) uchun bitta kirish nuqtasi.
 */
import { readFile } from 'node:fs/promises';
import sharp, { type Sharp } from 'sharp';
import { decodeBmp, isBmp } from './bmp.js';

export interface LoadedImage {
  /** Qayta ishlashga tayyor sharp quvuri. */
  image: Sharp;
  width: number;
  height: number;
  /** Fayldan olingan DPI; aniqlanmasa null. */
  dpi: number | null;
}

/**
 * Rasmni sharp quvuriga yuklaydi.
 *
 * BMP uchun piksellar Node'da dekodlanadi va sharp'ga `raw` sifatida beriladi —
 * bu libvips'da BMP yuklovchisi yo'qligini chetlab o'tadi va oraliq
 * konvertatsiyani (100 MB fayllarda sezilarli) yo'q qiladi.
 */
export async function loadImage(path: string): Promise<LoadedImage> {
  const buf = await readFile(path);

  if (isBmp(buf)) {
    const bmp = decodeBmp(buf);
    return {
      image: sharp(bmp.data, {
        raw: { width: bmp.width, height: bmp.height, channels: bmp.channels },
        limitInputPixels: false,
      }),
      width: bmp.width,
      height: bmp.height,
      dpi: bmp.dpi,
    };
  }

  const image = sharp(buf, { limitInputPixels: false });
  const meta = await image.metadata();
  return {
    image,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    dpi: meta.density ?? null,
  };
}

/** Kulrang `raw` bufer — ZXing va proyeksiya tahlili uchun. */
export async function toGrayRaw(
  image: Sharp,
  resizeWidth?: number,
): Promise<{ data: Buffer; width: number; height: number }> {
  let pipe = image.clone().grayscale();
  if (resizeWidth) pipe = pipe.resize({ width: resizeWidth, kernel: 'lanczos3', fit: 'inside' });
  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
