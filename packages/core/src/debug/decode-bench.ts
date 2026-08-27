/**
 * DPI bo'yicha shtrix-kod dekodlash darajasini o'lchash.
 *
 * 600 DPI da skanerlangan sahifani turli darajalarga tushirib, har birida
 * nechta shtrix-kod dekodlanishini solishtiradi. `CLAUDE_CONTEXT.md` da
 * ta'kidlanganidek, yuqori DPI Code128 uchun har doim ham yaxshi emas —
 * shuning uchun empirik o'lchov shart.
 *
 * Ishlatish:
 *   npx tsx src/debug/decode-bench.ts <dir-yoki-fayl>
 */
import { readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { readBarcodes } from 'zxing-wasm/reader';
import { loadImage, toGrayRaw } from '../image/load.js';
import { ensureZXing } from '../barcode/zxing.js';

const SOURCE_DPI = 600;
const TARGET_DPIS = [600, 500, 400, 300, 250, 200, 150];

interface DecodeSummary {
  dpi: number;
  width: number;
  height: number;
  ms: number;
  total: number;
  docIds: string[];
  itemBarcodes: string[];
  other: string[];
  error?: string;
}

async function decodeAt(imagePath: string, dpi: number): Promise<DecodeSummary> {
  const { image, width } = await loadImage(imagePath);
  const targetWidth = dpi === SOURCE_DPI ? undefined : Math.round(width * (dpi / SOURCE_DPI));
  const gray = await toGrayRaw(image, targetWidth);

  const base: DecodeSummary = {
    dpi,
    width: gray.width,
    height: gray.height,
    ms: 0,
    total: 0,
    docIds: [],
    itemBarcodes: [],
    other: [],
  };

  const started = performance.now();
  let results;
  try {
    results = await readBarcodes(
      { data: new Uint8ClampedArray(gray.data), width: gray.width, height: gray.height },
      {
        formats: ['Code128', 'EAN-13', 'Code39', 'ITF', 'EAN-8', 'UPC-A'],
        tryHarder: true,
        tryRotate: true,
        tryInvert: false,
        maxNumberOfSymbols: 80,
      },
    );
  } catch (err) {
    base.ms = Math.round(performance.now() - started);
    base.error = err instanceof Error ? err.message : String(err);
    return base;
  }
  base.ms = Math.round(performance.now() - started);
  base.total = results.length;

  for (const r of results) {
    const text = r.text.trim();
    if (/^\d{2}-\d{10}$/.test(text)) base.docIds.push(text);
    else if (/^\d{13}$/.test(text)) base.itemBarcodes.push(text);
    else base.other.push(`${text} (${r.format})`);
  }
  return base;
}

async function collectImages(target: string): Promise<string[]> {
  const st = await stat(target);
  if (st.isFile()) return [target];
  const entries = await readdir(target);
  return entries
    .filter((e) => /\.(bmp|png|jpe?g|tiff?)$/i.test(e))
    .sort()
    .map((e) => join(target, e));
}

async function main() {
  await ensureZXing();

  const target = resolve(process.argv[2] ?? '.');
  const images = await collectImages(target);
  if (images.length === 0) {
    console.error(`Rasm topilmadi: ${target}`);
    process.exit(1);
  }

  console.log(`${images.length} ta rasm topildi\n`);

  for (const image of images) {
    console.log(`════ ${basename(image)} ════`);
    for (const dpi of TARGET_DPIS) {
      const s = await decodeAt(image, dpi);
      const size = `${String(s.width).padStart(5)}x${String(s.height).padEnd(5)}`;
      if (s.error) {
        console.log(`  ${String(s.dpi).padStart(3)} DPI ${size} ${String(s.ms).padStart(6)} ms  XATO: ${s.error}`);
        continue;
      }
      const docPart = s.docIds.length ? ` doc=[${s.docIds.join(', ')}]` : '';
      const otherPart = s.other.length ? ` boshqa=[${s.other.join(' | ')}]` : '';
      console.log(
        `  ${String(s.dpi).padStart(3)} DPI ${size} ${String(s.ms).padStart(6)} ms  jami=${String(
          s.total,
        ).padStart(2)}  mahsulot=${String(s.itemBarcodes.length).padStart(2)}${docPart}${otherPart}`,
      );
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
