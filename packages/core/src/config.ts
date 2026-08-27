/**
 * Konfiguratsiya.
 *
 * Ishlab chiqishda repo ildizidagi `.env` va `credentials.local.json` dan,
 * o'rnatilgan dasturda esa `%APPDATA%/barcodeer/config.json` dan o'qiladi.
 */
import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

/** Dastur ma'lumotlari saqlanadigan papka. */
export function defaultDataDir(): string {
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'barcodeer');
  }
  return join(homedir(), '.config', 'barcodeer');
}

export const configSchema = z.object({
  /** Dastur yoqilganmi — o'chirilgan bo'lsa skanerlash ham, kuzatuv ham ishlamaydi. */
  enabled: z.boolean().default(true),

  /**
   * Google Sheets hujjatining ID si.
   *
   * Bo'sh bo'lishi MUMKIN: yangi o'rnatilgan dasturda hali hech narsa
   * sozlanmagan bo'ladi va foydalanuvchi Sozlamalar oynasini ochib to'ldirishi
   * kerak. Ilgari bu maydon majburiy edi va sozlamasiz kompyuterda dastur
   * ishga tushishdayoq yopilib qolardi — ya'ni sozlash imkoni ham yo'q edi.
   */
  spreadsheetId: z.string().default(''),
  /** Asosiy varaq nomi. */
  sheetName: z.string().min(1).default('Sheet1'),
  /** Service account kalitiga yo'l. Sozlanmagan bo'lsa bo'sh. */
  serviceAccountPath: z.string().default(''),
  /** Asosiy varaqda `⚠` ustunini yuritish. */
  flagColumn: z.boolean().default(true),

  /** PDF arxivi ildizi. */
  invoicesRoot: z.string().min(1),
  /** Kuzatiladigan papka (skanerning o'z tugmasi orqali chiqqan fayllar uchun). */
  hotFolder: z.string().nullable().default(null),

  /** Skanerlash ruxsati. 600 = optik maksimum (DS-530 II). */
  scanDpi: z.number().int().min(100).max(1200).default(600),
  /** Qurilma nomining bir qismi. */
  scannerName: z.string().default('DS-530'),

  // ---- Uzum mahsulot katalogi (`Баркод → Скю`) ----
  /**
   * Katalog joylashgan jadval. `null` bo'lsa katalog ishlatilmaydi va SKU
   * faqat OCR dan olinadi (aniqlik ~47%).
   */
  catalogueSpreadsheetId: z.string().nullable().default(null),
  /** Katalog varag'i nomi. */
  catalogueSheetName: z.string().default('Остаток Узум'),
  /** `Скю` ustuni harfi. */
  catalogueSkuColumn: z.string().default('B'),
  /** `Баркод` ustuni harfi. */
  catalogueBarcodeColumn: z.string().default('G'),
  /** Katalog shundan eski bo'lsa skanerlashdan oldin avtomatik yangilanadi. */
  catalogueMaxAgeHours: z.number().min(0).default(24),

  /** Tesseract til fayllari papkasi. */
  tessdataPath: z.string().min(1),
  /** Ichki ma'lumotlar (SKU lug'ati, indeks) papkasi. */
  dataDir: z.string().min(1),
});

export type BarcodeerConfig = z.infer<typeof configSchema>;

/**
 * Dastur ishlashga tayyormi.
 *
 * Tayyor bo'lmasa skanerlash boshlanmasligi kerak — aks holda qog'oz sarflanib,
 * natija hech qayerga yozilmaydi.
 */
export function isConfigured(config: BarcodeerConfig): boolean {
  return config.spreadsheetId.trim() !== '' && config.serviceAccountPath.trim() !== '';
}

/** Sozlanmagan maydonlarning o'zbekcha nomlari — foydalanuvchiga ko'rsatish uchun. */
export function missingSettings(config: BarcodeerConfig): string[] {
  const missing: string[] = [];
  if (!config.spreadsheetId.trim()) missing.push('Spreadsheet ID');
  if (!config.serviceAccountPath.trim()) missing.push('Service account kaliti');
  return missing;
}

export function configPath(dataDir = defaultDataDir()): string {
  return join(dataDir, 'config.json');
}

/** Standart qiymatlar — birinchi ishga tushirishda ishlatiladi. */
export function defaults(dataDir = defaultDataDir()): Partial<BarcodeerConfig> {
  return {
    enabled: true,
    sheetName: 'Sheet1',
    flagColumn: true,
    invoicesRoot: join(homedir(), 'Documents', 'Invoices'),
    hotFolder: null,
    scanDpi: 600,
    scannerName: 'DS-530',
    catalogueSpreadsheetId: null,
    catalogueSheetName: 'Остаток Узум',
    catalogueSkuColumn: 'B',
    catalogueBarcodeColumn: 'G',
    catalogueMaxAgeHours: 24,
    tessdataPath: join(dataDir, 'tessdata'),
    dataDir,
    // `spreadsheetId` va `serviceAccountPath` ATAYLAB yo'q: ular aniqlanmagan
    // bo'lib qolishi kerak, shunda `.env` dagi qiymatlar `??=` bilan
    // qo'llanadi. Bo'sh satr qo'yilsa `??=` uni "qiymat bor" deb hisoblaydi
    // va sozlama e'tiborsiz qolardi. Bo'sh qiymatni zod sxemasi qo'yadi.
  };
}

export interface LoadOptions {
  /** `config.json` o'rniga shu papkadan `.env` o'qiladi (ishlab chiqish rejimi). */
  devRoot?: string;
  dataDir?: string;
  /**
   * Standart qiymatlarni almashtirish. O'rnatilgan dasturda til fayllari
   * `resources/` ichida bo'ladi, ishlab chiqishda esa repo ichida —
   * chaqiruvchi shu farqni shu yerda bildiradi.
   *
   * `config.json` dagi qiymatlar bundan ham ustun turadi.
   */
  defaults?: Partial<BarcodeerConfig>;
}

/**
 * Konfiguratsiyani yuklaydi.
 *
 * Ustuvorlik: `config.json` → `.env` (dev) → standart qiymatlar.
 */
export async function loadConfig(opts: LoadOptions = {}): Promise<BarcodeerConfig> {
  const dataDir = opts.dataDir ?? defaultDataDir();
  let raw: Record<string, unknown> = { ...defaults(dataDir), ...opts.defaults };

  const stored = await readJsonIfExists(configPath(dataDir));
  if (stored) raw = { ...raw, ...stored };

  if (opts.devRoot) {
    const env = await readDotEnv(join(opts.devRoot, '.env'));
    if (env.MAIN_SHEET_ID) raw.spreadsheetId ??= env.MAIN_SHEET_ID;
    if (env.MAIN_SHEET_NAME) raw.sheetName = env.MAIN_SHEET_NAME;
    if (env.FINANCE_SHEET_ID) raw.catalogueSpreadsheetId ??= env.FINANCE_SHEET_ID;
    if (env.FINANCE_UZUM_STOCKS) raw.catalogueSheetName = env.FINANCE_UZUM_STOCKS;
    raw.serviceAccountPath ??= join(opts.devRoot, 'credentials.local.json');

    // Repo ichida yuklab olingan til fayllari bo'lsa, ular ustuvor —
    // ishlab chiqishda `%APPDATA%` ga nusxa ko'chirish shart bo'lmasin.
    const repoTessdata = join(opts.devRoot, 'packages', 'core', '.tessdata');
    if (await pathExists(repoTessdata)) raw.tessdataPath = repoTessdata;
  }

  return configSchema.parse(raw);
}

export async function saveConfig(config: BarcodeerConfig): Promise<void> {
  const path = configPath(config.dataDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), 'utf8');
}

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export async function loadServiceAccount(path: string): Promise<ServiceAccount> {
  const raw = await readFile(resolve(path), 'utf8');
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(`Service account faylida client_email yoki private_key yo'q: ${path}`);
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Konfiguratsiyani o'qib bo'lmadi (${path}): ${(err as Error).message}`);
  }
}

/** Minimal `.env` o'quvchi — qo'shimcha bog'liqlik kerak emas. */
async function readDotEnv(path: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key) out[key] = value;
  }
  return out;
}
