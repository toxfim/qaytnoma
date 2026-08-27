/**
 * WIA orqali skanerlash (Windows).
 *
 * NEGA PowerShell, `winax`/`node-activex` emas: native COM bog'lovchilari
 * node-gyp bilan qurilishni va Electron ABI uchun qayta qurishni talab qiladi.
 * PowerShell skripti esa hech qanday native bog'liqliksiz, Windows'ning o'z
 * WIA 2.0 interfeysiga to'g'ridan-to'g'ri kiradi.
 *
 * Tekshirilgan: EPSON DS-530II, ADF, 600 DPI rangli, 4 sahifa 53 soniyada;
 * qog'oz tugaganda drayver `WIA_ERROR_PAPER_EMPTY (0x80210003)` qaytaradi va
 * sikl shu bilan to'g'ri yakunlanadi.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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
  /** `NO_DEVICE` | `NO_PAPER` | `SCAN_FAILED` | `TIMEOUT` | `SPAWN_FAILED` */
  code: string;
  error: string;
  pages: string[];
}

export type ScanResult = ScanSuccess | ScanFailure;

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * `wia-scan.ps1` yo'li.
 *
 * Manba daraxtida skript `src/` yonidagi `scripts/` da, qurilgandan keyin esa
 * `dist/` yonida bo'ladi — ikkala holatni ham qamraymiz.
 */
function scriptPath(): string {
  return resolve(HERE, '..', 'scripts', 'wia-scan.ps1');
}

/** Mavjud WIA skanerlar ro'yxati. */
export async function listScanners(timeoutMs = 15_000): Promise<string[]> {
  const result = await runScript(['-ListOnly'], timeoutMs);
  if (result.ok && Array.isArray((result.data as { devices?: unknown }).devices)) {
    return (result.data as { devices: string[] }).devices;
  }
  return [];
}

/** ADF dagi barcha varaqlarni skanerlaydi. */
export async function scanBatch(opts: ScanOptions): Promise<ScanResult> {
  const args = [
    '-Dpi',
    String(opts.dpi ?? 600),
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

  // Skanerlash uzoq davom etadi: 600 DPI da sahifasiga ~13 s.
  const result = await runScript(args, opts.timeoutMs ?? 10 * 60_000);
  if (!result.ok) {
    return { ok: false, code: result.code, error: result.error, pages: [] };
  }
  return result.data as ScanResult;
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

/** PowerShell skriptini ishga tushirib, stdout dagi JSON ni qaytaradi. */
function runScript(args: string[], timeoutMs: number): Promise<RunOk | RunErr> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath(), ...args],
      { windowsHide: true },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (value: RunOk | RunErr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: 'TIMEOUT', error: `Skanerlash ${timeoutMs} ms ichida tugamadi` });
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      finish({ ok: false, code: 'SPAWN_FAILED', error: err.message });
    });

    child.on('close', () => {
      // Skript natijani stdout ga BITTA JSON qatori sifatida yozadi;
      // jarayon xabarlari stderr ga ketadi.
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
      if (!line) {
        finish({
          ok: false,
          code: 'SCAN_FAILED',
          error: stderr.trim() || 'Skript hech narsa qaytarmadi',
        });
        return;
      }
      try {
        finish({ ok: true, data: JSON.parse(line) });
      } catch {
        finish({ ok: false, code: 'SCAN_FAILED', error: `JSON tahlil qilinmadi: ${line}` });
      }
    });
  });
}

export { join as joinPath };
