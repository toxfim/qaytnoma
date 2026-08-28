/**
 * Google Sheets ga yozish.
 *
 * Asosiy varaqda foydalanuvchi so'ragan 6 ustun (`goal.md`):
 *   Номер документа | Ид документа | Дата составления | СКУ | ШК | Кол-во
 * va 7-ustun `⚠` — faqat validatsiya buzilgan qatorlarda belgi qo'yiladi,
 * qolgan qatorlarda bo'sh qoladi. To'liq diagnostika alohida `_log` varag'iga
 * yoziladi, shunda asosiy jadval toza qoladi.
 */
import { auth as googleAuth, sheets as sheetsApi, type sheets_v4 } from '@googleapis/sheets';
import {
  LOG_SHEET_HEADERS,
  SHEET_HEADERS,
  type InvoiceDocument,
  type Issue,
} from '@barcodeer/shared';
import { rowNeedsReview } from '../pipeline/validate.js';
import { duplicateIssue, rowKey } from '../pipeline/dedupe.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/** Diagnostika varag'ining nomi. */
export const LOG_SHEET_NAME = '_log';

export interface SheetsCredentials {
  client_email: string;
  private_key: string;
}

export interface SheetsWriterOptions {
  spreadsheetId: string;
  /** Asosiy varaq nomi, masalan `Лист1`. */
  sheetName: string;
  credentials: SheetsCredentials;
  /** `⚠` ustunini yozish (standart: yoqilgan). */
  flagColumn?: boolean;
  /** Diagnostikani `_log` varag'iga yozish (standart: yoqilgan). */
  writeLog?: boolean;
}

export interface AppendResult {
  rowsAppended: number;
  logRowsAppended: number;
  flaggedRows: number;
  /** `duplicate` belgisi bilan kelgan — yozilmagan, faqat `_log` ga tushgan qatorlar. */
  rowsSkipped: number;
}

export class SheetsWriter {
  readonly #api: sheets_v4.Sheets;
  readonly #opts: Required<Omit<SheetsWriterOptions, 'credentials'>>;
  /** Sarlavhalar shu nusxada allaqachon tekshirilgan — 3 ta API so'rovi tejaladi. */
  #headersEnsured = false;

  constructor(opts: SheetsWriterOptions) {
    // `googleapis` o'rniga faqat Sheets mijozi ishlatiladi: to'liq paket
    // 320 ta API ni olib yuradi va 194 MB joy egallaydi, bu esa o'rnatgich
    // hajmiga to'g'ridan-to'g'ri qo'shiladi.
    const auth = new googleAuth.JWT({
      email: opts.credentials.client_email,
      key: opts.credentials.private_key,
      scopes: SCOPES,
    });
    this.#api = sheetsApi({ version: 'v4', auth });
    this.#opts = {
      spreadsheetId: opts.spreadsheetId,
      sheetName: opts.sheetName,
      flagColumn: opts.flagColumn ?? true,
      writeLog: opts.writeLog ?? true,
    };
  }

  /** Ulanish va ruxsatlarni tekshiradi; varaq nomini qaytaradi. */
  async check(): Promise<{ title: string; sheets: string[] }> {
    const res = await this.#api.spreadsheets.get({
      spreadsheetId: this.#opts.spreadsheetId,
      fields: 'properties.title,sheets.properties.title',
    });
    return {
      title: res.data.properties?.title ?? '',
      sheets: (res.data.sheets ?? []).map((s) => s.properties?.title ?? ''),
    };
  }

  /**
   * Varaq bo'sh bo'lsa sarlavha qatorini qo'yadi.
   *
   * Bir nusxada faqat bir marta bajariladi: uchta ketma-ket API so'rovi
   * (~1.5 s) har skanerlashda takrorlanishi shart emas. Tray ilova bitta
   * yozuvchini skanerlashlar orasida saqlaydi.
   */
  async ensureHeaders(): Promise<void> {
    if (this.#headersEnsured) return;
    const existing = await this.check();

    if (!(await this.#hasHeader(this.#opts.sheetName))) {
      const headers = this.#opts.flagColumn ? [...SHEET_HEADERS, '⚠'] : [...SHEET_HEADERS];
      await this.#append(this.#opts.sheetName, [headers]);
    }

    if (this.#opts.writeLog) {
      if (!existing.sheets.includes(LOG_SHEET_NAME)) await this.#createSheet(LOG_SHEET_NAME);
      if (!(await this.#hasHeader(LOG_SHEET_NAME))) {
        await this.#append(LOG_SHEET_NAME, [[...LOG_SHEET_HEADERS]]);
      }
    }
    this.#headersEnsured = true;
  }

  /**
   * Asosiy varaqdagi barcha `Ид документа + ШК` juftliklarini o'qiydi —
   * takror qatorlarni yozishdan oldin aniqlash uchun (`pipeline/dedupe.ts`).
   * Bitta so'rov; 50 000 qatorli varaqda ham bir necha yuz KB.
   *
   * `UNFORMATTED_VALUE`: kimdir ШК ni raqam sifatida kiritgan bo'lsa ham
   * `1000076316479` qaytadi, ko'rsatish formatiga (`1E+12`) bog'liq emas.
   */
  async readRowKeys(): Promise<Set<string>> {
    const docCol = SHEET_HEADERS.indexOf('Ид документа');
    const barcodeCol = SHEET_HEADERS.indexOf('ШК');
    const res = await this.#api.spreadsheets.values.get({
      spreadsheetId: this.#opts.spreadsheetId,
      range: `${quote(this.#opts.sheetName)}!A2:${columnLetter(Math.max(docCol, barcodeCol))}`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });

    const keys = new Set<string>();
    for (const row of res.data.values ?? []) {
      const docId = String(row[docCol] ?? '').trim();
      const barcode = String(row[barcodeCol] ?? '').trim();
      if (docId && barcode) keys.add(rowKey(docId, barcode));
    }
    return keys;
  }

  /**
   * Hujjatlarni asosiy varaqqa va diagnostikani `_log` ga qo'shadi.
   *
   * `duplicate` belgili qatorlar asosiy varaqqa yozilmaydi — ular haqida
   * faqat `_log` da `DUPLICATE_ROW` yozuvi qoladi.
   */
  async appendDocuments(documents: readonly InvoiceDocument[]): Promise<AppendResult> {
    const rows: (string | number)[][] = [];
    const logRows: (string | number)[][] = [];
    let flaggedRows = 0;
    let rowsSkipped = 0;

    for (const doc of documents) {
      doc.items.forEach((item, index) => {
        if (item.duplicate) {
          rowsSkipped++;
          if (this.#opts.writeLog) logRows.push(logRow(doc, duplicateIssue(item)));
          return;
        }
        const needsReview = rowNeedsReview(doc, index);
        if (needsReview) flaggedRows++;

        const row: (string | number)[] = [
          doc.docNumber ?? '',
          doc.docId,
          doc.docDate ?? '',
          item.sku ?? '',
          item.itemBarcode,
          item.quantity ?? '',
        ];
        if (this.#opts.flagColumn) row.push(needsReview ? '⚠' : '');
        rows.push(row);
      });

      if (this.#opts.writeLog) {
        for (const issue of doc.issues) logRows.push(logRow(doc, issue));
        for (const item of doc.items) {
          if (item.duplicate) continue;
          for (const issue of item.issues) logRows.push(logRow(doc, issue));
        }
      }
    }

    if (rows.length > 0) await this.#append(this.#opts.sheetName, rows);
    if (logRows.length > 0) await this.#append(LOG_SHEET_NAME, logRows);

    return { rowsAppended: rows.length, logRowsAppended: logRows.length, flaggedRows, rowsSkipped };
  }

  async #hasHeader(sheetName: string): Promise<boolean> {
    try {
      const res = await this.#api.spreadsheets.values.get({
        spreadsheetId: this.#opts.spreadsheetId,
        range: `${quote(sheetName)}!A1:A1`,
      });
      return (res.data.values?.[0]?.[0] ?? '') !== '';
    } catch {
      return false;
    }
  }

  async #createSheet(title: string): Promise<void> {
    await this.#api.spreadsheets.batchUpdate({
      spreadsheetId: this.#opts.spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }

  async #append(sheetName: string, values: (string | number)[][]): Promise<void> {
    await this.#api.spreadsheets.values.append({
      spreadsheetId: this.#opts.spreadsheetId,
      range: `${quote(sheetName)}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }
}

function logRow(doc: InvoiceDocument, issue: Issue): (string | number)[] {
  return [
    doc.scannedAt,
    doc.docId,
    doc.docNumber ?? '',
    issue.rowNumber ?? '',
    issue.field ?? '',
    issue.code,
    issue.severity,
    issue.message,
    doc.pdfPath ?? '',
  ];
}

/** 0 → `A`, 25 → `Z`, 26 → `AA`. */
function columnLetter(index: number): string {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/** Varaq nomida bo'shliq yoki maxsus belgi bo'lsa A1 notatsiyasida qo'shtirnoq kerak. */
function quote(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}
