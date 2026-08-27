/**
 * Jadval to'ri detektsiyasini ko'z bilan tekshirish uchun overlay chizadi.
 *
 * Ishlatish:
 *   npx tsx src/debug/grid-overlay.ts <scan-dir> <out-dir>
 */
import { mkdir, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import sharp from 'sharp';
import { detectItemTable } from '../layout/grid.js';
import { preparePage, workImage } from '../layout/page.js';

async function main() {
  const dir = resolve(process.argv[2] ?? '.');
  const outDir = resolve(process.argv[3] ?? '.');
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(dir)).filter((f) => /\.(bmp|png|jpe?g|tiff?)$/i.test(f)).sort();

  for (const file of files) {
    const t = performance.now();
    const page = await preparePage(join(dir, file));
    const grid = detectItemTable(page.bin, page.width, page.height);
    const ms = Math.round(performance.now() - t);

    if (!grid) {
      console.log(`${file.padEnd(14)} skew=${page.skewDeg.toFixed(2)}°  ${ms} ms  -> to'r TOPILMADI`);
      continue;
    }

    const rows = grid.rowEdges.length - 1;
    const cols = grid.columnEdges.length - 1;
    const topPct = ((grid.bounds.y / page.height) * 100).toFixed(1);
    console.log(
      `${file.padEnd(14)} skew=${page.skewDeg.toFixed(2).padStart(5)}°  ${String(ms).padStart(4)} ms  -> ${String(rows).padStart(2)} qator x ${cols} ustun  jadval boshi=${topPct}%  ustunlar=[${grid.columnEdges.join(' ')}]`,
    );

    // Aylantirish natijasida rangli nusxaning balandligi kulrang buferdan
    // bir-ikki pikselga farq qilishi mumkin — SVG ni haqiqiy o'lchamga moslaymiz.
    const base = await workImage(page).png().toBuffer();
    const baseMeta = await sharp(base).metadata();

    const svg = `<svg width="${baseMeta.width}" height="${baseMeta.height}" xmlns="http://www.w3.org/2000/svg">
      ${grid.columnEdges
        .map(
          (x) =>
            `<line x1="${x}" y1="${grid.bounds.y}" x2="${x}" y2="${grid.bounds.y + grid.bounds.height}" stroke="#0066ff" stroke-width="5" opacity="0.7"/>`,
        )
        .join('')}
      ${grid.rowEdges
        .map(
          (y) =>
            `<line x1="${grid.bounds.x}" y1="${y}" x2="${grid.bounds.x + grid.bounds.width}" y2="${y}" stroke="#ff0033" stroke-width="5" opacity="0.7"/>`,
        )
        .join('')}
    </svg>`;

    // SVG ni aniq bir xil o'lchamga rasterlaymiz — librsvg yaxlitlashi
    // tufayli bir piksellik farq composite'ni buzadi.
    const overlay = await sharp(Buffer.from(svg))
      .resize(baseMeta.width, baseMeta.height, { fit: 'fill' })
      .png()
      .toBuffer();

    // DIQQAT: sharp `resize` ni `composite` dan OLDIN bajaradi, chaqiruv
    // tartibidan qat'i nazar. Shuning uchun ikki bosqichga ajratamiz.
    const composed = await sharp(base)
      .composite([{ input: overlay, top: 0, left: 0 }])
      .png()
      .toBuffer();

    await sharp(composed)
      .resize({ width: 1000 })
      .png()
      .toFile(join(outDir, basename(file).replace(/\.\w+$/, '.grid.png')));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
