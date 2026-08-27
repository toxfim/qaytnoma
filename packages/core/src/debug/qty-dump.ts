/** O'qilmagan Кол-во kataklarini kontakt-varaq qilib chiqaradi. */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { preparePage } from '../layout/page.js';
import { detectItemTable } from '../layout/grid.js';
import { resolveColumns } from '../layout/columns.js';
import { BARCODE_CELL, NUMBER_CELL, cellBox, cropFull } from '../layout/cells.js';
import { decodeCrop, acceptItemBarcode } from '../barcode/decode.js';
import { removeBlueInk } from '../image/ink.js';
import { prepareForOcr, contentBox } from '../image/bbox.js';
import { OcrEngine } from '../ocr/engine.js';
import { parseQuantity } from '../ocr/parse.js';

const file = process.argv[2]!, out = process.argv[3]!;
await mkdir(out, { recursive: true });
const ocr = new OcrEngine({ langPath: resolve('.tessdata') });
const page = await preparePage(file);
const grid = detectItemTable(page.bin, page.width, page.height)!;
const cols = resolveColumns(grid)!;
const tiles: Buffer[] = [];

for (let b = 0; b < grid.rowEdges.length - 1; b++) {
  const bc = await decodeCrop(cropFull(page, cellBox(grid, b, cols.barcode, BARCODE_CELL)!), { accept: acceptItemBarcode });
  if (!bc) continue;
  const box = cellBox(grid, b, cols.quantity!, NUMBER_CELL)!;
  const ink = await removeBlueInk(cropFull(page, box));
  const cb = contentBox(ink.data, ink.width, ink.height);
  const variants = await Promise.all([
    prepareForOcr(ink.data, ink.width, ink.height, { targetHeight: 80, threshold: 160 }),
    prepareForOcr(ink.data, ink.width, ink.height, { targetHeight: 120, threshold: 0 }),
    prepareForOcr(ink.data, ink.width, ink.height, { targetHeight: 60, threshold: 190 }),
  ]);
  const voted = await ocr.readVoted(variants, 'digits');
  const qty = voted.text ? parseQuantity(voted.text) : null;
  const reads: string[] = [];
  for (const v of variants) reads.push(v ? JSON.stringify((await ocr.read(v, 'digits')).text) : 'null');
  console.log(`band ${String(b).padStart(2)} ${bc.text}  qty=${String(qty).padStart(4)}  bbox=${cb.width}x${cb.height}${cb.empty?' BO`SH':''}  katak=${box.width}x${box.height}  o'qishlar=[${reads.join(' ')}]`);
  if (qty === null) {
    tiles.push(await sharp(ink.data, { raw: { width: ink.width, height: ink.height, channels: 1 } }).resize({ height: 110 }).png().toBuffer());
    if (variants[0]) await sharp(variants[0]).resize({height:110}).png().toFile(`${out}/prep_b${b}.png`);
  }
}
if (tiles.length) {
  const metas = await Promise.all(tiles.map(t => sharp(t).metadata()));
  const W = Math.max(...metas.map(m => m.width ?? 0)) + 10;
  const canvas = sharp({ create: { width: W, height: 120 * tiles.length, channels: 3, background: '#ffffff' } });
  await canvas.composite(tiles.map((t, i) => ({ input: t, top: i * 120 + 5, left: 5 }))).png().toFile(`${out}/failed-qty.png`);
  console.log(`\n${tiles.length} ta muvaffaqiyatsiz katak -> ${out}/failed-qty.png`);
}
await ocr.close();
