/**
 * Preload — renderer uchun cheklangan API.
 *
 * `.cts` kengaytmasi ataylab: Electron preload skriptlari CommonJS bo'lishi
 * kerak, loyihaning qolgan qismi esa ESM. TypeScript `NodeNext` rejimida
 * `.cts` ni `.cjs` ga o'giradi va bu ikki dunyoni muammosiz bog'laydi.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface SettingsPayload {
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
  pickFile: (title: string): Promise<string | null> => ipcRenderer.invoke('settings:pickFile', title),
  pickFolder: (title: string): Promise<string | null> =>
    ipcRenderer.invoke('settings:pickFolder', title),
  testSheets: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('settings:testSheets'),
  close: (): void => ipcRenderer.send('settings:close'),
};

contextBridge.exposeInMainWorld('barcodeer', api);

export type BarcodeerApi = typeof api;
