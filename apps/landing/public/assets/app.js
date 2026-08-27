/*
 * Til almashtirish.
 *
 * Matnlar Claude Design maketidan (`Qaytnoma Download.dc.html`) olingan va
 * sozlash yo'riqnomasi bilan to'ldirilgan. Maketda ular `DCLogic.state.lang`
 * orqali almashtirilgan — bu yerda o'sha mantiq oddiy DOM bilan takrorlangan.
 *
 * Ikki xil atribut:
 *   data-t  — matn (`textContent`), HTML sifatida talqin qilinmaydi;
 *   data-th — HTML (`innerHTML`), yo'riqnomadagi <code>/<b>/<a> uchun.
 * Ikkalasi ham faqat shu fayldagi statik matnni oladi, tashqi manba yo'q.
 */
(function () {
  'use strict';

  var CLOUD =
    '<a href="https://console.cloud.google.com/" target="_blank" rel="noopener">console.cloud.google.com</a>';

  var COPY = {
    uz: {
      navSetup: "Sozlash yo'riqnomasi",
      navInstall: "O'rnatish",
      badge: 'Windows uchun ilova',
      h1: "Skaner ishlaydi — ma'lumot jadvalga tushadi.",
      lede: "qaytnoma tizimga ulangan skanerni kuzatib turadi. Hujjat Uzum Invoice bo'lsa, ilova undagi ma'lumotlarni ajratib olib spreadsheetga yozib boradi.",
      cta: 'Windows uchun yuklab olish',
      cta2: 'Yuklab olish (.exe)',
      metaTop: '.exe · Windows 10/11 · 64-bit',
      metaBottom: 'Versiya 1.0.0 · 132 MB',
      featTitle: 'Nima qiladi',
      f1t: 'Skanerni kuzatadi',
      f1b: "Fonda ishlaydi. Skaner hujjatni o'qishi bilan ilova uni darhol qabul qiladi.",
      f2t: "Uzum Invoice'ni aniqlaydi",
      f2b: 'Faqat Uzum Invoice hujjatlarini ajratadi, qolganlariga tegmaydi.',
      f3t: "Ma'lumotni ajratib oladi",
      f3b: "Hujjat ichidan kerakli maydonlarni o'qib, tartibli ko'rinishga keltiradi.",
      f4t: 'Spreadsheetga yozadi',
      f4b: "Har bir hujjat jadvalga yangi qator bo'lib tushadi. Qo'lda kiritish kerak emas.",
      shot3: "Spreadsheetga yozilgan natija — test ma'lumot. ⚠ belgisi qatorni qo'lda tekshirish kerakligini bildiradi, sababi _log varag'ida.",
      testBadge: "Test ma'lumot",

      /* ---- Sozlash yo'riqnomasi ---- */
      gTitle: "Ilovani to'g'ri sozlash",
      gLede: "Ilova Google Sheets'ga o'z nomidan emas, siz yaratgan «service account» nomidan yozadi. Shuning uchun sozlash ikki qismdan iborat: Google tomonida kalit va ruxsat, ilova tomonida esa jadval ID si va o'sha kalit. Bir marta bajariladi, taxminan 10 daqiqa.",
      gNeedTitle: "Kerak bo'ladi",
      gNeed1: "Google akkaunt (jadval shu akkauntda bo'ladi)",
      gNeed2: "Windows 10/11 kompyuter, skaner USB orqali ulangan (Epson DS-530 II sinovdan o'tgan)",
      gNeed3: "Ixtiyoriy: Uzum'dan yuklab olingan «Остаток» jadvali — SKU 100% aniq bo'lishi uchun",

      g1t: "Google Cloud'da service account va kalit yarating",
      g1b: "Service account — ilova uchun alohida «texnik» Google hisobi. U faqat siz ruxsat bergan jadvallarni ko'radi.",
      g1l1: CLOUD + " ga kiring. Yuqoridagi loyiha tanlagichdan <b>New project</b> → nomi, masalan <code>Qaytnoma</code> → <b>Create</b>.",
      g1l2: "<b>APIs &amp; Services → Library</b> bo'limida <code>Google Sheets API</code> ni toping va <b>Enable</b> bosing.",
      g1l3: "<b>IAM &amp; Admin → Service Accounts → Create service account</b>. Nomi ixtiyoriy (<code>qaytnoma</code>), rol tanlash shart emas — <b>Done</b>.",
      g1l4: "Yaratilgan akkauntni oching → <b>Keys</b> → <b>Add key → Create new key → JSON → Create</b>. Brauzer <code>.json</code> faylni yuklab oladi.",
      g1l5: "Faylni doimiy joyga ko'chiring, masalan <code>C:\\Qaytnoma\\service-account.json</code>. Ichidagi <code>client_email</code> qatorini (…<code>@…iam.gserviceaccount.com</code>) keyingi qadamda ishlatasiz.",
      g1n: "<b>Bu fayl — kalit.</b> Uni Telegram'da yubormang, umumiy papkaga qo'ymang, Google Sheets'ga yuklamang. Kalit tarqalib ketsa, Google Cloud'da <b>Keys</b> bo'limidan o'chirib, yangisini yarating.",

      g2t: "Jadvalni tayyorlang va service account'ga ruxsat bering",
      g2b: "Ilova qatorlarni siz ko'rsatgan varaqqa qo'shib boradi. Ustun sarlavhalarini o'zi yozadi, tekshiruv izohlari uchun esa _log varag'ini o'zi yaratadi.",
      g2l1: "Google Sheets'da yangi jadval yarating (yoki mavjudini oching). Pastdagi varaq (tab) nomini eslab qoling — odatda <code>Sheet1</code> yoki <code>Лист1</code>. Varaq bo'sh bo'lishi mumkin.",
      g2l2: "O'ng yuqoridagi <b>Share</b> (Ulashish) → 1-qadamdagi <code>client_email</code> manzilini qo'shing → huquq <b>Editor</b> (Muharrir) → <b>Send</b>. «Notify» belgisini olib tashlash mumkin.",
      g2l3: "Brauzer manzilidan jadval ID sini ko'chiring — <code>/d/</code> va <code>/edit</code> orasidagi uzun satr:",
      g2n: "Natija ustunlari: <code>Номер документа</code> · <code>Ид документа</code> · <code>Дата составления</code> · <code>СКУ</code> · <code>ШК</code> · <code>Кол-во</code> · <code>⚠</code>. Har bir hujjatning har bir tovar qatori — jadvalda alohida qator.",

      g3t: "Ilovani o'rnating va Sozlamalar oynasini to'ldiring",
      g3b: "O'rnatgichni ishga tushiring. Ilova soat yonidagi tray'da paydo bo'ladi va hali sozlanmagani uchun <b>Sozlamalar</b> oynasini o'zi ochadi (keyinroq: tray ikonkasi → <code>Sozlamalar…</code>). <b>Google Sheets</b> bo'limini to'ldiring:",
      g3f1k: 'Spreadsheet ID',
      g3f1v: "2-qadamda ko'chirilgan ID. Faqat ID — to'liq havola emas.",
      g3f2k: 'Varaq nomi',
      g3f2v: "Jadval pastidagi tab nomi bilan <b>aynan</b> bir xil (<code>Sheet1</code>, <code>Лист1</code>…). Katta-kichik harf va bo'shliqlar farq qiladi.",
      g3f3k: 'Service account kaliti',
      g3f3v: "<b>Tanlash…</b> orqali 1-qadamdagi <code>.json</code> faylni ko'rsating.",
      g3f4k: '⚠ bilan belgilash',
      g3f4v: "Yoqiq qoldiring. Qiymati shubhali qatorlar (masalan miqdor o'qilmagan) <code>⚠</code> ustunida belgilanadi, sababi <code>_log</code> varag'iga yoziladi.",
      g3n: "<b>Ulanishni tekshirish</b> tugmasini bosing. <code>Ulanish muvaffaqiyatli: \"jadval nomi\"</code> chiqsa — hammasi joyida, <b>Saqlash</b> ni bosing. Xato chiqsa, pastdagi «Tez-tez uchraydigan muammolar» ga qarang.",

      g4t: 'Fayllar',
      g4f1k: 'PDF arxivi papkasi',
      g4f1v: "Har bir skanerlangan hujjat <code>{papka}\\{skan sanasi}\\{hujjat raqami}.pdf</code> ko'rinishida saqlanadi — keyin tekshirish uchun. Standart: <code>Documents\\Invoices</code>. Tray'dagi <code>Hujjatlar papkasi</code> shu papkani ochadi.",
      g4f2k: 'Kuzatiladigan papka (ixtiyoriy)',
      g4f2v: "Skanerning <b>o'z tugmasi</b> bilan skan qilsangiz, Epson dasturi fayllarni qaysi papkaga yozsa, shu papkani ko'rsating — ilova yangi tushgan fayllarni o'zi qayta ishlaydi. Ilovadagi <code>Skanerlash</code> tugmasidan foydalansangiz, bo'sh qoldiring.",

      g5t: 'Uzum katalogi (Баркод → Скю) — tavsiya etiladi',
      g5b: "SKU kodini rasmdan o'qish aniqligi atigi ~47%: kirill va lotin harflari (С/C, Е/E, Р/P) bir-biriga o'xshaydi. Shtrix-kod esa 100% o'qiladi. Katalog ulansa, SKU shtrix-kod bo'yicha Uzum'ning o'z jadvalidan olinadi va xato bo'lmaydi.",
      g5f1k: 'Katalog jadvali ID',
      g5f1v: "Uzum seller kabinetidan yuklab olingan qoldiq jadvali («Остаток Узум») joylashgan Google Sheets ID si. Bu jadvalni ham service account'ga ulashing — <b>Viewer</b> yetarli.",
      g5f2k: 'Varaq nomi',
      g5f2v: 'Katalog turgan varaq, standart <code>Остаток Узум</code>.',
      g5f3k: 'Скю / Баркод ustunlari',
      g5f3v: "Ustun harflari. Uzum eksportida standart: Скю — <code>B</code>, Баркод — <code>G</code>. Jadvalingiz boshqacha bo'lsa, harflarni moslang.",
      g5f4k: "Yangilash oralig'i",
      g5f4v: "<code>24</code> soat: katalog shundan eski bo'lsa, skanerlashdan oldin o'zi yangilanadi. Uzum'dan yangi eksport yuklaganingizdan keyin tray'dan <code>Katalogni yangilash</code> ni bosib qo'ying.",
      g5n: "Katalog bo'sh qoldirilsa, ilova ishlayveradi — lekin SKU faqat OCR dan olinadi va ko'p qatorlar <code>⚠</code> bilan belgilanadi.",

      g6t: 'Skaner',
      g6b: "Ilova skanerni Windows'ning WIA drayveri orqali to'g'ridan-to'g'ri boshqaradi — Epson Scan yoki Document Capture Pro o'rnatilgan bo'lishi shart emas. Skaner Windows'ning «Printers & scanners» ro'yxatida ko'rinsa, yetarli.",
      g6f1k: 'Qurilma nomi',
      g6f1v: "Nomning bir qismi yetarli: <code>DS-530</code>. Boshqa skaner bo'lsa, uning Windows'dagi nomidan bir qism (masalan <code>ADS-</code>, <code>ScanSnap</code>).",
      g6f2k: 'Ruxsat (DPI)',
      g6f2v: '<code>300</code> qoldiring. Sinovlarda 600 DPI aniqlikni oshirmadi, skanerlash va qayta ishlash esa ikki barobar sekinlashdi.',

      g7t: 'Ishlatish',
      g7l1: "Hujjatlarni skanerning avtomatik uzatgichiga (ADF) soling. Bir nechta hujjatni ketma-ket qo'yish mumkin — ilova sahifalarni hujjatlarga o'zi ajratadi (har hujjatning birinchi sahifasi sarlavhali).",
      g7l2: "Tray ikonkasi → <code>Skanerlash</code>. Ikonka ish paytida o'zgaradi, menyuda <code>Sahifa 2/4</code> kabi holat ko'rinadi.",
      g7l3: "Tugagach menyuda xulosa chiqadi: <code>14:05 — 3 hujjat, 36 qator, 2 ⚠</code>. Jadvalni ochish uchun <code>Google Sheets</code> bandini bosing.",
      g7l4: "<code>⚠</code> belgili qatorlarni qog'oz yoki PDF bilan solishtirib tuzating; sabab <code>_log</code> varag'ida (qaysi hujjat, qaysi qator, qaysi maydon). Qo'lda yozilgan tuzatishlar ataylab o'qilmaydi — jadvalga faqat bosma qiymat tushadi.",
      g7mt: 'Tray menyusi',
      g7m1: "Ilovani vaqtincha o'chirish/yoqish (kuzatuv ham to'xtaydi)",
      g7m2: "ADF'dagi hujjatlarni skanerlab, qayta ishlash",
      g7m3: 'Uzum katalogini hoziroq qayta yuklash',
      g7m4: 'PDF arxivi papkasini ochish',
      g7m5: 'Natija jadvalini brauzerda ochish',
      g7m6: 'Sozlamalar oynasi',
      g7m7: 'Windows bilan avtomatik ishga tushish (standart: yoqiq)',
      g7m8: "Ilovani to'liq yopish",

      faqTitle: 'Tez-tez uchraydigan muammolar',
      q1: 'Menyuda «Sozlash kerak: Spreadsheet ID, Service account kaliti» turibdi',
      a1: "Sozlamalar to'ldirilmagan yoki saqlanmagan. <code>Sozlamalar…</code> ni ochib, 3-qadamdagi maydonlarni to'ldiring va <b>Saqlash</b> ni bosing.",
      q2: '«The caller does not have permission» yoki 403',
      a2: "Jadval service account'ga ulashilmagan. Jadvalda <b>Share</b> → <code>client_email</code> manzilini <b>Editor</b> huquqi bilan qo'shing (2-qadam). Katalog jadvali uchun ham xuddi shunday.",
      q3: '«Requested entity was not found» yoki 404',
      a3: "Spreadsheet ID noto'g'ri. Havoladagi <code>/d/</code> va <code>/edit</code> orasidagi qismni to'liq, bo'shliqsiz ko'chiring.",
      q4: "«…varag'i yo'q. Mavjud: Лист1»",
      a4: "Varaq nomi jadvaldagi tab nomiga mos emas. Xabarda mavjud varaqlar ro'yxati chiqadi — shundan birini aynan ko'chirib yozing.",
      q5: 'Skanerlash boshlanmayapti / skaner topilmadi',
      a5: "USB kabelini va skaner yoqilganini tekshiring; Windows <b>Settings → Bluetooth &amp; devices → Printers &amp; scanners</b> ro'yxatida skaner ko'rinishi kerak. Sozlamalardagi <b>Qurilma nomi</b> o'sha nomning bir qismi bo'lsin. Boshqa dastur (Epson Scan) skanerni band qilgan bo'lsa, uni yoping.",
      q6: 'Sozlamalar qayerda saqlanadi?',
      a6: "<code>%APPDATA%\\barcodeer\\config.json</code> faylida. Ilovani boshqa kompyuterga ko'chirganda shu faylni va service account <code>.json</code> ini olib o'ting.",

      instTitle: "O'rnatish",
      instLede: "To'rt qadam, taxminan bir daqiqa. Administrator huquqi talab qilinmaydi.",
      s1t: 'Faylni yuklab oling',
      s1b: 'qaytnoma-setup.exe faylini yuklab oling va ishga tushiring.',
      s2t: 'Windows ogohlantirsa',
      s2b: "«Ko'proq ma'lumot» → «Baribir ishga tushirish» ni bosing. Bu imzosiz ilovalar uchun oddiy holat.",
      s3t: 'Skanerni ulang',
      s3b: "Skaner tizimga ulangan bo'lsa, ilova uni o'zi topadi va ro'yxatda ko'rsatadi.",
      s4t: 'Sozlang',
      s4b: "Birinchi ochilishda Sozlamalar oynasi o'zi chiqadi. Uni <a href=\"#sozlash\">yo'riqnoma</a> bo'yicha to'ldiring — Google kaliti, jadval ID si va ruxsat. Shundan keyin ilova o'zi ishlaydi.",
      foot: 'Windows 10/11 · 64-bit · Versiya 1.0.0',
    },
    ru: {
      navSetup: 'Настройка',
      navInstall: 'Установка',
      badge: 'Приложение для Windows',
      h1: 'Сканер работает — данные попадают в таблицу.',
      lede: 'qaytnoma следит за сканером, подключённым к системе. Если документ относится к Uzum Invoice, приложение извлекает из него данные и записывает их в таблицу.',
      cta: 'Скачать для Windows',
      cta2: 'Скачать (.exe)',
      metaTop: '.exe · Windows 10/11 · 64-bit',
      metaBottom: 'Версия 1.0.0 · 132 МБ',
      featTitle: 'Что делает',
      f1t: 'Следит за сканером',
      f1b: 'Работает в фоне. Как только сканер считывает документ, приложение сразу его принимает.',
      f2t: 'Распознаёт Uzum Invoice',
      f2b: 'Отбирает только документы Uzum Invoice, остальные не трогает.',
      f3t: 'Извлекает данные',
      f3b: 'Считывает нужные поля из документа и приводит их к единому виду.',
      f4t: 'Пишет в таблицу',
      f4b: 'Каждый документ становится новой строкой в таблице. Вручную вводить не нужно.',
      shot3: 'Результат, записанный в таблицу — тестовые данные. Знак ⚠ означает, что строку нужно проверить вручную; причина — на листе _log.',
      testBadge: 'Тестовые данные',

      /* ---- Инструкция по настройке ---- */
      gTitle: 'Как правильно настроить приложение',
      gLede: 'Приложение пишет в Google Sheets не от вашего имени, а от имени созданного вами «сервисного аккаунта». Поэтому настройка состоит из двух частей: на стороне Google — ключ и доступ, на стороне приложения — ID таблицы и этот ключ. Делается один раз, около 10 минут.',
      gNeedTitle: 'Понадобится',
      gNeed1: 'Google-аккаунт (в нём будет таблица)',
      gNeed2: 'Компьютер с Windows 10/11, сканер подключён по USB (проверено на Epson DS-530 II)',
      gNeed3: 'По желанию: выгрузка «Остаток» из Uzum — чтобы SKU определялся со 100% точностью',

      g1t: 'Создайте сервисный аккаунт и ключ в Google Cloud',
      g1b: 'Сервисный аккаунт — отдельная «техническая» учётная запись Google для приложения. Она видит только те таблицы, к которым вы дали доступ.',
      g1l1: 'Откройте ' + CLOUD + '. В переключателе проектов сверху — <b>New project</b> → имя, например <code>Qaytnoma</code> → <b>Create</b>.',
      g1l2: 'В разделе <b>APIs &amp; Services → Library</b> найдите <code>Google Sheets API</code> и нажмите <b>Enable</b>.',
      g1l3: '<b>IAM &amp; Admin → Service Accounts → Create service account</b>. Имя любое (<code>qaytnoma</code>), роль выбирать не нужно — <b>Done</b>.',
      g1l4: 'Откройте созданный аккаунт → <b>Keys</b> → <b>Add key → Create new key → JSON → Create</b>. Браузер скачает файл <code>.json</code>.',
      g1l5: 'Переместите файл в постоянное место, например <code>C:\\Qaytnoma\\service-account.json</code>. Строка <code>client_email</code> внутри (…<code>@…iam.gserviceaccount.com</code>) понадобится на следующем шаге.',
      g1n: '<b>Этот файл — ключ.</b> Не пересылайте его в Telegram, не кладите в общие папки, не загружайте в Google Sheets. Если ключ утёк — удалите его в разделе <b>Keys</b> и создайте новый.',

      g2t: 'Подготовьте таблицу и дайте доступ сервисному аккаунту',
      g2b: 'Приложение дописывает строки на указанный вами лист. Заголовки столбцов оно создаёт само, а для пояснений к проверке само заводит лист _log.',
      g2l1: 'Создайте в Google Sheets новую таблицу (или откройте существующую). Запомните имя листа (вкладки) внизу — обычно <code>Sheet1</code> или <code>Лист1</code>. Лист может быть пустым.',
      g2l2: 'Справа сверху <b>Share</b> (Настройки доступа) → добавьте адрес <code>client_email</code> из шага 1 → права <b>Editor</b> (Редактор) → <b>Send</b>. Галочку «Notify» можно снять.',
      g2l3: 'Скопируйте ID таблицы из адресной строки браузера — длинная строка между <code>/d/</code> и <code>/edit</code>:',
      g2n: 'Столбцы результата: <code>Номер документа</code> · <code>Ид документа</code> · <code>Дата составления</code> · <code>СКУ</code> · <code>ШК</code> · <code>Кол-во</code> · <code>⚠</code>. Каждая товарная строка каждого документа — отдельная строка таблицы.',

      g3t: 'Установите приложение и заполните окно настроек',
      g3b: 'Запустите установщик. Приложение появится в трее рядом с часами и, поскольку ещё не настроено, само откроет окно <b>настроек</b> (позже: иконка в трее → <code>Sozlamalar…</code>). Заполните раздел <b>Google Sheets</b>:',
      g3f1k: 'Spreadsheet ID',
      g3f1v: 'ID, скопированный на шаге 2. Только ID — не вся ссылка.',
      g3f2k: 'Varaq nomi (имя листа)',
      g3f2v: '<b>В точности</b> как вкладка внизу таблицы (<code>Sheet1</code>, <code>Лист1</code>…). Регистр и пробелы имеют значение.',
      g3f3k: 'Service account kaliti (ключ)',
      g3f3v: 'Через <b>Tanlash…</b> укажите файл <code>.json</code> из шага 1.',
      g3f4k: 'Отметка ⚠',
      g3f4v: 'Оставьте включённой. Сомнительные строки (например, не прочитано количество) помечаются в столбце <code>⚠</code>, причина записывается на лист <code>_log</code>.',
      g3n: 'Нажмите <b>Ulanishni tekshirish</b> (проверить подключение). Если появилось <code>Ulanish muvaffaqiyatli: "имя таблицы"</code> — всё в порядке, нажмите <b>Saqlash</b> (сохранить). При ошибке смотрите раздел «Частые проблемы» ниже.',

      g4t: 'Файлы',
      g4f1k: 'PDF arxivi papkasi (архив PDF)',
      g4f1v: 'Каждый отсканированный документ сохраняется как <code>{папка}\\{дата скана}\\{номер документа}.pdf</code> — для последующей проверки. По умолчанию <code>Documents\\Invoices</code>. Пункт <code>Hujjatlar papkasi</code> в трее открывает эту папку.',
      g4f2k: 'Kuzatiladigan papka (папка наблюдения, необязательно)',
      g4f2v: 'Если сканируете <b>кнопкой на сканере</b>, укажите папку, куда программа Epson складывает файлы — приложение само обработает новые. Если пользуетесь кнопкой <code>Skanerlash</code> в приложении, оставьте пустым.',

      g5t: 'Каталог Uzum (Баркод → Скю) — рекомендуется',
      g5b: 'Точность чтения SKU с изображения всего ~47%: кириллические и латинские буквы (С/C, Е/E, Р/P) неотличимы. Штрих-код же читается на 100%. С подключённым каталогом SKU берётся по штрих-коду из таблицы самого Uzum и не ошибается.',
      g5f1k: 'Katalog jadvali ID',
      g5f1v: 'ID Google-таблицы, куда загружена выгрузка остатков из кабинета продавца Uzum («Остаток Узум»). Эту таблицу тоже нужно открыть сервисному аккаунту — достаточно <b>Viewer</b>.',
      g5f2k: 'Varaq nomi (имя листа)',
      g5f2v: 'Лист с каталогом, по умолчанию <code>Остаток Узум</code>.',
      g5f3k: 'Столбцы Скю / Баркод',
      g5f3v: 'Буквы столбцов. В выгрузке Uzum по умолчанию: Скю — <code>B</code>, Баркод — <code>G</code>. Если ваша таблица устроена иначе, поправьте буквы.',
      g5f4k: 'Интервал обновления',
      g5f4v: '<code>24</code> часа: если каталог старше, он обновится сам перед сканированием. После загрузки новой выгрузки из Uzum нажмите в трее <code>Katalogni yangilash</code>.',
      g5n: 'Если каталог не указан, приложение всё равно работает — но SKU берётся только из OCR, и многие строки получат отметку <code>⚠</code>.',

      g6t: 'Сканер',
      g6b: 'Приложение управляет сканером напрямую через драйвер WIA Windows — Epson Scan или Document Capture Pro устанавливать не нужно. Достаточно, чтобы сканер был виден в списке «Принтеры и сканеры» Windows.',
      g6f1k: 'Qurilma nomi (имя устройства)',
      g6f1v: 'Достаточно части имени: <code>DS-530</code>. Для другого сканера — часть его имени в Windows (например <code>ADS-</code>, <code>ScanSnap</code>).',
      g6f2k: 'Ruxsat (DPI)',
      g6f2v: 'Оставьте <code>300</code>. В тестах 600 DPI не повысили точность, а сканирование и обработка стали вдвое медленнее.',

      g7t: 'Использование',
      g7l1: 'Положите документы в автоподатчик (ADF). Можно несколько документов подряд — приложение само разделит страницы по документам (первая страница каждого — с шапкой).',
      g7l2: 'Иконка в трее → <code>Skanerlash</code>. Во время работы иконка меняется, в меню виден статус вроде <code>Sahifa 2/4</code>.',
      g7l3: 'По окончании в меню появится итог: <code>14:05 — 3 hujjat, 36 qator, 2 ⚠</code>. Пункт <code>Google Sheets</code> открывает таблицу.',
      g7l4: 'Строки с <code>⚠</code> сверьте с бумагой или PDF и исправьте; причина — на листе <code>_log</code> (какой документ, строка, поле). Рукописные исправления намеренно не читаются — в таблицу попадает только печатное значение.',
      g7mt: 'Меню в трее',
      g7m1: 'Временно выключить/включить приложение (наблюдение тоже останавливается)',
      g7m2: 'Отсканировать документы из ADF и обработать',
      g7m3: 'Перезагрузить каталог Uzum прямо сейчас',
      g7m4: 'Открыть папку с архивом PDF',
      g7m5: 'Открыть таблицу результатов в браузере',
      g7m6: 'Окно настроек',
      g7m7: 'Автозапуск вместе с Windows (по умолчанию включён)',
      g7m8: 'Полностью закрыть приложение',

      faqTitle: 'Частые проблемы',
      q1: 'В меню висит «Sozlash kerak: Spreadsheet ID, Service account kaliti»',
      a1: 'Настройки не заполнены или не сохранены. Откройте <code>Sozlamalar…</code>, заполните поля из шага 3 и нажмите <b>Saqlash</b>.',
      q2: '«The caller does not have permission» или 403',
      a2: 'Таблица не открыта сервисному аккаунту. В таблице <b>Share</b> → добавьте адрес <code>client_email</code> с правами <b>Editor</b> (шаг 2). То же для таблицы каталога.',
      q3: '«Requested entity was not found» или 404',
      a3: 'Неверный Spreadsheet ID. Скопируйте часть ссылки между <code>/d/</code> и <code>/edit</code> целиком, без пробелов.',
      q4: "«…varag'i yo'q. Mavjud: Лист1»",
      a4: 'Имя листа не совпадает с вкладкой в таблице. В сообщении перечислены существующие листы — скопируйте одно из имён точно.',
      q5: 'Сканирование не начинается / сканер не найден',
      a5: 'Проверьте USB-кабель и что сканер включён; он должен быть в списке <b>Параметры → Bluetooth и устройства → Принтеры и сканеры</b>. <b>Qurilma nomi</b> в настройках — часть этого имени. Если сканер занят другой программой (Epson Scan), закройте её.',
      q6: 'Где хранятся настройки?',
      a6: 'В файле <code>%APPDATA%\\barcodeer\\config.json</code>. При переносе на другой компьютер возьмите этот файл и <code>.json</code> сервисного аккаунта.',

      instTitle: 'Установка',
      instLede: 'Четыре шага, около минуты. Права администратора не требуются.',
      s1t: 'Скачайте файл',
      s1b: 'Скачайте qaytnoma-setup.exe и запустите его.',
      s2t: 'Если Windows предупредит',
      s2b: 'Нажмите «Подробнее» → «Выполнить в любом случае». Для неподписанных приложений это обычное дело.',
      s3t: 'Подключите сканер',
      s3b: 'Если сканер подключён к системе, приложение найдёт его само и покажет в списке.',
      s4t: 'Настройте',
      s4b: 'При первом запуске окно настроек откроется само. Заполните его по <a href="#sozlash">инструкции</a> — ключ Google, ID таблицы и доступ. Дальше приложение работает само.',
      foot: 'Windows 10/11 · 64-bit · Версия 1.0.0',
    },
  };

  var STORAGE_KEY = 'qaytnoma.lang';
  var textNodes = document.querySelectorAll('[data-t]');
  var htmlNodes = document.querySelectorAll('[data-th]');
  var buttons = document.querySelectorAll('.lang__btn');

  function apply(lang) {
    var copy = COPY[lang] || COPY.uz;
    var i, key;

    for (i = 0; i < textNodes.length; i++) {
      key = textNodes[i].getAttribute('data-t');
      if (copy[key] !== undefined) textNodes[i].textContent = copy[key];
    }
    for (i = 0; i < htmlNodes.length; i++) {
      key = htmlNodes[i].getAttribute('data-th');
      if (copy[key] !== undefined) htmlNodes[i].innerHTML = copy[key];
    }
    for (var j = 0; j < buttons.length; j++) {
      var active = buttons[j].getAttribute('data-lang') === lang;
      buttons[j].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    document.documentElement.lang = lang;

    // Xotira mavjud bo'lmagan holatlar bor (maxfiy oyna, o'chirilgan cookie) —
    // tanlov saqlanmasa ham sahifa ishlashda davom etishi kerak.
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (err) {
      /* saqlab bo'lmadi — muhim emas */
    }
  }

  function initial() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && COPY[saved]) return saved;
    } catch (err) {
      /* o'qib bo'lmadi */
    }
    return (navigator.language || '').slice(0, 2) === 'ru' ? 'ru' : 'uz';
  }

  for (var k = 0; k < buttons.length; k++) {
    buttons[k].addEventListener('click', function (event) {
      apply(event.currentTarget.getAttribute('data-lang'));
    });
  }

  apply(initial());

  /*
   * O'rnatgichning versiyasi va hajmi `download/meta.json` dan olinadi —
   * uni `scripts/build-installer.mjs` har yig'ishda yozadi. Fayl bo'lmasa
   * (masalan o'rnatgich hali yig'ilmagan) yuqoridagi matn o'z holicha qoladi.
   */
  fetch('download/meta.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    })
    .then(function (meta) {
      var mb = Math.round(meta.sizeBytes / 1024 / 1024);

      COPY.uz.metaBottom = 'Versiya ' + meta.version + ' · ' + mb + ' MB';
      COPY.ru.metaBottom = 'Версия ' + meta.version + ' · ' + mb + ' МБ';
      COPY.uz.foot = 'Windows 10/11 · 64-bit · Versiya ' + meta.version;
      COPY.ru.foot = 'Windows 10/11 · 64-bit · Версия ' + meta.version;

      var lang = document.documentElement.lang === 'ru' ? 'ru' : 'uz';
      var slot = document.querySelector('[data-t="metaBottom"]');
      if (slot) slot.textContent = COPY[lang].metaBottom;
      var foot = document.querySelector('[data-t="foot"]');
      if (foot) foot.textContent = COPY[lang].foot;
    })
    .catch(function () {
      /* meta.json yo'q — sahifadagi matn o'zgarmaydi */
    });
})();
