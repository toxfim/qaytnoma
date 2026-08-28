/**
 * Barcodeer — Windows tray dasturi.
 *
 * `goal.md` talablari:
 *   - orqa fonda ishlaydi, tray'da ko'rinadi;
 *   - menyudan yoqish/o'chirish va "Skanerlash" tugmasi;
 *   - Windows ishga tushganda avtomatik ochiladi.
 */
import { app, dialog, Menu, nativeImage, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { existsSync } from 'node:fs';
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

/**
 * Avtomatik ishga tushirish holati.
 *
 * DIQQAT — Windows'da `getLoginItemSettings` yozuvni BUYRUQ QATORI bo'yicha
 * solishtiradi: `setLoginItemSettings` ga `args` berilgan bo'lsa, o'qishda ham
 * aynan shu `args` berilishi shart, aks holda doim `false` qaytadi. Ilgari
 * `--hidden` bilan yozib, argumentsiz o'qilardi — natijada menyudagi belgi hech
 * qachon chiqmasdi va o'chirib ham bo'lmasdi. Endi argument umuman
 * ishlatilmaydi (dastur uni o'qimas ham edi), yozish va o'qish mos.
 *
 * Ishlab chiqish rejimida (`npx electron .`) yozuv `electron.exe` ga ishora
 * qilib, login'da bo'sh Electron oynasini ochardi — shuning uchun faqat
 * paketlangan dasturda ishlaydi.
 */
function isAutoLaunchEnabled(): boolean {
  return app.isPackaged && app.getLoginItemSettings().openAtLogin;
}

/**
 * Paketlangan ilovadagi Tesseract til fayllari papkasi.
 *
 * `extraResources` ularni `resources/tessdata` ga qo'yadi, konfiguratsiyaning
 * standart qiymati esa `%APPDATA%/barcodeer/tessdata` — u papkani hech kim
 * yaratmaydi va hech qachon to'ldirmaydi. Standart qiymatni almashtirmasak,
 * o'rnatilgan ilovada OCR til faylini umuman topa olmaydi (ishlab chiqishda
 * bu ko'rinmaydi: u yerda `loadConfig` repo ichidagi `.tessdata` ni topadi).
 */
function packagedTessdata(): string | null {
  return app.isPackaged ? join(process.resourcesPath, 'tessdata') : null;
}

/**
 * Til fayllari yo'qolgan bo'lsa paketdagi nusxaga qaytaradi.
 *
 * `config.json` standart qiymatdan ustun turadi, shuning uchun standartni
 * to'g'rilash yetarli emas: eski o'rnatishlarda saqlanib qolgan noto'g'ri yo'l
 * o'z-o'zidan tuzalmaydi. Yo'l mavjudligini tekshirib almashtiramiz va
 * natijani saqlaymiz.
 */
async function repairTessdataPath(config: BarcodeerConfig): Promise<BarcodeerConfig> {
  const packaged = packagedTessdata();
  if (!packaged) return config;
  if (existsSync(config.tessdataPath) || !existsSync(packaged)) return config;

  const fixed = { ...config, tessdataPath: packaged };
  await saveConfig(fixed).catch(() => {});
  return fixed;
}

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
    const packaged = packagedTessdata();
    config = await loadConfig({
      devRoot: ROOT.includes('apps') ? repoRoot() : undefined,
      defaults: packaged ? { tessdataPath: packaged } : undefined,
    });
    config = await repairTessdataPath(config);
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
  // OCR worker'larini fonda isitamiz — birinchi skanerlash 2.4 s tezroq boshlanadi.
  if (isConfigured(config)) jobs.prewarm();

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
      label: app.isPackaged ? 'Ishga tushganda ochilsin' : 'Ishga tushganda ochilsin (faqat o`rnatilgan dasturda)',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: isAutoLaunchEnabled(),
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

/**
 * Avtomatik ishga tushirishni ta'minlaydi — `goal.md` dasturning startup
 * ilovalarida bo'lishini talab qiladi.
 *
 * Har ishga tushirishda tekshiriladi, bir marta emas: Windows yozuvi `.exe`
 * ning aniq yo'liga bog'langan, dastur yangilanib boshqa papkaga tushsa
 * (yoki eski yozuv ishlab chiqish nusxasiga ishora qilsa) u bekor bo'ladi va
 * dastur o'zini qayta ro'yxatdan o'tkazadi. Faqat foydalanuvchi menyudan
 * ochiq o'chirgan bo'lsa (`config.autoLaunchDisabled`) tegilmaydi.
 */
function applyAutoLaunch(config: BarcodeerConfig): void {
  if (!app.isPackaged || config.autoLaunchDisabled) return;
  if (!app.getLoginItemSettings().openAtLogin) setAutoLaunch(true);
}

/** Menyudan yoqish/o'chirish — foydalanuvchi qarori sozlamada eslab qolinadi. */
function setAutoLaunch(enabled: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled });
  void saveConfig(store.patchConfig({ autoLaunchDisabled: !enabled })).catch(() => {});
  render(store.state);
}

async function quit(): Promise<void> {
  if (watcher) await watcher.stop();
  await jobs.dispose();
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
  const skipped = run.skipped ? `, ${run.skipped} takror` : '';
  const flagged = run.flagged ? `, ${run.flagged} ⚠` : '';
  return `${time} — ${run.documents} hujjat, ${run.rows} qator${skipped}${flagged}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Ishlab chiqishda repo ildizi — `.env` shu yerdan o'qiladi. */
function repoRoot(): string {
  return join(ROOT, '..', '..');
}
