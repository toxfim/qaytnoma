/**
 * Ishlarni bajaruvchi: skanerlash va kuzatilayotgan papkadan qayta ishlash.
 *
 * Asosiy ilovadan farqi — isitiladigan OCR dvigateli yo'q: bu yerda og'ir
 * bosqich tarmoq so'rovi, uni oldindan tayyorlab bo'lmaydi. Shu sababli
 * ishga tushish ham tezroq.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Notification, shell } from 'electron';
import {
  SheetsWriter,
  SkuCatalogue,
  fetchCatalogue,
  loadServiceAccount,
  type BarcodeerConfig,
  type CatalogueOptions,
} from '@barcodeer/core';
import { scanStream } from '@barcodeer/scanner';
import { GeminiClient } from '../gemini/client.js';
import { formatUsd } from '../gemini/cost.js';
import { runAiPipeline, type AiProgressEvent, type AiRunResult } from '../pipeline/run.js';
import type { Store } from './state.js';

export class JobRunner {
  #running = false;
  /** Sheets yozuvchisi saqlanadi — sarlavha tekshiruvi bir marta bajariladi. */
  #sheets: SheetsWriter | null = null;
  #sheetsKey = '';

  constructor(private readonly store: Store) {}

  get running(): boolean {
    return this.#running;
  }

  /** Skanerdan o'qib, to'liq quvurni bajaradi. */
  async scanAndProcess(): Promise<void> {
    if (!this.#begin('Skaner tayyorlanmoqda…')) return;

    const config = this.store.state.config;
    let workDir: string | null = null;

    try {
      workDir = await mkdtemp(join(tmpdir(), 'qaytnoma-ai-'));
      this.store.update({ activity: 'Skanerlanmoqda…' });

      const stream = scanStream({
        dpi: config.scanDpi,
        outDir: workDir,
        deviceName: config.scannerName,
      });

      // Skanerlash xatosi quvurni KUTMASDAN ko'rsatiladi: quvur katalogni
      // yuklashdan boshlaydi va skaner umuman qo'zg'almagan holatda ham
      // ikonka o'nlab soniya "bajarilmoqda" holatida turardi.
      const processing = this.#process(config, stream.pages).then(
        (value) => ({ value, error: null as Error | null }),
        (error: Error) => ({ value: null, error }),
      );

      const scan = await stream.result;
      if (!scan.ok) {
        this.#fail(scanErrorMessage(scan.code, scan.error));
        await processing;
        return;
      }
      if (scan.pages.length === 0) {
        this.#fail('Skanerda qog`oz topilmadi');
        await processing;
        return;
      }

      const outcome = await processing;
      if (!outcome.value) throw outcome.error ?? new Error('Qayta ishlash natijasiz tugadi');
      this.#succeed(outcome.value);
    } catch (err) {
      this.#fail((err as Error).message);
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
      this.#end();
    }
  }

  /** Kuzatilayotgan papkadan kelgan fayllarni qayta ishlaydi. */
  async ingest(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    if (!this.#begin(`${paths.length} ta fayl qayta ishlanmoqda…`)) return;

    try {
      this.#succeed(await this.#process(this.store.state.config, paths));
    } catch (err) {
      this.#fail((err as Error).message);
    } finally {
      this.#end();
    }
  }

  /** Uzum katalogini majburan yangilaydi. */
  async syncCatalogue(): Promise<void> {
    if (!this.#begin('Katalog yangilanmoqda…')) return;
    const config = this.store.state.config;

    try {
      if (!config.catalogueSpreadsheetId) {
        this.#fail('Katalog sozlanmagan — sozlamalarda jadval ID sini kiriting');
        return;
      }
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
      this.store.update({ activity: null, status: 'idle' });
      notify('Katalog yangilandi', `${fetched.entries.size} ta shtrix-kod saqlandi`, null);
    } catch (err) {
      this.#fail(`Katalogni yangilab bo'lmadi: ${(err as Error).message}`);
    } finally {
      this.#end();
    }
  }

  async #process(
    config: BarcodeerConfig,
    pages: Iterable<string> | AsyncIterable<string>,
  ): Promise<AiRunResult> {
    let sheets: SheetsWriter | undefined;
    try {
      const key = `${config.spreadsheetId}|${config.sheetName}|${config.serviceAccountPath}`;
      if (!this.#sheets || this.#sheetsKey !== key) {
        this.#sheets = new SheetsWriter({
          spreadsheetId: config.spreadsheetId,
          sheetName: config.sheetName,
          credentials: await loadServiceAccount(config.serviceAccountPath),
          flagColumn: config.flagColumn,
        });
        this.#sheetsKey = key;
      }
      sheets = this.#sheets;
    } catch (err) {
      // Sheets sozlanmagan bo'lsa ham PDF saqlanadi.
      this.store.update({ activity: `Sheets o'chirildi: ${(err as Error).message}` });
    }

    const catalogue = await catalogueOptions(config);
    return runAiPipeline({
      pages,
      client: new GeminiClient({ apiKey: config.geminiApiKey, model: config.geminiModel }),
      dataDir: config.dataDir,
      invoicesRoot: config.invoicesRoot,
      ...(sheets ? { sheets } : {}),
      ...(catalogue ? { catalogue } : {}),
      onProgress: (event) => this.store.update({ activity: describe(event) }),
    });
  }

  #begin(activity: string): boolean {
    if (this.#running) return false;
    if (!this.store.enabled) return false;
    this.#running = true;
    this.store.update({ status: 'busy', activity });
    return true;
  }

  #end(): void {
    this.#running = false;
    if (this.store.state.status === 'busy') {
      this.store.update({ status: this.store.enabled ? 'idle' : 'off', activity: null });
    }
  }

  #succeed(result: AiRunResult): void {
    this.store.update({
      status: this.store.enabled ? 'idle' : 'off',
      activity: null,
      lastRun: {
        at: new Date().toISOString(),
        documents: result.documents.length,
        rows: result.rowsAppended,
        flagged: result.flaggedRows,
        skipped: result.rowsSkipped,
        tokens: result.usage.totalTokens,
        usd: result.usd,
        error: result.warnings[0] ?? null,
      },
    });

    const body =
      `${result.documents.length} hujjat, ${result.rowsAppended} qator yozildi` +
      (result.rowsSkipped ? `, ${result.rowsSkipped} takror` : '') +
      (result.flaggedRows ? `, ${result.flaggedRows} ta tekshiruvga` : '') +
      `\n${result.usage.totalTokens} token ~ ${formatUsd(result.usd)}` +
      (result.warnings.length ? `\n${result.warnings[0]}` : '');

    notify('Skanerlash tugadi', body, result.documents[0]?.pdfPath ?? null);
  }

  #fail(message: string): void {
    this.store.update({
      status: 'error',
      activity: null,
      lastRun: {
        at: new Date().toISOString(),
        documents: 0,
        rows: 0,
        flagged: 0,
        skipped: 0,
        tokens: 0,
        usd: 0,
        error: message,
      },
    });
    notify('Xatolik', message, null);
  }
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

function describe(event: AiProgressEvent): string {
  switch (event.type) {
    case 'catalogue':
      return event.refreshed
        ? `Katalog yangilandi (${event.entries})`
        : `Katalog: ${event.entries}`;
    case 'page':
      return `Sahifa ${event.index + 1}: ${event.rows} qator, ${event.tokens} token`;
    case 'grouped':
      return `${event.documents} ta hujjat aniqlandi`;
    case 'pdf':
      return `PDF saqlandi: ${event.docId}`;
    case 'sheets':
      return `Sheets: ${event.rows} qator`;
    case 'recovered':
      return `Navbatdan tiklandi: ${event.rows} qator`;
    case 'warning':
      return event.message;
  }
}

function scanErrorMessage(code: string, error: string): string {
  switch (code) {
    case 'NO_DEVICE':
      return 'Skaner topilmadi — USB ulanishini va WIA drayverini tekshiring';
    case 'SCRIPT_MISSING':
      return `Dastur to'liq o'rnatilmagan (${error}) — o'rnatgichni qayta yuklab, qayta o'rnating`;
    case 'NO_PAPER':
      return 'Avtomatik uzatgichda qog`oz yo`q';
    case 'TIMEOUT':
      return 'Skanerlash juda uzoq davom etdi';
    default:
      return error;
  }
}

function notify(title: string, body: string, openPath: string | null): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  if (openPath) {
    notification.on('click', () => {
      void shell.showItemInFolder(openPath);
    });
  }
  notification.show();
}
