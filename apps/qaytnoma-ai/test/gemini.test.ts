/**
 * Gemini qatlami — tarmoqsiz testlar.
 *
 * `fetch` almashtiriladi, shuning uchun bu testlar API kaliti ham, internet
 * ham talab qilmaydi. Ikki narsa qotirib qo'yiladi: SO'ROV SHAKLI (u
 * jimgina buzilsa hisob o'sadi yoki so'rov rad etiladi) va MODEL JAVOBINI
 * TALQIN QILISH (bu yerda ma'lumot yo'qoladi yoki soxta qiymat kirib
 * ketadi).
 */
import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { GeminiClient } from '../src/gemini/client.js';
import { estimateUsd, imageTokens, TOKENS_PER_TILE } from '../src/gemini/cost.js';
import { readPage } from '../src/gemini/page-reader.js';
import { rowNumberGap } from '../src/pipeline/run.js';
import { DEFAULT_MODEL } from '../src/config.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

function stubFetch(replies: { status: number; body: unknown }[]): Call[] {
  const calls: Call[] = [];
  let index = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const reply = replies[Math.min(index, replies.length - 1)]!;
    index++;
    calls.push({
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body),
    };
  }) as unknown as typeof fetch;
  return calls;
}

/** Modelning muvaffaqiyatli javobi. */
function reply(payload: unknown, usage: Record<string, number> = {}) {
  return {
    status: 200,
    body: {
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      usageMetadata: {
        promptTokenCount: 5560,
        candidatesTokenCount: 900,
        totalTokenCount: 6460,
        ...usage,
      },
    },
  };
}

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } } };

describe('GeminiClient — so`rov shakli', () => {
  it('modelni URL ga, kalitni SARLAVHAGA qo`yadi', async () => {
    const calls = stubFetch([reply({ ok: true })]);
    const client = new GeminiClient({ apiKey: 'k-123', model: 'gemini-2.5-flash-lite' });

    await client.ask({ system: 's', prompt: 'p', images: [], schema: SCHEMA });

    const call = calls[0]!;
    assert.equal(
      call.url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
    );
    // Kalit URL da bo'lmasligi kerak — u loglarga tushib qoladi.
    assert.equal(call.headers['x-goog-api-key'], 'k-123');
    assert.ok(!call.url.includes('k-123'));
  });

  it('rasmni inline_data sifatida yuboradi', async () => {
    const calls = stubFetch([reply({ ok: true })]);
    const client = new GeminiClient({ apiKey: 'k', model: 'gemini-2.5-flash-lite' });

    await client.ask({
      system: 's',
      prompt: 'p',
      images: [{ mimeType: 'image/jpeg', data: Buffer.from('JPEG') }],
      schema: SCHEMA,
    });

    const parts = calls[0]!.body.contents[0].parts;
    assert.equal(parts[0].text, 'p');
    assert.equal(parts[1].inline_data.mime_type, 'image/jpeg');
    assert.equal(parts[1].inline_data.data, Buffer.from('JPEG').toString('base64'));
    assert.equal(calls[0]!.body.systemInstruction.parts[0].text, 's');
  });

  it('javobni sxema bilan majburlaydi va tasodifiylikni o`chiradi', async () => {
    const calls = stubFetch([reply({ ok: true })]);
    const client = new GeminiClient({ apiKey: 'k', model: 'gemini-2.5-flash-lite' });

    await client.ask({ system: 's', prompt: 'p', images: [], schema: SCHEMA });

    const cfg = calls[0]!.body.generationConfig;
    assert.equal(cfg.responseMimeType, 'application/json');
    assert.deepEqual(cfg.responseSchema, SCHEMA);
    assert.equal(cfg.temperature, 0);
  });

  it('2.5 oilasida fikrlash BUTUNLAY o`chiriladi', async () => {
    const calls = stubFetch([reply({ ok: true })]);
    await new GeminiClient({ apiKey: 'k', model: 'gemini-2.5-flash-lite' }).ask({
      system: 's',
      prompt: 'p',
      images: [],
      schema: SCHEMA,
    });
    assert.deepEqual(calls[0]!.body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  });

  it('3.x oilasida eng past daraja tanlanadi', async () => {
    const calls = stubFetch([reply({ ok: true }), reply({ ok: true })]);
    await new GeminiClient({ apiKey: 'k', model: 'gemini-3.5-flash-lite' }).ask({
      system: 's',
      prompt: 'p',
      images: [],
      schema: SCHEMA,
    });
    await new GeminiClient({ apiKey: 'k', model: 'gemini-3.7-flash' }).ask({
      system: 's',
      prompt: 'p',
      images: [],
      schema: SCHEMA,
    });
    assert.deepEqual(calls[0]!.body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
    // `minimal` 3.7 Flash da qo'llab-quvvatlanmaydi.
    assert.deepEqual(calls[1]!.body.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  });

  it('token hisobini yig`adi', async () => {
    stubFetch([reply({ ok: true })]);
    const client = new GeminiClient({ apiKey: 'k', model: 'gemini-2.5-flash-lite' });
    await client.ask({ system: 's', prompt: 'p', images: [], schema: SCHEMA });
    await client.ask({ system: 's', prompt: 'p', images: [], schema: SCHEMA });

    assert.equal(client.usage.requests, 2);
    assert.equal(client.usage.inputTokens, 11120);
    assert.equal(client.usage.totalTokens, 12920);
  });

  it('javob uzilib qolsa sababini aytadi', async () => {
    // Eng ko'p uchraydigan holat: uzun jadval `maxOutputTokens` ga sig'magan.
    stubFetch([
      { status: 200, body: { candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: {} } },
    ]);
    const client = new GeminiClient({ apiKey: 'k', model: 'gemini-2.5-flash-lite' });
    await assert.rejects(
      client.ask({ system: 's', prompt: 'p', images: [], schema: SCHEMA }),
      /MAX_TOKENS/,
    );
  });

  it('400 xatosida qayta urinmaydi', async () => {
    const calls = stubFetch([{ status: 400, body: { error: 'model topilmadi' } }]);
    const client = new GeminiClient({ apiKey: 'k', model: 'yoq-model' });
    await assert.rejects(
      client.ask({ system: 's', prompt: 'p', images: [], schema: SCHEMA }),
      /400/,
    );
    assert.equal(calls.length, 1);
  });
});

describe('readPage — model javobini talqin qilish', () => {
  const client = () => new GeminiClient({ apiKey: 'k', model: 'gemini-2.5-flash-lite' });

  it('sarlavha maydonlarini normallashtiradi', async () => {
    stubFetch([
      reply({
        isHeaderPage: true,
        docNumber: '0163307',
        docDate: '2026-03-05 19:38',
        totalQuantity: 166,
        rows: [{ no: 1, sku: 'NOVYGOD-CIF0001-АЛЫЙ', barcode: '1000076316479', quantity: 3 }],
      }),
    ]);

    const page = await readPage(client(), Buffer.from('j'));
    assert.equal(page.isHeaderPage, true);
    assert.equal(page.docNumber, '163307');
    assert.equal(page.docId, '15-0000163307');
    assert.equal(page.docDate, '2026-03-05 19:38');
    assert.equal(page.totalQuantity, 166);
    assert.equal(page.rows[0]!.barcode, '1000076316479');
  });

  it('13 xonali bo`lmagan shtrix-kodni RAD ETADI', async () => {
    // Model raqamni tushirib qoldirsa qator jimgina noto'g'ri mahsulotga
    // yozilib ketishi mumkin edi.
    stubFetch([
      reply({
        isHeaderPage: false,
        rows: [
          { no: 1, sku: 'A-B-В', barcode: '100007631647', quantity: 1 },
          { no: 2, sku: 'A-B-В', barcode: '1000076316479', quantity: 1 },
        ],
      }),
    ]);

    const page = await readPage(client(), Buffer.from('j'));
    assert.equal(page.rows[0]!.barcode, null);
    assert.equal(page.rows[1]!.barcode, '1000076316479');
  });

  it('nol va manfiy miqdorni o`qilmagan deb hisoblaydi', async () => {
    stubFetch([
      reply({
        isHeaderPage: false,
        rows: [
          { no: 1, sku: 'A', barcode: '1000076316479', quantity: 0 },
          { no: 2, sku: 'B', barcode: '1000076316480', quantity: -3 },
          { no: 3, sku: 'C', barcode: '1000076316481', quantity: null },
        ],
      }),
    ]);

    const page = await readPage(client(), Buffer.from('j'));
    assert.deepEqual(
      page.rows.map((r) => r.quantity),
      [null, null, null],
    );
  });

  it('mumkin bo`lmagan sanani qabul qilmaydi', async () => {
    stubFetch([reply({ isHeaderPage: true, docDate: '2026-13-45 99:99', rows: [] })]);
    const page = await readPage(client(), Buffer.from('j'));
    assert.equal(page.docDate, null);
  });

  it('SKU dagi bo`shliqlarni tozalaydi', async () => {
    stubFetch([
      reply({
        isHeaderPage: false,
        rows: [{ no: 1, sku: 'NOVYGOD-CIF0001- АЛЫЙ', barcode: '1000076316479', quantity: 1 }],
      }),
    ]);
    const page = await readPage(client(), Buffer.from('j'));
    assert.equal(page.rows[0]!.sku, 'NOVYGOD-CIF0001-АЛЫЙ');
  });
});

describe('rowNumberGap — tushib qolgan qatorni topish', () => {
  const page = (numbers: (number | null)[]) => ({
    isHeaderPage: false,
    docId: null,
    docNumber: null,
    docDate: null,
    totalQuantity: null,
    rawRowCount: numbers.length,
    rows: numbers.map((no) => ({ no, sku: null, barcode: null, quantity: null })),
  });

  it('uzluksiz ketma-ketlikda hech nima demaydi', () => {
    assert.equal(rowNumberGap(page([1, 2, 3, 4])), null);
  });

  it('uzilishni ko`rsatadi', () => {
    // Modelning eng ehtimolli xatosi: qatorni butunlay tushirib qoldirish.
    assert.equal(rowNumberGap(page([12, 13, 15])), '13 → 15');
  });

  it('davomi sahifasidagi raqamlar 1 dan boshlanmasligi normal', () => {
    assert.equal(rowNumberGap(page([14, 15, 16])), null);
  });

  it('takrorlangan raqam ham uzilish', () => {
    assert.equal(rowNumberGap(page([1, 1, 2])), '1 → 1');
  });
});

describe('narx', () => {
  it('to`liq ishchi sahifa 20 plitka', () => {
    assert.equal(imageTokens(2481, 3510), 20 * TOKENS_PER_TILE);
    assert.equal(imageTokens(2481, 3510), 5160);
  });

  it('standart model — MAVJUDLARI orasida eng arzoni', () => {
    // `gemini-2.5-flash-lite` narx bo'yicha arzonroq va jadvalda hali ham
    // turibdi, ammo yangi kalitlar uchun yopilgan (API 404 qaytaradi).
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, thoughtTokens: 0 };
    const chosen = estimateUsd(usage, DEFAULT_MODEL);
    assert.equal(DEFAULT_MODEL, 'gemini-3.1-flash-lite');
    assert.ok(chosen < estimateUsd(usage, 'gemini-3.5-flash-lite'));
    assert.ok(chosen < estimateUsd(usage, 'gemini-3.6-flash'));
    assert.ok(chosen < estimateUsd(usage, 'gemini-3.7-flash'));
  });

  it('bitta sahifa bir sentdan arzon', () => {
    // O'lchangan qiymatlar: etalon skanning 1-sahifasi uchun API 1986
    // kirish va 879 chiqish tokeni hisobladi.
    const usd = estimateUsd(
      { inputTokens: 1986, outputTokens: 879, thoughtTokens: 0 },
      DEFAULT_MODEL,
    );
    assert.ok(usd < 0.01, `sahifa narxi ${usd}`);
    assert.equal(Number(usd.toFixed(4)), 0.0018);
  });

  it('fikrlash tokenlari CHIQISH narxida hisoblanadi', () => {
    const withThoughts = estimateUsd(
      { inputTokens: 0, outputTokens: 0, thoughtTokens: 1_000_000 },
      'gemini-2.5-flash-lite',
    );
    assert.equal(Number(withThoughts.toFixed(2)), 0.4);
  });
});
