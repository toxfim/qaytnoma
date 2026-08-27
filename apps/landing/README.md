# Qaytnoma — yuklab olish sahifasi

Statik sahifa. Manba maket: Claude Design loyihasi
`Agent-scanner ilovasi yukla` → `Qaytnoma Download.dc.html`. Maketdagi
skrinshotlar o'rniga HTML maket va batafsil sozlash yo'riqnomasi qo'yilgan.

Jonli manzil: **https://qaytnoma.tez-agent.uz**

## Tuzilishi

```
public/                       ← veb-ildiz, shuni hostingga qo'ying
  index.html
  assets/styles.css           ← maketdagi inline uslublar + yo'riqnoma uslublari
  assets/app.js               ← UZ/RU almashtirish (COPY obyekti), meta.json o'qish
  assets/icon.png
  download/qaytnoma-setup.exe ← `pnpm build:installer` natijasi (gitignored)
  download/meta.json          ← versiya va hajm, o'rnatgich bilan birga yoziladi
```

`download/` papkasi `.gitignore` da — o'rnatgich har safar qayta yig'iladi va
serverga alohida yuklanadi (pastga qarang).

Sahifada **rasm yo'q va bo'lmasligi kerak**: ilovaning real skrinshotida
foydalanuvchining Spreadsheet ID si ko'rinib qolgan edi. Hero'dagi oyna —
`settings.html` ning HTML nusxasi (`.mock`), undagi ID niqoblangan.

## Matnlar

Ikki xil atribut bor: `data-t` — oddiy matn (`textContent`), `data-th` —
HTML (`innerHTML`, yo'riqnomadagi `<code>`/`<b>`/`<a>` uchun). Ikkalasi ham
faqat `app.js` dagi `COPY` obyektidan oladi; kalit ikkala tilda ham bo'lishi
shart.

## Ishga tushirish

```bash
pnpm --filter @barcodeer/landing dev     # http://localhost:4173
```

## Serverga joylash

Server: `ydev` (139.162.197.219), nginx. Repo `~/projects/qaytnoma` da,
veb-ildiz `/var/www/qaytnoma.tez-agent.uz`. nginx `www-data` sifatida
ishlaydi va `/root` ga kira olmaydi, shuning uchun sahifa repo'dan veb-ildizga
nusxalanadi — `scripts/deploy-landing.sh` (repo ichida, serverda ishlaydi)
shuni qiladi:

```bash
git push origin v2        # server repo'ning v2 shoxini tortadi
pnpm deploy:landing       # = ssh ydev 'bash ~/projects/qaytnoma/scripts/deploy-landing.sh'
#   git reset --hard origin/v2 + rsync apps/landing/public → /var/www/qaytnoma.tez-agent.uz
#   (download/ papkasiga tegmaydi)
```

O'rnatgichni yangilash — repo'dan tashqarida, to'g'ridan-to'g'ri veb-ildizga:

```bash
pnpm build:installer
pnpm deploy:installer      # scp download/{qaytnoma-setup.exe,meta.json} → server
```

DNS: `qaytnoma.tez-agent.uz` → A `139.162.197.219` (ahost, DNS-хостинг →
DNS-менеджер; nameserverlar rdns1-3.ahost.uz). Sertifikat:
`scripts/enable-https.sh` — serverdagi cron DNS tarqalgach certbot'ni bir
marta ishga tushiradi (jurnal `/var/log/qaytnoma-https.log`), keyin
certbot'ning o'z taymeri yangilab turadi.

Versiya raqami `apps/tray/package.json` dan olinadi va `meta.json` orqali
sahifaga tushadi; `app.js` dagi `metaBottom` / `foot` faqat zaxira matn.
