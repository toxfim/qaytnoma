/**
 * Qaytnoma AI — Windows tray dasturi.
 *
 * Asosiy `Qaytnoma` ilovasi bilan bir xil ishlaydi (tray, yoqish/o'chirish,
 * "Skanerlash" tugmasi, kuzatiladigan papka), farqi bitta: sahifani
 * deterministik quvur emas, Gemini o'qiydi.
 *
 * IKKALASI BIR VAQTDA ISHLASHI MUMKIN: sozlamalar va ma'lumotlar boshqa
 * papkada (`%APPDATA%/qaytnoma-ai`), tray ikonkasi boshqa rangda, bitta
 * nusxa qulfi ham alohida. Shu sababli ikkita natijani yonma-yon
 * solishtirish mumkin.
 */
import {
  app,
  dialog,
  Menu,
  nativeImage,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveConfig, type BarcodeerConfig } from '@barcodeer/core';
import { isAiConfigured, loadAiConfig, missingAiSettings, repoRoot } from '../config.js';
import { formatUsd } from '../gemini/cost.js';
import { JobRunner } from './jobs.js';
import { openSettingsWindow } from './settings-window.js';
import { showErrorDialog } from './error-dialog.js';
import { Store, type AppState, type LastRun, type Status } from './state.js';
import { HotFolderWatcher } from './watcher.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const ASSETS = join(ROOT, 'assets');

let tray: Tray | null = null;
let store: Store;
let jobs: JobRunner;
let watcher: HotFolderWatcher | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => tray?.popUpContextMenu());
  void main();
}

async function main(): Promise<void> {
  await app.whenReady();
  app.on('window-all-closed', () => {});

  let config: BarcodeerConfig;
  try {
    config = await loadAiConfig({
      // Ishlab chiqishda `.env` repo ildizidan o'qiladi.
      ...(ROOT.includes('apps') ? { devRoot: repoRoot(ROOT) } : {}),
    });
  } catch (err) {
    dialog.showErrorBox(
      'Sozlamalar xatosi',
      `Konfiguratsiyani yuklab bo'lmadi:\n\n${(err as Error).message}`,
    );
    app.quit();
    return;
  }

  store = new Store(config);
  jobs = new JobRunner(store);

  tray = new Tray(iconFor('off'));
  tray.setToolTip('Qaytnoma AI');
  store.subscribe(render);

  applyAutoLaunch(config);
  await applyWatcher(config);
  render(store.state);

  if (!isAiConfigured(config)) openSettingsWindow(store, onConfigSaved);
  tray.on('click', () => tray?.popUpContextMenu());
}

function render(state: AppState): void {
  if (!tray) return;
  tray.setImage(iconFor(state.status));
  tray.setToolTip(tooltip(state));
  tray.setContextMenu(Menu.buildFromTemplate(buildMenu(state)));
}

function buildMenu(state: AppState): MenuItemConstructorOptions[] {
  const { config, status, activity, lastRun } = state;
  const ready = isAiConfigured(config);

  const items: MenuItemConstructorOptions[] = [
    {
      label: 'Yoqilgan',
      type: 'checkbox',
      checked: config.enabled,
      click: (item) => void toggleEnabled(item.checked),
    },
    { type: 'separator' },
    {
      label: status === 'busy' ? (activity ?? 'Bajarilmoqda…') : 'Skanerlash',
      enabled: config.enabled && status !== 'busy' && ready,
      click: () => void jobs.scanAndProcess(),
    },
    { label: `Model: ${config.geminiModel}`, enabled: false },
  ];

  if (!ready) {
    items.push({ label: `Sozlash kerak: ${missingAiSettings(config).join(', ')}`, enabled: false });
  }

  if (lastRun) {
    items.push({ type: 'separator' });
    const error = lastRun.error;
    items.push({
      label: error ? `${summarize(lastRun)} — batafsil` : summarize(lastRun),
      enabled: Boolean(error),
      click: error
        ? () =>
            void showErrorDialog(
              lastRun.documents > 0
                ? 'Oxirgi skanerlashdagi ogohlantirish'
                : 'Oxirgi ish bajarilmadi',
              error,
            )
        : undefined,
    });
  }

  items.push(
    { type: 'separator' },
    {
      label: 'Katalogni yangilash',
      enabled: config.enabled && status !== 'busy' && ready && !!config.catalogueSpreadsheetId,
      click: () => void jobs.syncCatalogue(),
    },
    { label: 'Hujjatlar papkasi', click: () => void shell.openPath(config.invoicesRoot) },
    {
      label: 'Google Sheets',
      enabled: Boolean(config.spreadsheetId),
      click: () =>
        void shell.openExternal(
          `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`,
        ),
    },
    { type: 'separator' },
    { label: 'Sozlamalar…', click: () => openSettingsWindow(store, onConfigSaved) },
    {
      label: app.isPackaged
        ? 'Ishga tushganda ochilsin'
        : 'Ishga tushganda ochilsin (faqat o`rnatilgan dasturda)',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: isAutoLaunchEnabled(),
      click: (item) => void toggleAutoLaunch(item.checked),
    },
    { type: 'separator' },
    { label: 'Chiqish', click: () => app.quit() },
  );

  return items;
}

function summarize(run: LastRun): string {
  if (run.error && run.documents === 0) return trim(`Xato: ${run.error}`);
  return (
    `${run.documents} hujjat, ${run.rows} qator` +
    (run.skipped ? `, ${run.skipped} takror` : '') +
    (run.flagged ? `, ${run.flagged} ⚠` : '') +
    ` · ${formatUsd(run.usd)}`
  );
}

function trim(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function tooltip(state: AppState): string {
  if (state.status === 'busy') return `Qaytnoma AI — ${state.activity ?? 'bajarilmoqda'}`;
  if (state.status === 'off') return 'Qaytnoma AI — o`chirilgan';
  if (state.status === 'error') return `Qaytnoma AI — ${state.lastRun?.error ?? 'xato'}`;
  return 'Qaytnoma AI — tayyor';
}

async function toggleEnabled(enabled: boolean): Promise<void> {
  const config = store.patchConfig({ enabled });
  await saveConfig(config).catch(() => {});
  await applyWatcher(config);
}

async function onConfigSaved(patch: Partial<BarcodeerConfig>): Promise<void> {
  const config = store.patchConfig(patch);
  await saveConfig(config);
  await applyWatcher(config);
}

/**
 * Kuzatiladigan papkani sozlamaga moslaydi.
 *
 * Papka o'zgarganda yoki dastur o'chirilganda kuzatuv to'xtatiladi —
 * o'chirilgan dastur hech narsa qilmasligi kerak.
 */
async function applyWatcher(config: BarcodeerConfig): Promise<void> {
  const shouldWatch = config.enabled && Boolean(config.hotFolder) && isAiConfigured(config);
  if (watcher) {
    await watcher.stop();
    watcher = null;
  }
  if (!shouldWatch || !config.hotFolder) {
    store.update({ watching: false });
    return;
  }

  watcher = new HotFolderWatcher({
    folder: config.hotFolder,
    onBatch: (paths) => jobs.ingest(paths),
    onError: (err) => store.update({ status: 'error', activity: err.message }),
  });
  watcher.start();
  store.update({ watching: true });
}

function isAutoLaunchEnabled(): boolean {
  return app.isPackaged && app.getLoginItemSettings().openAtLogin;
}

function applyAutoLaunch(config: BarcodeerConfig): void {
  if (!app.isPackaged || config.autoLaunchDisabled) return;
  if (!app.getLoginItemSettings().openAtLogin) app.setLoginItemSettings({ openAtLogin: true });
}

async function toggleAutoLaunch(enabled: boolean): Promise<void> {
  app.setLoginItemSettings({ openAtLogin: enabled });
  const config = store.patchConfig({ autoLaunchDisabled: !enabled });
  await saveConfig(config).catch(() => {});
}

function iconFor(status: Status): Electron.NativeImage {
  const image = nativeImage.createFromPath(
    join(ASSETS, `tray-${status === 'idle' ? 'on' : status}@32.png`),
  );
  image.setTemplateImage(false);
  return image;
}
