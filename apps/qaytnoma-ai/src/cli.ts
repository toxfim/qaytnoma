/**
 * Qaytnoma AI — buyruq qatori (Electron'siz sinov uchun).
 *
 *   npx tsx src/cli.ts check                 # sozlamalar, kalit va narx
 *   npx tsx src/cli.ts scan                  # skanerdan o'qib, to'liq quvur
 *   npx tsx src/cli.ts ingest <papka|fayl>   # tayyor rasmlardan
 *   npx tsx src/cli.ts page <rasm>           # bitta sahifa, xom natija
 */
import { readdir, stat } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { listScanners, scanStream } from '@barcodeer/scanner';
import {
  SheetsWriter,
  SkuCatalogue,
  loadServiceAccount,
  rowNeedsReview,
  WORK_WIDTH,
  type BarcodeerConfig,
  type CatalogueOptions,
} from '@barcodeer/core';
import { DEFAULT_MODEL, loadAiConfig, missingAiSettings, repoRoot } from './config.js';
import { GeminiClient } from './gemini/client.js';
import { estimateUsd, formatUsd, imageTokens } from './gemini/cost.js';
import { readPage } from './gemini/page-reader.js';
import { prepareForModel } from './pipeline/prepare.js';
import { runAiPipeline, type AiProgressEvent } from './pipeline/run.js';

const IMAGE_RE = /\.(bmp|png|jpe?g|tiff?)$/i;

async function main(): Promise<void> {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const positional = rest.filter((a) => !a.startsWith('--'));
  const config = await loadAiConfig({ devRoot: repoRoot(import.meta.dirname) });

  switch (command) {
    case 'check':
      await commandCheck(config);
      return;
    case 'scan':
      await commandScan(config, flags, rest);
      return;
    case 'ingest':
      await commandIngest(config, flags, rest, positional[0]);
      return;
    case 'page':
      await commandPage(config, rest, positional[0]);
      return;
    default:
      console.log(`Qaytnoma AI

  check                 Sozlamalar, kalit, skaner va Sheets ulanishini tekshiradi
  scan                  Skanerdan o'qib, hujjatlarni Gemini orqali qayta ishlaydi
  ingest <papka|fayl>   Tayyor rasmlardan qayta ishlaydi
  page <rasm>           Bitta sahifani o'qib, xom natijani ko'rsatadi

Bayroqlar:
  --no-sheets           Google Sheets ga yozmaydi
  --dpi <n>             Skanerlash ruxsati
  --pages <n>           Ko'pi bilan n varoq skanerlaydi
  --width <n>           Modelga yuboriladigan rasm kengligi (standart ${WORK_WIDTH})
  --model <nom>         Model nomi (standart ${DEFAULT_MODEL})`);
  }
}

function numberFlag(rest: string[], name: string): number | undefined {
  const at = rest.indexOf(name);
  if (at < 0) return undefined;
  const value = Number(rest[at + 1]);
  return Number.isFinite(value) ? value : undefined;
}

function stringFlag(rest: string[], name: string): string | undefined {
  const at = rest.indexOf(name);
  return at >= 0 ? rest[at + 1] : undefined;
}

function client(config: BarcodeerConfig, rest: string[]): GeminiClient {
  return new GeminiClient({
    apiKey: config.geminiApiKey,
    model: stringFlag(rest, '--model') ?? config.geminiModel,
  });
}

async function commandCheck(config: BarcodeerConfig): Promise<void> {
  console.log('Sozlamalar:');
  console.log(`  dataDir       : ${config.dataDir}`);
  console.log(`  invoicesRoot  : ${config.invoicesRoot}`);
  console.log(`  spreadsheetId : ${config.spreadsheetId || '(sozlanmagan)'}`);
  console.log(`  model         : ${config.geminiModel}`);
  console.log(
    `  gemini kaliti : ${config.geminiApiKey ? `bor (…${config.geminiApiKey.slice(-4)})` : 'YO`Q'}`,
  );

  const missing = missingAiSettings(config);
  if (missing.length > 0) console.log(`  SOZLANMAGAN   : ${missing.join(', ')}`);

  // Bitta sahifaning narxi — sozlashning eng muhim raqami.
  const tokens = imageTokens(WORK_WIDTH, Math.round(WORK_WIDTH * 1.414));
  const usd = estimateUsd(
    { inputTokens: tokens + 400, outputTokens: 1000, thoughtTokens: 0 },
    config.geminiModel,
  );
  console.log(
    `\nSahifa narxi (taxminan): ${tokens} rasm + ~400 so'rov + ~1000 javob token ~ ${formatUsd(usd)}`,
  );

  const catalogue = await SkuCatalogue.open(join(config.dataDir, 'sku-catalogue.json'));
  console.log(
    `Katalog: ${catalogue.size} yozuv` +
      (catalogue.syncedAt ? `, oxirgi yangilanish ${catalogue.syncedAt}` : ', hali yuklanmagan'),
  );

  const scanners = await listScanners();
  console.log(`Skanerlar: ${scanners.length ? scanners.join(', ') : 'topilmadi'}`);

  try {
    const writer = new SheetsWriter({
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      credentials: await loadServiceAccount(config.serviceAccountPath),
      flagColumn: config.flagColumn,
    });
    const info = await writer.check();
    console.log(`Google Sheets: "${info.title}" — varaqlar: ${info.sheets.join(', ')}`);
  } catch (err) {
    console.log(`Google Sheets: XATO — ${(err as Error).message}`);
  }
}

/** Bitta sahifani o'qib, modelning xom natijasini ko'rsatadi. */
async function commandPage(
  config: BarcodeerConfig,
  rest: string[],
  target: string | undefined,
): Promise<void> {
  if (!target) {
    console.error('Rasm ko`rsatilmadi');
    process.exitCode = 1;
    return;
  }
  if (!config.geminiApiKey) {
    console.error('Gemini kaliti yo`q (.env dagi GEMINI_API_KEY)');
    process.exitCode = 1;
    return;
  }

  const width = numberFlag(rest, '--width');
  const gemini = client(config, rest);
  const images = await prepareForModel(resolve(target), width ? { width } : {});
  console.log(
    `${gemini.model} ga yuborilmoqda: ${images.modelWidth}x${images.modelHeight}, ` +
      `${(images.model.length / 1024).toFixed(0)} KB, ` +
      `${imageTokens(images.modelWidth, images.modelHeight)} rasm tokeni`,
  );

  const started = Date.now();
  const page = await readPage(gemini, images.model);
  const usage = gemini.usage;

  console.log(
    `\nSahifa turi: ${page.isHeaderPage ? 'sarlavha' : 'davomi'}` +
      `  ${page.docId ?? '—'}  №${page.docNumber ?? '—'}  ${page.docDate ?? '—'}`,
  );
  console.log(`Qatorlar: ${page.rows.length}, Итого: ${page.totalQuantity ?? '—'}`);
  for (const row of page.rows) {
    console.log(
      `  ${String(row.no ?? '—').padStart(3)}  ${(row.barcode ?? 'O`QILMADI').padEnd(14)}` +
        `${String(row.quantity ?? '—').padStart(4)}  ${row.sku ?? '—'}`,
    );
  }
  console.log(
    `\n${usage.inputTokens} kirish + ${usage.outputTokens} chiqish` +
      (usage.thoughtTokens ? ` + ${usage.thoughtTokens} fikrlash` : '') +
      ` = ${usage.totalTokens} token ~ ${formatUsd(estimateUsd(usage, gemini.model))}, ` +
      `${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
}

async function commandScan(
  config: BarcodeerConfig,
  flags: Set<string>,
  rest: string[],
): Promise<void> {
  const dpi = numberFlag(rest, '--dpi') ?? config.scanDpi;
  const maxPages = numberFlag(rest, '--pages');
  const outDir = await mkdtemp(join(tmpdir(), 'qaytnoma-ai-'));

  console.log(`Skanerlash boshlandi (${dpi} DPI)…`);
  const started = Date.now();
  const stream = scanStream({
    dpi,
    outDir,
    deviceName: config.scannerName,
    ...(maxPages ? { maxPages } : {}),
  });
  await process_(config, flags, rest, stream.pages);

  const result = await stream.result;
  if (!result.ok) {
    console.error(`Skanerlash xatosi [${result.code}]: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\nSkaner: ${result.pages.length} sahifa, ${(result.elapsedMs / 1000).toFixed(1)} s. ` +
      `Uchdan-uchgacha: ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
}

async function commandIngest(
  config: BarcodeerConfig,
  flags: Set<string>,
  rest: string[],
  target: string | undefined,
): Promise<void> {
  if (!target) {
    console.error('Papka yoki fayl ko`rsatilmadi');
    process.exitCode = 1;
    return;
  }
  const path = resolve(target);
  const info = await stat(path);
  const pages = info.isDirectory()
    ? (await readdir(path))
        .filter((f) => IMAGE_RE.test(f))
        .sort()
        .map((f) => join(path, f))
    : [path];

  if (pages.length === 0) {
    console.error(`Rasm topilmadi: ${path}`);
    process.exitCode = 1;
    return;
  }
  await process_(config, flags, rest, pages);
}

async function process_(
  config: BarcodeerConfig,
  flags: Set<string>,
  rest: string[],
  pages: Iterable<string> | AsyncIterable<string>,
): Promise<void> {
  if (!config.geminiApiKey) {
    console.error('Gemini kaliti yo`q (.env dagi GEMINI_API_KEY yoki sozlamalar oynasi)');
    process.exitCode = 1;
    return;
  }

  let sheets: SheetsWriter | undefined;
  if (!flags.has('--no-sheets')) {
    try {
      sheets = new SheetsWriter({
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName,
        credentials: await loadServiceAccount(config.serviceAccountPath),
        flagColumn: config.flagColumn,
      });
    } catch (err) {
      console.warn(`Sheets o'chirildi: ${(err as Error).message}`);
    }
  }

  const width = numberFlag(rest, '--width');
  const catalogue = await catalogueOptions(config);
  const result = await runAiPipeline({
    pages,
    client: client(config, rest),
    dataDir: config.dataDir,
    invoicesRoot: config.invoicesRoot,
    ...(sheets ? { sheets } : {}),
    ...(width ? { pageWidth: width } : {}),
    ...(catalogue ? { catalogue } : {}),
    onProgress: logProgress,
  });

  console.log('\n═══ NATIJA ═══');
  for (const doc of result.documents) {
    const flagged = doc.items.filter((_, i) => rowNeedsReview(doc, i)).length;
    console.log(
      `\n${doc.docId || '(ID yo`q)'}  №${doc.docNumber ?? '—'}  ${doc.docDate ?? '—'}  —  ` +
        `${doc.items.length} qator` +
        (flagged ? `, ${flagged} ta tekshiruvga` : '') +
        (doc.totals.quantity !== null ? `, Итого ${doc.totals.quantity}` : ''),
    );
    if (doc.pdfPath) console.log(`  PDF: ${doc.pdfPath}`);
    for (const issue of doc.issues) console.log(`  [${issue.severity}] ${issue.message}`);
    for (const item of doc.items) {
      const marks = item.duplicate ? ' ⟲ takror' : item.issues.length ? ' ⚠' : '';
      console.log(
        `  ${String(item.rowNumber).padStart(3)}  ${(item.itemBarcode || 'O`QILMADI').padEnd(14)}` +
          `${String(item.quantity ?? '—').padStart(4)}  ${item.sku ?? '—'}${marks}`,
      );
    }
  }

  const u = result.usage;
  console.log(
    `\n${result.documents.length} hujjat, ${result.pagesRead} sahifa o'qildi` +
      (result.pagesFailed ? `, ${result.pagesFailed} sahifa o'qilmadi` : '') +
      `, ${result.rowsAppended} qator yozildi` +
      (result.rowsSkipped ? `, ${result.rowsSkipped} takror` : '') +
      (result.rowsRecovered ? `, ${result.rowsRecovered} navbatdan` : '') +
      `, ${result.flaggedRows} ta belgilandi.`,
  );
  console.log(
    `SKU: ${result.skuFromCatalogue} ta katalogdan, ${result.skuFromModel} ta faqat modeldan ` +
      `(katalogda ${result.catalogueEntries} yozuv).`,
  );
  console.log(
    `Gemini: ${u.requests} so'rov, ${u.inputTokens} kirish + ${u.outputTokens} chiqish` +
      (u.thoughtTokens ? ` + ${u.thoughtTokens} fikrlash` : '') +
      ` = ${u.totalTokens} token ~ ${formatUsd(result.usd)}. ` +
      `${(result.elapsedMs / 1000).toFixed(1)} s`,
  );
  for (const w of result.warnings) console.log(`  DIQQAT: ${w}`);
}

async function catalogueOptions(config: BarcodeerConfig): Promise<CatalogueOptions | undefined> {
  if (!config.catalogueSpreadsheetId) return undefined;
  try {
    return {
      spreadsheetId: config.catalogueSpreadsheetId,
      sheetName: config.catalogueSheetName,
      skuColumn: config.catalogueSkuColumn,
      barcodeColumn: config.catalogueBarcodeColumn,
      maxAgeHours: config.catalogueMaxAgeHours,
      credentials: await loadServiceAccount(config.serviceAccountPath),
    };
  } catch {
    return undefined;
  }
}

function logProgress(event: AiProgressEvent): void {
  switch (event.type) {
    case 'catalogue':
      console.log(
        `  katalog: ${event.entries} yozuv${event.refreshed ? ' (yangilandi)' : ' (keshdan)'}`,
      );
      break;
    case 'page':
      console.log(
        `  sahifa ${event.index + 1}: ${event.rows} qator, ${event.tokens} token, ` +
          `${(event.ms / 1000).toFixed(1)} s`,
      );
      break;
    case 'grouped':
      console.log(`  ${event.documents} ta hujjat aniqlandi`);
      break;
    case 'pdf':
      console.log(`  PDF: ${event.path}`);
      break;
    case 'sheets':
      console.log(`  Sheets: ${event.rows} qator (${event.flagged} belgilangan)`);
      break;
    case 'recovered':
      console.log(`  navbatdan tiklandi: ${event.rows} qator`);
      break;
    case 'warning':
      console.log(`  DIQQAT: ${event.message}`);
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
