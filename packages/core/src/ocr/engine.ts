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
 *    katalogi: shtrix-kod 100% ishonchli dekodlanadi. OCR faqat katalogda
 *    yo'q mahsulotlar uchun ishlatiladi va bunday qatorlar `needs_review` ga
 *    tushadi.
 *
 *  - `tessdata_best` SINALDI VA ISHLAMADI: tesseract.js ning WASM yadrosida
 *    `DotProductSSE` yo'q, "best" modellar ishga tushmay abort qiladi.
 *
 * WORKER POOL: har rejim uchun bir nechta worker. Tesseract WASM bitta
 * worker ichida ketma-ket ishlaydi; 12 yadroli mashinada 13 qatorli sahifani
 * bitta worker bilan o'qish ~2.4 s edi. Pool o'lchami rejimga qarab: `digits`
 * eng ko'p chaqiriladi (har qator uchun 3 variant), `headerBlock` sahifasiga
 * 4 marta, `latin`/`cyrillic` esa katalog tufayli deyarli chaqirilmaydi.
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
  /** Standart pool o'lchami. */
  pool: number;
}

const SPECS = {
  digits: { langs: 'eng', psm: PSM.SINGLE_WORD, whitelist: '0123456789', pool: 3 },
  // PSM 7 — `Итого` uchun ikkinchi fikr. O'lchov: PSM 8 toza `11` ni `1` deb
  // o'qidi (takrorlangan ingichka glif), PSM 7 esa `11` — ikkalasi birgalikda
  // o'qilib, qatorlar yig'indisiga mos nomzod tanlanadi.
  digitsLine: { langs: 'eng', psm: PSM.SINGLE_LINE, whitelist: '0123456789', pool: 1 },
  date: { langs: 'eng', psm: PSM.SINGLE_LINE, whitelist: '0123456789-: ', pool: 1 },
  // Sarlavha hududi ko'p qatorli. O'lchov: PSM 3 (AUTO) 4 sahifadan 3 tasida
  // sana va ID ni to'g'ri berdi; PSM 11 (SPARSE_TEXT) raqamlarni bo'lak-bo'lak
  // qilib yubordi ("3-0519:3"), PSM 6 esa bitta sahifada umuman bo'sh qaytardi.
  headerBlock: { langs: 'eng', psm: PSM.AUTO, whitelist: '0123456789-: ', pool: 2 },
  latin: { langs: 'eng', psm: PSM.SINGLE_BLOCK, whitelist: LATIN_CHARS, pool: 1 },
  cyrillic: { langs: 'rus', psm: PSM.SINGLE_BLOCK, whitelist: CYRILLIC_CHARS, pool: 1 },
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
  /** Rejim bo'yicha pool o'lchamini almashtirish. */
  poolSizes?: Partial<Record<OcrMode, number>>;
}

/** Bitta worker va uning navbati. */
interface Slot {
  worker: Promise<Worker>;
  /** Navbatda turgan ishlar soni — eng bo'sh worker'ni tanlash uchun. */
  queued: number;
  /** Bitta worker bir vaqtda bitta ish bajaradi — zanjir shuni ta'minlaydi. */
  chain: Promise<unknown>;
}

export class OcrEngine {
  readonly #slots = new Map<OcrMode, Slot[]>();
  readonly #opts: OcrOptions;
  #closed = false;

  constructor(opts: OcrOptions) {
    this.#opts = opts;
  }

  /**
   * Worker'larni oldindan yuklaydi.
   *
   * Til faylini yuklash rejimiga ~0.6 s oladi; tray ilovada bu ishga
   * tushirishda fonda bajariladi, shunda birinchi skanerlash kutmaydi.
   */
  async warmUp(modes: readonly OcrMode[] = ['digits', 'headerBlock']): Promise<void> {
    await Promise.all(modes.map((mode) => Promise.all(this.#pool(mode).map((s) => s.worker))));
  }

  #pool(mode: OcrMode): Slot[] {
    const existing = this.#slots.get(mode);
    if (existing) return existing;

    const spec: WorkerSpec = SPECS[mode];
    const size = Math.max(1, this.#opts.poolSizes?.[mode] ?? spec.pool);
    const slots: Slot[] = [];
    for (let i = 0; i < size; i++) {
      slots.push({ worker: this.#spawn(spec), queued: 0, chain: Promise.resolve() });
    }
    this.#slots.set(mode, slots);
    return slots;
  }

  async #spawn(spec: WorkerSpec): Promise<Worker> {
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
    return worker;
  }

  /** Eng bo'sh worker'ni tanlab, ishni uning navbatiga qo'yadi. */
  #run<T>(mode: OcrMode, job: (worker: Worker) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('OcrEngine yopilgan'));

    const slots = this.#pool(mode);
    let slot = slots[0]!;
    for (const s of slots) if (s.queued < slot.queued) slot = s;

    slot.queued++;
    const result = slot.chain
      .catch(() => {})
      .then(() => slot.worker)
      .then(job)
      .finally(() => {
        slot.queued--;
      });
    slot.chain = result;
    return result;
  }

  /** PNG buferdan matn o'qiydi. */
  read(png: Buffer, mode: OcrMode): Promise<OcrResult> {
    return this.#run(mode, async (worker) => {
      const { data } = await worker.recognize(png);
      return { text: data.text.trim(), confidence: data.confidence };
    });
  }

  /**
   * Bir nechta tayyorlangan variantni PARALLEL o'qib, eng ko'p uchragan
   * natijani qaytaradi. Yakka raqamlarda (`Кол-во`) 94.4% → 97.2%.
   */
  async readVoted(
    variants: readonly (Buffer | null)[],
    mode: OcrMode,
  ): Promise<{ text: string | null; confidence: number; agreement: number }> {
    const reads = await Promise.all(
      variants.filter((v): v is Buffer => v !== null).map((png) => this.read(png, mode)),
    );
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
    this.#closed = true;
    const slots = [...this.#slots.values()].flat();
    this.#slots.clear();
    await Promise.all(slots.map((s) => s.worker.then((w) => w.terminate()).catch(() => {})));
  }
}
