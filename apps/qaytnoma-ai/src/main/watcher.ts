/**
 * Hot folder kuzatuvi.
 *
 * Skanerning o'z tugmasi bosilganda Epson dasturi fayllarni papkaga yozadi —
 * dastur o'sha papkani kuzatib, avtomatik qayta ishlaydi.
 *
 * Ikkita tuzoq hisobga olingan:
 *   - Skaner faylni BO'LAK-BO'LAK yozadi; yozib bo'lgunicha ochilsa fayl
 *     buzilgan bo'ladi. Shuning uchun `awaitWriteFinish` bilan fayl o'lchami
 *     barqarorlashguncha kutiladi.
 *   - Tarmoq papkasi (SMB) FS hodisalarini bermaydi — bunday yo'l uchun
 *     so'rov (polling) rejimiga o'tiladi.
 *
 * To'plamdagi sahifalar bittalab kelgani uchun ular darhol emas, qisqa
 * "jimlik" oynasidan keyin birgalikda qayta ishlanadi.
 */
import { watch, type FSWatcher } from 'chokidar';

const IMAGE_RE = /\.(bmp|png|jpe?g|tiff?)$/i;

/** Oxirgi fayldan keyin shuncha kutamiz — to'plam tugagan deb hisoblaymiz. */
const BATCH_QUIET_MS = 4000;

export interface WatcherOptions {
  folder: string;
  onBatch: (paths: string[]) => void | Promise<void>;
  onError?: (error: Error) => void;
}

export class HotFolderWatcher {
  #watcher: FSWatcher | null = null;
  #pending: string[] = [];
  #timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: WatcherOptions) {}

  get active(): boolean {
    return this.#watcher !== null;
  }

  start(): void {
    if (this.#watcher) return;

    this.#watcher = watch(this.opts.folder, {
      ignoreInitial: true,
      depth: 1,
      // Tarmoq papkalarida FS hodisalari ishlamaydi.
      usePolling: isNetworkPath(this.opts.folder),
      interval: 1500,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 300 },
    });

    this.#watcher.on('add', (path) => {
      if (!IMAGE_RE.test(path)) return;
      this.#pending.push(path);
      this.#scheduleFlush();
    });

    this.#watcher.on('error', (err) => {
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    });
  }

  async stop(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#pending = [];
    const watcher = this.#watcher;
    this.#watcher = null;
    if (watcher) await watcher.close();
  }

  #scheduleFlush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const batch = this.#pending.sort((a, b) => a.localeCompare(b));
      this.#pending = [];
      if (batch.length > 0) void this.opts.onBatch(batch);
    }, BATCH_QUIET_MS);
  }
}

/** UNC yo'li (`\\server\share`) yoki tarmoq diski. */
function isNetworkPath(path: string): boolean {
  return path.startsWith('\\\\') || path.startsWith('//');
}
