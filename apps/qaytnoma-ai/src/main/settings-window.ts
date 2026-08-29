/**
 * Sozlamalar oynasi va uning IPC ishlovchilari.
 *
 * Asosiy ilovanikidan farqi — Gemini bo'limi va "Modelni tekshirish"
 * tugmasi: kalit to'g'ri ekanini bilishning yagona ishonchli yo'li —
 * haqiqiy so'rov yuborish. So'rov ataylab eng kichigi (bitta qisqa matn),
 * ya'ni tekshiruv deyarli tekin.
 */
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServiceAccount, SheetsWriter, type BarcodeerConfig } from '@barcodeer/core';
import { GeminiClient } from '../gemini/client.js';
import type { Store } from './state.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PRELOAD = join(ROOT, 'dist', 'preload', 'index.cjs');
const PAGE = join(ROOT, 'assets', 'settings.html');

type SaveHandler = (patch: Partial<BarcodeerConfig>) => Promise<void>;

let window: BrowserWindow | null = null;
let registered = false;

export function openSettingsWindow(store: Store, onSave: SaveHandler): void {
  if (window && !window.isDestroyed()) {
    window.show();
    window.focus();
    return;
  }

  registerHandlers(store, onSave);

  window = new BrowserWindow({
    width: 640,
    height: 760,
    title: 'Qaytnoma AI — sozlamalar',
    autoHideMenuBar: true,
    resizable: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.on('closed', () => {
    window = null;
  });

  void window.loadFile(PAGE);
}

function registerHandlers(store: Store, onSave: SaveHandler): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('settings:load', () => {
    const c = store.state.config;
    return {
      geminiApiKey: c.geminiApiKey,
      geminiModel: c.geminiModel,
      spreadsheetId: c.spreadsheetId,
      sheetName: c.sheetName,
      serviceAccountPath: c.serviceAccountPath,
      invoicesRoot: c.invoicesRoot,
      hotFolder: c.hotFolder,
      scanDpi: c.scanDpi,
      scannerName: c.scannerName,
      flagColumn: c.flagColumn,
      catalogueSpreadsheetId: c.catalogueSpreadsheetId,
      catalogueSheetName: c.catalogueSheetName,
      catalogueSkuColumn: c.catalogueSkuColumn,
      catalogueBarcodeColumn: c.catalogueBarcodeColumn,
      catalogueMaxAgeHours: c.catalogueMaxAgeHours,
    };
  });

  ipcMain.handle('settings:save', async (_event, payload: Partial<BarcodeerConfig>) => {
    try {
      await onSave({
        geminiApiKey: (payload.geminiApiKey ?? '').trim(),
        geminiModel: payload.geminiModel || 'gemini-3.1-flash-lite',
        spreadsheetId: payload.spreadsheetId,
        sheetName: payload.sheetName,
        serviceAccountPath: payload.serviceAccountPath,
        invoicesRoot: payload.invoicesRoot,
        hotFolder: payload.hotFolder || null,
        scanDpi: Number(payload.scanDpi),
        scannerName: payload.scannerName,
        flagColumn: Boolean(payload.flagColumn),
        catalogueSpreadsheetId: payload.catalogueSpreadsheetId || null,
        catalogueSheetName: payload.catalogueSheetName,
        catalogueSkuColumn: payload.catalogueSkuColumn,
        catalogueBarcodeColumn: payload.catalogueBarcodeColumn,
        catalogueMaxAgeHours: Number(payload.catalogueMaxAgeHours),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('settings:pickFile', async (_event, title: string) => {
    const result = await dialog.showOpenDialog({
      title,
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('settings:pickFolder', async (_event, title: string) => {
    const result = await dialog.showOpenDialog({
      title,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('settings:testSheets', async () => {
    const c = store.state.config;
    try {
      const writer = new SheetsWriter({
        spreadsheetId: c.spreadsheetId,
        sheetName: c.sheetName,
        credentials: await loadServiceAccount(c.serviceAccountPath),
        flagColumn: c.flagColumn,
      });
      const info = await writer.check();
      const found = info.sheets.includes(c.sheetName);
      return {
        ok: found,
        message: found
          ? `Ulanish muvaffaqiyatli: "${info.title}"`
          : `"${info.title}" ochildi, lekin "${c.sheetName}" varag'i yo'q. Mavjud: ${info.sheets.join(', ')}`,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  ipcMain.handle('settings:testGemini', async () => {
    const c = store.state.config;
    if (!c.geminiApiKey.trim()) return { ok: false, message: 'Kalit kiritilmagan' };
    try {
      const client = new GeminiClient({
        apiKey: c.geminiApiKey,
        model: c.geminiModel,
        attempts: 1,
      });
      // Eng kichik so'rov: rasmsiz, bitta so'z. Kalit va model nomini
      // tekshirish uchun shuncha yetarli.
      const res = await client.ask<{ ok?: boolean }>({
        system: 'Faqat so`ralgan JSON ni qaytaring.',
        prompt: 'ok maydonini true qilib qaytaring.',
        images: [],
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
        maxOutputTokens: 32,
      });
      return {
        ok: res.ok === true,
        message: `Model javob berdi: ${c.geminiModel} (${client.usage.totalTokens} token)`,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  ipcMain.on('settings:close', () => {
    window?.close();
  });
}
