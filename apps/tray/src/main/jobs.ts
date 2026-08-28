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
  OcrEngine,
  runPipeline,
  SheetsWriter,
  SkuCatalogue,
  type BarcodeerConfig,
  type CatalogueOptions,
  type ProgressEvent,
  type RunResult,
} from '@barcodeer/core';
import { scanStream } from '@barcodeer/scanner';
import type { Store } from './state.js';
import { showErrorDialog } from './error-dialog.js';

export class JobRunner {
  #running = false;
  /**
   * Isitilgan OCR dvigateli — skanerlashlar orasida saqlanadi.
   * Worker'larni yuklash ~2.4 s; ilova ishga tushganda fonda bajariladi,
   * shunda birinchi skanerlash ham kutmaydi.
   */
  #ocr: OcrEngine | null = null;
  #ocrPath = '';
  /** Sheets yozuvchisi ham saqlanadi — sarlavha tekshiruvi bir marta bajariladi. */
  #sheets: SheetsWriter | null = null;
  #sheetsKey = '';

  constructor(private readonly store: Store) {}

  get running(): boolean {
    return this.#running;
  }

  /** OCR dvigatelini oldindan isitadi (ilova ishga tushganda chaqiriladi). */
  prewarm(): void {
    void this.#engine().warmUp().catch(() => {});
  }

  #engine(): OcrEngine {
    const path = this.store.state.config.tessdataPath;
    if (this.#ocr && this.#ocrPath === path) return this.#ocr;
    // Til papkasi o'zgargan bo'lsa eskisini yopib, yangisini yaratamiz.
    void this.#ocr?.close().catch(() => {});
    this.#ocr = new OcrEngine({ langPath: path });
    this.#ocrPath = path;
    return this.#ocr;
  }

  async dispose(): Promise<void> {
    await this.#ocr?.close().catch(() => {});
    this.#ocr = null;
  }

  /** Skanerdan o'qib, to'liq quvurni bajaradi. */
  async scanAndProcess(): Promise<void> {
    if (!this.#begin('Skaner tayyorlanmoqda…')) return;

    const config = this.store.state.config;
    let workDir: string | null = null;

    try {
      workDir = await mkdtemp(join(tmpdir(), 'barcodeer-'));
      this.store.update({ activity: 'Skanerlanmoqda…' });

      // Oqim rejimi: sahifalar skanerdan kelishi bilan qayta ishlanadi —
      // skaner keyingi varaqni o'qiyotgan paytda.
      const stream = scanStream({
        dpi: config.scanDpi,
        outDir: workDir,
        deviceName: config.scannerName,
      });

      // Quvur skanerlash bilan parallel ishlaydi, ammo skanerlash xatosini
      // uni KUTMASDAN ko'rsatamiz. Quvur ishni Uzum katalogini yuklashdan
      // boshlaydi (~23 000 qator, tarmoq), shuning uchun skaner umuman
      // qo'zg'almagan holatda ham ikonka yana o'nlab soniya "bajarilmoqda"
      // holatida turardi — foydalanuvchi sababni ko'rmay qolardi.
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
          skipped: 0,
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
      this.#succeed(await this.#process(this.store.state.config, paths));
    } catch (err) {
      this.#fail((err as Error).message);
    } finally {
      this.#end();
    }
  }

  async #process(
    config: BarcodeerConfig,
    pages: Iterable<string> | AsyncIterable<string>,
  ): Promise<RunResult> {
    let sheets: SheetsWriter | undefined;
    try {
      const key = [config.spreadsheetId, config.sheetName, config.serviceAccountPath, config.flagColumn].join('|');
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
      // Sheets sozlanmagan bo'lsa ham PDF saqlanadi — skanerlangan qog'oz
      // behuda ketmasligi kerak.
      this.store.update({ activity: `Sheets o'chirildi: ${(err as Error).message}` });
    }

    return runPipeline({
      pages,
      ocr: this.#engine(),
      tessdataPath: config.tessdataPath,
      dataDir: config.dataDir,
      invoicesRoot: config.invoicesRoot,
      sheets,
      catalogue: await catalogueOptions(config),
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

  #succeed(result: RunResult): void {
    const lastRun = {
      at: new Date().toISOString(),
      documents: result.documents.length,
      rows: result.rowsAppended,
      flagged: result.flaggedRows,
      skipped: result.rowsSkipped,
      error: result.warnings[0] ?? null,
    };
    this.store.update({
      status: this.store.enabled ? 'idle' : 'off',
      activity: null,
      lastRun,
    });

    const body =
      `${result.documents.length} hujjat, ${result.rowsAppended} qator yozildi` +
      (result.rowsRecovered ? `, shundan ${result.rowsRecovered} tasi oldingi navbatdan` : '') +
      (result.rowsPending ? `, ${result.rowsPending} qator navbatda qoldi` : '') +
      (result.rowsSkipped ? `, ${result.rowsSkipped} ta takror o'tkazib yuborildi` : '') +
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
        skipped: 0,
        error: message,
      },
    });
    // Bildirishnoma emas, modal: xato sababi ko'rinmay qolmasligi kerak
    // (`error-dialog.ts` da nega — batafsil).
    void showErrorDialog('Ish bajarilmadi', message);
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
      return `Sheets: ${event.rows} qator` + (event.skipped ? `, ${event.skipped} takror o'tkazildi` : '');
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
