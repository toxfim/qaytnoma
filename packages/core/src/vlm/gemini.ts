/**
 * Gemini mijozi — Interactions API ustidagi eng yupqa qatlam.
 *
 * NEGA SDK EMAS: kerak bo'lgani bitta HTTP so'rov. `@google/genai` paketi
 * o'rnatgich hajmiga qo'shiladi va yangilanishlar bilan birga o'zgarish
 * xavfini olib keladi; bu yerda esa `fetch` yetarli va so'rovning har bir
 * maydoni ko'rinib turadi — bu token sarfini nazorat qilish uchun muhim.
 *
 * NEGA `interactions`, `models:generateContent` EMAS: Interactions API
 * javobida `output_text` va `usage` tayyor holda keladi, ya'ni token
 * hisobini qo'lda yig'ish shart emas.
 *
 * MAXFIYLIK: `store: false` ATAYLAB qo'yilgan. Standart holatda Google
 * so'rovni server tomonda saqlaydi; bu yerda esa foydalanuvchining haqiqiy
 * qaytarim hujjatlari — mijoz ismi, telefon, shartnoma raqami — yuboriladi.
 * Kesmalar (bitta katak) butun sahifadan xavfsizroq, lekin `full` rejimda
 * butun sahifa ketadi, shuning uchun saqlash o'chirilgan.
 */
import { withRetry } from '../util/retry.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/**
 * Fikrlash darajasi.
 *
 * Gemini 3.x da fikrlashni BUTUNLAY o'chirib bo'lmaydi (`minimal` ham
 * "juda kam fikrlash" degani va 3.7 Flash da umuman qo'llab-quvvatlanmaydi).
 * Katak o'qish vazifasi mulohaza talab qilmaydi, shuning uchun standart —
 * `low`.
 */
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface GeminiOptions {
  apiKey: string;
  /** Masalan `gemini-3.7-flash` yoki `gemini-3.5-flash-lite`. */
  model: string;
  thinkingLevel?: ThinkingLevel;
  /** Bitta so'rov uchun kutish chegarasi. */
  timeoutMs?: number;
  /** Qayta urinishlar soni (o'tkinchi xatolarda). */
  attempts?: number;
}

/** Bitta rasm — so'rovga qo'shiladigan. */
export interface ImagePart {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  data: Buffer;
}

export interface TokenUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** Fikrlashga ketgan tokenlar — chiqishga qo'shimcha to'lanadi. */
  thoughtTokens: number;
  totalTokens: number;
}

export function emptyUsage(): TokenUsage {
  return { requests: 0, inputTokens: 0, outputTokens: 0, thoughtTokens: 0, totalTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    requests: a.requests + b.requests,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thoughtTokens: a.thoughtTokens + b.thoughtTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export interface AskOptions {
  /** Vazifa ta'rifi — har so'rovda takrorlanadi. */
  system?: string;
  prompt: string;
  images?: readonly ImagePart[];
  /** JSON sxemasi — javob shu shaklga majburlanadi. */
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
}

export interface AskResult<T> {
  value: T;
  usage: TokenUsage;
}

/** Gemini javobi kutilgan shaklda kelmadi. */
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
    if (!opts.apiKey) throw new Error('Gemini API kaliti berilmagan');
  }

  /** Shu mijoz orqali sarflangan jami tokenlar. */
  get usage(): TokenUsage {
    return this.#usage;
  }

  get model(): string {
    return this.opts.model;
  }

  /**
   * Rasmlar va matnni yuborib, sxemaga mos JSON oladi.
   *
   * JSON javob sxema bilan MAJBURLANADI (`response_format`), shuning uchun
   * "javobni matndan ajratib olish" bosqichi yo'q. Sxema ham token sarfiga
   * kiradi, shuning uchun uni imkon qadar qisqa yozish kerak.
   */
  async ask<T>(opts: AskOptions): Promise<AskResult<T>> {
    const input: Record<string, unknown>[] = [{ type: 'text', text: opts.prompt }];
    for (const image of opts.images ?? []) {
      input.push({
        type: 'image',
        mime_type: image.mimeType,
        data: image.data.toString('base64'),
      });
    }

    const body: Record<string, unknown> = {
      model: this.opts.model,
      input,
      // Maxfiylik: so'rov Google tomonda saqlanmasin.
      store: false,
      generation_config: {
        thinking_level: this.opts.thinkingLevel ?? 'low',
        ...(opts.maxOutputTokens ? { max_output_tokens: opts.maxOutputTokens } : {}),
      },
      response_format: { type: 'json_schema', json_schema: opts.schema },
    };
    if (opts.system) body.system_instruction = opts.system;

    const json = await withRetry(() => this.#post(body), {
      attempts: this.opts.attempts ?? 3,
      baseDelayMs: 1000,
    });

    const usage = readUsage(json.usage);
    this.#usage = addUsage(this.#usage, usage);

    const text = typeof json.output_text === 'string' ? json.output_text : '';
    if (!text) throw new GeminiError('Gemini bo`sh javob qaytardi');

    let value: T;
    try {
      value = JSON.parse(text) as T;
    } catch {
      throw new GeminiError(`Gemini JSON emas qaytardi: ${text.slice(0, 200)}`);
    }
    return { value, usage };
  }

  async #post(body: unknown): Promise<GeminiResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 60_000);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.opts.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        // `status` maydoni `util/retry.ts` ga o'tkinchi xatoni tanitadi:
        // 429/5xx qayta uriniladi, 400/403 esa darhol uzatiladi.
        throw new GeminiError(`Gemini ${res.status}: ${detail}`, res.status);
      }
      return (await res.json()) as GeminiResponse;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Kutish chegarasi — o'tkinchi hisoblanadi.
        throw Object.assign(new GeminiError('Gemini javob bermadi (kutish tugadi)'), {
          code: 'ETIMEDOUT',
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

interface GeminiResponse {
  output_text?: unknown;
  usage?: Record<string, unknown>;
}

function readUsage(usage: Record<string, unknown> | undefined): TokenUsage {
  const num = (key: string): number => {
    const value = usage?.[key];
    return typeof value === 'number' ? value : 0;
  };
  return {
    requests: 1,
    inputTokens: num('total_input_tokens'),
    outputTokens: num('total_output_tokens'),
    thoughtTokens: num('total_thought_tokens'),
    totalTokens: num('total_tokens'),
  };
}
