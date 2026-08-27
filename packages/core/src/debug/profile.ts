/**
 * Quvurning har bir bosqichini alohida o'lchaydi.
 *
 *   npx tsx src/debug/profile.ts scan <n>        # skanerdan n varoq olib, o'lchaydi
 *   npx tsx src/debug/profile.ts <papka>          # tayyor rasmlarda o'lchaydi
 *
 * Skanerlangan rasmlar scratchpad'da qoladi — optimizatsiya paytida qayta
 * skanerlamasdan ishlatish uchun.
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { scanBatch } from '@barcodeer/scanner';
import { loadImage } from '../image/load.js';
import { preparePage, fullImage, WORK_WIDTH } from '../layout/page.js';
import { detectItemTable } from '../layout/grid.js';
import { resolveColumns } from '../layout/columns.js';
import { BARCODE_CELL, NUMBER_CELL, SKU_CELL, cellBox, cropFull } from '../layout/cells.js';
import { decodeCrop, acceptItemBarcode, acceptDocId } from '../barcode/decode.js';
import { removeBlueInk } from '../image/ink.js';
import { prepareForOcr } from '../image/bbox.js';
import { OcrEngine } from '../ocr/engine.js';
import { HEADER_REGION } from '../ocr/header-fields.js';

const SCRATCH =
  'C:/Users/toxfim/AppData/Local/Temp/claude/C--Users-toxfim-Desktop-Work-barcodeer/94e68b87-1af3-49fc-a462-b6d4e5bafb2c/scratchpad';

const timings = new Map<string, number[]>();
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  const r = await fn();
  const ms = performance.now() - t;
  (timings.get(label) ?? timings.set(label, []).get(label)!).push(ms);
  return r;
}

let pages: string[];
const arg = process.argv[2] ?? '';
if (arg === 'scan') {
  const n = Number(process.argv[3] ?? 1);
  const outDir = join(SCRATCH, `prof-${Date.now()}`);
  mkdirSync(outDir, { recursive: true });
  const dpi = Number(process.argv[4] ?? 600);
  const t = performance.now();
  const res = await scanBatch({ dpi, outDir, deviceName: 'DS-530', maxPages: n });
  if (!res.ok) { console.error('skan xatosi:', res.error); process.exit(1); }
  const ms = performance.now() - t;
  console.log(`SKAN: ${res.pages.length} sahifa, ${dpi} DPI, ${(ms/1000).toFixed(1)} s jami, ${(ms/res.pages.length/1000).toFixed(1)} s/sahifa`);
  console.log(`      papka: ${outDir}`);
  pages = res.pages;
} else {
  const dir = resolve(arg);
  pages = readdirSync(dir).filter(f => /\.(bmp|png|jpg)$/i.test(f)).sort().map(f => join(dir, f));
}

const t0 = performance.now();
const ocr = await timed('ocr:engine-yaratish', async () => new OcrEngine({ langPath: resolve('.tessdata') }));
// worker'larni isitamiz — birinchi chaqiruv til faylini yuklaydi
await timed('ocr:worker-isitish', async () => {
  const blank = await sharp({ create: { width: 60, height: 30, channels: 3, background: '#fff' } }).png().toBuffer();
  await ocr.read(blank, 'digits'); await ocr.read(blank, 'latin'); await ocr.read(blank, 'cyrillic'); await ocr.read(blank, 'headerBlock');
});

const VARIANTS = [
  { targetHeight: 80, threshold: 160 }, { targetHeight: 120, threshold: 0 }, { targetHeight: 60, threshold: 190 },
] as const;

for (const path of pages) {
  const tp = performance.now();
  const { image, width, height } = await timed('1.bmp-yuklash', () => loadImage(path));
  void image;
  const page = await timed('2.preparePage(deskew+rotate+bin)', () => preparePage(path));
  const grid = await timed('3.to`r', async () => detectItemTable(page.bin, page.width, page.height));
  if (!grid) { console.log('to`r yo`q'); continue; }
  const cols = resolveColumns(grid)!;
  await timed('4.arxiv-jpeg', () => fullImage(page).resize({ width: WORK_WIDTH }).jpeg({ quality: 80, mozjpeg: true }).toBuffer());

  // sarlavha
  const hb = { x: Math.round(page.width*HEADER_REGION.xFrac), y: 0, width: Math.round(page.width*HEADER_REGION.widthFrac), height: Math.round(page.height*HEADER_REGION.heightFrac) };
  await timed('5.header-barcode', () => decodeCrop(cropFull(page, hb), { accept: acceptDocId }));
  await timed('6.header-ocr(4 oston)', async () => {
    const ink = await removeBlueInk(cropFull(page, hb));
    for (const thr of [170, 140, 195, 0]) {
      let p = sharp(ink.data, { raw: { width: ink.width, height: ink.height, channels: 1 } }).normalize();
      if (thr > 0) p = p.threshold(thr);
      await ocr.read(await p.withMetadata({ density: 300 }).png().toBuffer(), 'headerBlock');
    }
  });

  let rows = 0;
  for (let b = 0; b < grid.rowEdges.length - 1; b++) {
    const bc = await timed('7.qator:barcode', () => decodeCrop(cropFull(page, cellBox(grid, b, cols.barcode, BARCODE_CELL)!), { accept: acceptItemBarcode }));
    if (!bc) continue;
    rows++;
    await timed('8.qator:qty(ink+3prep+3ocr)', async () => {
      const ink = await removeBlueInk(cropFull(page, cellBox(grid, b, cols.quantity!, NUMBER_CELL)!));
      const v = await Promise.all(VARIANTS.map(o => prepareForOcr(ink.data, ink.width, ink.height, o)));
      await ocr.readVoted(v, 'digits');
    });
    await timed('9.qator:sku(ink+prep+2ocr)', async () => {
      const ink = await removeBlueInk(cropFull(page, cellBox(grid, b, cols.sku!, SKU_CELL)!));
      const png = await prepareForOcr(ink.data, ink.width, ink.height, { targetHeight: 140, threshold: 160 });
      if (png) await Promise.all([ocr.read(png, 'latin'), ocr.read(png, 'cyrillic')]);
    });
  }
  console.log(`${path.split(/[\\/]/).pop()}  ${width}x${height}  ${rows} qator  ${((performance.now()-tp)/1000).toFixed(1)} s`);
}
await ocr.close();

console.log(`\nJAMI qayta ishlash: ${((performance.now()-t0)/1000).toFixed(1)} s  (${pages.length} sahifa)\n`);
console.log('Bosqich                              chaqiruv    jami ms   o`rtacha ms');
for (const [k, v] of [...timings].sort((a, b) => a[0].localeCompare(b[0]))) {
  const sum = v.reduce((a, x) => a + x, 0);
  console.log(`${k.padEnd(36)} ${String(v.length).padStart(6)}  ${String(Math.round(sum)).padStart(9)}  ${String(Math.round(sum / v.length)).padStart(11)}`);
}
