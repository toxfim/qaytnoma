/**
 * Sahifalarni hujjatlarga guruhlash.
 *
 * `CLAUDE.md` da ta'kidlanganidek, guruhlashni sahifa MAZMUNIDAN chiqarib
 * bo'lmaydi: davomi sahifalarida sarlavha ham, hujjat shtrix-kodi ham yo'q,
 * qator raqamlari esa oldingi sahifadan davom etadi.
 *
 * Yagona ishonchli belgi — sahifa turi: mahsulot jadvali sahifaning pastroq
 * qismidan boshlansa (sarlavha bloklari uchun joy qoldirilgan), bu yangi
 * hujjatning birinchi sahifasi. Bu geometrik mezon o'lchangan: sarlavha
 * sahifalari 32.7% / 33.2% / 33.4%, davomi sahifasi 2.1%.
 */
import type { InvoiceDocument, LineItem, ScanPage } from '@barcodeer/shared';
import type { PageExtraction } from './extract-page.js';

export interface GroupResult {
  documents: InvoiceDocument[];
  /** Birinchi sahifa sarlavhasiz bo'lsa — oldingi hujjatga bog'lab bo'lmaydi. */
  orphanPages: ScanPage[];
}

export interface GroupOptions {
  /** Skanerlash vaqti (barcha hujjatlar uchun bir xil). */
  scannedAt?: Date;
}

export function groupIntoDocuments(
  pages: PageExtraction[],
  options: GroupOptions = {},
): GroupResult {
  const scannedAt = (options.scannedAt ?? new Date()).toISOString();
  const documents: InvoiceDocument[] = [];
  const orphanPages: ScanPage[] = [];

  let current: InvoiceDocument | null = null;

  for (const page of pages) {
    const scanPage: ScanPage = {
      index: page.pageIndex,
      path: page.path,
      width: page.width,
      height: page.height,
      // Ishchi o'lcham ~300 DPI A4 ga to'g'ri keladi.
      dpi: 300,
    };

    if (page.isHeaderPage) {
      current = {
        docId: page.docId ?? '',
        docNumber: page.docNumber,
        docDate: page.docDate,
        pages: [scanPage],
        items: [],
        totals: { quantity: page.totals.quantity, sum: page.totals.sum },
        issues: [],
        docIdMismatch: page.docIdMismatch,
        scannedAt,
      };
      documents.push(current);
    } else if (current) {
      current.pages.push(scanPage);
      // Davomi sahifasida `Итого` takrorlanadi. Sarlavha sahifasida u
      // o'qilmagan bo'lsa (masalan kesilgan), davomidagisidan to'ldiramiz.
      current.totals.quantity ??= page.totals.quantity;
      current.totals.sum ??= page.totals.sum;
    } else {
      // Birinchi sahifa davomi bo'lib chiqdi — to'plam oldingi skandan
      // uzilib qolgan yoki sarlavha sahifasi tanilmadi.
      orphanPages.push(scanPage);
      continue;
    }

    for (const row of page.rows) {
      const item: LineItem = {
        rowNumber: null,
        sku: row.sku,
        itemBarcode: row.itemBarcode,
        quantity: row.quantity,
        quantityRaw: row.quantityRaw,
        pageIndex: page.pageIndex,
        issues: [],
      };
      // Manba belgisi validatsiyaga o'tadi: model o'qigan qiymat
      // tekshiruvga belgilanadi.
      if (row.quantitySource) item.quantitySource = row.quantitySource;
      if (row.skuSource) item.skuSource = row.skuSource;
      current!.items.push(item);
    }
  }

  // Qator raqamlarini hujjat bo'ylab ketma-ket qo'yamiz — hujjatdagi `№`
  // ustuni ham aynan shunday ishlaydi (davomi sahifasida 14 dan boshlanadi).
  for (const doc of documents) {
    doc.items.forEach((item, index) => {
      item.rowNumber = index + 1;
    });
  }

  return { documents, orphanPages };
}
