# Photographer Review R7 — Color/HDR Pipeline & UI/UX

**Date:** 2026-05-12
**Scope:** Fresh pass over the GalleryKit color/HDR pipeline after R6 convergence (commits `29bf9812` through `77473e6b`).
**Reviewer angle:** Professional photographer — color fidelity, accurate reproduction, HDR workflow, display gamut honesty, browser compatibility, UI/UX clarity.
**Findings:** 0 CRIT, 2 HIGH, 9 MED, 10 LOW

---

## Summary

R6 closed 7 findings (1 HIGH, 3 MED, 3 LOW). All R6 fixes verified in current codebase. R7 surfaces **new architectural, code-quality, i18n, and UI/UX gaps** that survived because they span multiple layers or require photographer-perspective scrutiny:

1. **R7-H1** — Custom monitor profiles (Eizo, BenQ, X-Rite) detected as wide-gamut via chromaticity but encoded as sRGB because the encoder prefers ICC name over chromaticity-derived primaries.
2. **R7-H2** — `image_quality_*` settings absent from `COLOR_IMPACTING_KEYS`; quality changes produce different bytes with the same ETag, silently serving stale derivatives.
3. **R7-M1** — ICC name normalization inconsistency: `color-detection.ts` uses `normalizeName()` (strip non-alphanumeric) while `process-image.ts` resolvers use raw `.toLowerCase()`. Profile names like `"DisplayP3"` or `"P3D65"` fail to match.
4. **R7-M2** — NCLX transfer values 8 (linear) and 17 (SMPTE ST 428-1 gamma 2.6) are unmapped, falling through to `'unknown'`.
5. **R7-M3** — Korean settings labels mistranslate "wide gamut" as "wide gamma" (`"와이드 감마"` instead of `"광색역"`) — a credibility-destroying error for a color-centric product.
6. **R7-M4** — Backfill re-encodes files but never updates DB color columns; detection logic changes between versions create stale-metadata-over-fresh-bytes.
7. **R7-M5** — `isDciP3` only checks `iccProfileName`, missing NCLX-derived DCI-P3, causing unnecessary rgb16 pipeline runs.
8. **R7-M6** — Public viewers cannot see delivered bit depth; `deliveredBitDepth` is gated on admin-only `color_pipeline_decision`.
9. **R7-M7** — Histogram loads full-resolution image before 256px canvas downscale; a future caller passing base-size URLs could cause browser OOM.
10. **R7-M8** — Lightbox histogram lacks `fallbackImageUrl` that other surfaces provide; legacy photos missing sized derivatives show blank histogram.
11. **R7-M9** — `"sRGB clipped"` / `"sRGB 클리핑"` conflates gamut compression with highlight/shadow clipping — two distinct concepts photographers keep strictly separate.

Plus 10 LOW findings covering documentation drift, histogram luminance coefficients, GPS-stripping ICC loss, misleading setting names, per-image backfill updates, and dependency CVEs.

---

## Severity Distribution

| Severity | Count | IDs |
|----------|-------|-----|
| CRIT | 0 | — |
| HIGH | 2 | R7-H1, R7-H2 |
| MED | 9 | R7-M1 through R7-M9 |
| LOW | 10 | R7-L1 through R7-L10 |

---

## Per-Finding Detail

### R7-H1 [HIGH] — Opaque ICC names bypass chromaticity-derived primaries in encoder

**Files:** `apps/web/src/lib/process-image.ts:490-501`, `:422-436`, `apps/web/src/lib/color-detection.ts:337-348`
**Confidence:** High
**Impact:** Custom monitor profiles (Eizo CG2700X, BenQ SW-series, X-Rite calibrations) with opaque description strings are detected as wide-gamut via chromaticity but encoded as sRGB.

**Root cause:** `resolveAvifIccProfile` (and `resolveColorPipelineDecision`) implements this precedence:

```typescript
// process-image.ts:490-501
export function resolveAvifIccProfile(
    iccProfileName: string | null | undefined,
    signals?: { colorPrimaries?: string | null } | null,
): AvifIccDecision {
    if (!iccProfileName) {
        // Only falls back to signals when ICC name is NULL
        const primaries = signals?.colorPrimaries;
        if (primaries === 'p3-d65' || primaries === 'dci-p3') return 'p3';
        ...
    }
    // ICC-name string matching; opaque names fall through to 'srgb'
```

The `color-detection.ts` ISOBMFF walker and `icc-chromaticity.ts` correctly identify these profiles as wide-gamut, storing `color_primaries = 'p3-d65'` (or `'bt2020'`, etc.) in the DB. But the encoder only consults `signals.colorPrimaries` when `iccProfileName` is null/undefined. For profiles with opaque names, the ICC-name string matching fails, and the wide-gamut chromaticity signal is silently ignored.

**Photographer-visible impact:** A photographer with a calibrated Eizo CG2700X uploads a photo. The color detection correctly says "this is Display P3." The admin panel shows "Color Primaries: Display P3." But the actual AVIF/JPEG derivatives are encoded as sRGB. Saturated reds and greens are clipped. The photographer sees correct metadata and wrong pixels.

**Fix:** In `resolveAvifIccProfile` and `resolveColorPipelineDecision`, when ICC name matching fails to produce a wide-gamut decision, fall back to `signals.colorPrimaries` before defaulting to `'srgb'`:

```typescript
export function resolveAvifIccProfile(
    iccProfileName: string | null | undefined,
    signals?: { colorPrimaries?: string | null } | null,
): AvifIccDecision {
    if (!iccProfileName) {
        // existing NCLX fallback...
    }
    const name = iccProfileName.toLowerCase();
    // existing name matching...
    
    // R7-H1: chromaticity-derived fallback when ICC name is opaque
    const primaries = signals?.colorPrimaries;
    if (primaries === 'p3-d65' || primaries === 'dci-p3') return 'p3';
    if (primaries === 'adobergb' || primaries === 'prophoto' || primaries === 'bt2020') return 'p3-from-wide';
    
    return 'srgb';
}
```

---

### R7-H2 [HIGH] — `image_quality_*` settings absent from `COLOR_IMPACTING_KEYS`

**Files:** `apps/web/src/lib/settings-hash.ts:29-35`, `apps/web/src/lib/serve-upload.ts:107`
**Confidence:** High
**Impact:** Changing `imageQualityWebp`, `imageQualityAvif`, or `imageQualityJpeg` produces different encoded bytes but the same ETag. Cached clients (browser, CDN, reverse proxy) keep stale derivatives.

**Root cause:** `COLOR_IMPACTING_KEYS` in `settings-hash.ts` only covers:
```typescript
const COLOR_IMPACTING_KEYS = [
    'wide_gamut_jpeg_chroma',
    'avif_effort',
    'force_srgb_derivatives',
    'sdr_jpeg_chroma',
    'wide_gamut_max_source_pixels',
];
```

`image_quality_webp`, `image_quality_avif`, and `image_quality_jpeg` are absent. When an admin changes JPEG quality from 90 to 85, existing cached derivatives still match the old ETag and are served with `304 Not Modified`. The photographer's re-export at new quality settings is invisible to returning visitors.

**Fix:** Add the three `image_quality_*` keys to `COLOR_IMPACTING_KEYS`.

---

### R7-M1 [MED] — ICC profile name normalization inconsistency

**Files:** `apps/web/src/lib/color-detection.ts:320-340`, `apps/web/src/lib/process-image.ts:440-528`
**Confidence:** High
**Impact:** Profile names like `"DisplayP3"` (no space) or `"P3D65"` (no hyphen) fail to match in encoder resolvers.

**Root cause:** `color-detection.ts` uses `normalizeName()` (strips all non-alphanumeric chars, lowercases) for matching. `process-image.ts` uses raw `.toLowerCase()`. `"DisplayP3"` → `"displayp3"` in normalize, but `"display p3"` in `.toLowerCase()` — the encoder checks `.includes('display p3')`, which fails.

**Fix:** Import `normalizeName` from `color-detection.ts` and use it consistently in all three resolver functions, or add normalized-form fallback patterns.

---

### R7-M2 [MED] — NCLX transfer values 8 and 17 unmapped

**Files:** `apps/web/src/lib/color-detection.ts:175-184`
**Confidence:** High
**Impact:** Linear transfer (ITU-T H.273 value 8) and SMPTE ST 428-1 gamma 2.6 (value 17) fall through to `'unknown'`, producing misleading "Transfer: Unknown" audit labels.

**Root cause:** The `NCLX_TRANSFER_MAP` is missing entries:
```typescript
// Missing:
8: 'linear',
17: 'gamma26',  // or 'gamma22' if treated as close enough
```

Value 17 (DCI-P3 gamma 2.6) is used by cinema-derived AVIF/HEIF sources. Value 8 (linear) is common in RAW intermediates and scientific imaging.

**Fix:** Add entries to `NCLX_TRANSFER_MAP` and update `humanizeTransferFunction` in `color-details-section.tsx` to handle the new values.

---

### R7-M3 [MED] — Korean mistranslation: "wide gamma" instead of "wide gamut"

**Files:** `apps/web/messages/ko.json` (settings keys)
**Confidence:** High
**Impact:** Three settings labels use `"와이드 감마"` (wide **gamma**) instead of `"광색역"` (wide **gamut**). Gamma and gamut are entirely different color-science concepts. This destroys credibility for Korean-speaking photographers.

**Affected keys:**
- `settings.wideGamutJpegChroma` → `"와이드 감마 JPEG 크로마 서브샘플링"`
- `settings.wideGamutJpegChromaHint` → `"와이드 감마 JPEG..."`
- `settings.wideGamutMaxSourcePixels` → `"와이드 감마 최대 소스 픽셀"`
- `settings.wideGamutMaxSourcePixelsHint` → `"와이드 감마..."`

The viewer-side `viewer.wideGamutHint` correctly uses `"광색역"`.

**Fix:** Change `"와이드 감마"` → `"광색역"` in all four settings strings.

---

### R7-M4 [MED] — Backfill re-encodes files but never updates DB color columns

**Files:** `apps/web/scripts/backfill-color-pipeline.ts:66-92`
**Confidence:** High
**Impact:** If detection logic changed between pipeline versions, the UI shows stale metadata over freshly encoded bytes.

**Root cause:** The backfill script re-runs `processImageFormats` but only updates `pipeline_version`. It does NOT re-run `detectColorSignals` or update `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, or `icc_profile_name`.

**Scenario:** Pipeline v6 fixes a bug in NCLX transfer mapping (e.g. code 2 was wrongly mapped to 'pq'). A backfill re-encodes all images with the corrected encoder. But the DB still shows `transfer_function = 'pq'` for those images. The admin panel shows stale data.

**Fix:** After `processImageFormats` succeeds, re-run `detectColorSignals` on the original file and update the DB color columns atomically with the pipeline_version update.

---

### R7-M5 [MED] — `isDciP3` only checks ICC name, missing NCLX-derived DCI-P3

**Files:** `apps/web/src/lib/process-image.ts:704`
**Confidence:** Medium
**Impact:** NCLX-only DCI-P3 sources go through the rgb16 pipeline unnecessarily, adding memory overhead and potentially shifting white point.

**Root cause:** `isDciP3` is computed inline as:
```typescript
const isDciP3 = iccProfileName?.toLowerCase() === 'dci-p3' || iccProfileName?.toLowerCase().startsWith('dci-p3');
```

It never checks `signals.colorPrimaries === 'dci-p3'`, which is how NCLX-only sources declare DCI-P3.

**Fix:** Also check `signals?.colorPrimaries === 'dci-p3'`:
```typescript
const isDciP3 = (iccProfileName?.toLowerCase() === 'dci-p3' || iccProfileName?.toLowerCase().startsWith('dci-p3')) || signals?.colorPrimaries === 'dci-p3';
```

---

### R7-M6 [MED] — Public viewers cannot see delivered bit depth

**Files:** `apps/web/src/components/color-details-section.tsx:302-310`, `apps/web/src/lib/data.ts`
**Confidence:** High
**Impact:** Public visitors viewing a Display P3 photo see "Source Bit Depth: 14-bit" but have no idea if delivery is 8-bit or 10-bit AVIF.

**Root cause:** `deliveredBitDepth` is computed from `image.color_pipeline_decision`, which is admin-only. The public accordion omits this row entirely.

**Fix:** Derive a public-safe `delivered_bit_depth_label` server-side (e.g. "8-bit" / "10-bit AVIF / 8-bit WebP+JPEG") from `color_pipeline_decision` in the server-side query, and include it in `publicSelectFields` as a non-sensitive derived string.

---

### R7-M7 [MED] — Histogram loads full-resolution image before downscale

**Files:** `apps/web/src/components/histogram.tsx:438-476`
**Confidence:** High
**Impact:** Browser decodes entire source image into memory before `ctx.drawImage()` downscales to 256px. On mobile with limited GPU texture memory, this can cause tab OOM.

**Root cause:** `new Image()` loads the full-resolution source. Current callers pass sized variants (`_640.jpg`), so the impact is bounded. But the `Histogram` component's props API accepts arbitrary URLs with no size validation.

**Fix:** Document the contract that callers must pass sized variants, or add a runtime assertion.

---

### R7-M8 [MED] — Lightbox histogram missing fallback URL

**Files:** `apps/web/src/components/lightbox-color-pip.tsx:119-128`
**Confidence:** High
**Impact:** Legacy photos missing sized derivatives show a blank histogram in the lightbox pip.

**Root cause:** `photo-viewer.tsx` and `info-bottom-sheet.tsx` pass `fallbackImageUrl` to `<Histogram>`; `LightboxColorPip` does not.

**Fix:** Pass `fallbackImageUrl` (the base JPEG) to the `<Histogram>` component in `lightbox-color-pip.tsx`.

---

### R7-M9 [MED] — "sRGB clipped" wording conflates gamut with highlight clipping

**Files:** `apps/web/src/components/histogram.tsx:412-414`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`
**Confidence:** High
**Impact:** Photographers interpret "clipped" as highlight/shadow clipping (blown highlights), not gamut compression. The label is ambiguous.

**Root cause:** The label text `"sRGB clipped"` / `"sRGB 클리핑"` uses "clipped" which in photography means "values beyond the sensor's capture range" (pure white/black), not "colors outside the display gamut."

**Fix:** Rename to `"sRGB preview"` / `"sRGB 색역 미리보기"` or `"sRGB gamut preview"` / `"sRGB 색역 미리보기"`.

---

### R7-L1 [LOW] — Histogram worker uses BT.709 luminance coefficients regardless of image primaries

**Files:** `apps/web/public/histogram-worker.js:21`
**Confidence:** Medium
**Impact:** For P3-tagged images decoded into a P3 canvas, the luminance weights (0.2126/0.7152/0.0722 for BT.709) are slightly incorrect for P3 primaries (0.22897/0.69174/0.07929). The difference is ~2-3% in luminance bins.

**Fix:** Pass image primaries to the worker and select correct coefficients. Or document the approximation.

---

### R7-L2 [LOW] — `stripGpsFromOriginal` strips ICC profile from original file

**Files:** `apps/web/src/lib/process-image.ts:1123-1145`
**Confidence:** Medium
**Impact:** When `strip_gps_on_upload` is enabled, the original file is rewritten via `sharp(inputPath).withMetadata({ orientation })`. This strips the ICC profile from the original, meaning future re-detections (backfill) use NCLX only or fall back to unknown.

**Fix:** Preserve the ICC profile during GPS stripping by also passing `icc` metadata, or use ExifTool instead of Sharp for metadata removal.

---

### R7-L3 [LOW] — `force_srgb_derivatives` naming is misleading

**Files:** `apps/web/src/lib/process-image.ts:696`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`
**Confidence:** Medium
**Impact:** The setting name implies ALL derivatives become sRGB, but AVIF remains gamut-preserved (P3 when appropriate). Only WebP/JPEG are forced to sRGB.

**Fix:** Rename the setting label to clarify "Force sRGB on WebP and JPEG derivatives (AVIF remains gamut-preserved)" or similar.

---

### R7-L4 [LOW] — `extractIccProfileName` called without locale at upload

**Files:** `apps/web/src/lib/color-detection.ts:287`
**Confidence:** Medium
**Impact:** Non-English `mluc` records (e.g. Japanese camera profiles with `ja-JP` locale) produce opaque stored names that fail downstream matching.

**Fix:** Pass the server's configured locale or attempt multiple locale matches.

---

### R7-L5 [LOW] — DCI-P3 AVIF documented as 8-bit; code produces 10-bit

**Files:** `CLAUDE.md` (encoder matrix table)
**Confidence:** High
**Impact:** Documentation says "P3 8-bit (Bradford D65)" for DCI-P3 AVIF, but `process-image.ts:815` gates 10-bit AVIF on `isWideGamutSource` which is true for DCI-P3 (`resolveAvifIccProfile` returns `'p3'`). The rgb16 skip is orthogonal to bit depth.

**Fix:** Update the CLAUDE.md encoder matrix to say "P3 10-bit (Bradford D65)" for DCI-P3 AVIF.

---

### R7-L6 [LOW] — HDR badge falsely claims `@media (dynamic-range: high)` gating

**Files:** `CLAUDE.md` (HDR badge description)
**Confidence:** High
**Impact:** Documentation says the HDR badge gates on `is_hdr` AND the media query, but `color-details-section.tsx:121` computes `isHdr` purely from `transfer_function`; no media query check exists in the badge path.

**Fix:** Update CLAUDE.md to match actual behavior (badge gates on `transfer_function` only, which is admin-only anyway).

---

### R7-L7 [LOW] — Triple Sharp construction for wide-gamut large images

**Files:** `apps/web/src/lib/process-image.ts:713`, `:720-722`, `:732`
**Confidence:** Medium
**Impact:** Three separate `sharp()` constructions on the same source file add ~10-30ms CPU overhead per large image.

**Fix:** Cache metadata from `saveOriginalAndGetMetadata` and pass it into `processImageFormats` to skip the second metadata read.

---

### R7-L8 [LOW] — Backfill DB updates are per-image, not batched

**Files:** `apps/web/scripts/backfill-color-pipeline.ts:178-179`
**Confidence:** Medium
**Impact:** N round-trips to MySQL for N images. Acceptable at personal-gallery scale but does not scale linearly.

**Fix:** Batch UPDATE statements every 100 images.

---

### R7-L9 [LOW] — Comment references wrong file for `extractIccProfileName`

**Files:** `apps/web/src/lib/color-detection.ts:278`
**Confidence:** High
**Impact:** Comment says parser is "used in process-image.ts"; actual source module is `icc-extractor.ts`.

**Fix:** Update comment.

---

### R7-L10 [LOW] — App-level dependency CVEs (Next.js, next-intl)

**Files:** `package.json`
**Confidence:** High
**Impact:** Next.js has HIGH-severity CVEs (XSS in App Router CSP nonces, SSRF, middleware bypass). next-intl has MEDIUM prototype pollution.

**Fix:** `npm audit fix` and deploy.

---

## Cross-Reference to Prior Reviews

| Finding | Prior related finding | Relationship |
|---------|----------------------|--------------|
| R7-H1 | R6-H1 (bootstrap NCLX) | Extends — R6-H1 fixed bootstrap but the same precedence bug exists in the encoder resolvers for non-null ICC names |
| R7-M1 | R6-H1 | Adjacent — same normalization gap in different functions |
| R7-M3 | R4-L3 (type safety in color details) | Similar — i18n accuracy in color metadata |
| R7-M4 | R5-H2 (queue bootstrap retry) | Separate — backfill metadata freshness was not reviewed in prior cycles |
| R7-M6 | R4-L3 | Adjacent — public vs admin field separation |
| R7-M7 | R5-M1 (histogram AVIF fallback) | Adjacent — histogram URL handling |
| R7-L2 | — | New — GPS stripping side effect on ICC profile |

---

## R6 Fix Verification

| Finding | Status | Evidence |
|---------|--------|----------|
| R6-H1 (bootstrap drops NCLX) | FIXED | `image-queue.ts:566-587` reads all color columns; `colorSignals` reconstructed and passed |
| R6-M1 (settings-hash test gap) | FIXED | Two new tests in `settings-hash.test.ts:66-76` |
| R6-M2 (histogram P3 canvas for sRGB) | FIXED | `histogram.tsx:189-194` gates `display-p3` on `isWideGamut` |
| R6-M3 (lightbox unsafe cast) | FIXED | `lightbox-color-pip.tsx:41-46` uses `COLOR_PIPELINE_DECISIONS.includes()` |
| R6-L1 (histogram clipped label) | FIXED | `histogram.tsx:412` uses `colorGamut === 'srgb'` |
| R6-L3 (histogram worker version) | FIXED | `histogram.tsx:426` uses `IMAGE_PIPELINE_VERSION` |

---

## Verdict

The R7 findings are a mix of architectural precedence bugs (R7-H1, R7-H2), i18n credibility issues (R7-M3), code-quality inconsistencies (R7-M1, R7-M2), and UI/UX polish (R7-M6, R7-M7, R7-M8, R7-M9). No fundamental pipeline bugs remain — the surface is converged and photographer-trustworthy for the common cases. R7-H1 is the most severe because it creates silent color-fidelity loss for photographers using calibrated monitor profiles. R7-H2 is close behind because it silently serves stale derivatives after quality changes.

The pipeline is mature. R7 is about edge cases, i18n hygiene, and making the photographer-visible surfaces fully honest about what the gallery delivers.
