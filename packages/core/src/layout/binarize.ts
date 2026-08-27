/**
 * Otsu usuli bilan global binarizatsiya.
 *
 * Skanlar toza va kontrasti yuqori, ammo qog'oz foni hujjatdan hujjatga
 * o'zgaradi (oq, bej, kulrang) — shuning uchun qat'iy oston emas, Otsu.
 */

/** Kulrang buferni 0/1 ga aylantiradi (1 = qora piksel / siyoh). */
export function binarize(gray: Buffer | Uint8Array, threshold?: number): Uint8Array {
  const t = threshold ?? otsuThreshold(gray);
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i]! <= t ? 1 : 0;
  return out;
}

/** Otsu ostonasini gistogramma orqali hisoblaydi. */
export function otsuThreshold(gray: Buffer | Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]!]! += 1;

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;

  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVariance = -1;

  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);

    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}
