/**
 * Barcodeer — Windows tray dasturi.
 *
 * `goal.md` talablari:
 *   - orqa fonda ishlaydi, tray'da ko'rinadi;
 *   - menyudan yoqish/o'chirish va "Skanerlash" tugmasi;
 *   - Windows ishga tushganda avtomatik ochiladi.
 */
import { app, dialog, Menu, nativeImage, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isConfigured,
  loadConfig,
  missingSettings,
  saveConfig,
  type BarcodeerConfig,
} from '@barcodeer/core';
import { Store, type AppState, type Status } from './state.js';
import { JobRunner } from './jobs.js';
import { HotFolderWatcher } from './watcher.js';
import { openSettingsWindow } from './settings-window.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const ASSETS = join(ROOT, 'assets');

/** Ishga tushirishda oyna ko'rsatmaslik uchun bayroq (startup uchun). */
const HIDDEN_FLAG = '--hidden';

let tray: Tray | null = null;
let store: Store;
let jobs: JobRunner;
let watcher: HotFolderWatcher | null = null;

// Bitta nusxa: ikkinchi ishga tushirish mavjud nusxaga menyuni ko'rsatadi.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => tray?.popUpContextMenu());
  void main();
}

async function main(): Promise<void> {
  await app.whenReady();

  // Tray dasturi: oynalar yopilganda ham ishlashda davom etadi.
  app.on('window-all-closed', () => {});

  let config: BarcodeerConfig;
  try {
    config = await loadConfig({ devRoot: ROOT.includes('apps') ? repoRoot() : undefined });
  } catch (err) {
    dialog.showErrorBox(
      'Sozlamalar xatosi',
      `Konfiguratsiyani yuklab bo'lmadi:\n\n${(err as Error).message}\n\n` +
        'Sozlamalarni to`ldirib, dasturni qayta ishga tushiring.',
    );
    app.quit();
    return;
  }

  store = new Store(config);
  jobs = new JobRunner(store);

  tray = new Tray(iconFor('off'));
  tray.setToolTip('Qaytnoma');
  store.subscribe(render);

  applyAutoLaunch(config);
  await applyWatcher(config);
  render(store.state);

  // Birinchi ishga tushirish: hech narsa sozlanmagan bo'lsa darhol Sozlamalar
  // oynasini ochamiz — aks holda foydalanuvchi tray ikonkasini ko'rib, nima
  // qilishni bilmay qoladi.
  if (!isConfigured(config)) openSettingsWindow(store, onConfigSaved);

  // Tray ikonkasiga chap tugma bilan bosilganda ham menyu chiqsin.
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
  const ready = isConfigured(config);

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
  ];

  if (!ready) {
    items.push({
      label: `Sozlash kerak: ${missingSettings(config).join(', ')}`,
      enabled: false,
    });
  }

  if (lastRun) {
    items.push({ type: 'separator' });
    items.push({ label: summarize(lastRun), enabled: false });
  }

  items.push(
    { type: 'separator' },
    {
      label: 'Katalogni yangilash',
      enabled: config.enabled && status !== 'busy' && ready && !!config.catalogueSpreadsheetId,
      click: () => void jobs.syncCatalogue(),
    },
    {
      label: 'Hujjatlar papkasi',
      click: () => void shell.openPath(config.invoicesRoot),
    },
    {
      label: 'Google Sheets',
      click: () =>
        void shell.openExternal(
          `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`,
        ),
    },
    { type: 'separator' },
    {
      label: 'Sozlamalar…',
      click: () => openSettingsWindow(store, onConfigSaved),
    },
    {
      label: 'Ishga tushganda ochilsin',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => setAutoLaunch(item.checked),
    },
    { type: 'separator' },
    { label: 'Chiqish', click: () => void quit() },
  );

  return items;
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

/** Kuzatuvchini konfiguratsiyaga moslaydi. */
async function applyWatcher(config: BarcodeerConfig): Promise<void> {
  const shouldWatch = config.enabled && !!config.hotFolder;

  if (!shouldWatch) {
    if (watcher) {
      await watcher.stop();
      watcher = null;
    }
    store.update({ watching: false });
    return;
  }

  if (watcher) await watcher.stop();
  watcher = new HotFolderWatcher({
    folder: config.hotFolder!,
    onBatch: (paths) => jobs.processFiles(paths),
    onError: (err) => store.update({ activity: `Kuzatuv xatosi: ${err.message}` }),
  });
  watcher.start();
  store.update({ watching: true });
}

function applyAutoLaunch(config: BarcodeerConfig): void {
  // Birinchi ishga tushirishda avtomatik ochilishni yoqamiz — `goal.md`
  // dasturning startup ilovalarida bo'lishini talab qiladi.
  if (!app.getLoginItemSettings().openAtLogin && config.enabled) setAutoLaunch(true);
}

function setAutoLaunch(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: [HIDDEN_FLAG],
  });
  render(store.state);
}

async function quit(): Promise<void> {
  if (watcher) await watcher.stop();
  tray?.destroy();
  app.quit();
}

function iconFor(status: Status): Electron.NativeImage {
  const name = status === 'idle' ? 'tray-on' : `tray-${status}`;
  const image = nativeImage.createFromPath(join(ASSETS, `${name}@32.png`));
  image.setTemplateImage(false);
  return image;
}

function tooltip(state: AppState): string {
  if (!isConfigured(state.config)) return 'Qaytnoma — sozlash kerak';
  if (!state.config.enabled) return 'Qaytnoma — o`chirilgan';
  if (state.status === 'busy') return `Qaytnoma — ${state.activity ?? 'bajarilmoqda'}`;
  if (state.status === 'error') return `Qaytnoma — xato: ${state.lastRun?.error ?? ''}`;
  return state.watching ? 'Qaytnoma — yoqilgan (papka kuzatilmoqda)' : 'Qaytnoma — yoqilgan';
}

function summarize(run: NonNullable<AppState['lastRun']>): string {
  const time = new Date(run.at).toLocaleTimeString('uz-UZ', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (run.error && run.documents === 0) return `${time} — xato: ${truncate(run.error, 60)}`;
  const flagged = run.flagged ? `, ${run.flagged} ⚠` : '';
  return `${time} — ${run.documents} hujjat, ${run.rows} qator${flagged}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Ishlab chiqishda repo ildizi — `.env` shu yerdan o'qiladi. */
function repoRoot(): string {
  return join(ROOT, '..', '..');
}
