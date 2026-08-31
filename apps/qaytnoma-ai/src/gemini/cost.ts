/**
 * Token narxi va rasm tokenlarini hisoblash.
 *
 * RASM TOKENLARI FAQAT O'LCHAMDAN kelib chiqadi, ya'ni sahifaning narxini
 * so'rov yubormasdan oldin ham aniq bilish mumkin:
 *   - ikkala o'lcham 384 px dan kichik bo'lsa — 258 token;
 *   - aks holda 768x768 plitkalar, har biri 258 token.
 *
 * Bu hisob YUQORI CHEGARA beradi: o'lchovda 2481x3431 sahifa uchun API
 * 5160 emas, 1986 kirish tokeni hisobladi — Gemini rasmni o'zi
 * normallashtiradi. Ya'ni haqiqiy narx bundan pastroq, va rasmni oldindan
 * kichraytirib tejashga arziydigan narsa yo'q: u faqat aniqlikni
 * yo'qotadi. O'lchangan sahifa narxi `gemini-3.1-flash-lite` da $0.0018,
 * va uning katta qismi CHIQISH tokenlari (jadval qatorlari).
 */

export const TOKENS_PER_TILE = 258;
const TILE = 768;
const SMALL_IMAGE = 384;

export function imageTokens(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  if (width <= SMALL_IMAGE && height <= SMALL_IMAGE) return TOKENS_PER_TILE;
  return Math.ceil(width / TILE) * Math.ceil(height / TILE) * TOKENS_PER_TILE;
}

/**
 * 1 million token uchun narx (AQSh dollari).
 *
 * Faqat baholash uchun — haqiqiy hisob Google konsolida ko'rinadi.
 * Noma'lum model eng qimmat qator bo'yicha baholanadi: kam emas, ko'p
 * tomonga adashgani xavfsizroq.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  // Narx jadvalida bor, lekin YANGI KALITLAR UCHUN YOPILGAN (404
  // "no longer available to new users"). Eski kalitlar uchun qoldirilgan.
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.6-flash': { input: 0.5, output: 3.0 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
};

const FALLBACK = { input: 1.5, output: 7.5 };

export interface UsageLike {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
}

/** Fikrlash tokenlari CHIQISH narxida hisoblanadi — javobda ko'rinmaydi. */
export function estimateUsd(usage: UsageLike, model: string): number {
  const price = PRICES[model] ?? FALLBACK;
  return (
    (usage.inputTokens / 1_000_000) * price.input +
    ((usage.outputTokens + usage.thoughtTokens) / 1_000_000) * price.output
  );
}

export function formatUsd(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
