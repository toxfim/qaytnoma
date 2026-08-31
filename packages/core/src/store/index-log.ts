/**
 * Qayta ishlangan hujjatlar indeksi (JSONL).
 *
 * Ikki vazifasi bor:
 *   - takroriy skanerlashni aniqlash (bir hujjat ikki marta Sheets'ga
 *     tushib qolmasligi uchun ogohlantirish beriladi);
 *   - nima qachon qayta ishlanganini kuzatish.
 *
 * JSONL tanlangani: har bir yozuv mustaqil qator, faylga qo'shib yozish
 * atomar va butun faylni qayta yozish shart emas.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { InvoiceDocument } from '@barcodeer/shared';
import { rowKey } from '../pipeline/dedupe.js';

export interface IndexEntry {
  docId: string;
  docNumber: string | null;
  docDate: string | null;
  scannedAt: string;
  rows: number;
  pdfPath: string | null;
  /** Muammoli qatorlar soni. */
  flagged: number;
  /**
   * Qatorlarning ШК lari — Sheets o'chiq bo'lganda `Ид + ШК` takror
   * tekshiruvi uchun. Eski yozuvlarda yo'q.
   */
  barcodes?: string[];
}

export class DocumentIndex {
  #entries: IndexEntry[] = [];
  #ids = new Set<string>();

  private constructor(private readonly path: string) {}

  static async open(path: string): Promise<DocumentIndex> {
    const index = new DocumentIndex(path);
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return index;
      throw new Error(`Indeksni o'qib bo'lmadi (${path}): ${(err as Error).message}`);
    }

    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as IndexEntry;
        if (entry.docId) {
          index.#entries.push(entry);
          index.#ids.add(entry.docId);
        }
      } catch {
        // Buzilgan qator — o'tkazib yuboramiz, qolgan indeks baribir foydali.
      }
    }
    return index;
  }

  /** Oldin ko'rilgan hujjat ID lari. */
  docIds(): ReadonlySet<string> {
    return this.#ids;
  }

  /** Oldin ko'rilgan `Ид + ШК` juftliklari. Har safar yangi to'plam — o'zgartirish xavfsiz. */
  rowKeys(): Set<string> {
    const keys = new Set<string>();
    for (const entry of this.#entries) {
      for (const barcode of entry.barcodes ?? []) keys.add(rowKey(entry.docId, barcode));
    }
    return keys;
  }

  get size(): number {
    return this.#entries.length;
  }

  /** Oxirgi `n` ta yozuv, yangisidan boshlab. */
  recent(n = 20): IndexEntry[] {
    return this.#entries.slice(-n).reverse();
  }

  async append(documents: readonly InvoiceDocument[]): Promise<void> {
    if (documents.length === 0) return;
    await mkdir(dirname(this.path), { recursive: true });

    const lines: string[] = [];
    for (const doc of documents) {
      const entry: IndexEntry = {
        docId: doc.docId,
        docNumber: doc.docNumber,
        docDate: doc.docDate,
        scannedAt: doc.scannedAt,
        rows: doc.items.length,
        pdfPath: doc.pdfPath ?? null,
        flagged:
          doc.items.filter((i) => i.issues.length > 0).length +
          (doc.issues.some((i) => i.severity === 'error') ? doc.items.length : 0),
        barcodes: doc.items.map((i) => i.itemBarcode).filter(Boolean),
      };
      this.#entries.push(entry);
      if (entry.docId) this.#ids.add(entry.docId);
      lines.push(JSON.stringify(entry));
    }

    await appendFile(this.path, `${lines.join('\n')}\n`, 'utf8');
  }
}
