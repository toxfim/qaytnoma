/**
 * O'rnatgichni serverga chiqaradi.
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
 * TARTIB HAM MUHIM: avval `.exe`, keyin `meta.json`. Sahifa versiya va hajmni
 * `meta.json` dan o'qiydi, ya'ni u hali yuklanmagan versiyani e'lon qilmasligi
 * kerak. Eski skript aksincha qilardi — `meta.json` birinchi ketardi.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = join(ROOT, 'apps', 'landing', 'public', 'download');
const HOST = 'root@139.162.197.219';
const REMOTE = '/var/www/qaytnoma.tez-agent.uz/download';
const URL = 'https://qaytnoma.tez-agent.uz/download/qaytnoma-setup.exe';
const INSTALLER = 'qaytnoma-setup.exe';

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
function publish() {
  const commands = [
    `cd ${REMOTE}`,
    `chown www-data:www-data ${partName(INSTALLER)} ${partName('meta.json')}`,
    `chmod 644 ${partName(INSTALLER)} ${partName('meta.json')}`,
    `mv -f ${partName(INSTALLER)} ${INSTALLER}`,
    `mv -f ${partName('meta.json')} meta.json`,
    `ls -l ${INSTALLER} meta.json`,
  ].join(' && ');

  log('serverda joyiga qo`yilmoqda…');
  execFileSync('ssh', [HOST, commands], { stdio: 'inherit' });
}

/** Sayt haqiqatan yangi faylni tarqatayotganini tekshiradi. */
async function verify(expectedSize) {
  log('sayt tekshirilmoqda…');
  const res = await fetch(URL, { method: 'HEAD', cache: 'no-store' });
  if (!res.ok) throw new Error(`Sayt ${res.status} qaytardi`);

  const served = Number(res.headers.get('content-length'));
  if (served !== expectedSize) {
    throw new Error(
      `Saytdagi hajm mos kelmadi: ${served} ≠ ${expectedSize}.\n` +
        'Fayl to`liq ko`chmagan bo`lishi mumkin — qayta yuboring.',
    );
  }
  log(`tekshirildi: ${served} bayt tarqatilmoqda`);
}

const meta = JSON.parse(readFileSync(join(LOCAL, 'meta.json'), 'utf8'));

upload(INSTALLER);
upload('meta.json');
publish();
await verify(meta.sizeBytes);
log(`tayyor: v${meta.version} → https://qaytnoma.tez-agent.uz`);
