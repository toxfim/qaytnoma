/** `Итого` katagi qanday kesilayotganini va OCR nima o'qiyotganini ko'rsatadi. */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { preparePage } from '../layout/page.js';
import { detectItemTable, findHorizontalLines } from '../layout/grid.js';
import { resolveColumns } from '../layout/columns.js';
import { cropFull } from '../layout/cells.js';
import { removeBlueInk } from '../image/ink.js';
import { prepareForOcr, contentBox } from '../image/bbox.js';
import { OcrEngine } from '../ocr/engine.js';

const file = process.argv[2]!, out = process.argv[3]!;
await mkdir(out, { recursive: true });
const ocr = new OcrEngine({ langPath: resolve('.tessdata') });
const page = await preparePage(file);
const grid = detectItemTable(page.bin, page.width, page.height)!;
const cols = resolveColumns(grid)!;

const tableBottom = grid.rowEdges[grid.rowEdges.length - 1]!;
const lines = findHorizontalLines(page.bin, page.width, page.height);
const next = lines.find((l) => l.y > tableBottom + 4);
console.log(`jadval osti y=${tableBottom}, keyingi chiziq y=${next?.y}, band=${next ? next.y - tableBottom : '-'}`);
console.log(`qator balandligi median ~${Math.round(grid.bounds.height / (grid.rowEdges.length - 1))}`);
console.log(`ustunlar: ${grid.columnEdges.join(' ')}   Кол-во=${cols.quantity}`);

if (!next) { console.log('Итого bandi topilmadi'); process.exit(0); }
const bandHeight = next.y - tableBottom;
const left = grid.columnEdges[cols.quantity!]!, right = grid.columnEdges[cols.quantity! + 1] ?? page.width;
const inset = Math.round((right - left) * 0.14);
const box = { x: left + inset, y: tableBottom + Math.round(bandHeight * 0.15), width: right - left - inset * 2, height: Math.round(bandHeight * 0.7) };
console.log(`kesma: ${JSON.stringify(box)}`);

await cropFull(page, box).png().toFile(`${out}/totals-raw.png`);
const ink = await removeBlueInk(cropFull(page, box));
const cb = contentBox(ink.data, ink.width, ink.height);
console.log(`mazmun bbox: x=${cb.x} y=${cb.y} ${cb.width}x${cb.height} bo'sh=${cb.empty}`);
const V = [{ targetHeight: 80, threshold: 160 }, { targetHeight: 120, threshold: 0 }, { targetHeight: 60, threshold: 190 }];
for (const [i, v] of V.entries()) {
  const png = await prepareForOcr(ink.data, ink.width, ink.height, v);
  if (!png) { console.log(`variant ${i}: bo'sh`); continue; }
  await sharp(png).toFile(`${out}/totals-v${i}.png`);
  const r = await ocr.read(png, 'digits');
  console.log(`variant ${i}: "${r.text}" (conf ${r.confidence.toFixed(0)})`);
}
// Kengroq kontekst: butun Итого bandi
await cropFull(page, { x: grid.bounds.x, y: tableBottom, width: grid.bounds.width, height: bandHeight }).png().toFile(`${out}/totals-band.png`);
await ocr.close();
