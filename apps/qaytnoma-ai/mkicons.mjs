/**
 * Tray ikonkalari.
 *
 * Asosiy ilovaniki bilan bir xil shtrix-kod glifi, ammo BINAFSHA rangda va
 * ustida uchqun belgisi — ikkala dastur bir vaqtda ishlaganda tray'da
 * ularni ajratib bo'lishi kerak. Rang holatni bildiradi (yoqilgan, o'chiq,
 * bajarilmoqda, xato).
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const BARS = [
  [64, 12],
  [84, 6],
  [98, 16],
  [122, 6],
  [136, 10],
  [154, 6],
  [168, 20],
];

/** To'rt uchli uchqun — "AI o'qidi" belgisi. */
const SPARK = (cx, cy, r, fill) =>
  `<path d="M ${cx} ${cy - r} Q ${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy}
            Q ${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r}
            Q ${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy}
            Q ${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r} Z" fill="${fill}"/>`;

const icon = (bg, fg) => `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect x="16" y="16" width="224" height="224" rx="52" fill="${bg}"/>
  ${BARS.map(([x, w]) => `<rect x="${x}" y="84" width="${w}" height="96" rx="3" fill="${fg}"/>`).join('')}
  ${SPARK(190, 66, 26, fg)}
  ${SPARK(214, 96, 13, fg)}
</svg>`;

const variants = {
  'tray-on': icon('#6d4aff', '#ffffff'),
  'tray-off': icon('#6b7280', '#e5e7eb'),
  'tray-busy': icon('#b45309', '#ffffff'),
  'tray-error': icon('#b91c1c', '#ffffff'),
};

await mkdir('assets', { recursive: true });

for (const [name, svg] of Object.entries(variants)) {
  for (const size of [16, 32, 64, 256]) {
    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(`assets/${name}@${size}.png`);
  }
}

console.log(`${Object.keys(variants).length * 4} ta ikonka yozildi`);
