/**
 * Preload — renderer uchun cheklangan API.
 *
 * `.cts` kengaytmasi ataylab: Electron preload skriptlari CommonJS bo'lishi
 * kerak, loyihaning qolgan qismi esa ESM.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface SettingsPayload {
  geminiApiKey: string;
  geminiModel: string;
  spreadsheetId: string;
  sheetName: string;
  serviceAccountPath: string;
  invoicesRoot: string;
  hotFolder: string | null;
  scanDpi: number;
  scannerName: string;
  flagColumn: boolean;
  catalogueSpreadsheetId: string | null;
  catalogueSheetName: string;
  catalogueSkuColumn: string;
  catalogueBarcodeColumn: string;
  catalogueMaxAgeHours: number;
}

const api = {
  load: (): Promise<SettingsPayload> => ipcRenderer.invoke('settings:load'),
  save: (payload: SettingsPayload): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:save', payload),
  pickFile: (title: string): Promise<string | null> =>
    ipcRenderer.invoke('settings:pickFile', title),
  pickFolder: (title: string): Promise<string | null> =>
    ipcRenderer.invoke('settings:pickFolder', title),
  testSheets: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('settings:testSheets'),
  testGemini: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('settings:testGemini'),
  close: (): void => ipcRenderer.send('settings:close'),
};

contextBridge.exposeInMainWorld('qaytnomaAi', api);

export type QaytnomaAiApi = typeof api;
