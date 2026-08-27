import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

/** Tray ikonkasi: shtrix-kod glifi. Rangi holatni bildiradi. */
const icon = (bars, bg, fg) => `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect x="16" y="16" width="224" height="224" rx="52" fill="${bg}"/>
  ${bars.map(([x, w]) => `<rect x="${x}" y="72" width="${w}" height="112" rx="3" fill="${fg}"/>`).join('')}
</svg>`;

const BARS = [[64,12],[84,6],[98,16],[122,6],[136,10],[154,6],[168,20]];

const variants = {
  'tray-on':    icon(BARS, '#1f7a4d', '#ffffff'),
  'tray-off':   icon(BARS, '#6b7280', '#e5e7eb'),
  'tray-busy':  icon(BARS, '#b45309', '#ffffff'),
  'tray-error': icon(BARS, '#b91c1c', '#ffffff'),
};

await mkdir('assets', { recursive: true });
for (const [name, svg] of Object.entries(variants)) {
  for (const size of [16, 32, 64, 256]) {
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`assets/${name}@${size}.png`);
  }
  console.log(name, 'yaratildi');
}
