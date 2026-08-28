# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Working end-to-end pipeline plus an Electron tray app. Verified on a real
4-page / 3-document scan from the DS-530 II.

## Commands

```bash
pnpm install                 # pnpm workspaces; native builds pre-approved in pnpm-workspace.yaml
pnpm build                   # tsc -b across all packages
pnpm --filter @barcodeer/core exec tsc --noEmit -p tsconfig.json   # typecheck one package

# Pipeline, without Electron
cd packages/core
npx tsx src/cli.ts check                 # config + scanner + Sheets connectivity
npx tsx src/cli.ts scan                  # scan the ADF and run the full pipeline (streaming)
npx tsx src/cli.ts scan --pages 1 --no-sheets   # scan only n sheets, dry run
npx tsx src/cli.ts ingest <dir> --no-sheets   # re-run on existing images, no writes
npx tsx src/cli.ts sync-catalogue        # force-refresh Баркод → Скю (auto-refreshes every 24h)

# Tray app
cd apps/tray && npx tsc -b && npx electron .

# Installer + landing page
pnpm build:installer                     # -> apps/landing/public/download/qaytnoma-setup.exe
pnpm --filter @barcodeer/landing dev     # serve the download page on :4173
pnpm deploy:landing                      # server pulls origin/v2 — commit first or nothing changes
pnpm deploy:installer                    # uploads to a .part name, then renames on the server
```

The installer offers to install the **Epson scanner driver** when none is found
(`scripts/installer.nsh` → `scripts/install-driver.ps1`). It checks first —
connected WIA scanners plus the uninstall registry — and stays silent when a
driver is already there. Nothing is bundled: the official combo installer is
downloaded from `ftp.epson.com`, its Authenticode signature is verified to be
Seiko Epson's *before* it runs (a hash pin would break on every Epson update),
and it is launched with `RunAs`, so that step alone raises UAC. Both files are
tracked in `scripts/` and copied into `build/resources/` at build time —
electron-builder auto-includes `installer.nsh` from `buildResources`, and
`build/` is gitignored.

The installer is built from a self-contained staging tree (`build/app`) because
pnpm gives each workspace package its own `node_modules` and electron-builder
needs one flat tree — see `scripts/build-installer.mjs` for the details and the
two traps that cost a debugging cycle (workspace packages must be declared as
real `file:` dependencies or electron-builder prunes them out of the asar; the
Electron version must be passed explicitly since the staging tree has no
`electron` dependency).

There is no test suite yet. The regression check is `cli.ts ingest` against a
saved scan compared with `docs/OCR-BENCHMARK.md`.

## Measured accuracy — read before changing OCR or decoding

`docs/OCR-BENCHMARK.md` records every measurement and the options that were
tried and rejected. Headline numbers on the reference scan: item barcodes
36/36, rows found 36/36, document fields 3/3, `Кол-во` 36/36, `СКУ` 36/36 via
the catalogue (17/36 if OCR alone) — on both a clean scan and a deliberately
skewed one (−2.35°, curled paper).

**Column indices are resolved dynamically, never hardcoded.** The widest column
is `Описание товара` and `Штрих-код` is always its right neighbour
(`layout/columns.ts`). Counting from the left broke silently when a skewed scan
lost the table's left border: every index shifted by one, `ШК` read the price
column, and two thirds of a page's rows vanished with no error.

**`СКУ` does not come from OCR.** SKU OCR tops out at 47% because Cyrillic and
Latin lookalikes (С/C, Е/E, Р/P, В/B, Н/H) and `0`/`O`, `6`/`B`, `5`/`S` are
genuinely ambiguous in these codes. The barcode decodes perfectly, so SKU is
looked up from Uzum's own `Баркод → Скю` table (`Остаток Узум` in the Finance
spreadsheet, 23 066 rows, zero conflicts) — `store/sku-catalogue.ts` and
`input/catalogue-sheet.ts`. OCR remains only as a suggestion for barcodes the
catalogue does not know, and those rows are flagged.

## Goal

Automate extraction of Uzum Market **"Возврат товаров комитенту"** (return-of-goods-to-consignor) invoices, batch-scanned on an Epson DS-530 II, into structured line-item rows appended to Google Sheets — with a `needs_review` queue for handwritten quantity corrections.

## Repository layout

- `docs/CLAUDE_CONTEXT.md` — the authoritative architecture and prior-art research doc. **Read it before making any engine or pipeline decision.** It records not just what to use but *why*, and each stage carries an explicit "threshold to change plan".
- `docs/EXAMPLE/` — ground-truth samples (see *Sample data* below).
- `README.md` — empty.

## Document anatomy (fixed template)

**Header page (page 1 of each document)**
- Title `Возврат товаров комитенту`; Code128 barcode top-right, human-readable value `15-0000163307` (format `\d{2}-\d{10}`).
- Printed `Номер документа` = `163307` — this is the **same** value as the barcode with the `15-` prefix and leading zeros stripped. Reconcile the two; do not model them as separate fields.
- `Дата составления`, e.g. `2026-03-05 19:38`.
- **Комитент** block: `Номер договора` (e.g. `0400494н` — note the trailing Cyrillic `н`), `ФИО`, `Телефон`.
- **Комиссионер** block: constant for Uzum (`ИП ООО «UZUM MARKET»`, ИНН `309376127`, ОКЭД `62090`, legal + warehouse address). These are validation anchors, not per-document data.

**Line-item table** (repeats on every page), columns left→right:
`№` | `SKU товара` | `Описание товара` | `Штрих-код` | `Закупочная цена (сум)` | `Кол-во (шт.)` | `Сумма (сум)`
- `Штрих-код` is a **per-row 13-digit barcode** (e.g. `1000076316479`). It is **Code128, not EAN-13** — verified by decoding real scans. Do not apply an EAN-13 checksum.
- `Сумма` is clipped/faded at the right scan edge on real scans. Compute it as price × qty; use the printed value only as a cross-check when legible.
- `Итого` row carries total qty and total sum — the basis for the sum-check validation rules.

**Continuation pages** carry no title, no document barcode, and no header blocks — only the repeated column headers, continuing row numbers (14–26 in the sample), and a repeated `Итого`.

Page grouping is therefore **geometric**: on a header page the item table starts
below the header blocks (measured 32.7% / 33.2% / 33.4% of page height); on a
continuation page it starts at the top (2.1%). The threshold is 15%. This works
even when the document barcode is unreadable, which barcode-separator splitting
would not.

**Last page** adds a signature block (`Товары проверил` / `сдал` / `принял` — ФИО, Подпись, Дата) filled in blue pen, plus a blue round `UZUM MARKET — Отдел сервиса` stamp.

## Non-obvious domain facts

1. **Blue ink is everywhere — a naive HSV blue-mask flags 100% of rows.** Every quantity row carries a blue checkmark as a routine "verified" mark. The *correction* signal is much narrower: a strikethrough over the printed digits plus a handwritten replacement digit beside them (sample row 6: printed `3` struck through, handwritten `5` to its left). Scope the blue mask to the printed-digit bounding box (overlap/strikethrough), treat a bare checkmark in the cell margin as normal, and exclude the signature/stamp region entirely.
2. **Scripts are mixed inside a single row.** Labels and column headers are Russian Cyrillic; product descriptions are Uzbek Latin (`Yangi yil archasi o'yinchoqlari...`); SKU cells mix both in one string (`NOVYGOD-CIF0001-АЛЫЙ` — Latin prefix, Cyrillic color suffix). Never apply a single-script model or a character whitelist to the SKU/description columns; load `rus`+`eng` together. Digit whitelisting is safe **only** for `Штрих-код`, `Кол-во`, `Закупочная цена`, and the document number.
3. **Quantities are not single-digit** — `55`, `34`, `24` appear in the samples.
4. **Placeholder prices are legitimate data.** `99999`, `999999`, `9999999` occur in real rows; do not treat them as OCR errors or reject them in validation.

## Sample data (verified facts)

- `docs/EXAMPLE/example_document*.png` are **826×1169 @ 100 DPI** — downscaled A4 previews. Visual reference only; far too low-resolution for barcode decoding or OCR benchmarking. Never benchmark against them.
- `docs/EXAMPLE/Scan_20260827.pdf` is real scanner output: **4 pages, image-only** (Flate-compressed; `pdftotext` yields ~0 characters, so there is no text layer), and its **xref table is damaged** — any PDF reader must tolerate xref reconstruction. Implication: the Epson searchable-PDF/OCR component was not enabled for this sample, so Stage 0 below is *not yet verified*.

## Architecture

Deterministic-first, staged (full rationale in `docs/CLAUDE_CONTEXT.md`):

**As built** (the numbered plan below is the original research proposal; steps 0
and 1 changed once real scans were measured):

0. ~~Configure Document Capture Pro to split by barcode.~~ **Not used.** The app
   drives WIA directly, so the Scan button works without Epson software and page
   grouping is geometric rather than barcode-driven.
1. **Deterministic core:** WIA scan (or hot folder) → BMP decode in Node →
   deskew → binarize → detect table grid → per cell: Code128 decode (`ШК`) and
   Tesseract (`SKU`, `Кол-во`) after blue-ink removal → validate → `pdf-lib`
   archive + `googleapis` append.
2. **Blue-ink removal instead of handwriting flagging.** The user's rule is that
   handwritten corrections are ignored, so the mask erases every blue pixel —
   checkmarks, corrections, `ИЗВ` notes, signatures and the stamp all disappear
   and only printed black text reaches OCR. This removed the whole "scope the
   mask to the printed-digit bounding box" problem in *Non-obvious domain facts*.
3. **Uzum's own `Баркод → Скю` catalogue instead of a VLM fallback.** SKU OCR
   tops out at 47%; the barcode is 100% reliable, so the SKU is looked up rather
   than read. A learned dictionary (`store/sku-dictionary.ts`) still covers
   barcodes the catalogue lacks.
4. **`needs_review` UI** — not built yet; flagged rows are marked `⚠` in the
   sheet and detailed in the `_log` tab.

**The load-bearing idea (REVISED after measuring real scans):** the printed
table grid is the row anchor, not the barcode. Two findings forced the change:

1. ZXing returns **zero** results on a full A4 page (header blocks and dense
   text break its multi-symbol search) but decodes a cropped single barcode
   perfectly. So a barcode cannot be found without already knowing where to look.
2. A barcode can be **physically unreadable**: on `15-0000163307` the right 30%
   of the document Code128 faded during printing. Its human-readable text
   underneath is crisp, and that is what the pipeline reads instead.

So the order is: deskew → detect grid → crop each cell → decode/OCR that cell.
Barcodes remain the source of truth for `ШК` and the document ID; they are no
longer the mechanism for *finding* rows.

**Pitfalls confirmed in this codebase (each cost real debugging time):**

- **sharp applies `resize` before `composite` and `rotate(angle)` after `extract`**, regardless of call order. Materialise a rotated image to a raw buffer before cropping from it (`layout/page.ts`).
- **`sharp.metadata()` on a pipeline returns the INPUT size**, not the size after `extract()`. Take crop dimensions from the raw buffer.
- **`zxing-wasm@3.1.3` leaks state on the raw-pixmap path** — the call right after a successful decode can return the *previous* result even on an empty image. Use the encoded-PNG `Blob` path (`barcode/decode.ts`).
- **libvips has no BMP loader** and the DS-530 II only offers BMP over WIA, so `image/bmp.ts` decodes it in Node and hands sharp raw pixels.
- **Deskew is mandatory, not optional.** See `docs/OCR-BENCHMARK.md`.
- **Scan at 300 DPI, not 600.** Measured identical accuracy; scan and processing both ~2x faster. `WORK_WIDTH` (2481 px) already is 300 DPI, so 600 DPI pixels were never used.
- **Skip SKU OCR when the catalogue knows the barcode** (`ExtractOptions.knownSku`) — it was the single largest per-row cost (2 Tesseract passes) for a value that gets overwritten anyway.
- **Scanner and pipeline overlap** (`scanStream` + `AsyncIterable` pages in `runPipeline`). Per-page WIA events come from `wia-scan.ps1` stdout; never make `runPipeline` wait for the whole batch.
- **A file an EXTERNAL process reads must live outside `app.asar`.** `wia-scan.ps1` is opened by `powershell.exe`, not by Node, and to any non-Electron process `app.asar` is a single file, not a directory. Packed inside it, the installed app started fine, showed its tray icon and settings, and then simply never moved the scanner — while `npx electron .` worked, because there the script is an ordinary file. It shipped to a user that way. The fix is two halves that must stay together: `asarUnpack` in `electron-builder.yml` and the `app.asar` → `app.asar.unpacked` rewrite in `scriptPath()` (`packages/scanner/src/index.ts`). `build-installer.mjs` now fails the build if the `.ps1` is not in `app.asar.unpacked`.
- **`scp` straight into the web root publishes a half-written file.** The 132 MB installer takes a minute or two, and nginx keeps serving the file the whole time — measured mid-upload, the site reported the previous build's length. Anyone downloading in that window gets a corrupt `.exe` that only fails at install time. `scripts/deploy-installer.mjs` uploads to a dot-prefixed `.part` name and renames on the server (`mv` within one filesystem is an atomic `rename`), publishes the `.exe` *before* `meta.json` so the page never advertises a build that isn't there yet, and then verifies the served `Content-Length`.
- **A config default that points where the installer never writes.** `tessdataPath` defaults to `%APPDATA%/barcodeer/tessdata`, but `extraResources` puts the language files in `<install>/resources/tessdata`. Nothing creates the former, so OCR in the installed app had no language data at all — invisible in development, where `loadConfig` finds the repo's `.tessdata`. `apps/tray/src/main/index.ts` now passes the packaged path as the default *and* repairs a stored path that no longer exists (`config.json` outranks defaults, so fixing the default alone leaves old installs broken).
- **Report the scan error without waiting for the pipeline.** `runPipeline` opens by syncing the ~23 000-row catalogue over the network, so a `Promise.all` of scan + pipeline left the tray amber for another half-minute after the scanner had already failed, hiding the cause.

**Known pitfalls to design around:** scanners write incrementally, so ingesting mid-write corrupts files; higher DPI is *not* monotonically better for Code128 (test 200/300/400 empirically); ZXing has narrow tilt tolerance on scans — keep a zbar/rotate/upscale fallback; Tesseract PSM 3 returns "Empty page" on single-cell crops; if the hot folder is an SMB share, poll rather than rely on FS events.

## Validation rules (any failure → `needs_review`)

- Document number matches `\d{2}-\d{10}` and equals the Code128 value; printed `Номер документа` reconciles to it.
- Item barcode is 13 digits. (No EAN-13 checksum — these are Code128.)
- Quantity is a positive integer.
- Detected item-barcode count == parsed row count.
- Σ quantities == `Итого` quantity; Σ (price × qty) == `Итого` sum.

Route **per field**, not per document — only failing cells go to review.

## Row-level dedupe (`pipeline/dedupe.ts`)

The unique key is **`Ид документа + ШК`** — equivalent to `Ид + СКУ` since
СКУ is looked up from ШК, but ШК decodes 36/36 while an OCR'd СКУ can differ
between two scans of the same row. Before appending, `SheetsWriter.readRowKeys()`
reads every existing key from the sheet itself (one `values.get`, ~1 s);
matching rows are marked `LineItem.duplicate`, left out of the main sheet,
logged as `DUPLICATE_ROW` in `_log` and reported as `rowsSkipped` + a warning.
**Sheets — not the local index — is the source of truth**, so a row deleted
by hand is re-added on the next scan; `documents.jsonl` stores barcodes only
for the `--no-sheets` path. A document is never checked against itself (a
repeated ШК inside one document keeps both rows), but the second copy of a
document inside the same batch is caught.

## Local environment (verified)

- node `v24.18.0`, pnpm `11.17.0`, python `3.14.7`.
- **EPSON DS-530II** on USB, WIA 2.0 driver, 600 DPI optical, ADF + duplex.
  Driven directly through `packages/scanner/scripts/wia-scan.ps1` — no Epson
  software or TWAIN layer involved.
- **No poppler / ImageMagick / Ghostscript needed.** WIA returns images and
  `pdf-lib` writes the PDFs, so the rasterisation step in the original plan
  never materialised.
- Tesseract language data lives in `packages/core/.tessdata` (gitignored,
  downloaded from `tessdata.projectnaptha.com/4.0.0/`). `tessdata_best` does
  **not** work with tesseract.js — its WASM core lacks `DotProductSSE`.
- Windows 11; PowerShell is the primary shell.

## Repository layout (current)

```
apps/tray/          Electron: tray icon, on/off, Scan button, settings window, hot folder
apps/landing/       Static download page (from the Claude Design mockup)
packages/shared/    domain types, constants, validation regexes
packages/scanner/   WIA bridge (PowerShell script + typed wrapper)
packages/core/      image → layout → barcode → OCR → validate → PDF + Sheets
  src/image/        BMP decoder, blue-ink removal, content-bbox OCR prep
  src/layout/       deskew, binarize, grid detection, cell cropping
  src/barcode/      ZXing setup (local wasm) and per-cell decoding
  src/ocr/          Tesseract workers, parsers, SKU two-pass merge
  src/pipeline/     page extraction, document grouping, validation, runner
  src/store/        ШК→СКУ dictionary, processed-document index
  src/output/       PDF writer, Google Sheets writer
  src/debug/        diagnostic scripts (grid overlay, decode bench, extraction probe)
```
