/**
 * To'r koordinatalaridan katak kesmalarini olish.
 *
 * To'r ishchi o'lchamda (`WORK_WIDTH`) aniqlanadi, kesmalar esa to'liq
 * ruxsatdagi deskew qilingan rasmdan olinadi — shtrix-kod dekodlash va OCR
 * uchun imkon qadar ko'p piksel kerak.
 */
import type { Sharp } from 'sharp';
import type { Box } from '@barcodeer/shared';
import { fullImage, type PreparedPage } from './page.js';
import type { TableGrid } from './grid.js';

/**
 * Katak chegarasidan siljish. Musbat = kengaytirish, manfiy = qisqartirish.
 *
 * X va Y alohida, chunki talablar qarama-qarshi:
 *   - GORIZONTAL: shtrix-kodga quiet zone kerak, shuning uchun biroz kengaytirish;
 *   - VERTIKAL: ZXing shtrix-kodni BITTA gorizontal skanliniyadan ham o'qiy oladi,
 *     shuning uchun bir necha piksel qo'shni qatorga chiqib ketish yetarli
 *     bo'lib, qo'shni qatorning kodini "o'z" katagimiz deb qaytaradi —
 *     vertikal bo'yicha har doim ichkariga qisqartiramiz.
 */
export interface CellOptions {
  padXFrac?: number;
  padYFrac?: number;
  padXPx?: number;
  padYPx?: number;
}

/** Shtrix-kod katagi: gorizontal quiet zone + vertikal xavfsizlik oralig'i. */
export const BARCODE_CELL: CellOptions = { padXFrac: 0.015, padYFrac: -0.08 };

/**
 * Raqam katagi (`Кол-во`, `Закупочная цена`): mazmun kalta va markazda.
 *
 * Gorizontal inset ATAYLAB katta (-14%): qog'ozdagi qoldiq qiyshiqlik tufayli
 * ustun chizig'i katak ichiga kirib qoladi va OCR bo'sh natija qaytaradi.
 * O'lchov: 134 px kenglikdagi katakda raqam atigi 20-34 px joy egallaydi,
 * demak har tomondan 19 px kesish xavfsiz — ikki xonali `55` ham bemalol
 * sig'adi.
 */
export const NUMBER_CELL: CellOptions = { padXFrac: -0.14, padYFrac: -0.12 };

/**
 * SKU katagi: matn bir necha qatorga cho'zilib, katakning deyarli hammasini
 * egallashi mumkin — shuning uchun ehtiyotkor, kichik inset.
 */
export const SKU_CELL: CellOptions = { padXFrac: -0.03, padYFrac: -0.05 };

/** Umumiy matn katagi. */
export const TEXT_CELL: CellOptions = SKU_CELL;

/** Ishchi o'lchamdagi katak to'rtburchagi. */
export function cellBox(
  grid: TableGrid,
  rowIndex: number,
  colIndex: number,
  opts: CellOptions = {},
): Box | null {
  const top = grid.rowEdges[rowIndex];
  const bottom = grid.rowEdges[rowIndex + 1];
  const left = grid.columnEdges[colIndex];
  const right = grid.columnEdges[colIndex + 1];
  if (top === undefined || bottom === undefined || left === undefined || right === undefined) {
    return null;
  }

  const w = right - left;
  const h = bottom - top;
  const padX = Math.round(w * (opts.padXFrac ?? 0)) + (opts.padXPx ?? 0);
  const padY = Math.round(h * (opts.padYFrac ?? 0)) + (opts.padYPx ?? 0);

  return {
    x: left - padX,
    y: top - padY,
    width: Math.max(4, w + padX * 2),
    height: Math.max(4, h + padY * 2),
  };
}

/** Ishchi o'lchamdagi to'rtburchakni to'liq ruxsatga o'tkazadi. */
export function scaleBox(box: Box, page: PreparedPage): Box {
  const k = page.fullWidth / page.width;
  return {
    x: Math.round(box.x * k),
    y: Math.round(box.y * k),
    width: Math.round(box.width * k),
    height: Math.round(box.height * k),
  };
}

/** To'liq ruxsatdagi deskew qilingan rasmdan katakni kesib oladi. */
export function cropFull(page: PreparedPage, box: Box): Sharp {
  const scaled = scaleBox(box, page);
  const left = Math.max(0, Math.min(scaled.x, page.fullWidth - 1));
  const top = Math.max(0, Math.min(scaled.y, page.fullHeight - 1));
  return fullImage(page).extract({
    left,
    top,
    width: Math.max(1, Math.min(scaled.width, page.fullWidth - left)),
    height: Math.max(1, Math.min(scaled.height, page.fullHeight - top)),
  });
}
