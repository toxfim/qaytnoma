/**
 * Mahsulot jadvalining to'rini (grid) aniqlash.
 *
 * NEGA shtrix-kod anchor emas: dastlabki reja qatorlarni dekodlangan shtrix-kod
 * bounding box'lariga bog'lashni ko'zda tutgan edi. Real skanlarda ikkita
 * muammo chiqdi:
 *   1. ZXing to'liq sahifada 0 natija beradi — faqat tor kesmalarda ishonchli
 *      ishlaydi (sarlavha bloklari detektsiyani buzadi);
 *   2. shtrix-kodning o'zi chop etishda so'nib qolishi mumkin
 *      (`15-0000163307` — o'ng 30% i yo'q, hech qachon dekodlanmaydi).
 *
 * Bosma to'r esa har doim toza va to'liq. Shuning uchun to'r birlamchi anchor,
 * shtrix-kod esa har bir katakdan alohida o'qiladi.
 *
 * Ikkita nozik joy real skanlardan o'rganildi:
 *   - Gorizontal chiziq bir necha bo'lakka uzilishi mumkin, shuning uchun
 *     "eng uzun uzluksiz tasma" emas, PROYEKSIYA CHO'QQISI + prominence.
 *   - Shtrix-kod chiziqchalari ham vertikal chiziqqa o'xshaydi. Ular qator
 *     balandligining ~55% ini egallaydi, haqiqiy ustun chizig'i esa 100% ini —
 *     shuning uchun `minVLineFill` 0.85 da ular toza ajraladi.
 */
import type { Box } from '@barcodeer/shared';

export interface TableGrid {
  /** Jadvalning tashqi chegarasi. */
  bounds: Box;
  /** Vertikal chiziqlar x koordinatalari (chapdan o'ngga). */
  columnEdges: number[];
  /** Gorizontal chiziqlar y koordinatalari — N qator uchun N+1 ta. */
  rowEdges: number[];
}

export interface GridOptions extends ProfileOptions {
  /** Gorizontal chiziq uchun eng kam qora piksel ulushi. */
  minHLineFrac?: number;
  /** Cho'qqining atrofdan ustunligi (matn bloklarini rad etish uchun). */
  minProminence?: number;
  /** Vertikal chiziq uchun eng kam to'ldirilganlik (shtrix-kodni rad etadi). */
  minVLineFill?: number;
  /** Qator bandining eng kichik balandligi (piksel). */
  minRowHeight?: number;
  /** Jadvalda kutilayotgan eng kam ustun chegaralari soni. */
  minColumnEdges?: number;
  /** Rasmning chetidagi shu ulushdagi zona e'tiborga olinmaydi (skaner soyasi). */
  edgeMarginFrac?: number;
}

export interface HLine {
  y: number;
  frac: number;
}

interface Band {
  top: number;
  bottom: number;
  vlines: number[];
}

/**
 * Deskew qilingan sahifadan mahsulot jadvalini topadi.
 *
 * Sahifada bir nechta jadval bo'lishi mumkin (Комитент, Комиссионер bloklari).
 * Mahsulot jadvali — vertikal chiziqlari KETMA-KET bandlar bo'ylab bir xil
 * qoladigan eng uzun blok. Qat'iy ustun soniga tayanmaymiz, chunki
 * `Сумма` ustuni skan chetida kesilib qolishi mumkin.
 */
export function detectItemTable(
  bin: Uint8Array,
  width: number,
  height: number,
  opts: GridOptions = {},
): TableGrid | null {
  const minRowHeight = opts.minRowHeight ?? Math.max(8, Math.round(height * 0.006));
  const minVLineFill = opts.minVLineFill ?? 0.85;
  const minColumnEdges = opts.minColumnEdges ?? 6;
  const margin = Math.round(width * (opts.edgeMarginFrac ?? 0.02));

  const profile = rowDarkProfile(bin, width, height, opts);
  const hLines = findHorizontalLines(bin, width, height, opts, profile);
  if (hLines.length < 3) return null;

  // Skanerning chekka soyasi butun sahifa balandligi bo'ylab qora ustun hosil
  // qiladi va soxta jadval chegarasi bo'lib ko'rinadi. Haqiqiy chegara faqat
  // jadval ichida mavjud — shuning uchun to'liq balandlikdagi ustunlarni
  // oldindan chiqarib tashlaymiz.
  const artifacts = findFullHeightColumns(bin, width, height);
  const artifactTolerance = Math.max(6, Math.round(width * 0.008));

  const bands: Band[] = [];
  for (let i = 0; i < hLines.length - 1; i++) {
    const top = hLines[i]!.y;
    const bottom = hLines[i + 1]!.y;
    if (bottom - top < minRowHeight) continue;
    const vlines = findVerticalLines(bin, width, top, bottom, minVLineFill).filter(
      (x) =>
        x >= margin &&
        x <= width - margin &&
        !artifacts.some((a) => Math.abs(a - x) <= artifactTolerance),
    );
    bands.push({ top, bottom, vlines });
  }

  // Eng uzun "bir xil ustunli" ketma-ketlikni topamiz.
  const tolerance = Math.max(6, Math.round(width * 0.005));
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;

  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    const usable = band.vlines.length >= minColumnEdges;
    const consistent =
      usable && runStart >= 0 && similarity(bands[i - 1]!.vlines, band.vlines, tolerance) >= 0.75;

    if (usable && (runStart < 0 || !consistent)) {
      // Yangi ketma-ketlik boshlanadi.
      if (runStart >= 0 && i - runStart > bestLen) {
        bestLen = i - runStart;
        bestStart = runStart;
      }
      runStart = i;
    } else if (!usable && runStart >= 0) {
      if (i - runStart > bestLen) {
        bestLen = i - runStart;
        bestStart = runStart;
      }
      runStart = -1;
    }
  }
  if (runStart >= 0 && bands.length - runStart > bestLen) {
    bestLen = bands.length - runStart;
    bestStart = runStart;
  }
  if (bestLen < 2 || bestStart < 0) return null;

  const chosen = bands.slice(bestStart, bestStart + bestLen);

  // Ustun chegaralari — barcha bandlar bo'ylab klasterlangan medianalar.
  const columnEdges = clusterMedian(
    chosen.flatMap((b) => b.vlines),
    tolerance,
    chosen.length * 0.5,
  );
  if (columnEdges.length < minColumnEdges) return null;

  // Mezon JADVALNING O'Z chiziqlariga nisbatan olinadi — sahifadagi barcha
  // chiziqlarning medianasi sarlavha bloklari tufayli chalg'ituvchi bo'ladi.
  const tableEdges = [chosen[0]!.top, ...chosen.map((b) => b.bottom)];
  const medianFrac = median(tableEdges.map((y) => profile[y] ?? 0));

  // Avval jadval OXIRINI cho'zamiz, keyin ichki yo'qolgan chiziqlarni
  // tiklaymiz — kengaytirish baland band qo'shishi mumkin va uni ham
  // `repairMissedLines` bo'lishi kerak.
  const extended = extendTableDown(tableEdges, profile, bin, width, height, columnEdges, {
    medianFrac,
    minVLineFill,
    artifacts,
    artifactTolerance,
    margin,
    tolerance,
    minColumnEdges,
  });
  const rowEdges = repairMissedLines(extended, profile, medianFrac);
  const left = columnEdges[0]!;
  const right = columnEdges[columnEdges.length - 1]!;

  return {
    bounds: {
      x: left,
      y: rowEdges[0]!,
      width: right - left,
      height: rowEdges[rowEdges.length - 1]! - rowEdges[0]!,
    },
    columnEdges,
    rowEdges,
  };
}

/**
 * Skanerning chekka soyasi / qog'oz cheti hosil qilgan soxta ustunlar.
 *
 * Ikkita shart birgalikda tekshiriladi:
 *   1. ustun sahifaning tashqi `zoneFrac` ulushida joylashgan;
 *   2. u sahifa balandligining deyarli hammasini egallaydi.
 *
 * Haqiqiy jadval chegarasi birinchi shartga tushmaydi (Uzum shablonida jadval
 * sahifa kengligining ~7% idan boshlanadi), shuning uchun to'liq sahifani
 * egallagan jadval ham xato o'chirilmaydi.
 *
 * Tekshiruv SILJISHGA CHIDAMLI: deskew aylantirishidan keyin skaner cheti
 * qiyshayadi va qat'iy x bo'yicha uzluksiz bo'lmaydi — shuning uchun balandlik
 * segmentlarga bo'linib, har segmentda kichik x-oynasi bo'ylab maksimum olinadi.
 */
export function findFullHeightColumns(
  bin: Uint8Array,
  width: number,
  height: number,
  opts: { minCoverage?: number; zoneFrac?: number; segments?: number } = {},
): number[] {
  const minCoverage = opts.minCoverage ?? 0.9;
  const zone = Math.round(width * (opts.zoneFrac ?? 0.055));
  const segments = opts.segments ?? 40;
  const drift = Math.max(4, Math.round(width * 0.008));
  const segHeight = Math.floor(height / segments);
  if (segHeight < 2) return [];

  // Faqat chekka zonalarni hisoblaymiz — o'rtasi baribir tekshirilmaydi.
  const inZone = (x: number) => x < zone || x >= width - zone;

  const fill = new Float32Array(width * segments);
  for (let s = 0; s < segments; s++) {
    const y0 = s * segHeight;
    const y1 = Math.min(height, y0 + segHeight);
    for (let x = 0; x < width; x++) {
      if (!inZone(x) && !inZone(x - drift) && !inZone(x + drift)) continue;
      let count = 0;
      for (let y = y0; y < y1; y++) if (bin[y * width + x] === 1) count++;
      fill[s * width + x] = count / (y1 - y0);
    }
  }

  const hits: number[] = [];
  for (let x = 0; x < width; x++) {
    if (!inZone(x)) continue;
    let covered = 0;
    for (let s = 0; s < segments; s++) {
      let best = 0;
      for (let dx = -drift; dx <= drift; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const v = fill[s * width + xx]!;
        if (v > best) best = v;
      }
      if (best >= 0.85) covered++;
    }
    if (covered / segments >= minCoverage) hits.push(x);
  }
  return hits;
}

/**
 * Jadvalning PASTKI chegarasini so'lg'in chiziq ortidan cho'zadi.
 *
 * NEGA KERAK: `repairMissedLines` faqat mavjud bandlar ICHIDAGI chiziqni
 * tiklaydi. Agar yo'qolgan chiziq jadvalning eng oxirgisi bo'lsa, uning
 * ostidagi qator umuman band hosil qilmaydi va sahifaning oxirgi qatori jimgina
 * yo'qoladi — hech qanday xatosiz.
 *
 * O'lchangan holat (15-0006740693, 1-sahifa): №13 qatorining pastki chizig'i
 * uzuq-yuluq bosilgan, proyeksiya ulushi atigi 0.317 (oston 0.45), shuning
 * uchun to'r y=2991 da to'xtagan. Natija: hujjatda 38 qator, sheetga 37 tasi
 * tushgan; `Итого` 132 o'rniga 100 chiqqan.
 *
 * HIMOYA — ostonani pasaytirish emas, VERTIKAL TUZILISH: qabul qilingan band
 * ichida jadvalning o'z ustun chegaralari topilishi shart. Bu `Итого` bandini
 * ham, imzo blokini ham avtomatik rad etadi, chunki ularda `Итого:` yozuvi
 * ustunlarni birlashtiradi va chegaralar soni yetmaydi.
 */
function extendTableDown(
  rowEdges: number[],
  profile: Float32Array,
  bin: Uint8Array,
  width: number,
  height: number,
  columnEdges: number[],
  opts: {
    medianFrac: number;
    minVLineFill: number;
    artifacts: number[];
    artifactTolerance: number;
    margin: number;
    tolerance: number;
    minColumnEdges: number;
  },
): number[] {
  if (rowEdges.length < 3) return rowEdges;

  const heights: number[] = [];
  for (let i = 0; i < rowEdges.length - 1; i++) heights.push(rowEdges[i + 1]! - rowEdges[i]!);
  const medianHeight = median(heights);
  if (medianHeight < 8) return rowEdges;

  // Cho'qqi ostonasi `repairMissedLines` bilan bir xil — bu yerda ham asosiy
  // himoya oston emas, quyidagi tuzilish sharti.
  const minPeak = opts.medianFrac * 0.5;
  // Yuqori chegara ikki barobar qator balandligini qamraydi: shablonda tavsif
  // ikki qatorga sig'masa qator ~2x baland bo'ladi. Bunday band keyin
  // `repairMissedLines` tomonidan bo'linadi.
  const lowBound = Math.round(medianHeight * 0.7);
  const highBound = Math.round(medianHeight * 2.4);

  // Ko'pi bilan shuncha qator qo'shiladi — cheksiz cho'zilib ketmasligi uchun.
  const maxAdded = 4;
  const out = [...rowEdges];

  for (let added = 0; added < maxAdded; added++) {
    const last = out[out.length - 1]!;
    const from = last + lowBound;
    const to = Math.min(height - 1, last + highBound);
    if (from >= to) break;

    let best: number | null = null;
    let bestFrac = minPeak;
    for (let y = from; y <= to; y++) {
      const v = profile[y]!;
      if (v < bestFrac) continue;
      if (v < (profile[y - 1] ?? 0) || v < (profile[y + 1] ?? 0)) continue;
      bestFrac = v;
      best = y;
    }
    if (best === null) break;

    // Tuzilish sharti: band jadvalning o'z ustunlariga ega bo'lishi kerak.
    const vlines = findVerticalLines(bin, width, last, best, opts.minVLineFill).filter(
      (x) =>
        x >= opts.margin &&
        x <= width - opts.margin &&
        !opts.artifacts.some((a) => Math.abs(a - x) <= opts.artifactTolerance),
    );
    if (vlines.length < opts.minColumnEdges) break;
    if (similarity(columnEdges, vlines, opts.tolerance) < 0.75) break;

    out.push(best);
  }

  return out;
}

/**
 * Sezilmay qolgan qator chiziqlarini tiklaydi.
 *
 * NEGA KERAK: jadval chizig'i ba'zan juda so'lg'in chop etiladi. O'lchangan
 * holat: qo'shni chiziqlar 0.48 va 0.61 zichlikda, oradagisi esa atigi 0.35 —
 * ostonadan past. Natijada ikki qator bitta bandga qo'shilib ketdi, o'sha
 * banddan faqat bitta shtrix-kod o'qildi va bir qator butunlay yo'qoldi
 * (yig'indi 166 o'rniga 110 chiqdi).
 *
 * Ostonani umumiy pasaytirish xavfli — matn qatorlari ham 0.5 gacha zichlikka
 * yetadi. Shuning uchun TUZILISHDAN foydalanamiz: mahsulot jadvalining qator
 * balandliklari juda bir tekis, demak median balandlikdan ancha baland band
 * ichida yo'qolgan chiziq bor. Bo'linish faqat NATIJASI ISHONARLI bo'lganda
 * qabul qilinadi — ikkala bo'lak ham median balandlikka yaqin bo'lishi kerak.
 */
function repairMissedLines(
  rowEdges: number[],
  profile: Float32Array,
  medianFrac: number,
): number[] {
  if (rowEdges.length < 3) return rowEdges;

  const heights: number[] = [];
  for (let i = 0; i < rowEdges.length - 1; i++) heights.push(rowEdges[i + 1]! - rowEdges[i]!);
  const medianHeight = median(heights);
  if (medianHeight < 8) return rowEdges;

  const minTall = medianHeight * 1.6;
  // 0.5: o'lchangan holatda yo'qolgan chiziq 0.35, jadval chiziqlarining
  // medianasi 0.55 edi. Asosiy himoya bu chegara emas, balki quyidagi
  // balandlik balansi sharti — bo'linish natijasi jadvalning odatiy qator
  // balandligiga mos kelmasa, u qabul qilinmaydi.
  const minPeak = medianFrac * 0.5;
  const lowBound = medianHeight * 0.7;
  const highBound = medianHeight * 1.35;

  const out: number[] = [rowEdges[0]!];
  for (let i = 0; i < rowEdges.length - 1; i++) {
    const top = rowEdges[i]!;
    const bottom = rowEdges[i + 1]!;

    if (bottom - top >= minTall) {
      const split = findSplit(profile, top, bottom, minPeak, lowBound, highBound);
      if (split !== null) out.push(split);
    }
    out.push(bottom);
  }
  return out;
}

/** Band ichidan bo'linish nuqtasini qidiradi. */
function findSplit(
  profile: Float32Array,
  top: number,
  bottom: number,
  minPeak: number,
  lowBound: number,
  highBound: number,
): number | null {
  let best: number | null = null;
  let bestFrac = minPeak;

  // Chekkalarni chetlab o'tamiz — u yerdagi cho'qqi mavjud chegaraning o'zi.
  const from = top + Math.round((bottom - top) * 0.2);
  const to = bottom - Math.round((bottom - top) * 0.2);

  for (let y = from; y < to; y++) {
    const v = profile[y]!;
    if (v < bestFrac) continue;
    if (v < (profile[y - 1] ?? 0) || v < (profile[y + 1] ?? 0)) continue;

    // Bo'linish natijasi jadvalning odatiy qator balandligiga mos kelishi shart.
    const upper = y - top;
    const lower = bottom - y;
    if (upper < lowBound || upper > highBound) continue;
    if (lower < lowBound || lower > highBound) continue;

    bestFrac = v;
    best = y;
  }
  return best;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Ikki chiziq to'plamining mos kelish ulushi (0..1). */
function similarity(a: number[], b: number[], tolerance: number): number {
  if (a.length === 0 || b.length === 0) return 0;
  let matched = 0;
  for (const x of a) {
    if (b.some((y) => Math.abs(x - y) <= tolerance)) matched++;
  }
  return matched / Math.max(a.length, b.length);
}

export interface ProfileOptions {
  /** Tekshiriladigan qoldiq qiyshiqlik diapazoni (gradus, ±). */
  shearRangeDeg?: number;
  /** Qadam (gradus). */
  shearStepDeg?: number;
}

/**
 * Har bir y uchun qora piksel ulushi — QOLDIQ QIYSHIQLIKKA CHIDAMLI.
 *
 * NEGA bitta burchak yetarli emas: `preparePage` sahifani global burchakka
 * to'g'rilaydi, ammo ADF dan bir necha marta o'tgan qog'oz biroz to'lqinlanadi
 * va sahifaning turli joyidagi qiyshiqlik bir xil bo'lmaydi. O'lchov: shunday
 * varaqda global deskewdan keyin ham eng zich qator ulushi 0.87 dan 0.74 ga
 * tushdi va topilgan chiziqlar 26 tadan 11 taga kamaydi — jadvalning yarmi
 * yo'qoldi.
 *
 * Yechim: har bir y uchun proyeksiyani bir necha kichik burchakda hisoblab,
 * eng kattasini olamiz. Biroz qiyshaygan chiziq o'z burchagida to'planadi va
 * baribir topiladi.
 *
 * Tezlik uchun x bo'yicha har ikkinchi piksel olinadi — chiziqni aniqlash
 * uchun bu yetarli, xarajat esa ikki barobar kamayadi.
 */
export function rowDarkProfile(
  bin: Uint8Array,
  width: number,
  height: number,
  opts: ProfileOptions = {},
): Float32Array {
  const range = opts.shearRangeDeg ?? 0.5;
  const step = opts.shearStepDeg ?? 0.25;

  const angles: number[] = [];
  for (let a = -range; a <= range + 1e-9; a += step) angles.push(a);
  if (angles.length === 0) angles.push(0);

  const stride = 2;
  const samples = Math.ceil(width / stride);
  const best = new Float32Array(height);
  const acc = new Float32Array(height);

  for (const angle of angles) {
    acc.fill(0);
    const tan = Math.tan((angle * Math.PI) / 180);

    for (let x = 0; x < width; x += stride) {
      const shift = Math.round(x * tan);
      const y0 = Math.max(0, -shift);
      const y1 = Math.min(height, height - shift);
      for (let y = y0; y < y1; y++) {
        acc[y]! += bin[(y + shift) * width + x]!;
      }
    }

    for (let y = 0; y < height; y++) {
      const frac = acc[y]! / samples;
      if (frac > best[y]!) best[y] = frac;
    }
  }

  return best;
}

/**
 * Gorizontal chiziqlar: proyeksiya profilining ingichka, ajralib turuvchi
 * cho'qqilari. Matn bloklari keng va past bo'lgani uchun rad etiladi.
 */
export function findHorizontalLines(
  bin: Uint8Array,
  width: number,
  height: number,
  opts: GridOptions = {},
  /** Oldindan hisoblangan profil — bir sahifada ikki marta hisoblamaslik uchun. */
  precomputed?: Float32Array,
): HLine[] {
  // 0.45 real skanlarda o'lchangan: haqiqiy jadval chegaralari 0.50..0.87
  // oralig'ida, jadval sarlavhasidagi qalin matn esa 0.30..0.37 beradi.
  // Past chekka ataylab tanlangan — yo'qolgan qator ma'lumot yo'qotishi
  // demak, ortiqcha band esa keyingi bosqichda ("shtrix-kod bormi?") filtrlanadi.
  const minFrac = opts.minHLineFrac ?? 0.45;
  const minProminence = opts.minProminence ?? 0.12;
  const profile = precomputed ?? rowDarkProfile(bin, width, height, opts);

  // Cho'qqi atrofidagi "fon" shu masofada o'lchanadi — jadval chizig'i
  // qalinligidan (2–4 px) kattaroq, matn qatori balandligidan kichikroq.
  const near = Math.max(4, Math.round(height * 0.0025));
  const far = near * 4;

  const candidates: HLine[] = [];
  for (let y = 0; y < height; y++) {
    const v = profile[y]!;
    if (v < minFrac) continue;

    let bg = 1;
    for (let d = near; d <= far; d++) {
      const a = profile[y - d];
      const b = profile[y + d];
      if (a !== undefined && a < bg) bg = a;
      if (b !== undefined && b < bg) bg = b;
    }
    if (v - bg >= minProminence) candidates.push({ y, frac: v });
  }

  return mergePeaks(candidates, Math.max(3, Math.round(height * 0.002)));
}

/**
 * Berilgan y-band ichidagi vertikal chiziqlar.
 *
 * Ikkita shart tekshiriladi va ikkinchisi HAL QILUVCHI:
 *
 *   1. band o'rtasida qora piksel ulushi `minFill` dan katta;
 *   2. ustun bandning YUQORI VA QUYI CHEKKALARIDA ham qora.
 *
 * Nega ikkinchisi kerak: shtrix-kod chiziqchalari ham tik va zich, shuning
 * uchun faqat "o'rtadagi to'ldirilganlik" ularni ajrata olmaydi. O'lchov buni
 * ochiq ko'rsatdi — bir skanda qator balandligi 136 px bo'lganda 0.85 ostonasi
 * ishlagan, boshqasida 130 px bo'lganda shtrix-kod chiziqchalari ham o'tib
 * ketgan va jadvalning yarmi yo'qolgan.
 *
 * Geometrik farq esa barqaror: haqiqiy ustun chizig'i bandning ustki
 * chegarasidan pastkisigacha uzluksiz o'tadi, shtrix-kod esa qator balandligining
 * ~55% ini egallab, usti va ostida oq joy qoldiradi.
 */
export function findVerticalLines(
  bin: Uint8Array,
  width: number,
  top: number,
  bottom: number,
  minFill: number,
): number[] {
  const height = bottom - top;

  // Burchaklarda gorizontal chiziqlar bilan tutashishni chetlab o'tamiz.
  const inset = Math.max(1, Math.round(height * 0.15));
  const y0 = top + inset;
  const y1 = bottom - inset;
  const span = y1 - y0;
  if (span <= 2) return [];
  const need = span * minFill;

  // Chekka zonalar: gorizontal chegara chizig'idan sal ichkarida, ammo
  // shtrix-kod boshlanadigan joydan ancha yuqorida/pastda.
  const zone = Math.max(1, Math.round(height * 0.12));
  const edgeInset = Math.max(1, Math.round(height * 0.04));
  const topZone = { from: top + edgeInset, to: top + edgeInset + zone };
  const bottomZone = { from: bottom - edgeInset - zone, to: bottom - edgeInset };
  const edgeNeed = zone * 0.5;
  const usableZones = zone >= 3 && topZone.to < bottomZone.from;

  const hits: number[] = [];
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = y0; y < y1; y++) if (bin[y * width + x] === 1) count++;
    if (count < need) continue;

    if (usableZones) {
      let topCount = 0;
      for (let y = topZone.from; y < topZone.to; y++) if (bin[y * width + x] === 1) topCount++;
      if (topCount < edgeNeed) continue;

      let bottomCount = 0;
      for (let y = bottomZone.from; y < bottomZone.to; y++) {
        if (bin[y * width + x] === 1) bottomCount++;
      }
      if (bottomCount < edgeNeed) continue;
    }

    hits.push(x);
  }

  const merged: number[] = [];
  let start = -1;
  let prev = -1;
  for (const x of hits) {
    if (start < 0) start = x;
    else if (x - prev > 3) {
      merged.push(Math.round((start + prev) / 2));
      start = x;
    }
    prev = x;
  }
  if (start >= 0) merged.push(Math.round((start + prev) / 2));
  return merged;
}

/** Yaqin cho'qqilarni birlashtiradi, har guruhdan eng zichini qoldiradi. */
function mergePeaks(peaks: HLine[], maxGap: number): HLine[] {
  const out: HLine[] = [];
  let group: HLine[] = [];
  for (const p of peaks) {
    if (group.length === 0 || p.y - group[group.length - 1]!.y <= maxGap) group.push(p);
    else {
      out.push(pickBest(group));
      group = [p];
    }
  }
  if (group.length) out.push(pickBest(group));
  return out;
}

function pickBest(group: HLine[]): HLine {
  let best = group[0]!;
  for (const g of group) if (g.frac > best.frac) best = g;
  return best;
}

/**
 * Yaqin qiymatlarni klasterlab, har bir klaster uchun median qaytaradi.
 * `minCount` dan kam uchragan klasterlar (tasodifiy shovqin) tashlanadi.
 */
function clusterMedian(values: number[], tolerance: number, minCount: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]!]];
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i]!;
    const current = clusters[clusters.length - 1]!;
    if (v - current[current.length - 1]! <= tolerance) current.push(v);
    else clusters.push([v]);
  }
  return clusters.filter((c) => c.length >= minCount).map((c) => c[Math.floor(c.length / 2)]!);
}
