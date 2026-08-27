/**
 * Skanerlash va qayta ishlash ishlari.
 *
 * Bir vaqtda faqat BITTA ish bajariladi: skaner ham, Tesseract worker'lari ham
 * bir vaqtda ikki marta ishlatilishi mumkin emas, va foydalanuvchi tray'dan
 * ketma-ket ikki marta bosib qo'yishi mumkin.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Notification, shell } from 'electron';
import {
  fetchCatalogue,
  loadServiceAccount,
  runPipeline,
  SheetsWriter,
  SkuCatalogue,
  type BarcodeerConfig,
  type CatalogueOptions,
  type ProgressEvent,
  type RunResult,
} from '@barcodeer/core';
import { scanBatch } from '@barcodeer/scanner';
import type { Store } from './state.js';

export class JobRunner {
  #running = false;

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
      workDir = await mkdtemp(join(tmpdir(), 'barcodeer-'));
      this.store.update({ activity: 'Skanerlanmoqda…' });

      const scan = await scanBatch({
        dpi: config.scanDpi,
        outDir: workDir,
        deviceName: config.scannerName,
      });

      if (!scan.ok) {
        this.#fail(scanErrorMessage(scan.code, scan.error));
        return;
      }
      if (scan.pages.length === 0) {
        this.#fail('Skanerda qog`oz topilmadi');
        return;
      }

      await this.#process(config, scan.pages);
    } catch (err) {
      this.#fail((err as Error).message);
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
      this.#end();
    }
  }

  /**
   * Uzum katalogini majburan yangilaydi.
   *
   * Odatda quvur uni kerak bo'lganda o'zi yangilaydi; bu buyruq foydalanuvchi
   * katalogga yangi mahsulot qo'shgandan keyin darhol yangilash uchun.
   */
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

      this.store.update({
        status: this.store.enabled ? 'idle' : 'off',
        activity: null,
        lastRun: {
          at: new Date().toISOString(),
          documents: 0,
          rows: 0,
          flagged: 0,
          error: null,
        },
      });
      notify('Katalog yangilandi', `${fetched.entries.size} ta shtrix-kod saqlandi`, null);
    } catch (err) {
      this.#fail(`Katalog yangilanmadi: ${(err as Error).message}`);
    } finally {
      this.#end();
    }
  }

  /** Tayyor rasm fayllarini qayta ishlaydi (hot folder yo'li). */
  async processFiles(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    if (!this.#begin('Fayllar qayta ishlanmoqda…')) return;

    try {
      await this.#process(this.store.state.config, paths);
    } catch (err) {
      this.#fail((err as Error).message);
    } finally {
      this.#end();
    }
  }

  async #process(config: BarcodeerConfig, pages: readonly string[]): Promise<void> {
    let sheets: SheetsWriter | undefined;
    try {
      sheets = new SheetsWriter({
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName,
        credentials: await loadServiceAccount(config.serviceAccountPath),
        flagColumn: config.flagColumn,
      });
    } catch (err) {
      // Sheets sozlanmagan bo'lsa ham PDF saqlanadi — skanerlangan qog'oz
      // behuda ketmasligi kerak.
      this.store.update({ activity: `Sheets o'chirildi: ${(err as Error).message}` });
    }

    const result = await runPipeline({
      pages,
      tessdataPath: config.tessdataPath,
      dataDir: config.dataDir,
      invoicesRoot: config.invoicesRoot,
      sheets,
      catalogue: await catalogueOptions(config),
      onProgress: (event) => this.store.update({ activity: describe(event) }),
    });

    this.#succeed(result);
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

  #succeed(result: RunResult): void {
    const lastRun = {
      at: new Date().toISOString(),
      documents: result.documents.length,
      rows: result.rowsAppended,
      flagged: result.flaggedRows,
      error: result.warnings[0] ?? null,
    };
    this.store.update({
      status: this.store.enabled ? 'idle' : 'off',
      activity: null,
      lastRun,
    });

    const body =
      `${result.documents.length} hujjat, ${result.rowsAppended} qator yozildi` +
      (result.flaggedRows ? `, ${result.flaggedRows} ta tekshiruvga` : '') +
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
        error: message,
      },
    });
    notify('Skanerlash bajarilmadi', message, null);
  }
}

/**
 * Katalog sozlamalarini quvur formatiga o'giradi.
 *
 * Kalit o'qilmasa `undefined` qaytadi — quvur katalogsiz ham ishlaydi,
 * shunchaki SKU OCR dan olinadi va qatorlar tekshirishga belgilanadi.
 */
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

function describe(event: ProgressEvent): string {
  switch (event.type) {
    case 'catalogue':
      return event.refreshed ? `Katalog yangilandi (${event.entries})` : `Katalog: ${event.entries}`;
    case 'page':
      return `Sahifa ${event.index + 1}/${event.total}`;
    case 'grouped':
      return `${event.documents} ta hujjat aniqlandi`;
    case 'pdf':
      return `PDF saqlandi: ${event.docId}`;
    case 'sheets':
      return `Sheets: ${event.rows} qator`;
    case 'warning':
      return event.message;
  }
}

function scanErrorMessage(code: string, error: string): string {
  switch (code) {
    case 'NO_DEVICE':
      return 'Skaner topilmadi — USB ulanishini tekshiring';
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
