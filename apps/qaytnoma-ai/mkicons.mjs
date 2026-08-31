/**
 * Tray ikonkalari.
 *
 * Asosiy ilovaniki bilan bir xil shtrix-kod glifi, ammo BINAFSHA rangda va
 * ustida uchqun belgisi — ikkala dastur bir vaqtda ishlaganda tray'da
 * ularni ajratib bo'lishi kerak. Rang holatni bildiradi (yoqilgan, o'chiq,
 * bajarilmoqda, xato).
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

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
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`assets/${name}@${size}.png`);
  }
}

// --- O'rnatgich uchun ikonka ---
//
// electron-builder Windows'da `.ico` talab qiladi, sharp esa uni yoza
// olmaydi. ICO formati oddiy: sarlavha + har bir o'lcham uchun yozuv +
// PNG bloklar. Vista'dan beri bloklar PNG bo'lishi mumkin, shuning uchun
// qo'shimcha kutubxona kerak emas.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** PNG bloklardan `.ico` yig'adi. */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // rezerv
  header.writeUInt16LE(1, 2); // tur: ikonka
  header.writeUInt16LE(pngs.length, 4);

  const entries = [];
  // Bloklar sarlavha va yozuvlar ro'yxatidan keyin boshlanadi.
  let offset = 6 + pngs.length * 16;

  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    // 256 px `0` bilan yoziladi — maydon bir baytli.
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // rang jadvali yo'q
    entry.writeUInt8(0, 3); // rezerv
    entry.writeUInt16LE(1, 4); // tekisliklar
    entry.writeUInt16LE(32, 6); // bit/piksel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const source = variants['tray-on'];
const icoFrames = [];
for (const size of ICO_SIZES) {
  icoFrames.push({
    size,
    data: await sharp(Buffer.from(source)).resize(size, size).png().toBuffer(),
  });
}
await writeFile('assets/icon.ico', buildIco(icoFrames));
await sharp(Buffer.from(source)).resize(512, 512).png().toFile('assets/icon.png');

console.log(
  `${Object.keys(variants).length * 4} ta tray ikonkasi + icon.ico (${ICO_SIZES.length} o'lcham) + icon.png yozildi`,
);
