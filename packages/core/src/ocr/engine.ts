/**
 * Tesseract.js ustidagi qatlam — real skanlarda o'lchangan sozlamalar bilan.
 *
 * Har bir qaror 36 ta ground-truth katakda o'lchangan (`docs/OCR-BENCHMARK.md`):
 *
 *  - `Кол-во`: PSM 8 (SINGLE_WORD) + mazmun bo'yicha qirqish + uchta
 *    tayyorgarlik varianti bo'yicha ovoz berish → 97.2%.
 *    PSM 7 → 88.9%, PSM 13 → 25%. Qirqishsiz PSM 8 → 25%.
 *
 *  - `SKU товара`: IKKI O'TISH. `rus+eng` bitta o'tishda atigi 13.9% beradi,
 *    chunki kirill va lotin ko'rinishi bir xil harflar (С/C, Е/E, Р/P, В/B,
 *    Н/H) doimiy adashadi. Uzum SKU tuzilishi qat'iy — 1 va 2-segment lotin,
 *    3-segment (rang) kirill, keyingilari lotin — shuning uchun lotin
 *    whitelist'i bilan bir marta, kirill whitelist'i bilan yana bir marta
 *    o'qib, segmentlarni birlashtiramiz → 47.2%.
 *
 *    47% yetarli emas, shuning uchun SKU ning ASOSIY manbai — `ШК → СКУ`
 *    lug'ati (`SkuDictionary`): shtrix-kod 100% ishonchli dekodlanadi, demak
 *    bir marta tasdiqlangan SKU keyin har doim to'g'ri bo'ladi. OCR faqat
 *    lug'atda yo'q mahsulotlar uchun taklif sifatida ishlatiladi va bunday
 *    qatorlar `needs_review` ga tushadi.
 *
 *  - `tessdata_best` SINALDI VA ISHLAMADI: tesseract.js ning WASM yadrosida
 *    `DotProductSSE` yo'q, "best" modellar ishga tushmay abort qiladi.
 *
 * Til fayllari lokal `langPath` dan o'qiladi — dastur offline ishlashi kerak.
 */
import { createWorker, PSM, type Worker } from 'tesseract.js';

/** Lotin segmentlari uchun belgilar. */
const LATIN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-';
/** Kirill (rang) segmenti uchun belgilar. */
const CYRILLIC_CHARS = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ-';

interface WorkerSpec {
  langs: string;
  psm: PSM;
  whitelist: string;
}

const SPECS = {
  digits: { langs: 'eng', psm: PSM.SINGLE_WORD, whitelist: '0123456789' },
  date: { langs: 'eng', psm: PSM.SINGLE_LINE, whitelist: '0123456789-: ' },
  // Sarlavha hududi ko'p qatorli. O'lchov: PSM 3 (AUTO) 4 sahifadan 3 tasida
  // sana va ID ni to'g'ri berdi; PSM 11 (SPARSE_TEXT) raqamlarni bo'lak-bo'lak
  // qilib yubordi ("3-0519:3"), PSM 6 esa bitta sahifada umuman bo'sh qaytardi.
  headerBlock: { langs: 'eng', psm: PSM.AUTO, whitelist: '0123456789-: ' },
  latin: { langs: 'eng', psm: PSM.SINGLE_BLOCK, whitelist: LATIN_CHARS },
  cyrillic: { langs: 'rus', psm: PSM.SINGLE_BLOCK, whitelist: CYRILLIC_CHARS },
} as const satisfies Record<string, WorkerSpec>;

export type OcrMode = keyof typeof SPECS;

export interface OcrResult {
  text: string;
  /** 0..100 — Tesseract'ning o'z ishonch bahosi. */
  confidence: number;
}

export interface OcrOptions {
  /** `*.traineddata.gz` fayllari joylashgan papka. */
  langPath: string;
  /** Yuklab olingan tillar keshi (ko'rsatilmasa `langPath`). */
  cachePath?: string;
}

export class OcrEngine {
  readonly #workers = new Map<OcrMode, Worker>();
  readonly #pending = new Map<OcrMode, Promise<Worker>>();
  readonly #opts: OcrOptions;

  constructor(opts: OcrOptions) {
    this.#opts = opts;
  }

  async #worker(mode: OcrMode): Promise<Worker> {
    const ready = this.#workers.get(mode);
    if (ready) return ready;

    // Bir vaqtda bir necha chaqiruv kelsa, worker faqat bir marta yaratilsin.
    const inflight = this.#pending.get(mode);
    if (inflight) return inflight;

    const spec: WorkerSpec = SPECS[mode];
    const creating = (async () => {
      const worker = await createWorker(spec.langs, 1, {
        langPath: this.#opts.langPath,
        cachePath: this.#opts.cachePath ?? this.#opts.langPath,
        gzip: true,
        logger: () => {},
        errorHandler: () => {},
      });
      await worker.setParameters({
        tessedit_pageseg_mode: spec.psm,
        tessedit_char_whitelist: spec.whitelist,
      });
      this.#workers.set(mode, worker);
      this.#pending.delete(mode);
      return worker;
    })();

    this.#pending.set(mode, creating);
    return creating;
  }

  /** PNG buferdan matn o'qiydi. */
  async read(png: Buffer, mode: OcrMode): Promise<OcrResult> {
    const worker = await this.#worker(mode);
    const { data } = await worker.recognize(png);
    return { text: data.text.trim(), confidence: data.confidence };
  }

  /**
   * Bir nechta tayyorlangan variantni o'qib, eng ko'p uchragan natijani
   * qaytaradi. Yakka raqamlarda (`Кол-во`) 94.4% → 97.2% ga ko'taradi.
   */
  async readVoted(
    variants: readonly (Buffer | null)[],
    mode: OcrMode,
  ): Promise<{ text: string | null; confidence: number; agreement: number }> {
    const reads: OcrResult[] = [];
    for (const png of variants) {
      if (!png) continue;
      reads.push(await this.read(png, mode));
    }
    if (reads.length === 0) return { text: null, confidence: 0, agreement: 0 };

    const tally = new Map<string, { count: number; confidence: number }>();
    for (const r of reads) {
      const entry = tally.get(r.text);
      if (entry) {
        entry.count++;
        entry.confidence = Math.max(entry.confidence, r.confidence);
      } else {
        tally.set(r.text, { count: 1, confidence: r.confidence });
      }
    }

    let bestText = reads[0]!.text;
    let best = { count: 0, confidence: 0 };
    for (const [text, entry] of tally) {
      if (entry.count > best.count) {
        best = entry;
        bestText = text;
      }
    }

    return {
      text: bestText || null,
      confidence: best.confidence,
      agreement: best.count / reads.length,
    };
  }

  async close(): Promise<void> {
    const workers = [...this.#workers.values()];
    this.#workers.clear();
    this.#pending.clear();
    await Promise.all(workers.map((w) => w.terminate()));
  }
}
