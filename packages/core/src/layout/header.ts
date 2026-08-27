/**
 * Sarlavha sahifasidagi `Номер документа` / `Дата составления` qutisini topish.
 *
 * NEGA alohida detektor: mahsulot jadvali sahifa kengligining ~90% ini
 * egallaydi, sarlavha qutisi esa atigi ~27% ini. `detectItemTable` ishlatadigan
 * "qora piksel ulushi butun kenglikka nisbatan" mezoni bunday tor jadval uchun
 * hech qachon ishlamaydi — shuning uchun bu yerda LOKAL uzluksiz tasmalar
 * (segment) bo'yicha qidiramiz.
 *
 * Quti tuzilishi (shablon qat'iy):
 *   ┌──────────────────┬──────────────────┐
 *   │ Номер документа  │ Дата составления │   <- sarlavha qatori
 *   ├──────────────────┼──────────────────┤
 *   │ 163307           │ 2026-03-05 19:38 │   <- qiymat qatori
 *   └──────────────────┴──────────────────┘
 */
import type { Box } from '@barcodeer/shared';

export interface HeaderBox {
  /** `Номер документа` qiymati joylashgan katak. */
  numberCell: Box;
  /** `Дата составления` qiymati joylashgan katak. */
  dateCell: Box;
  /** Butun qutining chegarasi — diagnostika uchun. */
  bounds: Box;
}

interface Segment {
  y: number;
  x0: number;
  x1: number;
}

export interface HeaderOptions {
  /** Sahifaning yuqori qismidan shu ulushigacha qidiriladi. */
  searchFrac?: number;
  /** Chiziq deb hisoblash uchun eng qisqa tasma (kenglikka nisbatan). */
  minRunFrac?: number;
  /** Qutining kutilayotgan eng katta kengligi (kenglikka nisbatan). */
  maxWidthFrac?: number;
}

/**
 * Sarlavha qutisini topadi. Topilmasa `null` — bu sahifa davomi sahifasi
 * bo'lishi mumkin degani.
 */
export function detectHeaderBox(
  bin: Uint8Array,
  width: number,
  height: number,
  opts: HeaderOptions = {},
): HeaderBox | null {
  const searchHeight = Math.round(height * (opts.searchFrac ?? 0.2));
  const minRun = Math.round(width * (opts.minRunFrac ?? 0.12));
  const maxWidth = Math.round(width * (opts.maxWidthFrac ?? 0.5));

  const segments = findSegments(bin, width, searchHeight, minRun);
  if (segments.length < 3) return null;

  // Bir xil x-oralig'iga ega gorizontal chiziqlarni guruhlaymiz — quti
  // chegaralari aynan shunday ko'rinadi (3 ta: ust, o'rta, ost).
  const tolerance = Math.max(8, Math.round(width * 0.01));
  const groups = new Map<string, Segment[]>();
  for (const s of segments) {
    if (s.x1 - s.x0 > maxWidth) continue;
    const key = `${Math.round(s.x0 / tolerance)}:${Math.round(s.x1 / tolerance)}`;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  // Kamida 3 chizig'i bor va eng kengi — bizning qutimiz.
  let best: Segment[] | null = null;
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    if (!best || list[0]!.x1 - list[0]!.x0 > best[0]!.x1 - best[0]!.x0) best = list;
  }
  if (!best) return null;

  const lines = [...best].sort((a, b) => a.y - b.y);
  const x0 = Math.min(...lines.map((l) => l.x0));
  const x1 = Math.max(...lines.map((l) => l.x1));

  // Qiymat qatori — oxirgi ikki chiziq orasidagi band.
  const valueTop = lines[lines.length - 2]!.y;
  const valueBottom = lines[lines.length - 1]!.y;
  if (valueBottom - valueTop < 8) return null;

  // Ikki ustunni ajratuvchi vertikal chiziq.
  const divider = findDivider(bin, width, x0, x1, valueTop, valueBottom);
  const mid = divider ?? Math.round((x0 + x1) / 2);

  const h = valueBottom - valueTop;
  return {
    bounds: { x: x0, y: lines[0]!.y, width: x1 - x0, height: valueBottom - lines[0]!.y },
    numberCell: { x: x0, y: valueTop, width: mid - x0, height: h },
    dateCell: { x: mid, y: valueTop, width: x1 - mid, height: h },
  };
}

/** Har bir y uchun eng uzun uzluksiz qora tasma (minimal uzunlikdan katta bo'lsa). */
function findSegments(bin: Uint8Array, width: number, height: number, minRun: number): Segment[] {
  const gapTolerance = 3;
  const raw: Segment[] = [];

  for (let y = 0; y < height; y++) {
    const off = y * width;
    let start = -1;
    let last = -1;
    let bestLen = 0;
    let bestSeg: Segment | null = null;

    for (let x = 0; x < width; x++) {
      if (bin[off + x] === 1) {
        if (start < 0) start = x;
        last = x;
      } else if (start >= 0 && x - last > gapTolerance) {
        const len = last - start + 1;
        if (len > bestLen) {
          bestLen = len;
          bestSeg = { y, x0: start, x1: last };
        }
        start = -1;
      }
    }
    if (start >= 0) {
      const len = last - start + 1;
      if (len > bestLen) bestSeg = { y, x0: start, x1: last };
    }
    if (bestSeg && bestSeg.x1 - bestSeg.x0 + 1 >= minRun) raw.push(bestSeg);
  }

  // Qalin chiziq bir necha y ga cho'ziladi — birlashtiramiz.
  const merged: Segment[] = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (prev && s.y - prev.y <= 3 && Math.abs(s.x0 - prev.x0) < 20 && Math.abs(s.x1 - prev.x1) < 20) {
      continue;
    }
    merged.push(s);
  }
  return merged;
}

/** Ikki ustunni ajratuvchi vertikal chiziqni topadi. */
function findDivider(
  bin: Uint8Array,
  width: number,
  x0: number,
  x1: number,
  top: number,
  bottom: number,
): number | null {
  const inset = Math.max(1, Math.round((bottom - top) * 0.2));
  const y0 = top + inset;
  const y1 = bottom - inset;
  const span = y1 - y0;
  if (span < 3) return null;

  // Chetki chegaralardan uzoqroqda qidiramiz.
  const margin = Math.round((x1 - x0) * 0.15);
  let bestX: number | null = null;
  let bestCount = span * 0.8;

  for (let x = x0 + margin; x <= x1 - margin; x++) {
    let count = 0;
    for (let y = y0; y < y1; y++) if (bin[y * width + x] === 1) count++;
    if (count > bestCount) {
      bestCount = count;
      bestX = x;
    }
  }
  return bestX;
}
