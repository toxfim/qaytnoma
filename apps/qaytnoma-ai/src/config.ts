/**
 * Qaytnoma AI konfiguratsiyasi.
 *
 * Sxema `@barcodeer/core` dan qayta ishlatiladi — Sheets, katalog va
 * skaner sozlamalari ikkala ilovada bir xil bo'lishi kerak. Farq ikkita:
 *
 *   1. O'Z PAPKASI (`%APPDATA%/qaytnoma-ai`). Bu ATAYLAB: `documents.jsonl`
 *      umumiy bo'lsa, asosiy ilova qayta ishlagan hujjatlar bu yerda
 *      "takror" deb belgilanadi va bironta qator yozilmaydi — ikki ilovani
 *      solishtirib bo'lmay qoladi.
 *   2. Standart model — eng arzoni (`gemini-2.5-flash-lite`, $0.10 / 1M
 *      kirish). Sahifa to'liq ruxsatda 5160 token, ya'ni ~$0.0005.
 */
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig, saveConfig, type BarcodeerConfig } from '@barcodeer/core';

/** Ushbu ilovaning eng arzon va shu vazifaga yetarli modeli. */
export const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

/** Ma'lumotlar papkasi — asosiy ilovanikidan alohida. */
export function aiDataDir(): string {
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'qaytnoma-ai');
  }
  return join(homedir(), '.config', 'qaytnoma-ai');
}

export interface LoadAiOptions {
  /** Ishlab chiqish rejimida repo ildizi — `.env` shu yerdan o'qiladi. */
  devRoot?: string;
  dataDir?: string;
}

export async function loadAiConfig(opts: LoadAiOptions = {}): Promise<BarcodeerConfig> {
  const dataDir = opts.dataDir ?? aiDataDir();
  const config = await loadConfig({
    dataDir,
    ...(opts.devRoot ? { devRoot: opts.devRoot } : {}),
    defaults: {
      dataDir,
      geminiModel: DEFAULT_MODEL,
      // Bu ilovada model — asosiy o'quvchi, zaxira emas.
      geminiMode: 'full',
      // PDF arxivi asosiy ilova bilan bir xil joyga tushadi: foydalanuvchi
      // uchun bu bitta papka bo'lib qolishi kerak.
      invoicesRoot: join(homedir(), 'Documents', 'Invoices'),
    },
  });
  return config;
}

export { saveConfig };

/** Sozlanmagan maydonlar — foydalanuvchiga ko'rsatish uchun. */
export function missingAiSettings(config: BarcodeerConfig): string[] {
  const missing: string[] = [];
  if (!config.geminiApiKey.trim()) missing.push('Gemini API kaliti');
  if (!config.spreadsheetId.trim()) missing.push('Spreadsheet ID');
  if (!config.serviceAccountPath.trim()) missing.push('Service account kaliti');
  return missing;
}

export function isAiConfigured(config: BarcodeerConfig): boolean {
  return missingAiSettings(config).length === 0;
}

/** Repo ildizi — `apps/qaytnoma-ai/src` dan ikki pog'ona yuqori. */
export function repoRoot(fromDir: string): string {
  return resolve(fromDir, '..', '..', '..');
}
