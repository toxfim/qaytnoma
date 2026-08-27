import { preparePage } from '../layout/page.js';
import { findHorizontalLines, findVerticalLines, findFullHeightColumns } from '../layout/grid.js';

const p = await preparePage(process.argv[2]!);
console.log(`${p.width}x${p.height} skew=${p.skewDeg}° otsu=${p.otsu}`);
const art = findFullHeightColumns(p.bin, p.width, p.height);
console.log(`chekka artefaktlar: [${art.join(' ')}]`);
const h = findHorizontalLines(p.bin, p.width, p.height);
console.log(`\n${h.length} gorizontal chiziq:`);
console.log('  ' + h.map(l=>`${l.y}(${l.frac.toFixed(2)})`).join(' '));
const minRowH = Math.max(8, Math.round(p.height*0.006));
const margin = Math.round(p.width*0.02);
const tol = Math.max(6, Math.round(p.width*0.008));
console.log('\nbandlar:');
for (let i=0;i<h.length-1;i++){
  const top=h[i]!.y, bottom=h[i+1]!.y;
  if (bottom-top < minRowH) continue;
  const v = findVerticalLines(p.bin, p.width, top, bottom, 0.85)
    .filter(x => x>=margin && x<=p.width-margin && !art.some(a=>Math.abs(a-x)<=tol));
  console.log(`  y ${String(top).padStart(4)}..${String(bottom).padStart(4)} h=${String(bottom-top).padStart(3)}  n=${String(v.length).padStart(2)}  [${v.join(' ')}]`);
}
