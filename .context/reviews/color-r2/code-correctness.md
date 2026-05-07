# Color Pipeline R2 -- Code Correctness Review

**Date:** 2026-05-06
**Reviewer:** code-reviewer (opus)
**Scope:** ~30 commits implementing Plan 36 work items WI-01 through WI-15 (excluding WI-09 HDR encoder and WI-11 SW bypass, which were deferred).
**Premise:** Photos uploaded AFTER editing. No edit/scoring features.
**Method:** Full file reads of all changed files, LSP diagnostics (zero errors), AST pattern matching, git log cross-reference.

---

## WI Verification (per-item)

### WI-01: colr box parser FullBox/Box fix
**Status:** [VERIFIED-FIXED]

The `colr` box parser at `color-detection.ts:152-216` now correctly treats `colr` as a regular ISOBMFF Box. The old 4-byte version+flags skip is gone. Walking through the byte layout in my head:

- Box header: 4 bytes size + 4 bytes type (`colr`) = `dataStart` at offset+8.
- `dataStart` now reads the colour_type FOURCC directly (`nclx`/`prof`/`rICC`) at `dataStart..dataStart+4` (line 187).
- For `nclx`, the CICP fields are at `dataStart+4` (primaries, 2 bytes), `dataStart+6` (transfer, 2 bytes), `dataStart+8` (matrix, 2 bytes) -- total 11 bytes of data after the header, correctly guarded by `dataSize >= 11` (line 186,188).
- Container box recursion correctly skips 4 bytes for `meta` (which IS a FullBox) but not for `iprp`/`ipco` (which are regular boxes) at lines 201-203.

The fix is correct per ISO 14496-12. The `parseCicpFromHeif` function is bounded (MAX_SCAN_BYTES=1MB, MAX_DEPTH=5) and handles extended-size boxes (size==1, 64-bit) at lines 169-173.

### WI-02: ICC parser consolidation
**Status:** [VERIFIED-FIXED]

`extractIccProfileName` is now a single implementation in `icc-extractor.ts:34-91`. Both `color-detection.ts:15` and `process-image.ts:17-18` import from this shared module. The duplicate parser that was in `color-detection.ts` is gone -- only the import remains at line 15.

The consolidated parser at `icc-extractor.ts` handles both ICC v2 `desc` tags (ASCII, lines 53-61) and ICC v4 `mluc` tags (UTF-16BE via `TextDecoder`, lines 63-81). The UTF-16BE handling is correct (the prior duplicate used ASCII on `mluc` data, which was a known divergence). The `dmdd`/`dmnd` manufacturer-name fallback search that existed in the old duplicate is gone, which is the desired behavior per the plan.

### WI-03: color_space column pollution fix
**Status:** [VERIFIED-FIXED]

`extractExifForDb` in `process-image.ts:970-981` now writes the EXIF ColorSpace tag value to `color_space`:
- Tag value 1 maps to `'sRGB'` (line 973).
- Tag value 65535 maps to `'Uncalibrated'` (line 976-978).
- Otherwise `null`.

The upload action at `images.ts:333` writes `icc_profile_name: data.iccProfileName` as a separate column. The EXIF panel in `photo-viewer.tsx:744-756` reads `image.icc_profile_name` (not `image.color_space`) for the Color Space display row, with the P3 badge gated on the ICC name containing `'p3'`. This matches the WI-03 spec.

### WI-04: OG route sRGB ICC fix
**Status:** [VERIFIED-FIXED]

`route.tsx:37-44` defines `postProcessOgImage` which explicitly calls `.toColorspace('srgb').withIccProfile('srgb')` before `.jpeg({ quality: 88 })`. The old `.withIccProfile('p3')` from commit 538f1f3 is gone. The wide-gamut OG commit (538f1f3) is fully superseded: sRGB ICC is always emitted regardless of source gamut.

The comment at line 36-37 documents the rationale (Satori flattens to sRGB via resvg).

### WI-05: admin Color Details panel
**Status:** [VERIFIED-FIXED]

`photo-viewer.tsx:838-894` renders a collapsible "Color details" section inside the info sidebar when `image.color_primaries || image.is_hdr`. It contains:
- Color primaries (humanized, line 860-865)
- Transfer function (humanized, line 866-871)
- Color pipeline decision (admin-only via `isAdmin` guard, line 872-877)
- HDR badge (CSS media-gated via `@media (dynamic-range: high)`, lines 880-889)
- Calibration tooltip (lines 846-857)

All translation keys present in both `en.json` and `ko.json` (verified: `colorDetails`, `colorPrimaries`, `transferFunction`, `colorPipelineDecision`, `hdrBadge`, `colorUnknown`, `calibrationTooltip`).

### WI-06: histogram AVIF source switching
**Status:** [VERIFIED-FIXED]

`histogram.tsx:41` defines `WIDE_GAMUT_PRIMARIES` set. Lines 258-261 compute `preferAvif` gated on `isWideGamut && avifSupported && supportsCanvasP3 && Boolean(avifUrl)`. The AVIF decode support probe uses a minimal 1x1 AVIF data URL (line 39). The `(sRGB clipped)` indicator renders at line 342 when `isClipped` is true. The photo-viewer passes the AVIF URL at lines 902-904 via the `avifUrl` prop.

The gamut label (e.g. "(P3)", "(Adobe RGB)") renders next to the histogram header (line 340). Translation keys for all gamut labels verified in both languages.

### WI-07: dynamic download button label
**Status:** [VERIFIED-FIXED]

`photo-viewer.tsx:947-949` checks `image.color_pipeline_decision?.startsWith('p3-from-')` to switch between `downloadP3Jpeg` and `downloadJpeg` labels. The wide-gamut download disclosure shows a dropdown with sRGB JPEG, P3 AVIF, and (conditionally) HDR AVIF options at lines 942-984. Translation keys `downloadSrgbJpeg`, `downloadP3Jpeg`, `downloadP3Avif`, `downloadHdrAvif` verified in both `en.json` and `ko.json`.

### WI-08: picture media="(dynamic-range: high)" source
**Status:** [VERIFIED-FIXED]

HDR `<source>` elements are present in all three picture-rendering components:
- `photo-viewer.tsx:413-419`: gated on `HDR_FEATURE_ENABLED && image.is_hdr && baseAvif`.
- `lightbox.tsx:418-425`: gated on `HDR_FEATURE_ENABLED && image.is_hdr && hdrAvifSrcSet`.
- `home-client.tsx:282-289`: gated on `hdrAvifSrcSet` (which is itself gated on `HDR_FEATURE_ENABLED && image.is_hdr`).

All three use `media="(dynamic-range: high)"` and `type="image/avif"`. The feature flag at `feature-flags.ts:10` defaults to `false` (env `NEXT_PUBLIC_HDR_FEATURE_FLAG === 'true'`), so this is currently a no-op as intended. The `info-bottom-sheet.tsx` does NOT have a `<picture>` element with HDR source, but it does not render photos inline (it shows metadata only), so this is correct.

### WI-10: dead CSS removal
**Status:** [VERIFIED-FIXED]

`grep` for `--display-gamut` and `--display-hdr` across all `.css` files under `src/app/` returns zero results. The dead custom properties from `globals.css:168-170` have been removed.

### WI-12: DCI-P3 Bradford adaptation
**Status:** [VERIFIED-FIXED]

`process-image.ts:658` detects DCI-P3 sources: `const isDciP3 = iccProfileName?.toLowerCase() === 'dci-p3' || ...`.

Lines 727-732 implement the critical path split: DCI-P3 sources skip the `pipelineColorspace('rgb16')` path and instead use `image.clone().resize(...)`. This preserves the source ICC profile (with DCI white point) so that the subsequent `.toColorspace(avifIcc).withIccProfile(avifIcc)` chain (lines 739-742 for WebP, 759-761 for AVIF, 791-793 for JPEG) performs the correct Bradford chromatic adaptation from DCI white to D65 within libvips/LCMS2.

The comment at line 722-725 documents the rationale: "DCI-P3 sources skip rgb16 pipeline so the source ICC profile (with DCI white point) is preserved for the toColorspace('p3') transform, which then does the correct Bradford adaptation to D65."

This is the correct approach: libvips/LCMS2 performs Bradford CAT by default when the source and destination ICC profiles have different white points. The DCI-P3 ICC profile specifies the DCI white (0.314, 0.351) and Display P3 specifies D65 (0.3127, 0.3290), so the transform is automatic.

### WI-14: Sharp shared-state hardening
**Status:** [VERIFIED-FIXED]

`process-image.ts:728-732` shows the fix: when `needsRgb16` is true (wide-gamut, non-DCI-P3), each format closure creates a **fresh `sharp(processingInputPath, ...)` instance** with `.pipelineColorspace('rgb16')` instead of using `image.clone()`. The non-rgb16 path (DCI-P3 and sRGB) still uses `image.clone()` which is safe because clone does not set `pipelineColorspace`.

Since the three format closures run in parallel via `Promise.all` (line 842), each one now has its own decode pipeline. This eliminates the shared-state risk identified in CD-HIGH-2.

### WI-15: memory pressure cap
**Status:** [VERIFIED-FIXED]

`process-image.ts:663-672` caps wide-gamut sources at 6000px width before fan-out. When `isWideGamutSource && baseWidth > WIDE_GAMUT_MAX_SOURCE_WIDTH`, a temporary downscaled intermediate is created via Sharp and used as `processingInputPath`. The intermediate is cleaned up in a `finally` block at lines 858-862.

This prevents the 1.1 GB working set per image that was identified in CD-HIGH-3 for 100 MP wide-gamut sources with `rgb16` pipeline.

---

## NEW Findings

### N-01: ColorPipelineDecision type vs. UI humanizer mismatch
**Severity:** [HIGH]

**Files:** `process-image.ts:379-386` (type definition), `photo-viewer.tsx:69-80` (humanizer).

The `ColorPipelineDecision` type in `process-image.ts` defines the wider-than-P3 values as:
- `'srgb-from-adobergb'`
- `'srgb-from-prophoto'`
- `'srgb-from-rec2020'`

But `humanizeColorPipelineDecision` in `photo-viewer.tsx:74-76` handles:
- `'p3-from-adobergb'`
- `'p3-from-prophoto'`
- `'p3-from-rec2020'`

These values will NEVER appear in the DB because `resolveColorPipelineDecision` at `process-image.ts:418-425` emits the `srgb-from-*` variants. The three `p3-from-*` cases in the switch are dead code. The admin Color Details panel will show an empty string for any Adobe RGB, ProPhoto, or Rec.2020 source because the switch falls through to `default: return ''`.

The likely intent was that the pipeline should emit `p3-from-*` after the `resolveAvifIccProfile` change made wider-than-P3 sources go through P3 (the `'p3-from-wide'` path). But `resolveColorPipelineDecision` was not updated to match `resolveAvifIccProfile` -- it still says `srgb-from-*` while the actual encoder output is P3. This means the `color_pipeline_decision` column in the DB is also misleading: it says `srgb-from-adobergb` when the AVIF is actually P3-tagged.

Additionally, `photo-viewer.tsx:947` checks `image.color_pipeline_decision?.startsWith('p3-from-')` for the download label. Since the DB stores `srgb-from-adobergb`, this check will be false for Adobe RGB/ProPhoto/Rec.2020 sources, and the download button will say "Download JPEG" instead of "Download (Display P3 JPEG)" even though the JPEG is P3-tagged. This is the exact label-mismatch bug that WI-07 was supposed to fix.

### N-02: Backfill script passes color_space instead of icc_profile_name
**Severity:** [HIGH]

**File:** `scripts/backfill-color-pipeline.ts:73-82`.

The backfill script SELECTs `color_space` (line 127) and passes it as the `iccProfileName` parameter to `processImageFormats` (line 81). But after WI-03, `color_space` stores EXIF tag values like `'sRGB'` or `'Uncalibrated'`, not ICC profile descriptions like `'Display P3'` or `'Adobe RGB (1998)'`.

For pre-WI-03 rows where `color_space` still holds the ICC name (legacy pollution), this works by accident. For post-WI-03 rows:
- `'sRGB'` will match `name.includes('srgb')` in `resolveAvifIccProfile` and correctly return `'srgb'`.
- `'Uncalibrated'` will fall through to the default `'srgb'`, which is wrong for P3/Adobe RGB sources that report EXIF ColorSpace=65535.

The script should SELECT `icc_profile_name` and pass that instead.

### N-03: NCLX transfer map uses non-standard code point for PQ
**Severity:** [MED]

**File:** `color-detection.ts:131-137`.

The NCLX transfer map assigns:
- `13: 'pq'`  (line 134)
- `14: 'hlg'` (line 135)

Per ITU-T H.273 (the CICP specification):
- Transfer characteristic 16 = SMPTE ST 2084 (PQ)
- Transfer characteristic 18 = ARIB STD-B67 (HLG)
- Transfer characteristic 13 = IEC 61966-2-4 (not PQ)
- Transfer characteristic 14 = ITU-R BT.2020 10-bit (not HLG)

The map at line 134 maps code point 13 to `'pq'` when it should map 16. And line 135 maps code point 14 to `'hlg'` when it should map 18. Code point 16 and 18 are not in the map at all.

This means:
- A genuine PQ HEIF (transfer=16) will map to `'unknown'` via the `?? 'unknown'` fallback at line 271, and `isHdr` will be `false`.
- A genuine HLG HEIF (transfer=18) will also map to `'unknown'`, and `isHdr` will be `false`.
- An IEC 61966-2-4 source (transfer=13) would be incorrectly flagged as HDR PQ.
- A BT.2020 10-bit source (transfer=14) would be incorrectly flagged as HDR HLG.

Note: the map DOES have `18: 'gamma18'` at line 136, which is also incorrect -- transfer characteristic 18 per H.273 is HLG (ARIB STD-B67), not gamma 1.8.

The net effect is that CICP-based HDR detection via the `colr` nclx box is silently broken for all genuine PQ and HLG content despite the WI-01 parser fix being correct. HDR may still be detected via the ICC-name heuristic path (lines 66-73), but the nclx path -- which is the authoritative one -- will miss it.

### N-04: HDR download link filename convention mismatch
**Severity:** [LOW]

**File:** `photo-viewer.tsx:227`.

The download link for HDR AVIF at line 227 constructs the filename as:
```
image.filename_avif.replace(/\.avif$/i, '_hdr.avif')
```
This produces `<uuid>_hdr.avif` (the base filename without size suffix).

But the `<picture>` srcSet HDR URLs at line 416 use:
```
${baseAvif}_hdr_${w}.avif
```
This produces `<uuid>_hdr_640.avif`, `<uuid>_hdr_1536.avif`, etc.

These are two different naming conventions. The download link points to a base-name file that would need to exist as `<uuid>_hdr.avif`, while the picture source uses sized variants like `<uuid>_hdr_640.avif`. Since WI-09 (the HDR encoder) is deferred, neither file pattern exists yet, so this is not a runtime bug today. But when the encoder ships, it needs to emit BOTH the sized variants AND the base filename (or the download link needs to target a sized variant). Currently a latent inconsistency.

### N-05: NCLX primaries map missing code point 11 (DCI-P3)
**Severity:** [LOW]

**File:** `color-detection.ts:125-129`.

The NCLX primaries map has:
- `1: 'bt709'`
- `9: 'bt2020'`
- `12: 'p3-d65'`

Per ITU-T H.273:
- Code point 11 = SMPTE RP 431-2 (DCI-P3, with DCI white point)
- Code point 12 = SMPTE EG 432-1 (Display P3, with D65 white point)

Both are P3 family. Code point 11 should map to `'dci-p3'` (which is already a valid value in the `ColorSignals['colorPrimaries']` union). Without this mapping, a DCI-P3 HEIF with nclx primaries=11 would fall through to `'unknown'` and the DCI-P3 white-point Bradford adaptation (WI-12) would not trigger.

---

## Coverage of original CD-HIGH-2 (Sharp shared-state)

[VERIFIED-FIXED] The fix at `process-image.ts:728-730` creates a fresh `sharp(processingInputPath, ...)` instance inside each format closure for the rgb16 path, rather than calling `.clone()` on the shared parent instance. Since each format encode now has its own decode pipeline with its own `pipelineColorspace('rgb16')` call, there is no possibility of cross-format state contamination. The race is resolved, not renamed.

The DCI-P3 path (line 732) still uses `image.clone()` but does NOT call `pipelineColorspace('rgb16')` on the clone, so there is no state mutation to leak across format closures.

## Coverage of original CD-CRIT-1 (HDR encoder)

[VERIFIED-DEFERRED] Commit 0481fdb documents the deferral via US-CM12. The `HDR_FEATURE_ENABLED` flag at `feature-flags.ts:10` defaults to `false`. The `<picture>` media source is conditional on this flag in all three components. There is no half-implemented HDR encoder: `processImageFormats` has no HDR encode branch, and the `_hdr.avif` URLs in the `<picture>` element are gated behind the flag.

The deferral path is clean: no malformed AVIFs can be emitted because the encoder simply does not exist. The HDR-related schema columns (`is_hdr`, `transfer_function`, `color_primaries`, `matrix_coefficients`) populate correctly via `detectColorSignals` regardless of whether the encoder ships.

However, per N-03 above, the CICP nclx detection is also effectively broken for genuine PQ/HLG content due to the wrong transfer code points in the map. So even when the encoder ships, HDR sources will not be correctly flagged via the nclx path.

---

## Positive Observations

1. The ICC parser consolidation (WI-02) is clean: single shared module, proper UTF-16BE handling, no duplicated code.
2. The `icc-extractor.ts` bounds-checking (tagCount capped at 100, string lengths capped at 1024, `cleanString` strips nulls) is defensive and correct.
3. The colr box parser (WI-01) has correct bounds checking at every level: MAX_SCAN_BYTES, MAX_DEPTH, size validation, and extended-size box handling.
4. The WI-15 temp-file cleanup in the `finally` block at `process-image.ts:858-862` prevents disk leak on processing failure.
5. The advisory lock for the backfill script (`LOCK_COLOR_PIPELINE_BACKFILL`) is correctly registered in the centralized `advisory-locks.ts` registry.
6. The feature flag pattern (`HDR_FEATURE_ENABLED`) is a clean deferral mechanism that prevents any half-baked HDR delivery.
7. Both `en.json` and `ko.json` translation files have all 24 new color-related keys at the same line numbers (278-318), with appropriate Korean translations.
8. The `postProcessOgImage` function (WI-04) is a clean, well-documented fix that explicitly documents why sRGB is correct for OG images.
9. Migration scripts 0015-0017 are purely additive (nullable columns, no data migration) and backward-compatible.

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| HIGH     | 2     | N-01 (decision type vs UI mismatch), N-02 (backfill color_space vs icc_profile_name) |
| MED      | 1     | N-03 (NCLX transfer code points wrong: PQ=13 should be 16, HLG=14 should be 18) |
| LOW      | 2     | N-04 (HDR download filename convention), N-05 (NCLX primaries missing code point 11) |
| VERIFIED | 12    | WI-01 through WI-08, WI-10, WI-12, WI-14, WI-15 |

**LSP diagnostics:** Zero type errors across all 6 scanned files.

**Verdict:** REQUEST CHANGES -- two HIGH issues (N-01, N-02) must be fixed before the color pipeline audit trail is reliable. N-03 is MED but will silently break HDR detection for all genuine PQ/HLG HEIF/AVIF content when the encoder ships.
