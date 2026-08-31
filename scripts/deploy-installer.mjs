/**
 * O'rnatgichlarni serverga chiqaradi: `node scripts/deploy-installer.mjs [dastur]`.
 *
 * Argumentsiz — `meta.json` dagi barcha dasturlar (`qaytnoma`, `qaytnoma-ai`).
 * Bitta nom berilsa faqat o'sha yuklanadi: ikkinchisini qayta yuborish 130 MB
 * ni bekorga haydash demak.
 *
 * NEGA TO'G'RIDAN-TO'G'RI `scp` EMAS: `scp` faylni joyiga o'sha zahoti yoza
 * boshlaydi, nginx esa o'sha paytda yarim yozilgan `.exe` ni tarqatishda davom
 * etadi. 132 MB taxminan bir-ikki daqiqa yuklanadi va o'sha oynada faylni
 * yuklab olgan odam buzuq `.exe` oladi — buzilgani esa faqat o'rnatishda
 * bilinadi. O'lchangan: yuklash o'rtasida sayt eski hajmni ko'rsatib turdi.
 *
 * Shuning uchun avval vaqtinchalik nom bilan yuklanadi, keyin serverda
 * `mv` qilinadi. Bitta fayl tizimi ichida `mv` — atomar `rename`: mijoz yo
 * eski, yo yangi faylni oladi, oraliq holat yo'q. Yuklab olish jarayonida
 * bo'lgan mijozlar esa eski inode'dan o'qishda davom etadi va uzilmaydi.
 *
 * TARTIB HAM MUHIM: avval `.exe` lar, keyin `meta.json`. Sahifa versiya va
 * hajmni `meta.json` dan o'qiydi, ya'ni u hali yuklanmagan versiyani e'lon
 * qilmasligi kerak. Eski skript aksincha qilardi — `meta.json` birinchi ketardi.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = join(ROOT, 'apps', 'landing', 'public', 'download');
const HOST = 'root@139.162.197.219';
const REMOTE = '/var/www/qaytnoma.tez-agent.uz/download';
const SITE = 'https://qaytnoma.tez-agent.uz';

const log = (msg) => console.log(`[deploy] ${msg}`);

/** Vaqtinchalik nom nuqta bilan boshlanadi — nginx uni tarqatmasin. */
const partName = (name) => `.${name}.part`;

function upload(name) {
  const path = join(LOCAL, name);
  if (!existsSync(path)) {
    throw new Error(`Fayl topilmadi: ${path}\nAvval "pnpm build:installer" ni ishlating.`);
  }
  const mb = (statSync(path).size / 1024 / 1024).toFixed(1);
  log(`${name} yuklanmoqda (${mb} MB)…`);
  execFileSync('scp', [path, `${HOST}:${REMOTE}/${partName(name)}`], { stdio: 'inherit' });
}

/**
 * Yuklangan fayllarni joyiga qo'yadi.
 *
 * Egasi va huquqlari `mv` dan OLDIN to'g'rilanadi: `mv` faylni o'z egasi bilan
 * ko'chiradi, `scp` esa uni root nomidan yaratadi.
 */
function publish(names) {
  const parts = names.map(partName).join(' ');
  const commands = [
    `cd ${REMOTE}`,
    `chown www-data:www-data ${parts}`,
    `chmod 644 ${parts}`,
    ...names.map((name) => `mv -f ${partName(name)} ${name}`),
    `ls -l ${names.join(' ')}`,
  ].join(' && ');

  log('serverda joyiga qo`yilmoqda…');
  execFileSync('ssh', [HOST, commands], { stdio: 'inherit' });
}

/** Sayt haqiqatan yangi faylni tarqatayotganini tekshiradi. */
async function verify(name, expectedSize) {
  const url = `${SITE}/download/${name}`;
  const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} — sayt ${res.status} qaytardi`);

  const served = Number(res.headers.get('content-length'));
  if (served !== expectedSize) {
    throw new Error(
      `${name}: saytdagi hajm mos kelmadi: ${served} ≠ ${expectedSize}.\n` +
        'Fayl to`liq ko`chmagan bo`lishi mumkin — qayta yuboring.',
    );
  }
  log(`tekshirildi: ${name} — ${served} bayt tarqatilmoqda`);
}

const meta = JSON.parse(readFileSync(join(LOCAL, 'meta.json'), 'utf8'));
const only = process.argv[2];
const entries = Object.entries(meta.apps ?? {}).filter(([key]) => !only || key === only);

if (entries.length === 0) {
  const known = Object.keys(meta.apps ?? {}).join(', ') || '(bo`sh)';
  console.error(`Yuklanadigan dastur topilmadi. meta.json dagilar: ${known}`);
  process.exit(1);
}

for (const [, app] of entries) upload(app.installer);
upload('meta.json');
publish([...entries.map(([, app]) => app.installer), 'meta.json']);

log('sayt tekshirilmoqda…');
for (const [, app] of entries) await verify(app.installer, app.sizeBytes);

log(`tayyor: ${entries.map(([key, app]) => `${key} v${app.version}`).join(', ')} → ${SITE}`);
