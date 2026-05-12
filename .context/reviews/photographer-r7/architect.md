# Photographer Review R7 — Color/HDR Pipeline Architecture

**Date:** 2026-05-12
**Scope:** End-to-end architectural review of the GalleryKit color/HDR pipeline from detection through display. Focus on silent color-fidelity degradation risks, cross-layer assumption consistency, and cache-invalidation completeness.
**Reviewer angle:** Professional photographer — color accuracy is the product promise.
**Findings:** 2 HIGH, 3 MED, 4 LOW (0 CRIT)

---

## Summary

R6 closed 6 findings (1 HIGH, 3 MED, 2 LOW). All R6 fixes are verified in the current codebase. R7 surfaces architectural risks that survive because they span multiple layers:

1. **R7-H1** — The encoder's `resolveAvifIccProfile` checks ICC name before chromaticity-derived primaries. Custom monitor profiles (Eizo, BenQ, X-Rite) with opaque names are detected as wide-gamut via chromaticity but silently encoded as sRGB.
2. **R7-H2** — `image_quality_*` settings are absent from `COLOR_IMPACTING_KEYS`, so quality changes produce different bytes with the same ETag. Cached clients keep stale derivatives.
3. **R7-M1** — The backfill script re-encodes files but never updates DB color columns. If detection logic changed between pipeline versions, the UI shows stale metadata over fresh bytes.
4. **R7-M2** — `isDciP3` only checks `iccProfileName`, missing NCLX-derived DCI-P3. The rgb16 pipeline runs unnecessarily, adding memory overhead.
5. **R7-M3** — `wide_gamut_max_source_pixels` changes require a backfill but the admin UI offers no signal or prompt.
6. **R7-L1** — Histogram worker uses BT.709 luminance coefficients (0.2126/0.7152/0.0722) regardless of image primaries.
7. **R7-L2** — `stripGpsFromOriginal` uses `withMetadata({ orientation })`, which strips the ICC profile from the original file.
8. **R7-L3** — `force_srgb_derivatives` naming implies all formats become sRGB, but AVIF remains gamut-preserved.
9. **R7-L4** — Upload-time `extractIccProfileName` is called without locale; non-English `mluc` records produce opaque stored names that fail downstream matching.

---

## Severity Distribution

| Severity | Count | IDs |
|----------|-------|-----|
| CRIT | 0 | — |
| HIGH | 2 | R7-H1, R7-H2 |
| MED | 3 | R7-M1, R7-M2, R7-M3 |
| LOW | 4 | R7-L1, R7-L2, R7-L3, R7-L4 |

---

## Per-Finding Detail

### R7-H1 [HIGH] — Opaque ICC names bypass chromaticity-derived primaries in encoder

**Files:** `apps/web/src/lib/process-image.ts:490-501`, `apps/web/src/lib/process-image.ts:422-436`, `apps/web/src/lib/color-detection.ts:337-348`
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
    ...
    return 'srgb';
}
```

`detectColorSignals` (`color-detection.ts:337-348`) runs chromaticity detection when `inferColorPrimaries(iccName)` returns `'unknown'`:

```typescript
if (colorPrimaries === 'unknown' && metadata.icc && Buffer.isBuffer(metadata.icc)) {
    const chromaticity = detectGamutFromIccChromaticity(metadata.icc);
    if (chromaticity && chromaticity.primary !== 'unknown' && chromaticity.confidence !== 'low') {
        colorPrimaries = chromaticity.primary === 'srgb' ? 'bt709' : chromaticity.primary;
    }
}
```

So a profile named "Eizo CG2700X 2026-05-01" (opaque) gets `colorPrimaries = 'p3-d65'` from chromaticity, but `iccProfileName = 'Eizo CG2700X 2026-05-01'` (opaque). The encoder sees a non-null ICC name that doesn't match any known profile, returns `'srgb'`, and the photographer's wide-gamut image is silently downgraded.

**Fix:** In `resolveAvifIccProfile` and `resolveColorPipelineDecision`, when `iccProfileName` is non-null but unrecognized, fall back to `signals.colorPrimaries` before defaulting to `'srgb'`. A simple sentinel like `const isKnownIcc = name.includes('display p3') || name.includes('srgb') || ...` is already the body of the function; wrap the final `return 'srgb'` with a signals fallback.

**Trade-off:** Changing precedence means previously-encoded images at `'srgb-from-unknown'` may now encode as `'p3-from-wide'` after a backfill. This is a behavioral change that should ship with a pipeline version bump.

---

### R7-H2 [HIGH] — `image_quality_*` settings missing from `COLOR_IMPACTING_KEYS`

**File:** `apps/web/src/lib/settings-hash.ts:29-35`
**Confidence:** High
**Impact:** Admin changes to JPEG/WebP/AVIF quality produce different encoded bytes but the same ETag. CDN/browser caches serve stale compressed derivatives until the file is naturally evicted or `max-age=86400` expires.

**Root cause:** `COLOR_IMPACTING_KEYS` includes color-impacting settings but omits quality:

```typescript
const COLOR_IMPACTING_KEYS = [
    'wide_gamut_jpeg_chroma',
    'sdr_jpeg_chroma',
    'avif_effort',
    'force_srgb_derivatives',
    'wide_gamut_max_source_pixels',
] as const;
```

Quality settings (`image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`) directly change the encoded byte stream. A flip from JPEG q90 to q70 halves file size but produces a different bitstream. The ETag remains `v6-{mtime}-{size}-{hash}` — the `size` component will differ, but if the quality change happens during a backfill that preserves mtime, or if two different quality settings happen to produce the same size (possible on uniform images), the ETag collides.

**Fix:** Add `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg` to `COLOR_IMPACTING_KEYS`. Update `__tests__/settings-hash.test.ts` with assertions that quality changes alter the hash.

**Trade-off:** ETag length increases slightly (the hash is already capped at 8 chars, so no change). The 5-second DB cache in `getColorSettingsHash` means a brief skew window across processes, which is acceptable.

---

### R7-M1 [MED] — Backfill leaves DB color metadata stale after re-encode

**File:** `apps/web/src/scripts/backfill-color-pipeline.ts:66-92`
**Confidence:** Medium
**Impact:** If pipeline version N fixes a bug in `detectColorSignals` (e.g., R7-H1 above), the backfill re-encodes with corrected logic but leaves `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, and `color_pipeline_decision` at their old (wrong) values. The admin UI shows stale metadata.

**Root cause:** `reprocessRow` passes `row.icc_profile_name` and `row.color_primaries` to `processImageFormats`, then updates only `pipeline_version`:

```typescript
// backfill-color-pipeline.ts:75-86
await processImageFormats(
    originalPath,
    row.filename_webp,
    row.filename_avif,
    row.filename_jpeg,
    row.width,
    undefined,        // quality — uses defaults
    undefined,        // imageSizes — uses defaults
    row.icc_profile_name,
    undefined,        // forceSrgbDerivatives — uses default
    row.color_primaries ? { colorPrimaries: row.color_primaries } : null,
);
// ... later:
await db.execute(sql`
    UPDATE images SET pipeline_version = ${IMAGE_PIPELINE_VERSION} WHERE id = ${row.id}
`);
```

It never re-runs `detectColorSignals` or updates the color columns. If `detectColorSignals` logic changed between versions (e.g., a new NCLX code added, chromaticity tolerance tightened), the DB retains the old detection results.

**Fix:** After `processImageFormats` succeeds, re-run `detectColorSignals` on the original and update all color columns. Or, at minimum, update `color_pipeline_decision` by re-calling `resolveColorPipelineDecision` with the same inputs used for encoding.

**Trade-off:** Re-running detection adds one `sharp().metadata()` + file read per backfilled image. For a gallery with 10k images, this is ~10 seconds of extra I/O. Acceptable for correctness.

---

### R7-M2 [MED] — `isDciP3` ignores NCLX-derived DCI-P3

**File:** `apps/web/src/lib/process-image.ts:704-705`
**Confidence:** Medium
**Impact:** NCLX-only DCI-P3 sources (no ICC) go through the `pipelineColorspace('rgb16')` resize path unnecessarily. Since there is no source ICC to preserve, color fidelity is unaffected, but memory usage is higher than needed.

**Root cause:** `isDciP3` only inspects `iccProfileName`:

```typescript
const isDciP3 = iccProfileName?.toLowerCase() === 'dci-p3' || iccProfileName?.toLowerCase().startsWith('dci-p3');
```

For NCLX-only sources, `iccProfileName` is null. Even if `signals.colorPrimaries === 'dci-p3'`, `isDciP3` is false, so `needsRgb16 = true`.

The WI-12 comment (`process-image.ts:779-782`) says DCI-P3 skips rgb16 "so the source ICC profile (with DCI white point) is preserved." For NCLX-only sources there is no ICC to preserve, so rgb16 is technically safe — but it adds ~2x memory during resize for no benefit.

**Fix:** Also check `signals?.colorPrimaries === 'dci-p3'`:

```typescript
const isDciP3 = iccProfileName?.toLowerCase() === 'dci-p3' || iccProfileName?.toLowerCase().startsWith('dci-p3') || signals?.colorPrimaries === 'dci-p3';
```

**Trade-off:** None. This is a pure optimization with no semantic change.

---

### R7-M3 [MED] — `wide_gamut_max_source_pixels` change requires backfill with no admin signal

**Files:** `apps/web/src/lib/gallery-config-shared.ts:60`, `apps/web/src/lib/settings-hash.ts:34`
**Confidence:** Medium
**Impact:** Admin lowers the cap (e.g., 50M -> 25M) to reduce memory pressure. Existing wide-gamut images remain at the old resolution. No UI warning tells the admin that existing photos are unaffected until a backfill runs.

**Root cause:** `wide_gamut_max_source_pixels` IS in `COLOR_IMPACTING_KEYS`, so the ETag changes. But the actual derivative files on disk are NOT regenerated. The setting only applies at upload/encode time. The admin settings UI does not mention the backfill requirement.

**Fix:** Add a settings-page note: "Changes to this setting only affect new uploads. Run the backfill script to re-encode existing images." Alternatively, track the last-applied cap in DB and show a banner when the configured cap differs.

**Trade-off:** UI text adds clutter. A one-time doc/note is the lightest-weight fix.

---

### R7-L1 [LOW] — Histogram worker uses BT.709 luminance coefficients regardless of primaries

**File:** `apps/web/src/public/histogram-worker.js:21`
**Confidence:** Low
**Impact:** For P3 or wide-gamut images decoded into a P3 canvas, the luminance histogram uses BT.709 coefficients (0.2126R + 0.7152G + 0.0722B) instead of P3 coefficients (~0.2095R + 0.7215G + 0.0690B). The difference is ~1.5% in luminance values — visible only to photographers doing precise tonal analysis.

**Root cause:** The worker hardcodes BT.709 coefficients:

```javascript
const lum = Math.round(0.2126 * rv + 0.7152 * gv + 0.0722 * bv);
```

This is correct for sRGB images (BT.709 primaries). For P3 images, the coefficients should use the P3 primaries. The difference is small but non-zero.

**Fix:** Pass the image primaries to the worker and select coefficients accordingly. Or document the limitation in the UI ("Luminance uses BT.709 weighting for cross-gamut consistency").

**Trade-off:** Adding primaries-aware coefficients requires changing the worker message protocol and adding a lookup table. For a photographer-facing histogram, accuracy is worth the complexity. For the current implementation, a documentation note is sufficient.

---

### R7-L2 [LOW] — `stripGpsFromOriginal` strips ICC profile from original

**File:** `apps/web/src/lib/process-image.ts:1123-1145`
**Confidence:** Low
**Impact:** When `strip_gps_on_upload` is enabled, the original file is rewritten with `sharp.withMetadata({ orientation })`, which preserves only the orientation tag and strips all other metadata including the ICC profile. Photographers who download the original lose color-space information.

**Root cause:**

```typescript
await sharp(filePath)
    .withMetadata({ orientation })
    .toFile(tmpPath);
```

Sharp's `withMetadata({ orientation })` keeps only the orientation EXIF tag. The ICC profile is typically stored in metadata and is stripped.

**Fix:** Pass `withMetadata({ orientation, icc: metadata.icc })` or similar. If Sharp does not support preserving ICC via `withMetadata`, use a lower-level metadata-preserving approach (e.g., `exiftool` or a Sharp pipeline that copies the ICC buffer explicitly).

**Trade-off:** The `withMetadata` API is concise but imprecise. A more explicit metadata-copying approach adds dependency complexity. Given that `stripGpsOnUpload` is opt-in and the derivatives (not the original) are what the public gallery serves, the impact is limited to photographers who use the download-original feature.

---

### R7-L3 [LOW] — `force_srgb_derivatives` naming implies all formats become sRGB

**File:** `apps/web/src/lib/process-image.ts:696`
**Confidence:** Low
**Impact:** Admin enables "Force sRGB derivatives" expecting all output formats to be sRGB. AVIF remains P3-tagged for wide-gamut sources. The admin may be confused about why P3 AVIF is still generated.

**Root cause:** The encoder splits the decision:

```typescript
const avifIcc: 'p3' | 'srgb' = isWideGamutSource ? 'p3' : 'srgb';   // ignores forceSrgbDerivatives
const targetIcc: 'p3' | 'srgb' = (isWideGamutSource && !forceSrgbDerivatives) ? 'p3' : 'srgb'; // WebP/JPEG only
```

This is documented in CLAUDE.md ("AVIF still gamut-preserved"), but the setting label in the admin UI does not clarify the AVIF exception.

**Fix:** Rename the admin setting label to "Force sRGB on WebP/JPEG derivatives (AVIF remains gamut-preserved)" or add a help tooltip.

**Trade-off:** UI text change only. No code change needed.

---

### R7-L4 [LOW] — `extractIccProfileName` called without locale at upload

**Files:** `apps/web/src/lib/color-detection.ts:287`, `apps/web/src/lib/icc-extractor.ts:45-127`
**Confidence:** Low
**Impact:** ICC v4 profiles with `mluc` tags may have non-English descriptions first. `extractIccProfileName` without locale returns the first non-empty record. The stored `icc_profile_name` may be Japanese/German/etc., causing `resolveAvifIccProfile`'s English substring matching to fail.

**Root cause:**

```typescript
// color-detection.ts:287
iccName = extractIccProfileName(metadata.icc); // no locale argument
```

The `extractIccProfileName` function supports locale-matched `mluc` selection (`icc-extractor.ts:107`), but upload-time detection has no request locale available.

**Fix:** Two options:
1. Always prefer English records in `mluc` by checking `recordLang === 'en'` before falling back to first-non-empty.
2. Re-extract the ICC name at render time with the user's locale for display purposes, while keeping the upload-time name for encoder decisions.

Option 1 is simpler and addresses the common case. Option 2 is more correct but adds complexity.

**Trade-off:** English-first preference may still fail for profiles that have no English record. But it improves the hit rate significantly over "first record wins."

---

## R6 Fix Verification

All 6 R6 findings are verified fixed in the current codebase:

| Finding | Status | Evidence |
|---------|--------|----------|
| R6-H1 | FIXED | `image-queue.ts:566-587` bootstrap query now reads `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map` and passes them as `colorSignals` to `enqueueImageProcessing`. |
| R6-M1 | FIXED | `__tests__/settings-hash.test.ts:66-76` now covers `sdr_jpeg_chroma` and `wide_gamut_max_source_pixels`. |
| R6-M2 | FIXED | `histogram.tsx:189-194` gates P3 canvas on `isWideGamut && supportsP3`. |
| R6-M3 | FIXED | `lightbox-color-pip.tsx:42-45` uses `COLOR_PIPELINE_DECISIONS.includes(rawDecision)` runtime validation instead of `as` cast. |
| R6-L1 | FIXED | `histogram.tsx:412` uses `colorGamut === 'srgb'` (not `avifSupported === false`) for the clipping label. |
| R6-L3 | FIXED | `histogram.tsx:426` uses `IMAGE_PIPELINE_VERSION` in worker URL instead of hardcoded `?v=1`. |

---

## Cross-Layer Assumption Consistency Matrix

| Concept | Detection Layer | Encoder Layer | Display Layer | Consistent? |
|---------|----------------|---------------|---------------|-------------|
| "Wide gamut" definition | `WIDE_GAMUT_PRIMARIES` set in `color-primaries.ts:37` | `avifDecision === 'p3' \|\| 'p3-from-wide'` in `process-image.ts:694` | `isWideGamutPrimary(colorPrimaries)` in `histogram.tsx:386` | YES |
| P3 display detection | N/A (server-side) | N/A (server-side) | `useDisplayCapability` layers MQ + `screen.colorGamut` + canvas-P3 | YES (with Firefox caveat) |
| DCI-P3 special path | NCLX code 11 -> `'dci-p3'` | `isDciP3` from ICC name only | N/A | NO — see R7-M2 |
| NCLX precedence | NCLX > ICC chromaticity > ICC name | N/A (uses resolved values) | N/A | YES |
| sRGB fallback | `'unknown'` transfer for unrecognized profiles | `'srgb'` for unrecognized ICC names | N/A | PARTIAL — see R7-H1 |
| HDR gate | `is_hdr = transfer in ('pq', 'hlg')` | Rejected at upload unless `allow_hdr_ingest` | Admin-only badge gated on `transfer_function` | YES |
| Cache invalidation | `pipeline_version` bump | ETag = `v{version}-{mtime}-{size}-{settingsHash}` | `IMAGE_PIPELINE_VERSION` in worker URL | MOSTLY — see R7-H2 |

---

## Browser × OS × Display Matrix — Remaining Gaps

| Browser | OS | Display | P3 AVIF | MQ `(color-gamut)` | MQ `(dynamic-range)` | `screen.colorGamut` | Canvas-P3 probe | Current behavior | Risk |
|---------|----|---------|---------|-------------------|---------------------|---------------------|-----------------|------------------|------|
| Safari 17+ | macOS/iOS | P3 | yes | yes | yes | yes (18+) | yes | Correct P3 detection | None |
| Chrome 122+ | macOS/Win/Android 14+ | P3 | yes | yes | no | yes | yes | Correct P3 detection | None |
| Edge 122+ | Windows 11 | P3 + Auto HDR | yes | yes | yes | yes | yes | Correct P3 + HDR detection | None |
| Firefox 124+ | macOS/Win | P3 | yes | **no** (bug 1591455) | no | no | yes (regardless of display) | **False positive** on sRGB displays: reports P3, suppresses WideGamutHint, prefers AVIF | LOW — no color fidelity loss, just slightly larger downloads and missing hint |
| Chrome | Android 13- | sRGB | yes | no | no | varies | no | Correct sRGB detection | None |

**Firefox sRGB-display false positive:** The canvas-P3 probe returns `true` on Firefox regardless of actual display gamut. `useDisplayCapability` falls back to canvas-P3 when MQ is unavailable, so sRGB-display Firefox users get `colorGamut = 'p3'`. The `WideGamutHint` is suppressed (user doesn't see "your display clips this"), and AVIF is preferred over JPEG. The AVIF is still gamut-mapped to sRGB by the browser, so no color fidelity loss occurs. The only impact is a slightly larger file download and a missing educational hint.

---

## Partially-Processed State Handling

The queue handles partially-processed states correctly:

- **Delete-while-processing:** `image-queue.ts:283-288` checks row exists before processing; `image-queue.ts:366-378` conditional-updates `processed=true` and cleans up orphaned files if `affectedRows === 0`.
- **Crash mid-encode:** `process-image.ts:907-929` wraps encode in `try/finally` and cleans up the WI-15 downscaled intermediate. Orphaned `.tmp` files are cleaned at bootstrap (`image-queue.ts:29-69`).
- **Retry after failure:** `image-queue.ts:252-491` implements 3 retries with exponential claim-retry backoff, permanently-failed ID tracking, and FIFO eviction.
- **Advisory locks:** Per-image `GET_LOCK` prevents duplicate processing across restart boundaries.

**Remaining gap:** The upload action (`actions/images.ts:286`) saves the original to disk before DB insert. If the process crashes between `saveOriginalAndGetMetadata` and `db.insert`, the original file is orphaned with no DB reference. There is no garbage collection for unreferenced originals. This is documented as acceptable for personal-gallery scale.

---

## Recommendations (Prioritized)

1. **[R7-H1] Fix encoder precedence for opaque ICC names** — Medium effort, High impact. In `resolveAvifIccProfile` and `resolveColorPipelineDecision`, fall back to `signals.colorPrimaries` when the ICC name is non-null but unrecognized. Bump `IMAGE_PIPELINE_VERSION` because this changes encode behavior for existing images.

2. **[R7-H2] Add image quality settings to `COLOR_IMPACTING_KEYS`** — Low effort, High impact. Add `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg` to `settings-hash.ts:29-35` and add corresponding test cases. No pipeline version bump needed (ETag change is sufficient).

3. **[R7-M1] Re-run color detection during backfill** — Medium effort, Medium impact. After `processImageFormats` in `reprocessRow`, call `detectColorSignals` on the original and update all color columns in the DB. This ensures the UI metadata matches the encoded bytes after any detection logic change.

4. **[R7-M2] Fix `isDciP3` to consider NCLX** — Low effort, Medium impact. One-line change in `process-image.ts:704` to also check `signals?.colorPrimaries === 'dci-p3'`.

5. **[R7-M3] Add backfill warning for `wide_gamut_max_source_pixels`** — Low effort, Medium impact. Add a note to the admin settings UI explaining that the setting only affects new uploads.

6. **[R7-L1 through R7-L4]** — Low effort, Low impact. Address via documentation, UI labels, or minor code changes as described above.

---

## References

- `apps/web/src/lib/process-image.ts:490-528` — `resolveAvifIccProfile`: ICC name takes precedence over signals; opaque names fall through to `'srgb'`.
- `apps/web/src/lib/process-image.ts:422-460` — `resolveColorPipelineDecision`: same precedence issue as `resolveAvifIccProfile`.
- `apps/web/src/lib/color-detection.ts:337-348` — Chromaticity detection runs when ICC name is opaque, setting `colorPrimaries` correctly.
- `apps/web/src/lib/settings-hash.ts:29-35` — `COLOR_IMPACTING_KEYS` omits `image_quality_*` settings.
- `apps/web/src/scripts/backfill-color-pipeline.ts:66-92` — `reprocessRow` updates only `pipeline_version`, not color metadata.
- `apps/web/src/lib/process-image.ts:704-705` — `isDciP3` checks only `iccProfileName`.
- `apps/web/src/public/histogram-worker.js:21` — BT.709 luminance coefficients hardcoded.
- `apps/web/src/lib/process-image.ts:1123-1145` — `stripGpsFromOriginal` strips ICC via `withMetadata({ orientation })`.
- `apps/web/src/lib/process-image.ts:696` — AVIF ignores `forceSrgbDerivatives`.
- `apps/web/src/lib/color-detection.ts:287` — Upload-time `extractIccProfileName` called without locale.
- `apps/web/src/lib/icc-extractor.ts:107` — `mluc` locale matching exists but is unused at upload.
- `apps/web/src/lib/image-queue.ts:566-587` — Bootstrap query now includes all color columns (R6-H1 fix verified).
- `apps/web/src/components/histogram.tsx:189-194` — P3 canvas gated on `isWideGamut` (R6-M2 fix verified).
- `apps/web/src/components/histogram.tsx:412` — Clipping label uses `colorGamut === 'srgb'` (R6-L1 fix verified).
- `apps/web/src/components/lightbox-color-pip.tsx:42-45` — Runtime validation via `COLOR_PIPELINE_DECISIONS.includes` (R6-M3 fix verified).
- `apps/web/src/components/histogram.tsx:426` — Worker URL uses `IMAGE_PIPELINE_VERSION` (R6-L3 fix verified).
- `apps/web/src/__tests__/settings-hash.test.ts:66-76` — Covers all 5 `COLOR_IMPACTING_KEYS` (R6-M1 fix verified).
