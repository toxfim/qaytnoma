/**
 * OCR natijasini domen qiymatlariga aylantirish — regressiya testlari.
 *
 * Har bir "REAL" deb belgilangan holat `docs/OCR-BENCHMARK.md` da qayd
 * etilgan haqiqiy skanda uchragan: ular tuzatilgan xatolar bo'lib, qayta
 * qaytmasligi kerak.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  normalizeSku,
  parseDocDate,
  parseDocNumber,
  parseQuantity,
  parseTotal,
} from '../src/ocr/parse.js';

describe('parseQuantity', () => {
  it('oddiy qiymatlarni o`qiydi', () => {
    assert.equal(parseQuantity('3'), 3);
    assert.equal(parseQuantity('55'), 55);
    assert.equal(parseQuantity(' 24 \n'), 24);
  });

  it('bo`shliqni birlashtiradi — Tesseract sonni bo`lib yuboradi', () => {
    // REAL: toza `11` ko'pincha `1 1` bo'lib keladi.
    assert.equal(parseQuantity('1 1'), 11);
    assert.equal(parseQuantity('5 34'), 534);
  });

  it('bo`shliqdan boshqa belgi bilan ajralgan guruhlardan eng uzunini oladi', () => {
    assert.equal(parseQuantity('3ИЗВ55'), 55);
  });

  it('raqamsiz va nolli natijalarni rad etadi', () => {
    assert.equal(parseQuantity(''), null);
    assert.equal(parseQuantity('ИЗВ'), null);
    assert.equal(parseQuantity('0'), null);
  });
});

describe('parseDocNumber', () => {
  it('boshidagi nollarni olib tashlaydi', () => {
    assert.equal(parseDocNumber('0000163307'), '163307');
    assert.equal(parseDocNumber('163307'), '163307');
  });

  it('raqam bo`lmasa null', () => {
    assert.equal(parseDocNumber('Номер'), null);
  });
});

describe('parseDocDate', () => {
  it('standart formatni o`qiydi', () => {
    assert.equal(parseDocDate('2026-03-05 19:38'), '2026-03-05 19:38');
  });

  it('oxiridagi ortiqcha ikki nuqtani tashlaydi', () => {
    // REAL: hujjatda `19:38:` deb chop etilgan.
    assert.equal(parseDocDate('2026-03-05 19:38:'), '2026-03-05 19:38');
  });

  it('ajratgichlar yo`qolganda 12 raqamdan tiklaydi', () => {
    assert.equal(parseDocDate('202603051938'), '2026-03-05 19:38');
  });

  it('mumkin bo`lmagan qiymatli sanani rad etadi', () => {
    // Shakli to'g'ri, qiymati yo'q: OCR shovqinidan tug'iladi.
    assert.equal(parseDocDate('2026-13-45 99:99'), null);
    assert.equal(parseDocDate('2026-02-30 10:00'), null);
    assert.equal(parseDocDate('9026-03-05 19:38'), null);
    assert.equal(parseDocDate('—'), null);
  });

  it('kabisa yilining 29-fevralini qabul qiladi', () => {
    assert.equal(parseDocDate('2028-02-29 10:00'), '2028-02-29 10:00');
    assert.equal(parseDocDate('2026-02-29 10:00'), null);
  });
});

describe('normalizeSku', () => {
  it('katakda ikki qatorga bo`lingan SKU ni ulaydi', () => {
    assert.equal(normalizeSku('NOVYGOD-CIF0001-\nАЛЫЙ'), 'NOVYGOD-CIF0001-АЛЫЙ');
  });

  it('uzilish belgisi yo`qolgan bo`lsa defis qo`yadi', () => {
    assert.equal(normalizeSku('NOVYGOD-CIF0001\nАЛЫЙ'), 'NOVYGOD-CIF0001-АЛЫЙ');
  });

  it('ikkinchi qator defis bilan boshlansa ikkilantirmaydi', () => {
    assert.equal(normalizeSku('NOVYGOD-CIF0001\n-АЛЫЙ'), 'NOVYGOD-CIF0001-АЛЫЙ');
  });

  it('ichki bo`shliqlarni olib tashlaydi', () => {
    assert.equal(normalizeSku('ACENTT-NOTE14S -ЛАВАНД-8I128GB'), 'ACENTT-NOTE14S-ЛАВАНД-8I128GB');
  });

  it('bo`sh matnda null', () => {
    assert.equal(normalizeSku('   \n  '), null);
  });
});

describe('parseTotal', () => {
  it('bo`shliq bilan ajratilgan jamini o`qiydi', () => {
    assert.equal(parseTotal('1 234 567'), 1234567);
  });

  it('raqamsiz matnda null', () => {
    assert.equal(parseTotal('Итого:'), null);
  });
});
