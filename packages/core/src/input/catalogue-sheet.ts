/**
 * Uzum katalogini Google Sheets'dan o'qish.
 *
 * Manba: foydalanuvchining "Finance" jadvalidagi `Остаток Узум` varag'i.
 * Faqat ikkita ustun kerak — `Скю` va `Баркод` — shuning uchun butun varaqni
 * emas (47 ustun x 23 000 qator), `batchGet` bilan aynan shu ikki ustun
 * olinadi: ~2 s va bir necha megabayt o'rniga bir necha yuz kilobayt.
 */
import { auth as googleAuth, sheets as sheetsApi } from '@googleapis/sheets';
import type { SheetsCredentials } from '../output/sheets.js';

export interface CatalogueSource {
  spreadsheetId: string;
  sheetName: string;
  /** `Скю` ustuni harfi, masalan `B`. */
  skuColumn: string;
  /** `Баркод` ustuni harfi, masalan `G`. */
  barcodeColumn: string;
  /** Sarlavha qatorlari soni (ular o'tkazib yuboriladi). */
  headerRows?: number;
}

export interface CatalogueFetchResult {
  entries: Map<string, string>;
  /** O'qilgan qatorlar soni. */
  rowsRead: number;
  /** Shtrix-kodi yoki SKU si bo'sh bo'lgani uchun tashlangan qatorlar. */
  skipped: number;
  /** Bir xil shtrix-kod turli SKU larga ishora qilgan holatlar. */
  conflicts: string[];
}

/** Katalogni o'qib, `barkod → SKU` xaritasini qaytaradi. */
export async function fetchCatalogue(
  source: CatalogueSource,
  credentials: SheetsCredentials,
): Promise<CatalogueFetchResult> {
  const auth = new googleAuth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const api = sheetsApi({ version: 'v4', auth });

  const firstRow = (source.headerRows ?? 1) + 1;
  const sheet = quote(source.sheetName);
  const res = await api.spreadsheets.values.batchGet({
    spreadsheetId: source.spreadsheetId,
    ranges: [
      `${sheet}!${source.skuColumn}${firstRow}:${source.skuColumn}`,
      `${sheet}!${source.barcodeColumn}${firstRow}:${source.barcodeColumn}`,
    ],
  });

  const skus = flatten(res.data.valueRanges?.[0]?.values);
  const barcodes = flatten(res.data.valueRanges?.[1]?.values);

  const entries = new Map<string, string>();
  const conflicts: string[] = [];
  let skipped = 0;

  const rows = Math.min(skus.length, barcodes.length);
  for (let i = 0; i < rows; i++) {
    const barcode = barcodes[i]!;
    const sku = skus[i]!;

    // Shtrix-kod 13 xonali bo'lishi shart — jadvalda bo'sh yoki xizmat
    // qatorlari uchraydi.
    if (!/^\d{13}$/.test(barcode) || !sku) {
      skipped++;
      continue;
    }

    const existing = entries.get(barcode);
    if (existing && existing !== sku) {
      // Ziddiyat: birinchi uchraganini qoldiramiz, lekin xabar beramiz.
      if (conflicts.length < 20) conflicts.push(`${barcode}: "${existing}" / "${sku}"`);
      continue;
    }
    entries.set(barcode, sku);
  }

  return { entries, rowsRead: rows, skipped, conflicts };
}

function flatten(values: unknown[][] | null | undefined): string[] {
  return (values ?? []).map((row) => String(row?.[0] ?? '').trim());
}

function quote(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}
