/**
 * Sarlavha hududini tahlil qilish — regressiya testlari.
 *
 * Eng muhim holat: so'ngan shtrix-kod matni parchalanganda hujjat raqami
 * o'rniga uning bo'lagi (`164`) olinib qolgan edi. Qoida — chop etilgan
 * raqam hech qachon noldan boshlanmaydi (`ocr/header-fields.ts`).
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { docIdFromNumber, docNumberFromId, parseHeaderFields } from '../src/ocr/header-fields.js';

describe('parseHeaderFields', () => {
  it('toza sarlavhadan uchala maydonni oladi', () => {
    const f = parseHeaderFields('15-0000163307\nНомер документа 163307\n2026-03-05 19:38');
    assert.equal(f.docIdFromText, '15-0000163307');
    assert.equal(f.docNumber, '163307');
    assert.equal(f.docDate, '2026-03-05 19:38');
  });

  it('parchalangan shtrix-kod matnidan soxta raqam yasamaydi', () => {
    // REAL: `15-0000164 33` — "eng uzun guruh" qoidasi `0000164` ni tanlab,
    // hujjat raqamini `164` deb yozgan edi.
    const f = parseHeaderFields('15-0000164 33 163307 2026-03-05 19:38');
    assert.equal(f.docNumber, '163307');
  });

  it('sana va ID matndan olib tashlanadi — raqam ular ichidan olinmaydi', () => {
    const f = parseHeaderFields('15-0000163307 2026-03-05 19:38 163307');
    assert.equal(f.docNumber, '163307');
    assert.equal(f.docDate, '2026-03-05 19:38');
  });

  it('soatni ikki xonaga to`ldiradi', () => {
    const f = parseHeaderFields('2026-03-05 9:38');
    assert.equal(f.docDate, '2026-03-05 09:38');
  });

  it('Комитент telefonini hujjat raqami deb olmaydi', () => {
    // 12 xonali telefon `DOC_ID_DIGITS` (10) chegarasidan uzun.
    const f = parseHeaderFields('998200249347 163307');
    assert.equal(f.docNumber, '163307');
  });

  it('mumkin bo`lmagan sanani qabul qilmaydi, ammo raqamini ham olmaydi', () => {
    const f = parseHeaderFields('2026-13-45 99:99 163307');
    assert.equal(f.docDate, null);
    assert.equal(f.docNumber, '163307');
  });

  it('bo`sh matnda barcha maydonlar null', () => {
    const f = parseHeaderFields('');
    assert.equal(f.docIdFromText, null);
    assert.equal(f.docNumber, null);
    assert.equal(f.docDate, null);
  });
});

describe('docNumberFromId / docIdFromNumber', () => {
  it('ikki tomonlama aylanish', () => {
    assert.equal(docNumberFromId('15-0000163307'), '163307');
    assert.equal(docIdFromNumber('163307'), '15-0000163307');
  });

  it('10 xonadan uzun raqamni rad etadi', () => {
    assert.equal(docIdFromNumber('12345678901'), null);
  });

  it('raqamsiz qiymatda null', () => {
    assert.equal(docIdFromNumber('abc'), null);
  });
});
