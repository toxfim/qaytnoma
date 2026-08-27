/**
 * `qaytnoma-setup.exe` o'rnatgichini yig'adi.
 *
 * NEGA ALOHIDA YIG'ISH PAPKASI: pnpm har bir workspace paketiga o'z
 * `node_modules` ini yaratadi va bog'liqliklarni do'kondan simvolik havola
 * bilan ulaydi. electron-builder esa dasturning barcha bog'liqliklarini bitta
 * `node_modules` daraxtida ko'rishni kutadi. Shuning uchun `build/app/` ichida
 * mustaqil, tekis daraxt quramiz:
 *
 *   build/app/
 *     package.json      -> haqiqiy versiyalar, `workspace:*` siz
 *     dist/ assets/     -> apps/tray dan
 *     node_modules/     -> `npm install --omit=dev` natijasi
 *       @barcodeer/*    -> workspace paketlarining `dist` i qo'lda ko'chiriladi
 *
 * Tesseract til fayllari `extraResources` orqali `resources/tessdata` ga
 * tushadi — dastur ularni offline o'qiydi (`config.tessdataPath`).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, 'build', 'app');
/** Workspace paketlarining nusxasi — `file:` bog'liqlik sifatida ulanadi. */
const PKGS = join(ROOT, 'build', 'pkgs');
/** electron-builder chiqishi — oraliq fayllar bilan birga. */
const DIST = join(ROOT, 'build', 'dist');
/** Landing sahifasining yuklash papkasi — faqat tayyor `.exe` shu yerga tushadi. */
const OUT = join(ROOT, 'apps', 'landing', 'public', 'download');
const INSTALLER = 'qaytnoma-setup.exe';

/** Workspace paketlari — ular npm'dan emas, diskdan ko'chiriladi. */
const WORKSPACE = [
  { name: 'shared', dir: join(ROOT, 'packages', 'shared'), extra: [] },
  { name: 'scanner', dir: join(ROOT, 'packages', 'scanner'), extra: ['scripts'] },
  { name: 'core', dir: join(ROOT, 'packages', 'core'), extra: [] },
];

const log = (msg) => console.log(`[installer] ${msg}`);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Barcha bog'liqliklarni yig'adi.
 *
 * Workspace paketlari `file:` protokoli bilan qo'shiladi. NEGA: electron-builder
 * `node_modules` ni `package.json` dagi bog'liqliklar daraxti bo'yicha tozalaydi
 * va u yerda e'lon qilinmagan paketni asar ichiga qo'shmaydi — hatto `files`
 * qoidasida ochiq ko'rsatilgan bo'lsa ham. Ularni shunchaki `node_modules` ga
 * ko'chirib qo'yish yetarli emas edi: dastur ishga tushishda
 * "Cannot find package '@barcodeer/core'" xatosi berardi.
 */
function collectDependencies() {
  const deps = {};
  const sources = [
    join(ROOT, 'apps', 'tray', 'package.json'),
    ...WORKSPACE.map((w) => join(w.dir, 'package.json')),
  ];

  for (const path of sources) {
    for (const [name, version] of Object.entries(readJson(path).dependencies ?? {})) {
      // `workspace:*` bog'liqliklari npm'dan olinmaydi — ularni o'zimiz ko'chiramiz.
      if (version.startsWith('workspace:')) continue;
      if (deps[name] && deps[name] !== version) {
        throw new Error(`${name} uchun ikki xil versiya: ${deps[name]} va ${version}`);
      }
      deps[name] = version;
    }
  }
  for (const pkg of WORKSPACE) {
    // Nisbiy yo'l: `build/app` dan `build/pkgs/<nom>` ga.
    deps[`@barcodeer/${pkg.name}`] = `file:../pkgs/${pkg.name}`;
  }

  return Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Workspace paketlarini `build/pkgs/` ga ko'chiradi.
 *
 * Bog'liqliklari olib tashlanadi — ular allaqachon asosiy `package.json` da
 * e'lon qilingan va tekis daraxtda yotadi, `workspace:*` esa npm uchun yaroqsiz.
 */
function stageWorkspacePackages() {
  log('workspace paketlari tayyorlanmoqda…');
  for (const pkg of WORKSPACE) {
    const target = join(PKGS, pkg.name);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });

    const manifest = readJson(join(pkg.dir, 'package.json'));
    delete manifest.dependencies;
    delete manifest.devDependencies;
    delete manifest.scripts;
    writeFileSync(join(target, 'package.json'), JSON.stringify(manifest, null, 2), 'utf8');

    cpSync(join(pkg.dir, 'dist'), join(target, 'dist'), { recursive: true });
    for (const extra of pkg.extra) {
      cpSync(join(pkg.dir, extra), join(target, extra), { recursive: true });
    }
  }
}

/**
 * Yig'ish papkasini tayyorlaydi.
 *
 * `node_modules` saqlanib qoladi va bog'liqliklar ro'yxati o'zgarmagan bo'lsa
 * qayta o'rnatilmaydi — `npm install` bir necha daqiqa oladi va har bir
 * qayta yig'ishda uni takrorlash keraksiz.
 *
 * @returns bog'liqliklarni qayta o'rnatish kerakmi
 */
function stage() {
  log('yig`ish papkasi tayyorlanmoqda…');
  mkdirSync(STAGE, { recursive: true });

  // Kod har safar yangilanadi, bog'liqliklar esa tegilmaydi.
  rmSync(join(STAGE, 'dist'), { recursive: true, force: true });
  rmSync(join(STAGE, 'assets'), { recursive: true, force: true });
  cpSync(join(ROOT, 'apps', 'tray', 'dist'), join(STAGE, 'dist'), { recursive: true });
  cpSync(join(ROOT, 'apps', 'tray', 'assets'), join(STAGE, 'assets'), { recursive: true });

  const manifestPath = join(STAGE, 'package.json');
  const previous = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : '';

  const trayPkg = readJson(join(ROOT, 'apps', 'tray', 'package.json'));
  const manifest = JSON.stringify(
      {
        name: 'qaytnoma',
        productName: 'Qaytnoma',
        version: trayPkg.version ?? '1.0.0',
        description: 'Uzum qaytarim hujjatlarini skanerdan Google Sheets ga ko`chiradi',
        main: 'dist/main/index.js',
        type: 'module',
        author: 'Uzum',
        license: 'UNLICENSED',
        dependencies: collectDependencies(),
      },
      null,
      2,
    );
  writeFileSync(manifestPath, manifest, 'utf8');

  const installed = existsSync(join(STAGE, 'node_modules'));
  return !installed || previous !== manifest;
}

function installDependencies(needed) {
  if (!needed) {
    log('bog`liqliklar o`zgarmagan — o`rnatish o`tkazib yuborildi');
    return;
  }
  log('bog`liqliklar o`rnatilmoqda (npm, bir necha daqiqa)…');
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: STAGE,
    stdio: 'inherit',
    shell: true,
  });
}

function ensureTessdata() {
  const src = join(ROOT, 'packages', 'core', '.tessdata');
  if (!existsSync(join(src, 'rus.traineddata.gz')) || !existsSync(join(src, 'eng.traineddata.gz'))) {
    throw new Error(
      `Tesseract til fayllari topilmadi: ${src}\n` +
        'Yuklab oling: curl -sSL -o rus.traineddata.gz https://tessdata.projectnaptha.com/4.0.0/rus.traineddata.gz',
    );
  }
  return src;
}

/**
 * Electron versiyasi.
 *
 * electron-builder uni odatda dastur papkasidagi `node_modules/electron` dan
 * oladi, ammo bizning yig'ish papkamizda Electron yo'q (u runtime sifatida
 * builder tomonidan qo'shiladi). Shuning uchun versiyani `apps/tray` da
 * o'rnatilgan nusxadan o'qib, aniq uzatamiz.
 */
function electronVersion() {
  const manifest = join(ROOT, 'apps', 'tray', 'node_modules', 'electron', 'package.json');
  if (!existsSync(manifest)) {
    throw new Error(`Electron topilmadi: ${manifest}\nAvval "pnpm install" ni ishlating.`);
  }
  return readJson(manifest).version;
}

function buildInstaller() {
  ensureTessdata();
  const version = electronVersion();
  log(`electron-builder ishga tushirilmoqda (Electron ${version})…`);
  execFileSync(
    'npx',
    [
      'electron-builder',
      '--win',
      '--x64',
      '--config',
      join(ROOT, 'electron-builder.yml'),
      `--config.electronVersion=${version}`,
    ],
    { cwd: ROOT, stdio: 'inherit', shell: true },
  );
}

/** Tayyor o'rnatgichni landing sahifasiga ko'chiradi. */
function publish() {
  const built = join(DIST, INSTALLER);
  if (!existsSync(built)) {
    throw new Error(`O'rnatgich topilmadi: ${built}`);
  }
  mkdirSync(OUT, { recursive: true });
  const target = join(OUT, INSTALLER);
  cpSync(built, target);

  const size = statSync(target).size;
  const version = readJson(join(STAGE, 'package.json')).version;

  // Sahifa hajm va versiyani shu fayldan o'qiydi — aks holda ular qo'lda
  // yozilgan matnda qolib, har yangi yig'ishdan keyin eskirardi.
  writeFileSync(
    join(OUT, 'meta.json'),
    JSON.stringify({ version, sizeBytes: size, builtAt: new Date().toISOString() }, null, 2),
    'utf8',
  );

  log(`tayyor: ${target} (${(size / 1024 / 1024).toFixed(1)} MB, v${version})`);
}

stageWorkspacePackages();
const needsInstall = stage();
installDependencies(needsInstall);
buildInstaller();
publish();
