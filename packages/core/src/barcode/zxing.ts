/**
 * ZXing WASM ni LOKAL binary bilan ishga tushirish.
 *
 * Standart holatda `zxing-wasm` `.wasm` faylni jsDelivr CDN'idan yuklaydi —
 * bu offline ishlaydigan desktop dastur uchun yaramaydi. Shu sababli binary
 * `node_modules` ichidan o'qib, modulga to'g'ridan-to'g'ri beriladi.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { prepareZXingModule } from 'zxing-wasm/reader';

let ready: Promise<void> | null = null;

/** `zxing-wasm/dist/reader/zxing_reader.wasm` faylining absolyut yo'li. */
function wasmPath(): string {
  // .../zxing-wasm/dist/es/reader/index.js -> .../zxing-wasm/dist/reader/zxing_reader.wasm
  const entry = fileURLToPath(import.meta.resolve('zxing-wasm/reader'));
  return resolvePath(dirname(entry), '..', '..', 'reader', 'zxing_reader.wasm');
}

/** ZXing modulini bir marta, lokal binary bilan tayyorlaydi. */
export function ensureZXing(): Promise<void> {
  ready ??= (async () => {
    const binary = await readFile(wasmPath());
    prepareZXingModule({
      overrides: {
        wasmBinary: binary.buffer.slice(
          binary.byteOffset,
          binary.byteOffset + binary.byteLength,
        ) as ArrayBuffer,
      },
      fireImmediately: true,
    });
  })();
  return ready;
}
