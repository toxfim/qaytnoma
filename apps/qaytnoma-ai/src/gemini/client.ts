/**
 * Gemini mijozi — `models:generateContent` ustidagi yupqa qatlam.
 *
 * NEGA `generateContent`, `interactions` EMAS: eng arzon model
 * (`gemini-2.5-flash-lite`, $0.10 / 1M kirish) 2.5 oilasiga tegishli va u
 * yangi Interactions API da yo'q. Klassik endpoint esa 2.5 ni ham, 3.x ni
 * ham bir xil qabul qiladi — ya'ni model almashtirilganda kod o'zgarmaydi.
 *
 * NEGA SDK EMAS: kerak bo'lgani bitta HTTP so'rov. `@google/genai` paketi
 * o'rnatgich hajmiga qo'shiladi, so'rovning har bir maydonini esa yashiradi —
 * token sarfini nazorat qilish uchun aynan shu maydonlar ko'rinib turishi kerak.
 */
import { withRetry } from '@barcodeer/core';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiOptions {
  apiKey: string;
  /** Masalan `gemini-2.5-flash-lite`. */
  model: string;
  /** Bitta so'rov uchun kutish chegarasi. */
  timeoutMs?: number;
  /** O'tkinchi xatolarda urinishlar soni. */
  attempts?: number;
}

export interface ImagePart {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  data: Buffer;
}

export interface TokenUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** Fikrlash tokenlari — CHIQISH narxida hisoblanadi va javobda ko'rinmaydi. */
  thoughtTokens: number;
  totalTokens: number;
}

export function emptyUsage(): TokenUsage {
  return { requests: 0, inputTokens: 0, outputTokens: 0, thoughtTokens: 0, totalTokens: 0 };
}

export interface AskOptions {
  system: string;
  prompt: string;
  images: readonly ImagePart[];
  /** Javob shu JSON sxemasiga majburlanadi. */
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export class GeminiClient {
  #usage = emptyUsage();

  constructor(private readonly opts: GeminiOptions) {
    if (!opts.apiKey.trim()) throw new Error('Gemini API kaliti berilmagan');
  }

  get usage(): TokenUsage {
    return this.#usage;
  }

  get model(): string {
    return this.opts.model;
  }

  /** Rasm va matnni yuborib, sxemaga mos JSON oladi. */
  async ask<T>(opts: AskOptions): Promise<T> {
    const parts: Record<string, unknown>[] = [{ text: opts.prompt }];
    for (const image of opts.images) {
      parts.push({
        inline_data: { mime_type: image.mimeType, data: image.data.toString('base64') },
      });
    }

    const body = {
      contents: [{ role: 'user', parts }],
      systemInstruction: { parts: [{ text: opts.system }] },
      generationConfig: {
        // Hujjat o'qishda ijodkorlik kerak emas: bir xil rasm bir xil
        // natija berishi kerak.
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: opts.schema,
        maxOutputTokens: opts.maxOutputTokens ?? 8192,
        thinkingConfig: thinkingFor(this.opts.model),
      },
    };

    const json = await withRetry(() => this.#post(body), {
      attempts: this.opts.attempts ?? 3,
      baseDelayMs: 1000,
    });

    this.#account(json.usageMetadata);

    const text = json.candidates?.[0]?.content?.parts?.find(
      (p) => typeof p.text === 'string',
    )?.text;
    if (!text) {
      const reason = json.candidates?.[0]?.finishReason ?? 'javob bo`sh';
      // `MAX_TOKENS` — eng ko'p uchraydigan holat: uzun jadval javobga
      // sig'magan. Buni alohida aytamiz, aks holda sabab noma'lum qoladi.
      throw new GeminiError(`Gemini javob qaytarmadi (${reason})`);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GeminiError(`Gemini JSON emas qaytardi: ${text.slice(0, 200)}`);
    }
  }

  async #post(body: unknown): Promise<GeminiResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 120_000);
    try {
      const res = await fetch(`${BASE}/${this.opts.model}:generateContent`, {
        method: 'POST',
        headers: {
          // Kalit sarlavhada — URL da emas: URL loglarga va proksi
          // yozuvlariga tushib qoladi.
          'x-goog-api-key': this.opts.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        // `status` `withRetry` ga o'tkinchi xatoni tanitadi: 429/5xx qayta
        // uriniladi, 400/403 esa darhol uzatiladi (sozlama xatosi).
        throw new GeminiError(`Gemini ${res.status}: ${detail}`, res.status);
      }
      return (await res.json()) as GeminiResponse;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw Object.assign(new GeminiError('Gemini javob bermadi (kutish tugadi)'), {
          code: 'ETIMEDOUT',
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  #account(usage: GeminiResponse['usageMetadata']): void {
    const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
    this.#usage = {
      requests: this.#usage.requests + 1,
      inputTokens: this.#usage.inputTokens + num(usage?.promptTokenCount),
      outputTokens: this.#usage.outputTokens + num(usage?.candidatesTokenCount),
      thoughtTokens: this.#usage.thoughtTokens + num(usage?.thoughtsTokenCount),
      totalTokens: this.#usage.totalTokens + num(usage?.totalTokenCount),
    };
  }
}

/**
 * Fikrlash sozlamasi model oilasiga qarab farq qiladi.
 *
 * 2.5 oilasida fikrlashni BUTUNLAY o'chirish mumkin (`thinkingBudget: 0`),
 * 3.x da esa faqat darajani pasaytirish mumkin (`thinkingLevel`), va
 * `minimal` 3.7 Flash da qo'llab-quvvatlanmaydi. Jadvalni o'qish mulohaza
 * talab qilmaydi, fikrlash tokenlari esa chiqish narxida hisoblanadi —
 * shuning uchun har doim eng past daraja.
 */
function thinkingFor(model: string): Record<string, unknown> {
  if (model.includes('2.5')) return { thinkingBudget: 0 };
  return { thinkingLevel: model.includes('3.7-flash') ? 'low' : 'minimal' };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}
