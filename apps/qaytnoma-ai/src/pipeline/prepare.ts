/**
 * Skaner faylini modelga va arxivga tayyorlash.
 *
 * DESKEW SAQLANADI, garchi model qiyshiq matnni ham o'qiy olsa: qiyshiq
 * qog'ozda ustunlar bir-biriga kirib ketadi va aynan shu holatda
 * `Штрих-код` bilan `Закупочная цена` chalkashishi ehtimoli ortadi. Deskew
 * lokal, tekin va tez — undan voz kechishga sabab yo'q.
 *
 * BMP ni libvips o'qiy olmaydi (`image/bmp.ts` izohiga qarang), shuning
 * uchun yuklash `@barcodeer/core` ning `preparePage` funksiyasi orqali
 * boradi — u BMP ni Node'da dekodlab, deskew qiladi va sharp'ga xom
 * piksellar beradi.
 */
import { fullImage, preparePage, WORK_WIDTH } from '@barcodeer/core';

/** Arxiv PDF uchun sifat — asosiy ilova bilan bir xil. */
const ARCHIVE_QUALITY = 80;

/**
 * Modelga yuboriladigan JPEG sifati.
 *
 * 85 — 80 bilan solishtirganda fayl ~15% kattaroq, ammo TOKEN SONI
 * o'zgarmaydi (u faqat o'lchamga bog'liq), ya'ni qo'shimcha narx yo'q.
 * Yagona narx — yuklash vaqti, u esa mahalliy tarmoqda sezilmaydi.
 */
const MODEL_QUALITY = 85;

export interface PreparedImages {
  /** Modelga yuboriladigan nusxa. */
  model: Buffer;
  /** Arxiv PDF uchun nusxa. */
  archive: Buffer;
  width: number;
  height: number;
  /** Aniqlangan va to'g'rilangan qiyshiqlik burchagi. */
  skewDeg: number;
  /** Modelga yuborilgan rasmning o'lchami — token hisobi uchun. */
  modelWidth: number;
  modelHeight: number;
}

export interface PrepareOptions {
  /**
   * Modelga yuboriladigan rasm kengligi.
   *
   * Standart — to'liq ishchi kenglik (2481 px, ~300 DPI). Kichraytirish
   * token sarfini kamaytiradi, ammo eng arzon modelda butun sahifa
   * $0.0005 turadi — 13 xonali shtrix-kodni yo'qotish xavfi bunga
   * arzimaydi (`gemini/cost.ts`).
   */
  width?: number;
}

export async function prepareForModel(
  path: string,
  opts: PrepareOptions = {},
): Promise<PreparedImages> {
  const page = await preparePage(path);
  const width = Math.min(opts.width ?? WORK_WIDTH, page.width);

  const archive = await fullImage(page)
    .resize({ width: WORK_WIDTH, kernel: 'lanczos3' })
    .jpeg({ quality: ARCHIVE_QUALITY })
    .toBuffer();

  // Kengliklar teng bo'lsa ikkinchi marta kodlamaymiz — bu sahifasiga
  // ~0.3 s tejaydi va natija bir xil bo'ladi.
  const sameSize = width === WORK_WIDTH;
  const model = sameSize
    ? archive
    : await fullImage(page)
        .resize({ width, kernel: 'lanczos3' })
        .jpeg({ quality: MODEL_QUALITY })
        .toBuffer();

  const scale = width / page.width;
  return {
    model,
    archive,
    width: page.width,
    height: page.height,
    skewDeg: page.skewDeg,
    modelWidth: width,
    modelHeight: Math.round(page.height * scale),
  };
}
