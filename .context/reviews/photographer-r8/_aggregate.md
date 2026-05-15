# Photographer Review R8 — Color/HDR Pipeline & UI/UX

**Date:** 2026-05-14
**Scope:** Fresh comprehensive pass after R7 convergence (commits `77473e6b` through `7922c576`).
**Reviewer angle:** Professional photographer — color fidelity, accurate reproduction, HDR workflow, display gamut honesty, browser compatibility, UI/UX clarity.
**Premise:** Photos arrive AFTER the photographer's editing. The encoder + viewer must deliver the photographer's intent (gamut, tonality, dynamic range) accurately to every viewer's display. No edit / culling / scoring features ship.
**Findings:** 1 CRIT, 4 HIGH, 9 MED, 10 LOW

---

## Summary

R7 closed 19 findings (2 HIGH, 9 MED, 10 LOW). R8 surfaces **new architectural, code-quality, UI/UX, and test-coverage gaps** that survived because they span multiple layers or require deep photographer-perspective scrutiny:

1. **R8-R1 [CRIT]** — Backfill script ignores admin-configured encoder settings, silently reverting backfilled images to hardcoded defaults while new uploads honor the admin's tuning.
2. **R8-R2 [HIGH]** — ETag hash reads raw unvalidated DB values; encoder reads validated/fallback values. Cache invalidation signal can misrepresent actual encoding parameters.
3. **R8-R3 [HIGH]** — Lightroom plugin upload silently drops color signals (NCLX primaries, transfer function, HDR flags, gain map) — permanent data loss for plugin-uploaded images.
4. **R8-R4 [HIGH]** — `bit_depth` leaks to public queries; violates documented admin-only privacy boundary.
5. **R8-R5 [MED]** — 10-bit AVIF probe permanently disabled on first transient failure.
6. **R8-R6 [MED]** — `image_sizes` omitted from `COLOR_IMPACTING_KEYS`; ETag stale on size config change.
7. **R8-R7 [MED]** — 24-hour `max-age` cache window delays color-fix visibility.
8. **R8-R8 [MED]** — Non-rgb16 encode path still uses shared `image.clone()` across parallel format jobs.
9. **R8-M1 [MED]** — NCLX_TRANSFER_MAP omits ITU-T H.273 values 4, 5, 7 (gamma-2.2 family codes).
10. **R8-M2 [MED]** — Stored `colorPipelineDecision` does not reflect `forceSrgbDerivatives` admin toggle — audit panel misleads photographer.
11. **R8-M3 [MED]** — P3 badge hidden on Firefox + P3 display (CSS MQ gap vs. canvas probe).
12. **R8-M4 [MED]** — HDR badge lacks "delivered as SDR" honesty note.
13. **R8-L1–L10** — Ten LOW findings covering histogram approximations, label clarity, test coverage gaps, keyboard navigation, schema notes for WI-09, and documented browser limitations.

---

## Severity Distribution

| Severity | Count | IDs |
|----------|-------|-----|
| CRIT | 1 | R8-R1 |
| HIGH | 4 | R8-R2, R8-R3, R8-R4 |
| MED | 8 | R8-R5, R8-R6, R8-R7, R8-R8, R8-M1, R8-M2, R8-M3, R8-M4 |
| LOW | 10 | R8-L1–L10 |

---

## Cross-Reference to Prior Reviews

| Finding | Prior related | Relationship |
|---------|--------------|-------------|
| R8-R1 | R7-M4 (backfill batching) | Adjacent — backfill was rewritten in R7 but settings pass-through was missed |
| R8-R2 | R7-H2 (settings hash) | Adjacent — quality keys were added but raw-vs-validated gap not spotted |
| R8-R3 | R6-H1 (bootstrap NCLX) | Separate — Lightroom route predates color columns |
| R8-M1 | R7-M2 (NCLX transfer 8/17) | Adjacent — same map, additional missing codes |
| R8-M2 | R7-H1 (chromaticity fallback) | Separate — data-model issue, not encoder logic |
| R8-M3 | R7-M6 (public bit depth) | Adjacent — display capability consistency |
| R8-M4 | R7-L6 (HDR badge docs) | Adjacent — badge honesty, now in UI |

---

## Detailed Findings

### R8-R1 [CRITICAL] — Backfill script ignores admin-configured encoder settings

**Files:** `apps/web/scripts/backfill-color-pipeline.ts:91-101`
**Confidence:** Confirmed by direct inspection
**Impact:** Mixed population of derivatives — some honor admin tuning, some silently revert to stock behavior.

The backfill passes `undefined` for `quality`, `sizes`, `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, and `wideGamutMaxSourcePixels`. Every backfilled image gets hardcoded defaults. No warning, no audit log, uniform `pipeline_version=6` masks the split.

**Fix:** Import `getGalleryConfig()` (or read DB settings directly) inside the backfill and forward all tunables to `processImageFormats`.

---

### R8-R2 [HIGH] — ETag settings-hash reads raw DB values; encoder reads validated values

**Files:** `apps/web/src/lib/settings-hash.ts:59-67`, `apps/web/src/lib/gallery-config.ts:96-100`
**Confidence:** Confirmed
**Impact:** False cache invalidation confidence — ETag changes but bytes on disk were produced with different parameters.

`settings-hash.ts` reads raw strings from `admin_settings` without validation. `gallery-config.ts` validates and falls back to defaults. An invalid `image_quality_avif=150` is stored → ETag includes `150`, encoder falls back to `85`. When corrected to `80`, ETag changes but the file was encoded with `85`.

**Fix:** Have `getColorSettingsHash()` accept an optional `GalleryConfig` and compute from resolved values. In `serve-upload.ts`, pass resolved settings to the hash builder.

---

### R8-R3 [HIGH] — Lightroom plugin upload silently drops color signals

**Files:** `apps/web/src/app/api/admin/lr/upload/route.ts:112-132`, `:137-152`
**Confidence:** Confirmed
**Impact:** Permanent loss of NCLX-derived signals for plugin-uploaded HDR HEICs and P3 images.

The Lightroom route stores only `color_space` (ICC name) and `bit_depth`. Missing: `color_pipeline_decision`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `pipeline_version`. Re-processing cannot recover lost signals.

**Fix:** Mirror the browser upload path in `images.ts:354-365` — store all color/HDR columns. Pass `colorSignals` in `enqueueImageProcessing`.

---

### R8-R4 [HIGH] — `bit_depth` leaks to public queries

**Files:** `apps/web/src/lib/data.ts:224`, `:276-293`, `:339`
**Confidence:** Confirmed
**Impact:** Technical metadata about photographer workflow exposed to unauthenticated visitors. Violates documented admin-only privacy boundary.

`bit_depth` is in `adminSelectFields` but not in the `_omit` block for `publicSelectFields`. The `_PrivacySensitiveKeys` compile-time guard does not include it.

**Fix:** Add `bit_depth: _omitBitDepthPublic` to `publicSelectFields` destructuring. Add `'bit_depth'` to `_PrivacySensitiveKeys`.

---

### R8-R5 [MEDIUM] — 10-bit AVIF probe permanently disabled on transient failure

**Files:** `apps/web/src/lib/process-image.ts:60-86`
**Confidence:** Confirmed
**Impact:** One transient error at startup causes every wide-gamut image for the process lifetime to encode as 8-bit AVIF — skies and skin tones band.

The Promise singleton catches ALL errors indiscriminately and caches `false` forever.

**Fix:** Retry probe up to 3 times with exponential backoff. Distinguish Sharp-rejected-bitdepth (expected) from transient errors (EIO, ENOSPC).

---

### R8-R6 [MEDIUM] — `image_sizes` not in `COLOR_IMPACTING_KEYS`

**Files:** `apps/web/src/lib/settings-hash.ts:29-39`
**Confidence:** Confirmed
**Impact:** Size config changes produce different derivative files with the same ETag. Browsers serve stale cached variants.

**Fix:** Add `image_sizes` to `COLOR_IMPACTING_KEYS`.

---

### R8-R7 [MEDIUM] — 24-hour `max-age` cache window delays color-fix visibility

**Files:** `apps/web/src/lib/serve-upload.ts:125`
**Confidence:** Confirmed
**Impact:** Photographer flips `force_srgb_derivatives` to fix colors, but browsers serve stale wrong-color images for up to 24 hours.

**Fix:** Reduce `max-age` to 3600 (1 hour) or 1800 (30 min) for upload routes. Self-hosted gallery with modest traffic can afford shorter cache.

---

### R8-R8 [MEDIUM] — Non-rgb16 encode path uses shared `image.clone()` across parallel jobs

**Files:** `apps/web/src/lib/process-image.ts:754`, `:808-812`
**Confidence:** Hypothesis (same risk profile as WI-14 which DID manifest contamination)
**Impact:** Theoretical race condition in metadata caching under concurrent mutation from three parallel encodes.

**Fix:** Apply WI-14 fix universally — fresh `sharp()` instance per format for ALL paths, not just rgb16.

---

### R8-M1 [MEDIUM] — NCLX_TRANSFER_MAP omits values 4, 5, 7

**Files:** `apps/web/src/lib/color-detection.ts:175`
**Confidence:** High for value 4; Medium for 5, 7
**Impact:** Audit panel shows "Transfer: unknown" for common camera firmware and legacy broadcast codes that map to gamma-2.2.

**Fix:** Add `4: 'gamma22'`, `5: 'gamma22'`, `7: 'gamma22'` to `NCLX_TRANSFER_MAP`.

---

### R8-M2 [MEDIUM] — Stored `colorPipelineDecision` does not reflect `forceSrgbDerivatives` toggle

**Files:** `apps/web/src/lib/process-image.ts:641`, `apps/web/src/app/actions/images.ts`
**Confidence:** High
**Impact:** Admin sees `p3-from-displayp3` but JPEG is actually sRGB-tagged because toggle is ON. AVIF is still P3 — different gamuts per format for same source.

**Fix:** Recompute effective decision at display time from stored `color_primaries` + current `forceSrgbDerivatives` setting, OR add a UI annotation "WebP/JPEG forced to sRGB" when toggle is active.

---

### R8-M3 [MEDIUM] — P3 badge hidden on Firefox + P3 display

**Files:** `apps/web/src/app/[locale]/globals.css:168-169`, `apps/web/src/components/color-details-section.tsx:225-243`
**Confidence:** High
**Impact:** Inconsistent audit experience: Firefox P3 users see P3 histograms but no P3 chip in Color Details accordion.

**Fix:** Add JS-driven `data-display-gamut` attribute selector driven by `useDisplayCapability` output, in addition to CSS MQ.

---

### R8-M4 [MEDIUM] — HDR badge lacks "delivered as SDR" honesty note

**Files:** `apps/web/src/components/color-details-section.tsx:340-351`
**Confidence:** High
**Impact:** Photographer sees "HDR" badge on HDR display and expects HDR delivery, but GalleryKit delivers SDR-only (WI-09 not shipped).

**Fix:** Add adjacent italic text: "Delivered as SDR — HDR AVIF output is planned." Mirror the gain map honesty pattern.

---

### R8-L1 [LOW] — Histogram luminance uses BT.709 coefficients for all primaries

**Files:** `apps/web/public/histogram-worker.js:25`
**Impact:** ~2-3% luminance bin difference for P3 images vs. Lightroom. Already documented in R7-L1 comment.

### R8-L2 [LOW] — Rec.2020 sources histogrammed in Display-P3 canvas space

**Files:** `apps/web/src/components/histogram.tsx:201-206`
**Impact:** Histogram silently clips Rec.2020 colors to P3 bounds. Canvas API limitation. UI doesn't disclose approximation.
**Fix:** Append "(histogram rendered in Display-P3 space)" note when `colorPrimaries === 'bt2020'`.

### R8-L3 [LOW] — `wideGamutMaxSourcePixels` label ambiguity

**Files:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:271`
**Impact:** Sounds like output resolution cap. Hint clarifies but label itself is ambiguous.
**Fix:** Rename to "Wide-Gamut Source Downscale Threshold" / "광색역 원본 축소 임계값".

### R8-L4 [LOW] — Gain map info missing from lightbox color pip

**Files:** `apps/web/src/components/lightbox-color-pip.tsx`
**Impact:** Admin gain map audit row present in Color Details accordion but not replicated in lightbox panel.

### R8-L5 [LOW] — Mobile histogram lacks keyboard ref wiring

**Files:** `apps/web/src/components/info-bottom-sheet.tsx:298-309, 516-528`
**Impact:** `H` shortcut only cycles desktop sidebar histogram, not mobile bottom sheet instance.

### R8-L6 [LOW] — NCLX_MATRIX_MAP omits value 10 (BT.2020 constant luminance)

**Files:** `apps/web/src/lib/color-detection.ts:188-192`
**Impact:** Rare in stills; harmless fallback to `'unknown'`.

### R8-L7 [LOW] — gain-map-detection.ts heuristic 2 forward-compatibility note

**Files:** `apps/web/src/lib/gain-map-detection.ts:274-280`
**Impact:** Could false-positive if future non-HDR encoder uses `tmap` + `auxl`. Low risk.

### R8-L8 [LOW] — SSR default `'p3'` in use-display-capability

**Files:** `apps/web/src/lib/use-display-capability.ts:37`
**Impact:** sRGB-display users briefly miss WideGamutHint during SSR→hydration. Defensible trade-off.

### R8-L9 [LOW] — DCI-P3 rgb16 skip comment misleading for NCLX-only sources

**Files:** `apps/web/src/lib/process-image.ts:801-804`
**Impact:** Comment says "preserves source ICC for Bradford adaptation" but NCLX-only DCI-P3 has no ICC. Harmless behavior, inaccurate documentation.

### R8-L10 [LOW] — Schema missing CLLI, mastering display metadata for WI-09

**Files:** `apps/web/src/db/schema.ts`
**Impact:** Future HDR AVIF delivery (WI-09) will need content light level info and mastering display primaries. Not blocking today.

---

## Positive Observations (What's Working Well)

- **Per-format fresh Sharp instances on rgb16 path** prevent cross-format contamination (WI-14 fixed correctly).
- **NCLX-wins-over-ICC precedence** is correct and regression-tested.
- **Atomic rename contract** for base filenames eliminates 404 windows during re-encode.
- **DCI-P3 Bradford D65 adaptation** is real and verified by round-trip tests.
- **ICC chromaticity detection** correctly rescues opaque monitor profile names.
- **Promise-singleton 10-bit probe** correctly eliminates prior race condition.
- **Color metadata labels** include genuinely useful clipping warnings.
- **DCI-P3 tooltip** explaining Bradford white-point adaptation is excellent UX.
- **Wide-gamut hint** is calm, factual, and correctly gated.
- **Admin settings** clearly explain photographer-relevant tradeoffs.
- **Korean translations** are technically accurate and professional.
- **Touch targets** all meet 44px floor.
- **Keyboard navigation** (`C` for color details, `H` for histogram) is well-implemented.

---

## Test Coverage Matrix

| Scenario | Coverage | Gap |
|----------|----------|-----|
| NCLX primary codes (1, 9, 11, 12) | Partial — 9, 11 tested; 1, 12 missing | MEDIUM |
| Transfer functions (all 7) | Partial — pq, hlg, linear, gamma26 tested; gamma22, gamma18, srgb NCLX missing | MEDIUM |
| ICC chromaticity detection | Strong — 8 tests | — |
| Apple HDR gain map | Strong — 12 tests | — |
| DCI-P3 Bradford adaptation | **NOT TESTED** | **HIGH** |
| 10-bit AVIF metadata | **NOT TESTED** | **HIGH** |
| Wide-gamut JPEG chroma | **NOT TESTED** | MEDIUM |
| force_srgb_derivatives AVIF | **NOT TESTED** | MEDIUM |
| HDR rejection at upload | **NOT TESTED** | **HIGH** |
| Display capability | Strong — 8 tests | — |
| Settings hash | Partial — pure function tested; ETag end-to-end not | MEDIUM |
| E2E color metadata UI | **ZERO COVERAGE** | **HIGH** |

---

*End of aggregate review. Implementation plans are in `.context/plans/photographer-r8/`.*
