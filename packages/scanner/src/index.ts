/**
 * WIA orqali skanerlash (Windows).
 *
 * NEGA PowerShell, `winax`/`node-activex` emas: native COM bog'lovchilari
 * node-gyp bilan qurilishni va Electron ABI uchun qayta qurishni talab qiladi.
 * PowerShell skripti esa hech qanday native bog'liqliksiz, Windows'ning o'z
 * WIA 2.0 interfeysiga to'g'ridan-to'g'ri kiradi.
 *
 * Tekshirilgan: EPSON DS-530II, ADF, rangli; qog'oz tugaganda drayver
 * `WIA_ERROR_PAPER_EMPTY (0x80210003)` qaytaradi va sikl shu bilan to'g'ri
 * yakunlanadi. O'lchangan tezlik: 600 DPI da ~12.8 s/sahifa.
 *
 * OQIM REJIMI (`scanStream`): skript har sahifani saqlagach stdout ga
 * `{"event":"page",...}` qatorini yozadi. Node shu zahoti sahifani qayta
 * ishlashni boshlaydi — skaner keyingi varaqni o'qiyotgan paytda. Shunda
 * to'plamning umumiy vaqti "skan + qayta ishlash" emas, ikkalasidan
 * kattasiga yaqin bo'ladi.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

/** Skanerlashda rang SHART: ko'k qo'lyozmani ajratish uchun RGB kerak. */
export const WIA_DATATYPE_COLOR = 3;

export interface ScanOptions {
  /** Skanerlash ruxsati (DPI). */
  dpi?: number;
  /** Sahifalar saqlanadigan papka. */
  outDir: string;
  /** Qurilma nomining bir qismi, masalan `DS-530`. Bo'sh bo'lsa birinchi skaner. */
  deviceName?: string;
  /** Maksimal sahifalar soni (himoya chegarasi). */
  maxPages?: number;
  /** Jarayon uchun vaqt chegarasi (ms). */
  timeoutMs?: number;
  /**
   * Oraliq holat xabarlari (masalan "Skaner band - kutilmoqda").
   *
   * Qurilma band bo'lsa skript uni bir necha daqiqagacha kutadi; busiz
   * ilova shu vaqt davomida sababsiz "bajarilmoqda" holatida qotib turadi.
   */
  onStatus?: (message: string) => void;
  /**
   * Skript hech narsa yozmasa qancha kutiladi (ms).
   *
   * NEGA: `Transfer` COM chaqiruvi qurilma qotib qolganda MANGU bloklanadi —
   * o'lchangan holat: qurilma USB da "OK", ADF sensori "qog'oz bor", lekin
   * Transfer 6 daqiqada ham qaytmadi. Umumiy `timeoutMs` (10 daqiqa) bunday
   * paytda juda kech: foydalanuvchi sababini bilmay kutib o'tiradi. 300 DPI
   * da bitta sahifa ~5-13 s, band bo'lsa esa skript har ~11 s da holat
   * xabarini yozadi — shuning uchun 2 daqiqalik jimlik nosozlik demakdir.
   */
  idleTimeoutMs?: number;
}

export interface ScanSuccess {
  ok: true;
  device: string;
  dpi: number;
  format: string;
  width: number;
  height: number;
  pages: string[];
  elapsedMs: number;
}

export interface ScanFailure {
  ok: false;
  /**
   * `NO_DEVICE` | `NO_PAPER` | `DEVICE_BUSY` | `NO_RESPONSE` | `SCAN_FAILED`
   * | `SCRIPT_MISSING` | `TIMEOUT` | `SPAWN_FAILED`
   */
  code: string;
  error: string;
  pages: string[];
}

export type ScanResult = ScanSuccess | ScanFailure;

/** Skript stdout ga yozadigan oraliq hodisalar. */
interface PageEvent {
  event: 'page';
  index: number;
  path: string;
}

interface StatusEvent {
  event: 'status';
  message: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * `wia-scan.ps1` yo'li.
 *
 * Manba daraxtida skript `src/` yonidagi `scripts/` da, qurilgandan keyin esa
 * `dist/` yonida bo'ladi — ikkala holatni ham qamraymiz.
 *
 * PAKETLANGAN ILOVA — ASAR TUZOG'I: Electron ichida bu yo'l `app.asar`
 * ichiga tushadi. Node uchun u oddiy papkadek ko'rinadi (fs shim), ammo
 * `powershell.exe` — tashqi jarayon — arxiv ichini umuman ocholmaydi va
 * "The argument ... to the -File parameter does not exist" deb tugaydi.
 * Skaner umuman qo'zg'almaydi. Shuning uchun skript `asarUnpack` bilan
 * `app.asar.unpacked` ga chiqariladi (`electron-builder.yml`) va yo'l shu
 * papkaga yo'naltiriladi. Ikkalasi birga bo'lishi shart: faqat bittasi
 * qilinsa, paketlangan ilovada skanerlash ishlamaydi.
 */
function scriptPath(): string {
  const path = resolve(HERE, '..', 'scripts', 'wia-scan.ps1');
  return path.split(`${sep}app.asar${sep}`).join(`${sep}app.asar.unpacked${sep}`);
}

/** Mavjud WIA skanerlar ro'yxati. */
export async function listScanners(timeoutMs = 15_000): Promise<string[]> {
  const result = await runScript(['-ListOnly'], timeoutMs, () => {});
  if (result.ok && Array.isArray((result.data as { devices?: unknown }).devices)) {
    return (result.data as { devices: string[] }).devices;
  }
  return [];
}

function scanArgs(opts: ScanOptions): string[] {
  const args = [
    '-Dpi',
    String(opts.dpi ?? 300),
    '-OutDir',
    opts.outDir,
    '-DataType',
    String(WIA_DATATYPE_COLOR),
    '-Format',
    'BMP',
    '-MaxPages',
    String(opts.maxPages ?? 200),
  ];
  if (opts.deviceName) args.push('-DeviceName', opts.deviceName);
  return args;
}

/** ADF dagi barcha varaqlarni skanerlaydi va hammasi tugagach qaytaradi. */
export async function scanBatch(opts: ScanOptions): Promise<ScanResult> {
  const result = await runScript(
    scanArgs(opts),
    opts.timeoutMs ?? 10 * 60_000,
    () => {},
    opts.onStatus,
    opts.idleTimeoutMs,
  );
  if (!result.ok) {
    return { ok: false, code: result.code, error: result.error, pages: [] };
  }
  return result.data as ScanResult;
}

export interface ScanStream {
  /** Sahifa yo'llari — har biri fayl diskka to'liq yozilgach keladi. */
  pages: AsyncIterable<string>;
  /** Skanerlash tugagach yakuniy natija. */
  result: Promise<ScanResult>;
}

/**
 * Skanerlashni boshlaydi va sahifalarni tayyor bo'lishi bilan uzatadi.
 *
 * `pages` ni `for await` bilan o'qish mumkin; iteratsiya skanerlash tugab,
 * barcha sahifalar uzatilgach yakunlanadi. Xato bo'lsa iteratsiya jim
 * tugaydi — sababini `result` dan oling.
 */
export function scanStream(opts: ScanOptions): ScanStream {
  const queue: string[] = [];
  let done = false;
  let wake: (() => void) | null = null;

  const push = (path: string) => {
    queue.push(path);
    wake?.();
  };
  const finish = () => {
    done = true;
    wake?.();
  };

  const result = runScript(
    scanArgs(opts),
    opts.timeoutMs ?? 10 * 60_000,
    push,
    opts.onStatus,
    opts.idleTimeoutMs,
  ).then((r): ScanResult => {
    finish();
    if (!r.ok) return { ok: false, code: r.code, error: r.error, pages: [] };
    return r.data as ScanResult;
  });

  const pages: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        if (done) return;
        await new Promise<void>((r) => {
          wake = r;
        });
        wake = null;
      }
    },
  };

  return { pages, result };
}

interface RunOk {
  ok: true;
  data: unknown;
}
interface RunErr {
  ok: false;
  code: string;
  error: string;
}

/**
 * PowerShell skriptini ishga tushiradi.
 *
 * stdout qator-qator o'qiladi: `event:"page"` qatorlari `onPage` ga uzatiladi,
 * oxirgi (`ok` maydonli) qator esa yakuniy natija. Jarayon xabarlari stderr da.
 */
function runScript(
  args: string[],
  timeoutMs: number,
  onPage: (path: string) => void,
  onStatus: (message: string) => void = () => {},
  idleTimeoutMs = 2 * 60_000,
): Promise<RunOk | RunErr> {
  return new Promise((resolvePromise) => {
    // Skript yo'qligini o'zimiz aniqlaymiz: aks holda PowerShell ning
    // ingliz tilidagi "-File parameter does not exist" xabari foydalanuvchiga
    // "skanerlash bajarilmadi" deb ko'rsatiladi va sabab noma'lum qoladi.
    const script = scriptPath();
    if (!existsSync(script)) {
      resolvePromise({
        ok: false,
        code: 'SCRIPT_MISSING',
        error: `Skanerlash skripti topilmadi: ${script}`,
      });
      return;
    }

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      { windowsHide: true },
    );

    let pending = '';
    let final: unknown = null;
    let stderr = '';
    let settled = false;

    const finish = (value: RunOk | RunErr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      resolvePromise(value);
    };

    // `child.kill()` faqat powershell.exe ni to'xtatadi; u tug'dirgan
    // jarayonlar (WIA yordamchilari) qolib ketishi mumkin, ular esa qurilmani
    // band deb ushlab turadi. `taskkill /T` butun daraxtni oladi.
    const killTree = () => {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).on(
        'error',
        () => child.kill(),
      );
    };

    const timer = setTimeout(() => {
      killTree();
      finish({ ok: false, code: 'TIMEOUT', error: `Skanerlash ${timeoutMs} ms ichida tugamadi` });
    }, timeoutMs);

    // Jimlik nazoratchisi: skriptning HAR QANDAY chiqishi (sahifa, holat
    // xabari yoki stderr jurnali) uni qaytadan boshlaydi.
    let idleTimer: NodeJS.Timeout = setTimeout(onIdle, idleTimeoutMs);
    function onIdle(): void {
      killTree();
      finish({
        ok: false,
        code: 'NO_RESPONSE',
        error: `Skaner ${Math.round(idleTimeoutMs / 1000)} s davomida javob bermadi`,
      });
    }
    const bump = () => {
      if (settled) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(onIdle, idleTimeoutMs);
    };

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const event = (parsed as { event?: string }).event;
      if (event === 'page') {
        onPage((parsed as PageEvent).path);
      } else if (event === 'status') {
        onStatus((parsed as StatusEvent).message);
      } else {
        final = parsed;
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bump();
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      bump();
      stderr += chunk;
    });

    child.on('error', (err) => {
      finish({ ok: false, code: 'SPAWN_FAILED', error: err.message });
    });

    child.on('close', () => {
      if (pending) handleLine(pending);
      if (final === null) {
        finish({
          ok: false,
          code: 'SCAN_FAILED',
          error: stderr.trim() || 'Skript hech narsa qaytarmadi',
        });
        return;
      }
      finish({ ok: true, data: final });
    });
  });
}

export { join as joinPath };
