/**
 * Guruhlash, takror aniqlash va validatsiya — quvurning ma'lumot yo'qotishi
 * mumkin bo'lgan uchta joyi.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { InvoiceDocument } from '@barcodeer/shared';
import { groupIntoDocuments } from '../src/pipeline/group.js';
import { markDuplicates, rowKey } from '../src/pipeline/dedupe.js';
import { rowNeedsReview, validateDocument } from '../src/pipeline/validate.js';
import type { ExtractedRow, PageExtraction } from '../src/pipeline/extract-page.js';

function row(barcode: string, quantity: number | null, sku: string | null = null): ExtractedRow {
  return {
    bandIndex: 0,
    itemBarcode: barcode,
    sku,
    skuLatin: null,
    skuCyrillic: null,
    quantity,
    quantityRaw: quantity === null ? null : String(quantity),
    quantityAgreement: 1,
  };
}

function page(over: Partial<PageExtraction>): PageExtraction {
  return {
    path: 'p.bmp',
    pageIndex: 0,
    isHeaderPage: false,
    skewDeg: 0,
    docId: null,
    docNumber: null,
    docDate: null,
    docIdFromBarcode: false,
    docIdMismatch: false,
    headerEvidenceMissing: false,
    columns: null,
    rows: [],
    totals: { quantity: null, sum: null, quantityCandidates: [] },
    gridFound: true,
    width: 2481,
    height: 3510,
    archiveJpeg: Buffer.alloc(0),
    ...over,
  };
}

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    docId: '15-0000163307',
    docNumber: '163307',
    docDate: '2026-03-05 19:38',
    pages: [],
    items: [],
    totals: { quantity: null, sum: null },
    issues: [],
    scannedAt: new Date('2026-03-05T19:38:00Z').toISOString(),
    ...over,
  };
}

describe('groupIntoDocuments', () => {
  it('sarlavha sahifasi yangi hujjat boshlaydi, davomi unga qo`shiladi', () => {
    const { documents, orphanPages } = groupIntoDocuments([
      page({
        pageIndex: 0,
        isHeaderPage: true,
        docId: '15-0000163307',
        docNumber: '163307',
        rows: [row('1000076316479', 3)],
        totals: { quantity: 5, sum: null, quantityCandidates: [5] },
      }),
      page({ pageIndex: 1, rows: [row('1000076316480', 2)] }),
    ]);

    assert.equal(documents.length, 1);
    assert.equal(orphanPages.length, 0);
    assert.equal(documents[0]!.items.length, 2);
    assert.equal(documents[0]!.pages.length, 2);
    // `№` hujjat bo'ylab ketma-ket.
    assert.deepEqual(
      documents[0]!.items.map((i) => i.rowNumber),
      [1, 2],
    );
  });

  it('sarlavhasiz boshlangan to`plamning birinchi sahifalari orphan bo`ladi', () => {
    const { documents, orphanPages } = groupIntoDocuments([
      page({ pageIndex: 0, rows: [row('1000076316479', 3)] }),
      page({ pageIndex: 1, isHeaderPage: true, docId: '15-0000163307' }),
    ]);
    assert.equal(orphanPages.length, 1);
    assert.equal(documents.length, 1);
  });

  it('sarlavhada o`qilmagan `Итого` davomi sahifasidan to`ldiriladi', () => {
    const { documents } = groupIntoDocuments([
      page({ pageIndex: 0, isHeaderPage: true, docId: '15-0000163307' }),
      page({ pageIndex: 1, totals: { quantity: 166, sum: 900, quantityCandidates: [166] } }),
    ]);
    assert.equal(documents[0]!.totals.quantity, 166);
    assert.equal(documents[0]!.totals.sum, 900);
  });
});

describe('markDuplicates', () => {
  it('Sheets`da mavjud kalitni takror deb belgilaydi', () => {
    const documents = [
      doc({
        items: [
          {
            rowNumber: 1,
            sku: null,
            itemBarcode: '1000076316479',
            quantity: 3,
            quantityRaw: '3',
            pageIndex: 0,
            issues: [],
          },
          {
            rowNumber: 2,
            sku: null,
            itemBarcode: '1000076316480',
            quantity: 2,
            quantityRaw: '2',
            pageIndex: 0,
            issues: [],
          },
        ],
      }),
    ];
    const existing = new Set([rowKey('15-0000163307', '1000076316479')]);
    const res = markDuplicates(documents, existing);

    assert.equal(res.skipped, 1);
    assert.equal(documents[0]!.items[0]!.duplicate, true);
    assert.equal(documents[0]!.items[1]!.duplicate, undefined);
  });

  it('hujjat o`z-o`ziga qarshi tekshirilmaydi', () => {
    // Bitta hujjatda bir xil ШК ikki qatorda kelsa — ikkalasi ham qoladi.
    const documents = [
      doc({
        items: [
          {
            rowNumber: 1,
            sku: null,
            itemBarcode: '1000076316479',
            quantity: 3,
            quantityRaw: '3',
            pageIndex: 0,
            issues: [],
          },
          {
            rowNumber: 2,
            sku: null,
            itemBarcode: '1000076316479',
            quantity: 1,
            quantityRaw: '1',
            pageIndex: 0,
            issues: [],
          },
        ],
      }),
    ];
    assert.equal(markDuplicates(documents, new Set()).skipped, 0);
  });

  it('bitta to`plamdagi hujjatning ikkinchi nusxasi ushlanadi', () => {
    const item = () => ({
      rowNumber: 1,
      sku: null,
      itemBarcode: '1000076316479',
      quantity: 3,
      quantityRaw: '3',
      pageIndex: 0,
      issues: [],
    });
    const documents = [doc({ items: [item()] }), doc({ items: [item()] })];
    const res = markDuplicates(documents, new Set());
    assert.equal(res.skipped, 1);
    assert.equal(documents[1]!.items[0]!.duplicate, true);
  });
});

describe('validateDocument', () => {
  const item = (over: Partial<InvoiceDocument['items'][number]> = {}) => ({
    rowNumber: 1,
    sku: 'NOVYGOD-CIF0001-АЛЫЙ',
    itemBarcode: '1000076316479',
    quantity: 3,
    quantityRaw: '3',
    pageIndex: 0,
    issues: [],
    ...over,
  });

  it('toza hujjatda faqat tasdiqlanmagan SKU belgisi qoladi', () => {
    const d = doc({ items: [item()], totals: { quantity: 3, sum: null } });
    validateDocument(d, { skuFromDictionary: new Set(['1000076316479']) });
    assert.deepEqual(d.issues, []);
    assert.deepEqual(d.items[0]!.issues, []);
  });

  it('yig`indi mos kelmasa xato beradi — o`qilmagan katak bo`lsa ham', () => {
    // REAL: 26 qatordan 25 tasi o'qilib, yig'indi 166 o'rniga 112 chiqqanda
    // hech qanday ogohlantirish bo'lmagan edi.
    const d = doc({
      items: [item({ quantity: 100 }), item({ quantity: null, rowNumber: 2 })],
      totals: { quantity: 166, sum: null },
    });
    validateDocument(d, { skuFromDictionary: new Set(['1000076316479']) });
    assert.ok(d.issues.some((i) => i.code === 'TOTAL_QTY_MISMATCH' && i.severity === 'error'));
  });

  it('13 xonali bo`lmagan shtrix-kod xato', () => {
    const d = doc({
      items: [item({ itemBarcode: '10000763' })],
      totals: { quantity: 3, sum: null },
    });
    validateDocument(d, {});
    assert.ok(d.items[0]!.issues.some((i) => i.code === 'BARCODE_LENGTH'));
  });

  it('miqdor o`qilmasa xato', () => {
    const d = doc({ items: [item({ quantity: null })], totals: { quantity: 0, sum: null } });
    validateDocument(d, {});
    assert.ok(d.items[0]!.issues.some((i) => i.code === 'QTY_MISSING'));
  });

  it('shtrix-kod va chop etilgan raqam zid bo`lsa xato', () => {
    const d = doc({ docIdMismatch: true, items: [item()], totals: { quantity: 3, sum: null } });
    validateDocument(d, {});
    assert.ok(d.issues.some((i) => i.code === 'DOC_ID_MISMATCH' && i.severity === 'error'));
  });

  it('hujjat darajasidagi xato barcha qatorlarni tekshiruvga oladi', () => {
    const d = doc({ docId: '', items: [item()], totals: { quantity: 3, sum: null } });
    validateDocument(d, { skuFromDictionary: new Set(['1000076316479']) });
    assert.equal(rowNeedsReview(d, 0), true);
  });

  it('takror qator tekshiruvga tushmaydi', () => {
    const d = doc({ items: [item({ duplicate: true })], totals: { quantity: 3, sum: null } });
    validateDocument(d, {});
    assert.equal(rowNeedsReview(d, 0), false);
  });
});
