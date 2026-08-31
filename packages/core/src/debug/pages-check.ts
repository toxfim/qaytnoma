import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { extractPage } from '../pipeline/extract-page.js';
import { OcrEngine } from '../ocr/engine.js';
const dir = process.argv[2]!;
const ocr = new OcrEngine({ langPath: resolve('.tessdata') });
const tWarm = performance.now();
await ocr.warmUp();
console.log(`worker isitish: ${((performance.now() - tWarm) / 1000).toFixed(1)} s`);
const t0 = performance.now();
let i = 0;
for (const f of (await readdir(dir)).filter(f=>/\.(bmp|jpg|png)$/i.test(f)).sort()) {
  const tp = performance.now();
  const p = await extractPage(join(dir, f), i++, ocr, { knownSku: () => true });
  process.stdout.write(`${((performance.now() - tp) / 1000).toFixed(1)}s  `);
  const c = p.columns;
  const qtys = p.rows.map(r => r.quantity);
  const nulls = qtys.filter(q => q === null).length;
  const sum = qtys.reduce((a: number, q) => a + (q ?? 0), 0);
  console.log(`${f.padEnd(14)} ${p.isHeaderPage ? 'SARLAVHA' : 'davomi  '}  qatorlar=${String(p.rows.length).padStart(2)}  Σqty=${String(sum).padStart(3)} (o'qilmagan ${nulls})  Итого=${p.totals.quantity}  [${qtys.join(' ')}]`);
  if (p.isHeaderPage) console.log(`               docId=${p.docId} num=${p.docNumber} date=${p.docDate} bc=${p.docIdFromBarcode}`);
  if (p.headerEvidenceMissing) console.log(`               DIQQAT: sarlavhaga o'xshaydi, lekin dalil yo'q`);
}
console.log(`
JAMI: ${((performance.now() - t0) / 1000).toFixed(1)} s, ${i} sahifa`);
await ocr.close();
