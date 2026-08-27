/**
 * SKU ni turli manbalardan hal qilish.
 *
 * Ustuvorlik tartibi va uning sababi:
 *
 *   1. `catalogue` — Uzum'ning o'z ma'lumotlari (`Остаток Узум` varag'i).
 *      Bu tizimning haqiqat manbai va muntazam yangilanadi.
 *   2. `confirmed` — inson tasdiqlagan qiymat. Katalogda YO'Q mahsulotlar
 *      uchun ishlatiladi; katalogdan ustun qo'yilmaydi, chunki eski qo'lda
 *      kiritilgan qiymat katalogdagi yangilanishni to'sib qo'yishi mumkin.
 *   3. `ocr` — OCR taklifi. Aniqligi ~47%, shuning uchun bunday qatorlar
 *      har doim tekshirishga belgilanadi.
 */
import type { SkuCatalogue } from './sku-catalogue.js';
import type { SkuDictionary } from './sku-dictionary.js';

export type SkuSource = 'catalogue' | 'confirmed' | 'ocr' | 'none';

export interface ResolvedSku {
  sku: string | null;
  source: SkuSource;
  /** Bu qiymatga ishonsa bo'ladimi — `false` bo'lsa qator tekshirishga tushadi. */
  trusted: boolean;
}

export class SkuResolver {
  constructor(
    private readonly catalogue: SkuCatalogue,
    private readonly dictionary: SkuDictionary,
  ) {}

  /**
   * @param barcode dekodlangan mahsulot shtrix-kodi
   * @param ocrSku shu qator uchun OCR taklifi (bo'lmasa `null`)
   */
  resolve(barcode: string, ocrSku: string | null): ResolvedSku {
    const fromCatalogue = this.catalogue.lookup(barcode);
    if (fromCatalogue) return { sku: fromCatalogue, source: 'catalogue', trusted: true };

    const known = this.dictionary.lookup(barcode);
    if (known?.confirmed) return { sku: known.sku, source: 'confirmed', trusted: true };

    if (ocrSku) return { sku: ocrSku, source: 'ocr', trusted: false };

    // OCR o'qiy olmadi, lekin oldin ko'rilgan taklif bor.
    if (known) return { sku: known.sku, source: 'ocr', trusted: false };

    return { sku: null, source: 'none', trusted: false };
  }
}
