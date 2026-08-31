/**
 * Tarmoq qayta urinishlari va yozilmay qolgan qatorlar navbati.
 *
 * Ikkalasi ham bitta maqsadga xizmat qiladi: skanerlangan qog'oz behuda
 * ketmasin.
 */
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import type { InvoiceDocument } from '@barcodeer/shared';
import { isTransientError, withRetry } from '../src/util/retry.js';
import { PendingQueue } from '../src/store/pending-batch.js';
import { mergeSkuPasses, looksLikeValidSku } from '../src/ocr/sku.js';

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'barcodeer-test-'));
  temps.push(dir);
  return dir;
}
after(async () => {
  for (const dir of temps) await rm(dir, { recursive: true, force: true });
});

function doc(barcodes: string[], over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    docId: '15-0000163307',
    docNumber: '163307',
    docDate: '2026-03-05 19:38',
    pages: [],
    items: barcodes.map((itemBarcode, i) => ({
      rowNumber: i + 1,
      sku: null,
      itemBarcode,
      quantity: 1,
      quantityRaw: '1',
      pageIndex: 0,
      issues: [],
    })),
    totals: { quantity: barcodes.length, sum: null },
    issues: [],
    scannedAt: '2026-03-05T19:38:00.000Z',
    ...over,
  };
}

describe('withRetry', () => {
  it('o`tkinchi xatodan keyin qayta uradi', async () => {
    let calls = 0;
    const value = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw Object.assign(new Error('unavailable'), { code: 503 });
        return 'ok';
      },
      { baseDelayMs: 1 },
    );
    assert.equal(value, 'ok');
    assert.equal(calls, 3);
  });

  it('o`tkinchi bo`lmagan xatoni DARHOL uloqtiradi', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(
        async () => {
          calls++;
          throw Object.assign(new Error('ruxsat yo`q'), { code: 403 });
        },
        { baseDelayMs: 1 },
      ),
      /ruxsat/,
    );
    assert.equal(calls, 1, 'sozlama xatosi takrorlanmasligi kerak');
  });

  it('urinishlar tugagach oxirgi xatoni beradi', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(
        async () => {
          calls++;
          throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
        },
        { attempts: 2, baseDelayMs: 1 },
      ),
      /ECONNRESET/,
    );
    assert.equal(calls, 2);
  });
});

describe('isTransientError', () => {
  it('HTTP holatlarini ajratadi', () => {
    assert.equal(isTransientError({ code: 429 }), true);
    assert.equal(isTransientError({ code: '503' }), true);
    assert.equal(isTransientError({ status: 500 }), true);
    assert.equal(isTransientError({ code: 404 }), false);
    assert.equal(isTransientError({ code: 401 }), false);
  });

  it('ichma-ich joylashgan tarmoq xatosini topadi', () => {
    assert.equal(isTransientError({ cause: { code: 'ETIMEDOUT' } }), true);
  });

  it('oddiy obyekt va null uchun false', () => {
    assert.equal(isTransientError(null), false);
    assert.equal(isTransientError({}), false);
  });
});

describe('PendingQueue', () => {
  it('yozilmagan hujjatlarni saqlaydi va qayta o`qiydi', async () => {
    const path = join(await tempDir(), 'pending.json');
    const queue = await PendingQueue.open(path);
    assert.equal(queue.size, 0);

    await queue.add([doc(['1000076316479', '1000076316480'])], 'internet yo`q');
    assert.equal(queue.size, 1);
    assert.equal(queue.rowCount, 2);

    const reopened = await PendingQueue.open(path);
    assert.equal(reopened.rowCount, 2);
    assert.equal(reopened.batches()[0]!.reason, 'internet yo`q');
    assert.equal(reopened.documents()[0]!.docId, '15-0000163307');
  });

  it('takror deb belgilangan qatorlarni hisoblamaydi', async () => {
    const path = join(await tempDir(), 'pending.json');
    const queue = await PendingQueue.open(path);
    const d = doc(['1000076316479', '1000076316480']);
    d.items[0]!.duplicate = true;
    await queue.add([d], 'xato');
    assert.equal(queue.rowCount, 1);
  });

  it('barcha qatorlari takror bo`lgan hujjatni navbatga qo`ymaydi', async () => {
    const path = join(await tempDir(), 'pending.json');
    const queue = await PendingQueue.open(path);
    const d = doc(['1000076316479']);
    d.items[0]!.duplicate = true;
    await queue.add([d], 'xato');
    assert.equal(queue.size, 0);
  });

  it('navbat nusxa saqlaydi — keyingi o`zgarish unga ta`sir qilmaydi', async () => {
    const path = join(await tempDir(), 'pending.json');
    const queue = await PendingQueue.open(path);
    const d = doc(['1000076316479']);
    await queue.add([d], 'xato');
    d.items[0]!.quantity = 999;
    assert.equal(queue.documents()[0]!.items[0]!.quantity, 1);
  });

  it('buzilgan fayl skanerlashni to`xtatmaydi', async () => {
    const path = join(await tempDir(), 'pending.json');
    await writeFile(path, '{ buzilgan', 'utf8');
    const queue = await PendingQueue.open(path);
    assert.equal(queue.size, 0);
  });

  it('clear navbatni bo`shatadi va faylga yozadi', async () => {
    const path = join(await tempDir(), 'pending.json');
    const queue = await PendingQueue.open(path);
    await queue.add([doc(['1000076316479'])], 'xato');
    await queue.clear();
    assert.equal(JSON.parse(await readFile(path, 'utf8')).length, 0);
  });
});

describe('SKU ikki o`tish', () => {
  it('rang segmentini kirill o`tishidan oladi', () => {
    assert.equal(
      mergeSkuPasses('NOVYGOD-CIF0001-ANbIN', 'НОВУГОД-СИФ0001-АЛЫЙ'),
      'NOVYGOD-CIF0001-АЛЫЙ',
    );
  });

  it('segmentlar soni mos kelmasa kirillga ishonmaydi', () => {
    assert.equal(mergeSkuPasses('A-B-C-D', 'А-Б-В'), 'A-B-C-D');
  });

  it('lotin o`tishi bo`sh bo`lsa kirillni qaytaradi', () => {
    assert.equal(mergeSkuPasses(null, 'А-Б-В'), 'А-Б-В');
  });

  it('kutilgan shaklni tekshiradi', () => {
    assert.equal(looksLikeValidSku('NOVYGOD-CIF0001-АЛЫЙ'), true);
    assert.equal(looksLikeValidSku('ACENTT-NOTE14S-ЛАВАНД-8I128GB'), true);
    assert.equal(looksLikeValidSku('NOVYGOD-CIF0001'), false, 'segment yetarli emas');
    assert.equal(looksLikeValidSku('NOVYGOD-CIF0001-ALYJ'), false, 'rang lotin');
    assert.equal(looksLikeValidSku(null), false);
  });
});
