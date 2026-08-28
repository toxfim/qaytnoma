export * from './config.js';

export { preparePage, fullImage, workImage, WORK_WIDTH, type PreparedPage } from './layout/page.js';
export { detectItemTable, type TableGrid } from './layout/grid.js';
export { cellBox, cropFull, BARCODE_CELL, NUMBER_CELL, SKU_CELL } from './layout/cells.js';

export { decodeCrop, acceptDocId, acceptItemBarcode } from './barcode/decode.js';
export { removeBlueInk } from './image/ink.js';
export { prepareForOcr, contentBox, suppressLines } from './image/bbox.js';
export { loadImage } from './image/load.js';

export { OcrEngine, type OcrMode, type OcrResult } from './ocr/engine.js';
export { parseQuantity, parseDocDate, parseDocNumber, normalizeSku } from './ocr/parse.js';
export { parseHeaderFields, docNumberFromId, HEADER_REGION } from './ocr/header-fields.js';
export { mergeSkuPasses, looksLikeValidSku } from './ocr/sku.js';

export {
  extractPage,
  type PageExtraction,
  type ExtractedRow,
  type VlmOptions,
} from './pipeline/extract-page.js';

export { GeminiClient, GeminiError, type TokenUsage, emptyUsage } from './vlm/gemini.js';
export { VlmReader, type VlmPage, type VlmRow } from './vlm/reader.js';
export { vlmFromConfig } from './vlm/setup.js';
export { resolveColumns, type ColumnMap } from './layout/columns.js';
export { groupIntoDocuments } from './pipeline/group.js';
export { validateDocument, rowNeedsReview } from './pipeline/validate.js';
export {
  runPipeline,
  type RunOptions,
  type RunResult,
  type ProgressEvent,
  type CatalogueOptions,
} from './pipeline/run.js';

export { SkuDictionary } from './store/sku-dictionary.js';
export { SkuCatalogue } from './store/sku-catalogue.js';
export { SkuResolver, type SkuSource, type ResolvedSku } from './store/sku-resolver.js';
export { fetchCatalogue, type CatalogueSource } from './input/catalogue-sheet.js';
export { DocumentIndex, type IndexEntry } from './store/index-log.js';
export { PendingQueue, type PendingBatch } from './store/pending-batch.js';
export { withRetry, isTransientError, type RetryOptions } from './util/retry.js';

export { writeDocumentPdf, formatDate } from './output/pdf.js';
export { SheetsWriter, LOG_SHEET_NAME, type SheetsCredentials } from './output/sheets.js';
