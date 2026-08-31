/**
 * Ustunlarni aniqlash — regressiya testlari.
 *
 * Kengliklar `layout/columns.ts` izohidagi REAL O'LCHOVLARDAN olingan:
 * qiyshiq skanda jadvalning chap chegarasi topilmagan va qat'iy indeks
 * bilan `ШК` deb narx ustuni o'qilib, sahifadagi 9 qatordan 6 tasi
 * jimgina yo'qolgan edi.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { barcodeCandidates, resolveColumns, shiftColumns } from '../src/layout/columns.js';
import type { TableGrid } from '../src/layout/grid.js';

/** Ustun kengliklaridan sun'iy to'r yasaydi. */
function gridOf(widths: number[]): TableGrid {
  const edges = [0];
  for (const w of widths) edges.push(edges[edges.length - 1]! + w);
  const right = edges[edges.length - 1]!;
  return {
    bounds: { x: 0, y: 0, width: right, height: 1000 },
    columnEdges: edges,
    rowEdges: [0, 100, 200, 300],
  };
}

describe('resolveColumns', () => {
  it('toza skan: eng keng ustun 2, ШК 3', () => {
    const map = resolveColumns(gridOf([78, 390, 721, 422, 218, 157, 197]));
    assert.ok(map);
    assert.equal(map.description, 2);
    assert.equal(map.barcode, 3);
    assert.equal(map.sku, 1);
    assert.equal(map.rowNumber, 0);
    assert.equal(map.quantity, 5);
    assert.equal(map.sum, 6);
  });

  it('qiyshiq skan: chap chegara yo`q, ustunlar bittaga siljigan', () => {
    const map = resolveColumns(gridOf([369, 682, 399, 206, 148, 186]));
    assert.ok(map);
    assert.equal(map.description, 1);
    assert.equal(map.barcode, 2);
    assert.equal(map.sku, 0);
    // `№` ustuni umuman yo'q — chaqiruvchi buni tekshirishi kerak.
    assert.equal(map.rowNumber, null);
    assert.equal(map.quantity, 4);
    assert.equal(map.sum, 5);
  });

  it('chegaradan chiqqan ustunlar null bo`ladi', () => {
    // `Сумма` skan chetida kesilgan holat.
    const map = resolveColumns(gridOf([78, 390, 721, 422, 218, 157]));
    assert.ok(map);
    assert.equal(map.quantity, 5);
    assert.equal(map.sum, null);
  });

  it('ustunlar juda kam bo`lsa null', () => {
    assert.equal(resolveColumns(gridOf([100, 200])), null);
  });

  it('ШК ustuni chegaradan chiqsa null qaytaradi', () => {
    // Eng keng ustun oxirgi bo'lsa uning o'ng qo'shnisi yo'q.
    assert.equal(resolveColumns(gridOf([100, 120, 900])), null);
  });
});

describe('shiftColumns', () => {
  it('ШК ustunini almashtirganda qolganlari ham suriladi', () => {
    const grid = gridOf([78, 390, 721, 422, 218, 157, 197]);
    const map = shiftColumns(grid, 4);
    assert.ok(map);
    assert.equal(map.barcode, 4);
    assert.equal(map.description, 3);
    assert.equal(map.quantity, 6);
  });

  it('chegaradan tashqari indeksda null', () => {
    assert.equal(shiftColumns(gridOf([78, 390, 721]), 9), null);
  });
});

describe('barcodeCandidates', () => {
  it('avval taklif qilingan ustun, keyin qo`shnilari', () => {
    const grid = gridOf([78, 390, 721, 422, 218, 157, 197]);
    assert.deepEqual(barcodeCandidates(grid, 3), [3, 4, 2, 5, 1]);
  });

  it('chegaradan chiqqanlarini tashlaydi va takrorlamaydi', () => {
    const grid = gridOf([100, 200, 300]);
    assert.deepEqual(barcodeCandidates(grid, 0), [0, 1, 2]);
  });
});
