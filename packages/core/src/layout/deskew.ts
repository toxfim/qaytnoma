/**
 * Qiyshiqlikni (skew) baholash — proyeksiya profili usuli.
 *
 * NEGA kerak: ADF skanerda varaq 0.2–0.5° ga qiyshayishi odatiy hol. 2200 px
 * kenglikda 0.3° = 11 px vertikal siljish, ya'ni jadvalning gorizontal chizig'i
 * bitta y qatoriga sig'maydi. Real skanlarda qator bo'yicha eng uzun qora tasma
 * chiziq kengligining atigi ~38% ini tashkil qildi — to'r detektsiyasi ham,
 * ZXing ham shu sababdan ishlamagan.
 *
 * Usul: rasmni turli burchaklarga "siljitib" (shear) gorizontal proyeksiya
 * gistogrammasini hisoblaymiz. To'g'rilangan burchakda chiziqlar bitta qatorga
 * to'planadi va gistogramma eng "o'tkir" bo'ladi — buni kvadratlar yig'indisi
 * bilan o'lchaymiz.
 */

export interface SkewEstimate {
  /** Gradusda. Musbat = sahifani soat yo'nalishi bo'yicha aylantirish kerak. */
  angleDeg: number;
  /** Nisbiy o'tkirlik: to'g'rilangan / to'g'rilanmagan. 1.0 = yaxshilanish yo'q. */
  improvement: number;
}

export interface DeskewOptions {
  /** Tekshiriladigan maksimal burchak (gradus). */
  maxDeg?: number;
  /** Dastlabki qadam (gradus). */
  coarseStepDeg?: number;
  /** Aniqlashtirish qadami (gradus). */
  fineStepDeg?: number;
}

/**
 * Binarizatsiya qilingan rasmdan qiyshiqlik burchagini baholaydi.
 * Tezlik uchun kichraytirilgan rasmda chaqirilishi kerak (~600–900 px keng).
 */
export function estimateSkew(
  bin: Uint8Array,
  width: number,
  height: number,
  opts: DeskewOptions = {},
): SkewEstimate {
  const maxDeg = opts.maxDeg ?? 2.5;
  const coarse = opts.coarseStepDeg ?? 0.25;
  const fine = opts.fineStepDeg ?? 0.05;

  const baseline = projectionScore(bin, width, height, 0);

  let best = 0;
  let bestScore = baseline;
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += coarse) {
    const s = projectionScore(bin, width, height, a);
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }

  // Eng yaxshi qo'pol burchak atrofini aniqlashtiramiz.
  const lo = best - coarse;
  const hi = best + coarse;
  for (let a = lo; a <= hi + 1e-9; a += fine) {
    const s = projectionScore(bin, width, height, a);
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }

  return {
    angleDeg: Number(best.toFixed(3)),
    improvement: baseline > 0 ? bestScore / baseline : 1,
  };
}

/**
 * Berilgan burchakda gorizontal proyeksiya gistogrammasining "o'tkirligi".
 * Aylantirish o'rniga har bir ustunni vertikal siljitamiz (shear) — bu
 * ancha tez va burchak kichik bo'lganda aylantirishga ekvivalent.
 */
function projectionScore(bin: Uint8Array, width: number, height: number, angleDeg: number): number {
  const tan = Math.tan((angleDeg * Math.PI) / 180);
  const rowSums = new Float64Array(height);

  for (let x = 0; x < width; x++) {
    const shift = Math.round(x * tan);
    // Siljish natijasida rasmdan chiqib ketadigan y oralig'ini oldindan kesamiz.
    const y0 = Math.max(0, -shift);
    const y1 = Math.min(height, height - shift);
    for (let y = y0; y < y1; y++) {
      if (bin[(y + shift) * width + x] === 1) rowSums[y]! += 1;
    }
  }

  let score = 0;
  for (let y = 0; y < height; y++) score += rowSums[y]! * rowSums[y]!;
  return score;
}
