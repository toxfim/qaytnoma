/** 600 DPI skanlarni past DPI'ga tushiradi — DPI tajribasi uchun. */
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { loadImage } from '../image/load.js';
const src = resolve(process.argv[2]!); const dpi = Number(process.argv[3]!);
const out = resolve(process.argv[4] ?? `${src}-${dpi}`);
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src).filter(f => /\.bmp$/i.test(f)).sort()) {
  const { image, width } = await loadImage(join(src, f));
  const target = join(out, basename(f, '.bmp') + '.png');
  await image.resize({ width: Math.round(width * dpi / 600), kernel: 'lanczos3' }).png({ compressionLevel: 3 }).toFile(target);
  console.log(`${f} -> ${dpi} DPI`);
}
console.log(out);
