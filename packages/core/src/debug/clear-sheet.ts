/** Sinov ma'lumotlarini tozalaydi: sarlavha qatorini qoldirib, qolganini o'chiradi. */
import { resolve } from 'node:path';
import { auth as googleAuth, sheets as sheetsApi } from '@googleapis/sheets';
import { loadConfig, loadServiceAccount } from '../config.js';

const config = await loadConfig({ devRoot: resolve(import.meta.dirname, '..', '..', '..', '..') });
const creds = await loadServiceAccount(config.serviceAccountPath);
const auth = new googleAuth.JWT({ email: creds.client_email, key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const api = sheetsApi({ version: 'v4', auth });

for (const sheet of [config.sheetName, '_log']) {
  try {
    const before = await api.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId, range: `'${sheet}'!A:A` });
    const rows = (before.data.values ?? []).length;
    if (rows <= 1) { console.log(`${sheet}: allaqachon bo'sh (${rows} qator)`); continue; }
    await api.spreadsheets.values.clear({
      spreadsheetId: config.spreadsheetId, range: `'${sheet}'!A2:Z${rows}` });
    console.log(`${sheet}: ${rows - 1} ta ma'lumot qatori tozalandi, sarlavha qoldi`);
  } catch (err) {
    console.log(`${sheet}: ${(err as Error).message}`);
  }
}
