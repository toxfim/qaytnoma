/**
 * Tarmoq chaqiruvlarini qayta urinish.
 *
 * NEGA KERAK: quvurning eng oxirgi bosqichi — Google Sheets ga yozish.
 * Bir martalik 503 yoki uzilgan ulanish butun skanerlash natijasini yo'q
 * qilardi: qog'oz o'tib bo'lgan, PDF saqlangan, lekin qatorlar hech qayerga
 * yozilmagan. Google API lari `RESOURCE_EXHAUSTED` (429) va `UNAVAILABLE`
 * (503) ni qisqa muddatli holat sifatida qaytaradi va bir-ikki soniyadan
 * keyingi urinish odatda o'tadi.
 *
 * FAQAT O'TKINCHI xatolar qayta urinilib ko'riladi. 403 (ruxsat yo'q) yoki
 * 404 (varaq topilmadi) — sozlama xatosi; ularni takrorlash foydasiz va
 * foydalanuvchiga xato sababini ko'rsatishni kechiktiradi.
 */

/** Qayta urinishga arziydigan HTTP holat kodlari. */
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Qayta urinishga arziydigan Node tarmoq xatolari. */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export interface RetryOptions {
  /** Umumiy urinishlar soni (birinchisi ham hisobda). */
  attempts?: number;
  /** Birinchi kutish, ms. Har urinishda ikki barobar oshadi. */
  baseDelayMs?: number;
  /** Kutishning yuqori chegarasi, ms. */
  maxDelayMs?: number;
  /** Har bir muvaffaqiyatsiz urinishdan keyin chaqiriladi (loglash uchun). */
  onRetry?: (info: { attempt: number; delayMs: number; error: Error }) => void;
  /** Xato o'tkinchimi — standart tekshiruvni almashtirish uchun. */
  isTransient?: (error: unknown) => boolean;
}

/**
 * `fn` ni muvaffaqiyatgacha yoki urinishlar tugagunicha bajaradi.
 *
 * O'tkinchi bo'lmagan xato DARHOL uloqtiriladi — kutish ham, takror ham yo'q.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 700;
  const max = opts.maxDelayMs ?? 8000;
  const transient = opts.isTransient ?? isTransientError;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === attempts || !transient(err)) throw lastError;

      // To'liq eksponensial kutish + jitter: bir vaqtda qaytgan bir necha
      // so'rov keyingi urinishda ham birga urilib qolmasligi uchun.
      const delay = Math.min(max, base * 2 ** (attempt - 1));
      const jittered = Math.round(delay * (0.75 + Math.random() * 0.5));
      opts.onRetry?.({ attempt, delayMs: jittered, error: lastError });
      await sleep(jittered);
    }
  }
  throw lastError ?? new Error('withRetry: urinishlar tugadi');
}

/**
 * Xato qayta urinishga arziydimi.
 *
 * `googleapis` xatolari `code` maydonida HTTP holatini (son yoki satr)
 * olib yuradi, `undici` esa `cause.code` da tarmoq kodini beradi.
 */
export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: unknown; status?: unknown; message?: unknown; cause?: unknown };

  for (const raw of [err.code, err.status]) {
    if (typeof raw === 'number' && TRANSIENT_STATUS.has(raw)) return true;
    if (typeof raw === 'string') {
      if (TRANSIENT_CODES.has(raw)) return true;
      const asNumber = Number(raw);
      if (Number.isFinite(asNumber) && TRANSIENT_STATUS.has(asNumber)) return true;
    }
  }

  if (err.cause && err.cause !== error) return isTransientError(err.cause);

  // Ulanish umuman qurilmagan holatlarda holat kodi bo'lmaydi.
  if (typeof err.message === 'string') {
    return /socket hang up|network|timeout|ECONNRESET|EAI_AGAIN/i.test(err.message);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
