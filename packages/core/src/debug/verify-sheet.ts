import { resolve } from 'node:path';
import { auth as googleAuth, sheets as sheetsApi } from '@googleapis/sheets';
import { loadConfig, loadServiceAccount } from '../config.js';

const config = await loadConfig({ devRoot: resolve(import.meta.dirname, '..', '..', '..', '..') });
const creds = await loadServiceAccount(config.serviceAccountPath);
const auth = new googleAuth.JWT({ email: creds.client_email, key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const api = sheetsApi({ version: 'v4', auth });

for (const sheet of [config.sheetName, '_log']) {
  const res = await api.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId, range: `'${sheet}'!A1:I8`,
  });
  const rows = res.data.values ?? [];
  console.log(`\n═══ ${sheet} (birinchi ${rows.length} qator) ═══`);
  for (const r of rows) console.log('  ' + r.map(c => String(c ?? '').slice(0, 24).padEnd(16)).join('│'));
  const all = await api.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId, range: `'${sheet}'!A:A`,
  });
  console.log(`  jami qatorlar: ${(all.data.values ?? []).length}`);
}
