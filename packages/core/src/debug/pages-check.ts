import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { extractPage } from '../pipeline/extract-page.js';
import { OcrEngine } from '../ocr/engine.js';
const dir = process.argv[2]!;
const ocr = new OcrEngine({ langPath: resolve('.tessdata') });
let i = 0;
for (const f of (await readdir(dir)).filter(f=>/\.(bmp|jpg|png)$/i.test(f)).sort()) {
  const p = await extractPage(join(dir, f), i++, ocr);
  const c = p.columns;
  console.log(`${f.padEnd(14)} ${p.isHeaderPage ? 'SARLAVHA' : 'davomi  '}  qatorlar=${String(p.rows.length).padStart(2)}  ustunlar: ШК=${c?.barcode} SKU=${c?.sku} Кол=${c?.quantity}  Итого=${p.totals.quantity}`);
  if (p.isHeaderPage) console.log(`               docId=${p.docId} num=${p.docNumber} date=${p.docDate} bc=${p.docIdFromBarcode}`);
  if (p.headerEvidenceMissing) console.log(`               DIQQAT: sarlavhaga o'xshaydi, lekin dalil yo'q`);
}
await ocr.close();
