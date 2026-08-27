/*
 * Til almashtirish.
 *
 * Matnlar Claude Design maketidan (`Qaytnoma Download.dc.html`) o'zgarishsiz
 * olingan. Maketda ular `DCLogic.state.lang` orqali almashtirilgan — bu yerda
 * o'sha mantiq oddiy DOM bilan takrorlangan.
 */
(function () {
  'use strict';

  var COPY = {
    uz: {
      badge: 'Windows uchun ilova',
      h1: "Skaner ishlaydi — ma'lumot jadvalga tushadi.",
      lede: "qaytnoma tizimga ulangan skanerni kuzatib turadi. Hujjat Uzum Invoice bo'lsa, ilova undagi ma'lumotlarni ajratib olib spreadsheetga yozib boradi.",
      cta: 'Windows uchun yuklab olish',
      cta2: 'Yuklab olish (.exe)',
      metaTop: '.exe · Windows 10/11 · 64-bit',
      metaBottom: 'Versiya 1.0 · 48 MB',
      featTitle: 'Nima qiladi',
      f1t: 'Skanerni kuzatadi',
      f1b: "Fonda ishlaydi. Skaner hujjatni o'qishi bilan ilova uni darhol qabul qiladi.",
      f2t: "Uzum Invoice'ni aniqlaydi",
      f2b: 'Faqat Uzum Invoice hujjatlarini ajratadi, qolganlariga tegmaydi.',
      f3t: "Ma'lumotni ajratib oladi",
      f3b: "Hujjat ichidan kerakli maydonlarni o'qib, tartibli ko'rinishga keltiradi.",
      f4t: 'Spreadsheetga yozadi',
      f4b: "Har bir hujjat jadvalga yangi qator bo'lib tushadi. Qo'lda kiritish kerak emas.",
      shot2: 'Skanerdan kelgan hujjatlar oqimi',
      shot3: "Spreadsheetga yozilgan natija — test ma'lumot",
      testBadge: "Test ma'lumot",
      slotEmpty: "Skrinshot qo'yilmagan",
      instTitle: "O'rnatish",
      instLede: "To'rt qadam, taxminan bir daqiqa. Administrator huquqi talab qilinmaydi.",
      s1t: 'Faylni yuklab oling',
      s1b: 'qaytnoma-setup.exe faylini yuklab oling va ishga tushiring.',
      s2t: 'Windows ogohlantirsa',
      s2b: "«Ko'proq ma'lumot» → «Baribir ishga tushirish» ni bosing. Bu imzosiz ilovalar uchun oddiy holat.",
      s3t: 'Skanerni ulang',
      s3b: "Skaner tizimga ulangan bo'lsa, ilova uni o'zi topadi va ro'yxatda ko'rsatadi.",
      s4t: 'Spreadsheet havolasini kiriting',
      s4b: "Ma'lumot yoziladigan jadval havolasini qo'ying va ruxsat bering. Shundan keyin ilova o'zi ishlaydi.",
      foot: 'Windows 10/11 · 64-bit · Versiya 1.0',
    },
    ru: {
      badge: 'Приложение для Windows',
      h1: 'Сканер работает — данные попадают в таблицу.',
      lede: 'qaytnoma следит за сканером, подключённым к системе. Если документ относится к Uzum Invoice, приложение извлекает из него данные и записывает их в таблицу.',
      cta: 'Скачать для Windows',
      cta2: 'Скачать (.exe)',
      metaTop: '.exe · Windows 10/11 · 64-bit',
      metaBottom: 'Версия 1.0 · 48 МБ',
      featTitle: 'Что делает',
      f1t: 'Следит за сканером',
      f1b: 'Работает в фоне. Как только сканер считывает документ, приложение сразу его принимает.',
      f2t: 'Распознаёт Uzum Invoice',
      f2b: 'Отбирает только документы Uzum Invoice, остальные не трогает.',
      f3t: 'Извлекает данные',
      f3b: 'Считывает нужные поля из документа и приводит их к единому виду.',
      f4t: 'Пишет в таблицу',
      f4b: 'Каждый документ становится новой строкой в таблице. Вручную вводить не нужно.',
      shot2: 'Поток документов со сканера',
      shot3: 'Результат, записанный в таблицу — тестовые данные',
      testBadge: 'Тестовые данные',
      slotEmpty: 'Скриншот не добавлен',
      instTitle: 'Установка',
      instLede: 'Четыре шага, около минуты. Права администратора не требуются.',
      s1t: 'Скачайте файл',
      s1b: 'Скачайте qaytnoma-setup.exe и запустите его.',
      s2t: 'Если Windows предупредит',
      s2b: 'Нажмите «Подробнее» → «Выполнить в любом случае». Для неподписанных приложений это обычное дело.',
      s3t: 'Подключите сканер',
      s3b: 'Если сканер подключён к системе, приложение найдёт его само и покажет в списке.',
      s4t: 'Укажите ссылку на таблицу',
      s4b: 'Вставьте ссылку на таблицу для записи и выдайте доступ. Дальше приложение работает само.',
      foot: 'Windows 10/11 · 64-bit · Версия 1.0',
    },
  };

  var STORAGE_KEY = 'qaytnoma.lang';
  var nodes = document.querySelectorAll('[data-t]');
  var buttons = document.querySelectorAll('.lang__btn');

  function apply(lang) {
    var copy = COPY[lang] || COPY.uz;

    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-t');
      if (copy[key] !== undefined) nodes[i].textContent = copy[key];
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
      var lang = document.documentElement.lang === 'ru' ? 'ru' : 'uz';
      var mb = Math.round(meta.sizeBytes / 1024 / 1024);
      var unit = lang === 'ru' ? 'МБ' : 'MB';
      var word = lang === 'ru' ? 'Версия' : 'Versiya';
      var text = word + ' ' + meta.version + ' · ' + mb + ' ' + unit;

      COPY.uz.metaBottom = 'Versiya ' + meta.version + ' · ' + mb + ' MB';
      COPY.ru.metaBottom = 'Версия ' + meta.version + ' · ' + mb + ' МБ';
      COPY.uz.foot = 'Windows 10/11 · 64-bit · Versiya ' + meta.version;
      COPY.ru.foot = 'Windows 10/11 · 64-bit · Версия ' + meta.version;

      var slot = document.querySelector('[data-t="metaBottom"]');
      if (slot) slot.textContent = text;
      var foot = document.querySelector('[data-t="foot"]');
      if (foot) foot.textContent = COPY[lang].foot;
    })
    .catch(function () {
      /* meta.json yo'q — sahifadagi matn o'zgarmaydi */
    });
})();
