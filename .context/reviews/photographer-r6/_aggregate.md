# Photographer Review R6 Aggregate

**Date:** 2026-05-11
**Scope:** Fresh pass over the GalleryKit color/HDR pipeline after R5 convergence (commits `39f649e0` through `29bf9812`).
**Reviewer angle:** Professional photographer perspective — color fidelity, HDR workflow, color space management, display gamut detection, browser compatibility, photographer UX.
**Findings:** 1 HIGH, 3 MED, 3 LOW (0 CRIT)

---

## Summary

R5 closed 14 findings (0 CRIT, 4 HIGH, 6 MED, 4 LOW). The pipeline is now mature and converged. R6 catches edge cases and test gaps that survived the prior cycles:

- **R6-H1** — Bootstrap queue loses NCLX color signals on server restart. NCLX-only sources (no ICC name) fall back to `srgb-from-unknown` after a restart.
- **R6-M1** — `settings-hash.test.ts` lacks coverage for two `COLOR_IMPACTING_KEYS` (`sdr_jpeg_chroma`, `wide_gamut_max_source_pixels`).
- **R6-M2** — Histogram unconditionally renders into a P3 canvas context even for sRGB images, producing misleading perceptual data.
- **R6-M3** — `lightbox-color-pip.tsx` casts `image.color_pipeline_decision` without runtime validation; corrupted DB values can crash the UI.
- **R6-L1** — Histogram "(sRGB clipped)" label gates on `avifSupported === false` instead of display gamut, so sRGB-display visitors with AVIF-capable browsers see no clipping warning.
- **R6-L2** — Bootstrap query reads `icc_profile_name` from DB at restart, but the stored value may be stale if a backfill/detection run updated it.
- **R6-L3** — Histogram worker cache-buster is hardcoded `?v=1`; worker content changes won't invalidate returning-visitor caches.

---

## Severity Distribution

| Severity | Count | IDs |
|----------|-------|-----|
| CRIT | 0 | — |
| HIGH | 1 | R6-H1 |
| MED | 3 | R6-M1, R6-M2, R6-M3 |
| LOW | 3 | R6-L1, R6-L2, R6-L3 |

---

## Per-Agent Detail

### R6-H1 [HIGH] — Bootstrap queue drops NCLX color signals on server restart

**File:** `apps/web/src/lib/image-queue.ts` (bootstrap query, lines ~559–587)
**Impact:** NCLX-only sources pending at server restart lose their gamut information and are encoded as sRGB.
**Root cause:** The bootstrap `SELECT` includes `icc_profile_name` but does NOT include `color_primaries`. The `enqueueImageProcessing` call omits the `colorSignals` parameter entirely, so `processImageFormats` receives `colorSignals: undefined` and falls through to ICC-name-only resolution.

For NCLX-only HEIF/AVIF sources (no embedded ICC, only `colr` box), `icc_profile_name` is NULL. Without `color_primaries` in the bootstrap query, the restarted queue has zero information about the source gamut. The encoder resolves `srgb-from-unknown`, and the photographer's wide-gamut image is silently downgraded to sRGB.

**Fix:** Add `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, and `has_gain_map` to the bootstrap query. Reconstruct a `ColorSignals` object from those columns and pass it as `colorSignals` to `enqueueImageProcessing`.

---

### R6-M1 [MED] — Missing test coverage for two COLOR_IMPACTING_KEYS in settings-hash

**File:** `apps/web/src/__tests__/settings-hash.test.ts`
**Impact:** Undetected hash drift if `sdr_jpeg_chroma` or `wide_gamut_max_source_pixels` changes.
**Root cause:** The test fixture exercises `wide_gamut_jpeg_chroma`, `avif_effort`, and `force_srgb_derivatives`, but `sdr_jpeg_chroma` and `wide_gamut_max_source_pixels` have no dedicated test cases. If someone removes either key from `COLOR_IMPACTING_KEYS`, the test suite still passes.

**Fix:** Add two minimal test cases: one asserting that flipping `sdr_jpeg_chroma` changes the hash, and one asserting that flipping `wide_gamut_max_source_pixels` changes the hash. Keep the existing ordering-independence and stability tests.

---

### R6-M2 [MED] — Histogram requests P3 canvas context for sRGB images

**File:** `apps/web/src/components/histogram.tsx` (`computeHistogramAsync`, lines ~171–207)
**Impact:** Misleading histogram data for sRGB images on P3 displays; wasted worker CPU.
**Root cause:** `computeHistogramAsync` unconditionally creates a canvas with `getContext('2d', { colorSpace: 'display-p3' })` whenever `getSupportsCanvasP3()` returns true, regardless of the image's actual `color_primaries`. For an sRGB source decoded into a P3 canvas, the browser gamut-maps the sRGB pixels into P3 space. The resulting histogram bins shift relative to the true source data, and the luminance weights (BT.709 coefficients in the worker) are no longer correct for the P3-primaries pixels.

**Fix:** Gate the P3 canvas context on `image.color_primaries` being a wide-gamut value. Pass the resolved display capability + image primaries to the worker so it can select correct luminance coefficients.

---

### R6-M3 [MED] — Unsafe type cast in lightbox-color-pip

**File:** `apps/web/src/components/lightbox-color-pip.tsx` (line ~40)
**Impact:** Runtime crash on corrupted DB values.
**Root cause:** `humanizeColorPipelineDecision(image.color_pipeline_decision as ColorPipelineDecision | null | undefined, t)` casts the raw DB string without validation. If a migration bug, manual DB edit, or future schema change introduces an unrecognized value (e.g. `'p3-from-custom'`), `humanizeColorPipelineDecision`'s switch will hit the `default` case (which returns `'Unknown'`), but the cast itself is a lie to the type system. More critically, if downstream code ever assumes the casted value is in the enum, it can crash.

**Fix:** Replace the `as` cast with a runtime guard: `COLOR_PIPELINE_DECISIONS.includes(value as typeof COLOR_PIPELINE_DECISIONS[number]) ? value : undefined`.

---

### R6-L1 [LOW] — Histogram "(sRGB clipped)" label gates on wrong signal

**File:** `apps/web/src/components/histogram.tsx` (line ~404)
**Impact:** Photographers on sRGB displays with AVIF-capable browsers don't see the clipping warning.
**Root cause:** `const isClipped = isWideGamut && avifSupported === false;` — the label only appears when the browser cannot decode AVIF. But the actual clipping condition is "wide-gamut image on an sRGB display", which is independent of AVIF support. An sRGB-display Chrome user with AVIF support still sees the image gamut-clipped; they just don't get the hint.

**Fix:** Change the condition to `isWideGamut && colorGamut === 'srgb'`.

---

### R6-L2 [LOW] — Bootstrap query may use stale ICC profile name

**File:** `apps/web/src/lib/image-queue.ts` (bootstrap query)
**Impact:** Pipeline decision drift if ICC name was updated by a backfill or re-detection.
**Root cause:** The bootstrap query reads `icc_profile_name` from the `images` row at restart time. If an admin ran a backfill, color-detection fix, or manual DB update that changed `icc_profile_name` (or added `color_primaries` via the NCLX path), the restarted queue sees the old value. This is similar to R6-H1 but affects ICC-name-based sources too.

**Fix:** Same as R6-H1 — bootstrap should read ALL color columns (`color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `icc_profile_name`) and reconstruct the full signal set. The `colorSignals` object then takes precedence over the raw `iccProfileName` in `processImageFormats`.

---

### R6-L3 [LOW] — Hardcoded histogram worker cache-buster

**File:** `apps/web/src/components/histogram.tsx` (line ~418)
**Impact:** Returning visitors may run stale worker code after a deploy that changes the worker.
**Root cause:** `new Worker('/histogram-worker.js?v=1')` uses a hardcoded version. If `histogram-worker.js` is updated (e.g., new luminance coefficients, new message format), existing users with a cached worker will continue running the old version until a hard refresh.

**Fix:** Derive the version from a content hash or the `IMAGE_PIPELINE_VERSION` constant, or append a build-timestamp query param at build time (e.g., via an env var or webpack/Next.js define).

---

## Cross-Reference to Prior Reviews

| Finding | Prior related finding | Relationship |
|---------|----------------------|--------------|
| R6-H1 | R5-H2 (queue bootstrap retry) | Extends — R5-H2 added retry logic but didn't add color columns to the bootstrap SELECT |
| R6-M2 | R5-M1 (histogram AVIF fallback) | Separate issue — R5-M1 fixed the sized-variant 404 fallback; R6-M2 is about canvas colorSpace |
| R6-M3 | R4-L3 (type safety in color details) | Similar pattern — unsafe casts in color-metadata UI components |
| R6-L1 | R5-M1 (histogram AVIF fallback) | Adjacent — both in histogram display logic |
| R6-L3 | — | New — worker versioning was not reviewed in prior cycles |

---

## Verdict

The R6 findings are all edge cases or test gaps. No fundamental pipeline bugs remain. The color/HDR surface is converged and photographer-trustworthy. R6-H1 is the only finding with user-visible color-fidelity impact (NCLX-only wide-gamut sources can silently downgrade after restart). The rest are hygiene, test coverage, or UI polish.
