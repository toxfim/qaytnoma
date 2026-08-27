/**
 * Sozlamalar oynasi va uning IPC ishlovchilari.
 *
 * Oyna faqat kerak bo'lganda yaratiladi va yopilganda yo'q qilinadi —
 * tray dasturi doimiy oyna saqlashi shart emas.
 */
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServiceAccount, SheetsWriter, type BarcodeerConfig } from '@barcodeer/core';
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
    height: 720,
    title: 'Qaytnoma — sozlamalar',
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

/** IPC ishlovchilari bir marta ro'yxatdan o'tkaziladi. */
function registerHandlers(store: Store, onSave: SaveHandler): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('settings:load', () => {
    const c = store.state.config;
    return {
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

  ipcMain.on('settings:close', () => {
    window?.close();
  });
}
