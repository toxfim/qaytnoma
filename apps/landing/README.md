# Qaytnoma — yuklab olish sahifasi

Statik sahifa. Manba maket: Claude Design loyihasi
`Agent-scanner ilovasi yukla` → `Qaytnoma Download.dc.html`.

## Tuzilishi

```
public/                       ← veb-ildiz, shuni hostingga qo'ying
  index.html
  assets/styles.css           ← maketdagi inline uslublar
  assets/app.js               ← UZ/RU almashtirish (maketdagi COPY obyekti)
  assets/icon.png
  img/qn-hero.webp            ← maketdagi `qn-hero` uyasidan olingan skrinshot
  download/qaytnoma-setup.exe ← `pnpm build:installer` natijasi
```

`download/` papkasi `.gitignore` da — o'rnatgich har safar qayta yig'iladi.

## Ishga tushirish

```bash
pnpm --filter @barcodeer/landing dev     # http://localhost:4173
```

## O'rnatgichni yangilash

```bash
pnpm build:installer
```

`electron-builder` natijani to'g'ridan-to'g'ri `public/download/qaytnoma-setup.exe`
ga yozadi, shuning uchun sahifadagi havola qo'shimcha ish talab qilmaydi.
Versiya raqami `apps/tray/package.json` dan olinadi; sahifadagi «Versiya 1.0 · 48 MB»
matnini `assets/app.js` dagi `metaBottom` / `foot` kalitlaridan yangilang.

## Bajarilmagan qism

Maketdagi ikkinchi rasm uyasi (`qn-shot-2`, «Skanerdan kelgan hujjatlar oqimi»)
bo'sh. Real skanlarda mijozlarning ismi va telefon raqami bor, shuning uchun
ular sahifaga qo'yilmadi. Mos skrinshot tayyor bo'lganda `img/qn-shot-2.webp`
nomi bilan qo'ying va `index.html` dagi `.panel__slot` blokini `<img>` bilan
almashtiring.
