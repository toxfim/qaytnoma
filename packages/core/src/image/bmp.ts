/**
 * Minimal BMP dekoderi.
 *
 * Nega kerak: Epson DS-530 II WIA orqali FAQAT BMP beradi
 * (`item.Formats` = [BMP, Epson-specific]), sharp/libvips esa BMP ni o'qimaydi.
 * BMP → PNG konvertatsiyasi 100 MB lik fayllarda qimmat, shuning uchun
 * piksellarni to'g'ridan-to'g'ri o'qib, sharp'ga `raw` sifatida uzatamiz.
 *
 * Qo'llab-quvvatlanadi: BITMAPINFOHEADER va undan kengroq sarlavhalar,
 * 1 / 8 / 24 / 32 bit, siqilmagan (BI_RGB) va BI_BITFIELDS.
 * Qo'llab-quvvatlanmaydi: RLE siqish (skanerlar ishlatmaydi).
 */

export interface DecodedBmp {
  /** RGB, yuqoridan pastga, qatorlar orasida to'ldirish yo'q. */
  data: Buffer;
  width: number;
  height: number;
  channels: 3;
  /** Sarlavhadagi gorizontal DPI (piksel/metrdan hisoblangan), aniqlanmasa null. */
  dpi: number | null;
}

const BI_RGB = 0;
const BI_BITFIELDS = 3;

export function isBmp(buf: Buffer): boolean {
  return buf.length > 2 && buf[0] === 0x42 && buf[1] === 0x4d; // 'BM'
}

export function decodeBmp(buf: Buffer): DecodedBmp {
  if (!isBmp(buf)) throw new Error('BMP emas: "BM" imzosi topilmadi');

  const pixelOffset = buf.readUInt32LE(10);
  const headerSize = buf.readUInt32LE(14);
  if (headerSize < 40) throw new Error(`Qo'llab-quvvatlanmaydigan BMP sarlavhasi: ${headerSize} bayt`);

  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const bitCount = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  const xPelsPerMeter = buf.readInt32LE(38);
  let clrUsed = buf.readUInt32LE(46);

  if (width <= 0 || rawHeight === 0) throw new Error(`Noto'g'ri BMP o'lchami: ${width}x${rawHeight}`);
  if (compression !== BI_RGB && compression !== BI_BITFIELDS) {
    throw new Error(`Qo'llab-quvvatlanmaydigan BMP siqishi: ${compression}`);
  }

  // Musbat balandlik = pastdan yuqoriga (BMP standarti), manfiy = yuqoridan pastga.
  const bottomUp = rawHeight > 0;
  const height = Math.abs(rawHeight);

  // Palitra (1 va 8 bit uchun) sarlavhadan keyin darhol keladi.
  if (clrUsed === 0 && bitCount <= 8) clrUsed = 1 << bitCount;
  const paletteOffset = 14 + headerSize + (compression === BI_BITFIELDS ? 12 : 0);

  const stride = (((width * bitCount + 31) / 32) | 0) * 4;
  const out = Buffer.allocUnsafe(width * height * 3);

  const readRow = pickRowReader(buf, bitCount, paletteOffset, clrUsed, width);

  for (let y = 0; y < height; y++) {
    const srcY = bottomUp ? height - 1 - y : y;
    const rowStart = pixelOffset + srcY * stride;
    if (rowStart + stride > buf.length) {
      throw new Error(`BMP kesilgan: ${srcY}-qator uchun ma'lumot yetmadi`);
    }
    readRow(rowStart, out, y * width * 3);
  }

  return {
    data: out,
    width,
    height,
    channels: 3,
    dpi: xPelsPerMeter > 0 ? Math.round(xPelsPerMeter * 0.0254) : null,
  };
}

type RowReader = (srcOffset: number, dst: Buffer, dstOffset: number) => void;

function pickRowReader(
  buf: Buffer,
  bitCount: number,
  paletteOffset: number,
  clrUsed: number,
  width: number,
): RowReader {
  switch (bitCount) {
    case 24:
      return (src, dst, dstOff) => {
        for (let x = 0; x < width; x++) {
          const s = src + x * 3;
          const d = dstOff + x * 3;
          // BMP piksellarni BGR tartibida saqlaydi.
          dst[d] = buf[s + 2]!;
          dst[d + 1] = buf[s + 1]!;
          dst[d + 2] = buf[s]!;
        }
      };

    case 32:
      return (src, dst, dstOff) => {
        for (let x = 0; x < width; x++) {
          const s = src + x * 4;
          const d = dstOff + x * 3;
          dst[d] = buf[s + 2]!;
          dst[d + 1] = buf[s + 1]!;
          dst[d + 2] = buf[s]!;
        }
      };

    case 8: {
      const palette = readPalette(buf, paletteOffset, clrUsed);
      return (src, dst, dstOff) => {
        for (let x = 0; x < width; x++) {
          const idx = buf[src + x]! * 3;
          const d = dstOff + x * 3;
          dst[d] = palette[idx]!;
          dst[d + 1] = palette[idx + 1]!;
          dst[d + 2] = palette[idx + 2]!;
        }
      };
    }

    case 1: {
      const palette = readPalette(buf, paletteOffset, clrUsed);
      return (src, dst, dstOff) => {
        for (let x = 0; x < width; x++) {
          const byte = buf[src + (x >> 3)]!;
          const bit = (byte >> (7 - (x & 7))) & 1;
          const idx = bit * 3;
          const d = dstOff + x * 3;
          dst[d] = palette[idx]!;
          dst[d + 1] = palette[idx + 1]!;
          dst[d + 2] = palette[idx + 2]!;
        }
      };
    }

    default:
      throw new Error(`Qo'llab-quvvatlanmaydigan BMP chuqurligi: ${bitCount} bit`);
  }
}

/** Palitrani BGRA0 dan RGB uchligiga o'giradi. */
function readPalette(buf: Buffer, offset: number, count: number): Buffer {
  const palette = Buffer.alloc(Math.max(count, 2) * 3);
  for (let i = 0; i < count; i++) {
    const s = offset + i * 4;
    if (s + 2 >= buf.length) break;
    palette[i * 3] = buf[s + 2]!;
    palette[i * 3 + 1] = buf[s + 1]!;
    palette[i * 3 + 2] = buf[s]!;
  }
  return palette;
}
