# OCR va dekodlash o'lchovlari

Barcha raqamlar **real skanda** o'lchangan: EPSON DS-530II, 600 DPI, rangli,
4 sahifa / 3 hujjat / 36 mahsulot qatori. Ground truth qo'lda kiritilgan.

Bu hujjat `packages/core/src/ocr/engine.ts` va `barcode/decode.ts` dagi
sozlamalarning **nega** shunday tanlanganini qayd etadi. Sozlamani o'zgartirishdan
oldin shu jadvallarga qarang.

## Sinov to'plamlari

Ikkita mustaqil skan ishlatiladi. Ikkinchisi ataylab qiyin: bir xil varaqlar
ADF dan bir necha marta o'tib egilib qolgan va ancha qiyshiq tushgan. Ko'p
tuzatish aynan shu skanda topilgan muammolardan kelib chiqqan.

| Skan | Qiyshiqlik | Xususiyati |
|---|---|---|
| A — toza | −1.05° … 0° | Birinchi skan |
| B — qiyshiq | −1.75° … −2.35° | Egilgan qog'oz, qoldiq to'lqin |

## Sahifalar

| Sahifa | Hujjat | Qator | Xususiyati |
|---|---|---|---|
| page_001 | `15-0000163307` | 1–13 | Hujjat shtrix-kodi **chop etishda so'ngan**; `Сумма` ustuni skan chetida kesilgan; qiyshiqlik −1.05° |
| page_002 | `15-0000163307` (davomi) | 14–26 | Sarlavhasiz davomi sahifasi; imzo bloki va ko'k muhr |
| page_003 | `15-1006739165` | 1–9 | Bej qog'oz; `Кол-во` ustunida ko'k ruchkada `ИЗВ` yozuvlari; imzo bloki YO'Q |
| page_004 | `15-0000153419` | 1 | Bitta qatorli hujjat; imzo va muhr |

## Yakuniy natijalar

Ikkala skanda ham bir xil:

| Maydon | Aniqlik | Manba |
|---|---|---|
| Qator soni (13/13/9/1) | **36/36 = 100%** | Jadval to'ri + yo'qolgan chiziqni tiklash |
| `ШК` (mahsulot shtrix-kodi) | **36/36 = 100%** | Code128 dekoderi, katak bo'yicha |
| `Ид документа` | **3/3 = 100%** | Shtrix-kod, yoki chop etilgan raqamdan tiklangan |
| `Номер документа` | **3/3 = 100%** | 4 ta ostona bo'yicha ovoz berish |
| `Дата составления` | **3/3 = 100%** | Sarlavha hududi OCR + regex |
| `Кол-во` | **36/36 = 100%** | PSM 8 + bbox + chiziqlarni olib tashlash + ovoz |
| Sahifa turi (sarlavha/davomi) | **4/4 = 100%** | Geometriya + sarlavha dalili |
| `СКУ` (OCR) | 17/36 = 47.2% | Ikki o'tishli OCR — yetarli emas |
| `СКУ` (katalog) | **36/36 = 100%** | `Баркод → Скю` katalogi — **ishlatiladigan yo'l** |

## Shtrix-kod dekodlash

### To'liq sahifa ishlamaydi

| Nima o'qildi | Natija |
|---|---|
| To'liq A4 sahifa, har qanday DPI va binarizatorda | **0 ta kod** |
| Faqat shtrix-kod ustunining tor tasmasi | 13 tadan 6–10 tasi |
| Jadval to'ri bilan topilgan **alohida katak** | **36/36** |

Sabab: sarlavha bloklari va zich matn ZXing ning ko'p-belgili qidiruvini
buzadi. Shuning uchun quvur to'r → katak → dekod tartibida ishlaydi.

### Xom piksel yo'lida holat oqishi (`zxing-wasm@3.1.3`)

Muvaffaqiyatli o'qishdan keyingi **darhol** chaqiruv, rasmda kod bo'lmasa ham,
oldingi natijani qaytaradi:

| Usul | c3 (kodli) | c4 (kodsiz) | c5 (kodsiz) |
|---|---|---|---|
| Xom piksel, tozalashsiz | ✓ | **arvoh** | — |
| Xom piksel + kichik bo'sh o'qish | ✓ | **arvoh** | — |
| Xom piksel + katta bo'sh o'qish | ✓ | **arvoh** | **arvoh** |
| **PNG Blob** | ✓ | — | — |

PNG yo'li 3 marta takrorlanganda ham barqaror. Xom piksel yo'lidagi bu xato
qo'shni katakni o'qiganda **jimgina noto'g'ri ma'lumot** beradi — eng xavfli
xato turi, shuning uchun quvurda faqat PNG yo'li ishlatiladi.

### Masshtab

Kattalashtirish sezilarli yordam beradi (600 DPI da Code128 moduli ~5 px).
Urinish tartibi: `1 → 2 → 3 → 0.5`, birinchi muvaffaqiyatda to'xtaydi.

## Qiyshiqlik (deskew)

Deskewsiz **hech narsa ishlamaydi**: 0.3° qiyshiqlik 2200 px kenglikda 11 px
vertikal siljish beradi va jadval chizig'i bitta skanliniyaga sig'maydi.

| | Deskewsiz | Deskew bilan |
|---|---|---|
| Qator bo'yicha eng yuqori qora ulush | 0.50 | **0.84–0.87** |
| Topilgan gorizontal chiziqlar | 7 | **17–26** |

O'lchangan qiyshiqliklar: −1.05°, −0.75°, 0.00°, −0.25°.

## `Кол-во`

| PSM | Tayyorgarlik | Aniqlik |
|---|---|---|
| 7 | normalize | 88.9% |
| 7 | threshold + DPI | 88.9% |
| **8** | **bbox qirqish** | **94.4%** |
| **8** | **bbox + 3 variant ovozi** | **97.2%** |
| 10 | bbox qirqish | 86.1% |
| 8 | qirqishsiz | 25.0% |
| 13 | har qanday | 25.0% |

Mazmun bo'yicha qirqish hal qiluvchi: usiz Tesseract rasm o'lchamidan DPI ni
25 deb baholaydi ("Invalid resolution 25 dpi") va yakka ingichka `1` ni umuman
ko'rmaydi.

## `СКУ` — nega OCR yetarli emas va nima bilan almashtirilgan

| Usul | Aniqlik |
|---|---|
| `rus+eng`, bitta o'tish | 13.9% |
| Faqat lotin whitelist | 0% (kirill rang segmenti buziladi) |
| Faqat kirill whitelist | 0% (lotin segmentlari buziladi) |
| **Ikki o'tish, segmentlarni birlashtirish** | **47.2%** |
| Ikki o'tish + 3 variant ovozi | 47.2% (o'zgarmadi) |

Ikki o'tishdan keyin **rang segmenti to'liq to'g'ri** bo'ladi; qolgan xatolar
faqat lotin kod segmentida:

```
CIF0001  -> CIFO001     (0 / O)
NEWP080  -> NEWPQOBO    (0 / O / Q,  8 / B)
SHA60MM  -> SHABOMM     (6 / B,  0 / O)
SHARIK5  -> SHARIKS     (5 / S)
```

Sinalgan va rad etilgan variantlar:

- **`tessdata_best`** — tesseract.js WASM yadrosida `DotProductSSE` yo'q,
  modul ishga tushmay abort qiladi.
- **Tayyorgarlik variantlari bo'yicha ovoz berish** — barcha variantlar bir xil
  xatoni takrorlaydi.
- **Qatorlararo konsensus** (bir xil prefiksni ko'p qatorda solishtirish) —
  **xavfli**: `SHARIK5` va `SHARIK7` orasidagi Levenshtein masofasi 1, ya'ni
  real turli mahsulotlar birlashtirilib yuborilardi.

**Qabul qilingan yechim: Uzum katalogi.**

Foydalanuvchining "Finance" jadvalidagi `Остаток Узум` varag'ida Uzum'ning o'z
ma'lumotlari bor — `Скю` (B ustun) va `Баркод` (G ustun).

| O'lchov | Natija |
|---|---|
| Katalog hajmi | 23 066 qator |
| Noyob shtrix-kod | 23 066 |
| Ziddiyat (bir kod → turli SKU) | **0** |
| Bo'sh / noto'g'ri formatdagi qator | **0** |
| Yuklab olish vaqti (2 ustun, `batchGet`) | 2.1 s |
| Sinov skanidagi 36 shtrix-kod topildi | **36/36** |
| Topilganlarning SKU si ground truth bilan mos | **36/36** |

Natijada `СКУ` aniqligi **47% → 100%**, belgilangan qatorlar esa **36 → 1**
(faqat haqiqatan o'qilmagan miqdor qoldi).

Ustuvorlik tartibi (`store/sku-resolver.ts`): `catalogue` → `confirmed` → `ocr`.
Katalog tepada, chunki u Uzum tizimining o'zidan keladi va muntazam yangilanadi;
eski qo'lda kiritilgan qiymat katalogdagi yangilanishni to'sib qo'ymasligi kerak.

OCR yo'li olib tashlanmadi: katalogda yo'q mahsulot uchrasa (yangi tovar, boshqa
firma) u taklif beradi va qator `SKU_UNCONFIRMED` bilan belgilanadi.

## Qiyshiq qog'oz: topilgan va tuzatilgan muammolar

B skanida (egilgan qog'oz) beshta mustaqil xato yuzaga chiqdi. Har biri
jimgina ma'lumot yo'qotardi, shuning uchun har biri alohida qayd etilgan.

| Muammo | Belgisi | Yechim |
|---|---|---|
| Qoldiq qiyshiqlik | Global deskewdan keyin ham chiziqlar yoyilgan: eng zich qator 0.87 → 0.74, chiziqlar 26 → 11 | Proyeksiyani bir necha kichik burchakda hisoblab maksimumini olish (`rowDarkProfile`) |
| Shtrix-kod chiziqchalari ustun deb sanalgan | Qator 136 px da 0.85 ostonasi ishlagan, 130 px da ishlamagan — jadvalning yarmi yo'qolgan | Ustun chizig'i band CHEKKALARIDA ham qora bo'lishi shart; shtrix-kod esa usti-ostida oq joy qoldiradi |
| Chap chegara topilmay, ustun indekslari siljigan | `ШК` deb narx ustuni o'qilgan, 9 qatordan 3 tasi qolgan | Ustunlar qat'iy indeks bilan emas, eng keng ustun (`Описание`) bo'yicha aniqlanadi (`layout/columns.ts`) |
| So'lg'in qator chizig'i (0.35, oston 0.45) | Ikki qator bitta bandga qo'shilib, bittasi butunlay yo'qolgan | Median balandlikdan 1.6x baland band ichida chiziq qidiriladi; bo'linish faqat ikkala bo'lak ham odatiy qator balandligiga mos kelsa qabul qilinadi |
| Ustun chizig'i katak ichiga kirib qolgan | `Кол-во` bo'sh qaytgan; mazmun chegarasi 20x54 o'rniga 173x260 | Chiziqlarni oqartirish (`suppressLines`) + raqam kataklarini gorizontal bo'yicha −14% qisqartirish |

Ikkita tizim darajasidagi tuzatish ham shu skandan kelib chiqdi:

- **`Итого` tekshiruvi endi o'qilmagan katak bo'lsa ham bajariladi.** Ilgari u
  shunday holatda o'tkazib yuborilardi va aynan eng xavfli vaziyatda jim
  qolardi: 26 qatordan 25 tasi o'qilib, yig'indi 166 o'rniga 110 chiqqanda hech
  qanday ogohlantirish bo'lmagan.
- **Sarlavha sahifasi faqat geometriya bilan aniqlanmaydi.** To'r qisman
  topilganda davomi sahifasi sarlavha deb qabul qilinib, narx qiymatidan
  (`5850`) soxta hujjat raqami va soxta `15-0000005850` ID si yasalgan edi.
  Endi sana yoki dekodlangan shtrix-kod ham talab qilinadi.

## Tezlik

| Bosqich | Vaqt |
|---|---|
| Skanerlash (600 DPI, rangli) | ~13 s / sahifa |
| Sahifani tayyorlash (deskew + binarizatsiya) | ~1.1 s |
| To'liq quvur | ~10 s / sahifa (13 qatorli sahifada) |
| 4 sahifa, 3 hujjat, uchdan boshiga | 39 s |
