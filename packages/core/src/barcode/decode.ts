/**
 * Shtrix-kod dekodlash — HAR BIR KATAK ALOHIDA, KODLANGAN RASM ORQALI.
 *
 * Ikkita muhim qaror real skanlarda o'lchov asosida qabul qilingan:
 *
 * 1. NEGA to'liq sahifa emas: `readBarcodes` butun A4 sahifada 0 natija
 *    qaytardi (sarlavha bloklari va zich matn detektsiyani buzadi), xuddi shu
 *    sahifadan kesib olingan yakka shtrix-kod esa 100% dekodlandi. Shuning
 *    uchun to'r bilan topilgan katak chegaralaridan foydalanamiz.
 *
 * 2. NEGA xom piksel emas, PNG: `zxing-wasm@3.1.3` ning `ReadableImageData`
 *    yo'lida holat oqishi bor — muvaffaqiyatli o'qishdan keyingi chaqiruv,
 *    rasmda kod bo'lmasa ham, OLDINGI natijani qaytaradi. Bu qo'shni katakni
 *    o'qiganda jimgina noto'g'ri ma'lumot beradi. Oradagi "bo'sh" o'qish
 *    yordam bermadi (katta bo'sh rasm holatni yanada yomonlashtirdi), PNG
 *    Blob yo'li esa takroriy sinovlarda to'liq barqaror bo'ldi.
 *
 * Shuningdek `sharp.metadata()` quvurdagi `extract()` dan KEYINGI emas, KIRISH
 * rasmining o'lchamini qaytaradi — kesma o'lchamlari xom buferdan olinadi.
 */
import sharp, { type Sharp } from 'sharp';
import { readBarcodes } from 'zxing-wasm/reader';
import { DOC_ID_RE, ITEM_BARCODE_RE } from '@barcodeer/shared';
import { ensureZXing } from './zxing.js';

/** Uzum hujjatlarida ishlatiladigan formatlar. Mahsulot kodlari ham Code128. */
const FORMATS = ['Code128', 'Code39', 'EAN-13', 'ITF'] as const;

/**
 * Kattalashtirish sezilarli yordam beradi: 600 DPI da Code128 moduli ~5 px,
 * ZXing esa kengroq moduldan ancha ishonchli o'qiydi. Birinchi muvaffaqiyatda
 * to'xtaydi, shuning uchun tartib tezlik bo'yicha tanlangan.
 */
const DEFAULT_SCALES = [1, 2, 3, 0.5] as const;

export interface DecodeResult {
  text: string;
  format: string;
}

interface GrayImage {
  data: Buffer;
  width: number;
  height: number;
}

async function readGray(pipe: Sharp): Promise<GrayImage> {
  const { data, info } = await pipe.grayscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Xom kulrang buferni masshtablab, PNG ga kodlaydi (siqishsiz — tezlik uchun). */
async function encodePng(base: GrayImage, scale: number): Promise<Buffer> {
  const pipe = sharp(base.data, {
    raw: { width: base.width, height: base.height, channels: 1 },
  });
  if (scale !== 1) {
    pipe.resize({ width: Math.max(24, Math.round(base.width * scale)), kernel: 'lanczos3' });
  }
  return pipe.png({ compressionLevel: 0 }).toBuffer();
}

async function tryRead(png: Buffer, accept?: (text: string) => boolean): Promise<DecodeResult | null> {
  let results;
  try {
    results = await readBarcodes(new Blob([new Uint8Array(png)]), {
      formats: [...FORMATS],
      tryHarder: true,
      tryRotate: false,
      maxNumberOfSymbols: 4,
    });
  } catch {
    return null;
  }
  for (const r of results) {
    const text = r.text.trim();
    if (!text) continue;
    if (accept && !accept(text)) continue;
    return { text, format: r.format };
  }
  return null;
}

/**
 * Kesmadan bitta shtrix-kodni o'qiydi.
 *
 * Bir necha masshtabda urinib ko'riladi: skanerlangan Code128 uchun optimal
 * masshtab oldindan ma'lum emas — `CLAUDE_CONTEXT.md` da ta'kidlanganidek,
 * yuqori DPI har doim ham yaxshi natija bermaydi.
 */
export async function decodeCrop(
  crop: Sharp,
  opts: { scales?: readonly number[]; accept?: (text: string) => boolean } = {},
): Promise<DecodeResult | null> {
  await ensureZXing();

  const base = await readGray(crop.clone());
  if (base.width < 24 || base.height < 8) return null;

  for (const scale of opts.scales ?? DEFAULT_SCALES) {
    const hit = await tryRead(await encodePng(base, scale), opts.accept);
    if (hit) return hit;
  }
  return null;
}

/** Mahsulot shtrix-kodi: 13 xonali raqam. */
export function acceptItemBarcode(text: string): boolean {
  return ITEM_BARCODE_RE.test(text);
}

/** Hujjat shtrix-kodi: `15-0000163307`. */
export function acceptDocId(text: string): boolean {
  return DOC_ID_RE.test(text);
}
