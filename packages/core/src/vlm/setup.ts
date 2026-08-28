/**
 * Konfiguratsiyadan Gemini zaxirasini yig'ish.
 *
 * Bitta joyda turishi muhim: CLI ham, tray ilova ham bir xil qoidaga
 * bo'ysunishi kerak — kalit yo'q yoki rejim `off` bo'lsa model umuman
 * yaratilmaydi va quvur o'zgarmagan holda ishlaydi.
 */
import type { BarcodeerConfig } from '../config.js';
import type { VlmOptions } from '../pipeline/extract-page.js';
import { GeminiClient } from './gemini.js';
import { VlmReader } from './reader.js';

export function vlmFromConfig(config: BarcodeerConfig): VlmOptions | undefined {
  if (config.geminiMode === 'off') return undefined;
  if (!config.geminiApiKey.trim()) return undefined;

  const client = new GeminiClient({
    apiKey: config.geminiApiKey.trim(),
    model: config.geminiModel,
    // Katak o'qish mulohaza talab qilmaydi — eng past daraja.
    thinkingLevel: 'low',
  });

  return {
    reader: new VlmReader(client),
    mode: config.geminiMode,
    // OCR variantlari to'liq kelishmagan katak ham shubhali hisoblanadi:
    // o'lchovda `Кол-во` xatolarining aksariyati aynan shu holatda edi.
    minAgreement: 1,
  };
}
