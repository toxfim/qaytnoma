/**
 * Gemini qatlami — tarmoqsiz testlar.
 *
 * `fetch` almashtiriladi, shuning uchun bu testlar API kaliti ham, internet
 * ham talab qilmaydi va CI da ishlaydi. Tekshiriladigan narsa — SO'ROV
 * SHAKLI va javobni talqin qilish: aynan shu ikkisi jimgina buzilib,
 * hisobdan chiqib ketishi mumkin.
 */
import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { GeminiClient } from '../src/vlm/gemini.js';
import { VlmReader } from '../src/vlm/reader.js';
import { vlmFromConfig } from '../src/vlm/setup.js';
import { configSchema, defaults } from '../src/config.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** `fetch` ni almashtiradi va yozib olingan so'rovlarni qaytaradi. */
function stubFetch(
  responses: (
    { status: number; body: unknown } | ((call: number) => { status: number; body: unknown })
  )[],
): Call[] {
  const calls: Call[] = [];
  let index = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const spec = responses[Math.min(index, responses.length - 1)]!;
    const resolved = typeof spec === 'function' ? spec(index) : spec;
    index++;
    calls.push({
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    return {
      ok: resolved.status >= 200 && resolved.status < 300,
      status: resolved.status,
      json: async () => resolved.body,
      text: async () => JSON.stringify(resolved.body),
    };
  }) as unknown as typeof fetch;
  return calls;
}

function okResponse(outputText: string, usage: Record<string, number> = {}) {
  return {
    status: 200,
    body: {
      output_text: outputText,
      usage: {
        total_input_tokens: 300,
        total_output_tokens: 12,
        total_thought_tokens: 0,
        total_tokens: 312,
        ...usage,
      },
    },
  };
}

const SCHEMA = { type: 'object', properties: { values: { type: 'array' } } };

describe('GeminiClient', () => {
  it('so`rovni kutilgan shaklda yuboradi', async () => {
    const calls = stubFetch([okResponse('{"values":["3"]}')]);
    const client = new GeminiClient({ apiKey: 'k-123', model: 'gemini-3.7-flash' });

    await client.ask({
      system: 'tizim',
      prompt: 'katakni o`qing',
      images: [{ mimeType: 'image/png', data: Buffer.from('PNG') }],
      schema: SCHEMA,
    });

    const call = calls[0]!;
    assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(call.headers['x-goog-api-key'], 'k-123');
    assert.equal(call.body.model, 'gemini-3.7-flash');
    assert.equal(call.body.system_instruction, 'tizim');

    // Maxfiylik: so'rov Google tomonda saqlanmasligi kerak.
    assert.equal(call.body.store, false);

    const input = call.body.input as Record<string, unknown>[];
    assert.equal(input[0]!.type, 'text');
    assert.equal(input[1]!.type, 'image');
    assert.equal(input[1]!.mime_type, 'image/png');
    assert.equal(input[1]!.data, Buffer.from('PNG').toString('base64'));

    const format = call.body.response_format as Record<string, unknown>;
    assert.equal(format.type, 'json_schema');
    assert.deepEqual(format.json_schema, SCHEMA);
  });

  it('token hisobini yig`ib boradi', async () => {
    stubFetch([okResponse('{"values":["3"]}')]);
    const client = new GeminiClient({ apiKey: 'k', model: 'm' });

    await client.ask({ prompt: 'a', schema: SCHEMA });
    await client.ask({ prompt: 'b', schema: SCHEMA });

    assert.equal(client.usage.requests, 2);
    assert.equal(client.usage.inputTokens, 600);
    assert.equal(client.usage.totalTokens, 624);
  });

  it('o`tkinchi xatoda qayta uradi', async () => {
    const calls = stubFetch([
      (i) => (i === 0 ? { status: 503, body: { error: 'unavailable' } } : okResponse('{"v":1}')),
    ]);
    const client = new GeminiClient({ apiKey: 'k', model: 'm', attempts: 3 });

    const res = await client.ask<{ v: number }>({ prompt: 'a', schema: SCHEMA });
    assert.equal(res.value.v, 1);
    assert.equal(calls.length, 2);
    // Muvaffaqiyatsiz urinish token hisobiga TUSHMAYDI.
    assert.equal(client.usage.requests, 1);
  });

  it('so`rov xatosida (400) qayta urinmaydi', async () => {
    const calls = stubFetch([{ status: 400, body: { error: 'bad model' } }]);
    const client = new GeminiClient({ apiKey: 'k', model: 'yoq-model' });

    await assert.rejects(client.ask({ prompt: 'a', schema: SCHEMA }), /400/);
    assert.equal(calls.length, 1);
  });

  it('JSON bo`lmagan javobni xato deb qaytaradi', async () => {
    stubFetch([okResponse('bu JSON emas')]);
    const client = new GeminiClient({ apiKey: 'k', model: 'm' });
    await assert.rejects(client.ask({ prompt: 'a', schema: SCHEMA }), /JSON emas/);
  });

  it('kalitsiz yaratilmaydi', () => {
    assert.throws(() => new GeminiClient({ apiKey: '', model: 'm' }), /kalit/);
  });
});

describe('VlmReader — kataklar', () => {
  const cells = [
    { id: '1000076316479', png: Buffer.from('a') },
    { id: '1000076316480', png: Buffer.from('b') },
  ];

  it('kataklarni tartib bo`yicha moslaydi', async () => {
    stubFetch([okResponse('{"values":["11","3"]}')]);
    const reader = new VlmReader(new GeminiClient({ apiKey: 'k', model: 'm' }));

    const res = await reader.readQuantityCells(cells);
    assert.equal(res.get('1000076316479'), 11);
    assert.equal(res.get('1000076316480'), 3);
  });

  it('o`qilmagan katak xaritaga tushmaydi', async () => {
    stubFetch([okResponse('{"values":["","7"]}')]);
    const reader = new VlmReader(new GeminiClient({ apiKey: 'k', model: 'm' }));

    const res = await reader.readQuantityCells(cells);
    assert.equal(res.has('1000076316479'), false);
    assert.equal(res.get('1000076316480'), 7);
  });

  it('javoblar soni mos kelmasa BUTUN to`plamni rad etadi', async () => {
    // Noto'g'ri katakka tushgan qiymat o'qilmagan katakdan xavfliroq.
    stubFetch([okResponse('{"values":["11"]}')]);
    const reader = new VlmReader(new GeminiClient({ apiKey: 'k', model: 'm' }));

    const res = await reader.readQuantityCells(cells);
    assert.equal(res.size, 0);
    assert.match(reader.errors[0] ?? '', /2 ta katakka 1 ta javob/);
  });

  it('tarmoq xatosi quvurni to`xtatmaydi', async () => {
    stubFetch([{ status: 500, body: {} }]);
    const reader = new VlmReader(new GeminiClient({ apiKey: 'k', model: 'm', attempts: 1 }));

    const res = await reader.readQuantityCells(cells);
    assert.equal(res.size, 0);
    assert.equal(reader.errors.length, 1);
  });
});

describe('VlmReader — butun sahifa', () => {
  it('maydonlarni normallashtiradi', async () => {
    stubFetch([
      okResponse(
        JSON.stringify({
          docNumber: '0163307',
          docDate: '2026-03-05 19:38',
          totalQuantity: '166',
          rows: [
            { sku: 'NOVYGOD-CIF0001-АЛЫЙ', barcode: '1000076316479', quantity: '3' },
            { sku: 'X', barcode: '10000', quantity: '1' },
            { sku: '', barcode: '1000076316480', quantity: '' },
          ],
        }),
      ),
    ]);
    const reader = new VlmReader(new GeminiClient({ apiKey: 'k', model: 'm' }));

    const page = await reader.readPage(Buffer.from('jpeg'));
    assert.ok(page);
    assert.equal(page.docNumber, '163307');
    assert.equal(page.docId, '15-0000163307');
    assert.equal(page.docDate, '2026-03-05 19:38');
    assert.equal(page.totalQuantity, 166);

    // 13 xonali bo'lmagan shtrix-kod rad etiladi — qator tekshiruvga tushadi.
    assert.equal(page.rows[1]!.barcode, null);
    assert.equal(page.rows[0]!.barcode, '1000076316479');
    assert.equal(page.rows[0]!.quantity, 3);
    assert.equal(page.rows[2]!.quantity, null);
    assert.equal(page.rows[2]!.sku, null);
  });

  it('mumkin bo`lmagan sanani qabul qilmaydi', async () => {
    stubFetch([okResponse('{"docDate":"2026-13-45 99:99","rows":[]}')]);
    const reader = new VlmReader(new GeminiClient({ apiKey: 'k', model: 'm' }));

    const page = await reader.readPage(Buffer.from('j'));
    assert.equal(page?.docDate, null);
  });
});

describe('vlmFromConfig', () => {
  const base = () => configSchema.parse({ ...defaults('C:/tmp'), tessdataPath: 'x', dataDir: 'y' });

  it('rejim off bo`lsa yaratilmaydi', () => {
    assert.equal(vlmFromConfig({ ...base(), geminiApiKey: 'k', geminiMode: 'off' }), undefined);
  });

  it('kalit bo`sh bo`lsa yaratilmaydi', () => {
    assert.equal(vlmFromConfig({ ...base(), geminiApiKey: '  ', geminiMode: 'assist' }), undefined);
  });

  it('kalit va rejim bo`lsa yaratiladi', () => {
    const vlm = vlmFromConfig({ ...base(), geminiApiKey: 'k', geminiMode: 'assist' });
    assert.ok(vlm);
    assert.equal(vlm.mode, 'assist');
    assert.equal(vlm.reader.model, 'gemini-3.7-flash');
  });
});
