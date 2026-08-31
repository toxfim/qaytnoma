/**
 * Buyruq qatori interfeysi — Electron'siz test va qo'lda ishga tushirish uchun.
 *
 *   npx tsx src/cli.ts scan                 # skanerdan o'qib, to'liq quvurni bajaradi
 *   npx tsx src/cli.ts ingest <papka|fayl>  # tayyor rasmlardan qayta ishlaydi
 *   npx tsx src/cli.ts check                # sozlamalar va ulanishlarni tekshiradi
 *
 * Bayroqlar:
 *   --no-sheets   Google Sheets ga yozmaydi (quruq ishlash)
 *   --dpi <n>     Skanerlash ruxsati
 */
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scanStream, listScanners } from '@barcodeer/scanner';
import { loadConfig, loadServiceAccount, type BarcodeerConfig } from './config.js';
import { SheetsWriter } from './output/sheets.js';
import { runPipeline, type CatalogueOptions, type ProgressEvent } from './pipeline/run.js';
import { rowNeedsReview } from './pipeline/validate.js';
import { SkuCatalogue } from './store/sku-catalogue.js';
import { fetchCatalogue } from './input/catalogue-sheet.js';
import { vlmFromConfig } from './vlm/setup.js';
import { fullImage, preparePage, WORK_WIDTH } from './layout/page.js';

const IMAGE_RE = /\.(bmp|png|jpe?g|tiff?)$/i;

async function main(): Promise<void> {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const positional = rest.filter((a) => !a.startsWith('--'));

  const config = await loadConfig({ devRoot: findRepoRoot() });

  switch (command) {
    case 'check':
      await commandCheck(config);
      return;
    case 'scan':
      await commandScan(config, flags, rest);
      return;
    case 'ingest':
      await commandIngest(config, flags, positional[0]);
      return;
    case 'sync-catalogue':
      await commandSyncCatalogue(config);
      return;
    case 'gemini':
      await commandGemini(config, positional[0]);
      return;
    default:
      printHelp();
  }
}

function printHelp(): void {
  console.log(`Barcodeer CLI

  scan                  Skanerdan o'qib, hujjatlarni qayta ishlaydi
  ingest <papka|fayl>   Tayyor rasmlardan qayta ishlaydi
  sync-catalogue        Uzum katalogini (Баркод -> Скю) majburan yangilaydi
  gemini <rasm>         Bitta sahifani faqat Gemini orqali o'qib ko'rsatadi
  check                 Sozlamalar, skaner va Sheets ulanishini tekshiradi

Bayroqlar:
  --no-sheets           Google Sheets ga yozmaydi
  --dpi <n>             Skanerlash ruxsati (standart: konfiguratsiyadan)
  --pages <n>           Ko'pi bilan n varoq skanerlaydi (sinov uchun)
  --gemini              Til modeli zaxirasini yoqadi (assist rejimi)
  --gemini-full         Har bir sahifani to'liq modelga ham beradi
  --no-gemini           Sozlamada yoqilgan bo'lsa ham o'chiradi`);
}

async function commandCheck(config: BarcodeerConfig): Promise<void> {
  console.log('Sozlamalar:');
  console.log(`  spreadsheetId : ${config.spreadsheetId}`);
  console.log(`  sheetName     : ${config.sheetName}`);
  console.log(`  invoicesRoot  : ${config.invoicesRoot}`);
  console.log(`  tessdataPath  : ${config.tessdataPath}`);
  console.log(`  dataDir       : ${config.dataDir}`);
  console.log(`  scanDpi       : ${config.scanDpi}`);
  console.log(`  katalog       : ${config.catalogueSpreadsheetId ?? 'sozlanmagan'} / "${config.catalogueSheetName}"`);
  console.log(
    `  gemini        : ${config.geminiMode}` +
      (config.geminiApiKey ? ` / ${config.geminiModel}` : ' (kalit yo`q)'),
  );

  const catalogue = await SkuCatalogue.open(join(config.dataDir, 'sku-catalogue.json'));
  console.log(
    `  katalog holati: ${catalogue.size} yozuv` +
      (catalogue.syncedAt ? `, oxirgi yangilanish ${catalogue.syncedAt}` : ', hali yuklanmagan'),
  );

  const scanners = await listScanners();
  console.log(`\nSkanerlar: ${scanners.length ? scanners.join(', ') : 'topilmadi'}`);

  try {
    const credentials = await loadServiceAccount(config.serviceAccountPath);
    const writer = new SheetsWriter({
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      credentials,
      flagColumn: config.flagColumn,
    });
    const info = await writer.check();
    console.log(`\nGoogle Sheets: "${info.title}"`);
    console.log(`  varaqlar: ${info.sheets.join(', ')}`);
    if (!info.sheets.includes(config.sheetName)) {
      console.log(`  DIQQAT: "${config.sheetName}" varag'i topilmadi`);
    }
  } catch (err) {
    console.log(`\nGoogle Sheets: XATO — ${(err as Error).message}`);
  }
}

async function commandSyncCatalogue(config: BarcodeerConfig): Promise<void> {
  if (!config.catalogueSpreadsheetId) {
    console.error('Katalog sozlanmagan (catalogueSpreadsheetId bo`sh)');
    process.exitCode = 1;
    return;
  }
  console.log(`Katalog yuklanmoqda: "${config.catalogueSheetName}"…`);
  const started = Date.now();

  const fetched = await fetchCatalogue(
    {
      spreadsheetId: config.catalogueSpreadsheetId,
      sheetName: config.catalogueSheetName,
      skuColumn: config.catalogueSkuColumn,
      barcodeColumn: config.catalogueBarcodeColumn,
    },
    await loadServiceAccount(config.serviceAccountPath),
  );

  const catalogue = await SkuCatalogue.open(join(config.dataDir, 'sku-catalogue.json'));
  await catalogue.replaceAll(
    fetched.entries,
    `${config.catalogueSpreadsheetId}/${config.catalogueSheetName}`,
  );

  console.log(
    `${fetched.entries.size} ta noyob shtrix-kod saqlandi ` +
      `(${fetched.rowsRead} qator o'qildi, ${fetched.skipped} tashlandi, ` +
      `${fetched.conflicts.length} ziddiyat, ${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
  for (const c of fetched.conflicts.slice(0, 5)) console.log(`  ziddiyat: ${c}`);
}

async function commandScan(config: BarcodeerConfig, flags: Set<string>, rest: string[]): Promise<void> {
  const dpiIndex = rest.indexOf('--dpi');
  const dpi = dpiIndex >= 0 ? Number(rest[dpiIndex + 1]) : config.scanDpi;
  const pagesIndex = rest.indexOf('--pages');
  const maxPages = pagesIndex >= 0 ? Number(rest[pagesIndex + 1]) : undefined;

  const outDir = await mkdtemp(join(tmpdir(), 'barcodeer-scan-'));
  console.log(`Skanerlash boshlandi (${dpi} DPI)...`);
  const started = Date.now();

  // Oqim rejimi: sahifalar skanerdan kelishi bilan qayta ishlanadi.
  const stream = scanStream({
    dpi,
    outDir,
    deviceName: config.scannerName,
    maxPages,
    onStatus: (message) => console.log(message),
  });
  await process_(config, flags, stream.pages);

  const result = await stream.result;
  if (!result.ok) {
    console.error(`Skanerlash xatosi [${result.code}]: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\nSkaner: ${result.pages.length} sahifa, ${(result.elapsedMs / 1000).toFixed(1)} s. ` +
      `Uchdan-uchgacha (skan + qayta ishlash + yozish): ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
}

async function commandIngest(
  config: BarcodeerConfig,
  flags: Set<string>,
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
    ? (await readdir(path)).filter((f) => IMAGE_RE.test(f)).sort().map((f) => join(path, f))
    : [path];

  if (pages.length === 0) {
    console.error(`Rasm topilmadi: ${path}`);
    process.exitCode = 1;
    return;
  }
  await process_(config, flags, pages);
}

async function process_(
  config: BarcodeerConfig,
  flags: Set<string>,
  pages: Iterable<string> | AsyncIterable<string>,
): Promise<void> {
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

  const result = await runPipeline({
    pages,
    vlm: vlmOptions(config, flags),
    tessdataPath: config.tessdataPath,
    dataDir: config.dataDir,
    invoicesRoot: config.invoicesRoot,
    sheets,
    catalogue: await catalogueOptions(config),
    onProgress: logProgress,
  });

  console.log('\n═══ NATIJA ═══');
  for (const doc of result.documents) {
    const flagged = doc.items.filter((_, i) => rowNeedsReview(doc, i)).length;
    console.log(
      `\n${doc.docId}  №${doc.docNumber}  ${doc.docDate}  —  ${doc.items.length} qator` +
        (flagged ? `, ${flagged} ta tekshiruvga` : ''),
    );
    if (doc.pdfPath) console.log(`  PDF: ${doc.pdfPath}`);
    for (const issue of doc.issues) console.log(`  [${issue.severity}] ${issue.message}`);
    for (const item of doc.items) {
      const marks = item.duplicate ? ' ⟲ takror' : item.issues.length ? ' ⚠' : '';
      console.log(
        `  ${String(item.rowNumber).padStart(3)}  ${item.itemBarcode}  ${String(item.quantity).padStart(3)}  ${item.sku ?? '—'}${marks}`,
      );
    }
  }

  console.log(
    `\n${result.documents.length} hujjat, ${result.rowsAppended} qator yozildi, ` +
      (result.rowsRecovered ? `${result.rowsRecovered} ta navbatdan tiklandi, ` : '') +
      (result.rowsPending ? `${result.rowsPending} ta navbatda qoldi, ` : '') +
      (result.rowsSkipped ? `${result.rowsSkipped} ta takror o'tkazib yuborildi, ` : '') +
      `${result.flaggedRows} ta belgilandi. ` +
      `SKU: ${result.skuResolved} ta ishonchli manbadan, ${result.skuFromOcr} ta OCR dan ` +
      `(katalogda ${result.catalogueEntries} yozuv). ${(result.elapsedMs / 1000).toFixed(1)} s`,
  );
  if (result.vlmUsage.requests > 0) {
    const u = result.vlmUsage;
    console.log(
      `Gemini: ${u.requests} so'rov, ${u.inputTokens} kirish + ${u.outputTokens} chiqish` +
        (u.thoughtTokens ? ` + ${u.thoughtTokens} fikrlash` : '') +
        ` = ${u.totalTokens} token` +
        (result.vlmRescuedPages ? `, ${result.vlmRescuedPages} sahifa qutqarildi` : ''),
    );
  }
  for (const w of result.warnings) console.log(`  DIQQAT: ${w}`);
}


/**
 * Bayroqlar konfiguratsiyadan ustun turadi — sinov uchun kalitni
 * `.env` da qoldirib, rejimni buyruq qatoridan boshqarish qulay.
 */
function vlmOptions(config: BarcodeerConfig, flags: Set<string>) {
  if (flags.has('--no-gemini')) return undefined;
  const mode = flags.has('--gemini-full')
    ? 'full'
    : flags.has('--gemini')
      ? 'assist'
      : config.geminiMode;
  return vlmFromConfig({ ...config, geminiMode: mode });
}

/**
 * Bitta sahifani FAQAT model orqali o'qiydi — quvursiz.
 *
 * Sozlamani tekshirish va modelning shu hujjat turida qanchalik
 * ishlashini ko'rish uchun: natija va sarflangan tokenlar chiqariladi.
 */
async function commandGemini(config: BarcodeerConfig, target: string | undefined): Promise<void> {
  if (!target) {
    console.error('Rasm ko`rsatilmadi');
    process.exitCode = 1;
    return;
  }
  const vlm = vlmFromConfig({ ...config, geminiMode: 'full' });
  if (!vlm) {
    console.error('Gemini kaliti sozlanmagan (`.env` dagi GEMINI_API_KEY yoki sozlamalar oynasi)');
    process.exitCode = 1;
    return;
  }

  // Sahifa quvurdagi bilan AYNAN bir xil tayyorlanadi (deskew + JPEG),
  // aks holda sinov natijasi haqiqiy ishlashdan farq qiladi.
  const prepared = await preparePage(resolve(target));
  const jpeg = await fullImage(prepared)
    .resize({ width: WORK_WIDTH, kernel: 'lanczos3' })
    .jpeg({ quality: 80 })
    .toBuffer();

  console.log(`${vlm.reader.model} ga yuborilmoqda (${(jpeg.length / 1024).toFixed(0)} KB)…`);
  const started = Date.now();
  const page = await vlm.reader.readPage(jpeg);
  const usage = vlm.reader.usage;

  if (!page) {
    console.error(`O'qib bo'lmadi: ${vlm.reader.errors.join('; ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`
Hujjat: ${page.docId ?? '—'}  №${page.docNumber ?? '—'}  ${page.docDate ?? '—'}`);
  console.log(`Qatorlar: ${page.rows.length}, Итого: ${page.totalQuantity ?? '—'}`);
  for (const row of page.rows) {
    console.log(
      `  ${(row.barcode ?? '—').padEnd(14)} ${String(row.quantity ?? '—').padStart(4)}  ${row.sku ?? '—'}`,
    );
  }
  console.log(
    `
${usage.inputTokens} kirish + ${usage.outputTokens} chiqish` +
      (usage.thoughtTokens ? ` + ${usage.thoughtTokens} fikrlash` : '') +
      ` = ${usage.totalTokens} token, ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
}

/** Katalog sozlamalarini quvur formatiga o'giradi. */
export async function catalogueOptions(
  config: BarcodeerConfig,
): Promise<CatalogueOptions | undefined> {
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

function logProgress(event: ProgressEvent): void {
  switch (event.type) {
    case 'catalogue':
      console.log(
        `  katalog: ${event.entries} yozuv${event.refreshed ? ' (yangilandi)' : ' (keshdan)'}`,
      );
      break;
    case 'page':
      console.log(`  sahifa ${event.index + 1}/${event.total}`);
      break;
    case 'grouped':
      console.log(`  ${event.documents} ta hujjat aniqlandi`);
      break;
    case 'pdf':
      console.log(`  PDF: ${event.path}`);
      break;
    case 'sheets':
      console.log(
        `  Sheets: ${event.rows} qator (${event.flagged} belgilangan` +
          (event.skipped ? `, ${event.skipped} takror o'tkazib yuborildi` : '') +
          ')',
      );
      break;
    case 'vlm':
      console.log(
        `  gemini: ${event.requests} so'rov, ${event.totalTokens} token` +
          (event.rescuedPages ? `, ${event.rescuedPages} sahifa qutqarildi` : ''),
      );
      break;
    case 'recovered':
      console.log(`  navbatdan tiklandi: ${event.rows} qator (${event.batches} to'plam)`);
      break;
    case 'warning':
      console.log(`  DIQQAT: ${event.message}`);
      break;
  }
}

/** Repo ildizini topadi — ishlab chiqishda `.env` shu yerdan o'qiladi. */
function findRepoRoot(): string {
  // packages/core/src -> packages/core -> packages -> <root>
  return resolve(import.meta.dirname, '..', '..', '..');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
