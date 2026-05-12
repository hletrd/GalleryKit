# Photographer Review R7 — Color/HDR Pipeline Test Coverage Analysis

**Reviewer:** Test Engineer
**Date:** 2026-05-12
**Scope:** All test files under `apps/web/src/__tests__/` related to color, HDR, image processing, and pipeline decisions
**Files Analyzed:** 32 test files + 12 source files

---

## Executive Summary

The color/HDR pipeline has **extensive but uneven test coverage**. Pure-function resolvers (`resolveColorPipelineDecision`, `resolveAvifIccProfile`, `isP3Pipeline`, `detectGamutFromIccChromaticity`, `hasGainMap`, `parseCicpFromHeif`) are well-tested with fixture-style and property-based approaches. Integration tests (`process-image-color-roundtrip`, `backfill-color-pipeline`) exercise actual Sharp encode/decode cycles. Source-inspection fixtures (`is-p3-pipeline`, `color-details-section-delivered`, `lightbox-color-pip-hdr`, `process-image-icc-options-lockin`) prevent regression of cross-cycle consolidations.

However, **the test suite would NOT catch 3 of 4 MEDIUM-severity bugs found in R7**, and **would NOT catch any of the 5 LOW-severity issues**. The histogram surface is the largest untested area — only 1 of ~15 behavioral contracts has a test. The `signals` parameter fallback path in `resolveAvifIccProfile` and `resolveColorPipelineDecision` (NCLX-only sources with no ICC name) is entirely untested. Several edge cases in ICC name normalization and NCLX transfer mapping have no fixture coverage.

| Severity | R7 Findings | Would Tests Catch? |
|----------|-------------|-------------------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 4 | **1 of 4** (25 %) |
| LOW | 5 | **0 of 5** (0 %) |

---

## 1. Tested vs Untested Color Pipeline Behaviors

### 1.1 Well-tested surfaces

| Behavior | Test File | Coverage Quality |
|----------|-----------|------------------|
| `resolveColorPipelineDecision` ICC-name path | `color-pipeline-decision.test.ts` | Good — 15 cases covering exact match, case variance, null/unknown |
| `resolveAvifIccProfile` ICC-name path | `process-image-p3-icc.test.ts` | Good — 11 cases, plus AVIF round-trip via Sharp |
| `isP3Pipeline` enum walk + edge cases | `is-p3-pipeline.test.ts` | Excellent — walks every enum value + null/undefined/empty/forward-compat |
| `detectGamutFromIccChromaticity` synthetic ICCs | `icc-chromaticity.test.ts` | Excellent — 6 preset gamuts + custom Eizo drift + off-gamut + truncated buffer |
| `detectGamutFromIccChromaticity` real fixtures | `color-fixtures.test.ts` | Good — 5 on-disk ICC files |
| `parseCicpFromHeif` ISOBMFF walker | `color-detection.test.ts:330-392` | Good — flat nclx, nested meta/iprp/ipco, prof skip, depth bound, malformed |
| `hasGainMap` synthetic containers | `gain-map-detection.test.ts` | Good — urim, tmap+auxl, false-positive guards, truncation |
| `extractIccProfileName` mluc v4 UTF-16BE | `process-image-metadata.test.ts` | Good — locale-matched selection, supplementary chars, byte bounds |
| `useDisplayCapability` detection paths | `use-display-capability.test.ts` | Good — screen.colorGamut, MQ, canvas-P3 fallback, SSR default |
| `humanizeColorPipelineDecision` i18n | `color-pipeline-decision-i18n.test.ts` | Good — walks canonical enum through en + ko |
| `humanizeTransferFunction` i18n | `humanize-transfer-function-i18n.test.ts` | Good — all transfer values in both locales |
| `humanizeColorPrimaries` Latinate convention | `humanize-color-primaries.test.ts` | Good — canonical keys + null/unknown guards |
| Privacy field separation | `privacy-fields.test.ts` | Good — symmetric guard: admin-only keys == SENSITIVE_KEYS exactly |
| Color round-trip (pixel + ICC) | `process-image-color-roundtrip.test.ts` | Good — untagged sRGB, Display-P3, Adobe RGB, ProPhoto, Rec.2020 via Sharp |
| Backfill reprocessor | `backfill-color-pipeline.test.ts` | Good — skip missing, process existing, P3 → P3-tagged AVIF |
| Source-inspection locks (consumer imports) | `is-p3-pipeline.test.ts:70-124` | Excellent — 4 consumers × 4 assertions each |
| `WIDE_GAMUT_PRIMARIES` canonical set | `wide-gamut-primaries.test.ts` | Good — exact membership + `isWideGamutPrimary` edge cases |
| `settings-hash` format/stability/key coverage | `settings-hash.test.ts` | Good — 9 tests covering format, stability, ordering, diffs, ignored keys |
| `force_srgb_derivatives` setting validation | `force-srgb-derivatives.test.ts` | Good — default, boolean validation, target ICC matrix |
| `primariesMatchIccName` dedup | `color-details-primaries-match-icc.test.ts` | Good — normalization + match logic |

### 1.2 Untested or barely-tested surfaces

| Behavior | Why It Matters | Risk Level |
|----------|---------------|------------|
| `resolveColorPipelineDecision` with `signals` parameter (NCLX fallback) | P3-11: NCLX-only sources (no ICC name) resolve via `signals.colorPrimaries` | **High** |
| `resolveAvifIccProfile` with `signals` parameter (NCLX fallback) | Same as above — this is the bootstrap path for ICC-less AVIF/HEIF | **High** |
| `isDciP3` detection in `processImageFormats` | WI-12: DCI-P3 sources skip rgb16 to preserve source ICC for Bradford adaptation; false negative → wrong white point | **Medium** |
| `detectColorSignals` HEIF/AVIF file-open path (try/catch fallback) | If `fs.open` fails, detection falls back to ICC-only; no test for this branch | **Medium** |
| `detectColorSignals` with `inferTransferFunction` + `bitDepth` param | The `bitDepth >= 10 → 'unknown'` branch is not directly exercised | **Medium** |
| `inferColorPrimaries` standalone | Only tested through `detectColorSignals` top-level; no direct unit tests | **Low** |
| `inferMatrixCoefficients` standalone | Only tested through `detectColorSignals` top-level; no direct unit tests | **Low** |
| `processImageFormats` DCI-P3 rgb16 skip | No integration test verifies DCI-P3 goes through the non-rgb16 path | **Medium** |
| `processImageFormats` WI-15 wide-gamut downscale | No test for >50 MP source downscale before rgb16 fan-out | **Medium** |
| `processImageFormats` sized-variant dedup (hard-link path) | No test for `fs.link` dedup when lastRendered.resizeWidth === resizeWidth | **Low** |
| `processImageFormats` atomic rename fallback chain | No test for the three-level fallback (link+rename → copy+rename → direct copy) | **Low** |
| `canUseHighBitdepthAvif` / 10-bit probe singleton | No direct test for the Promise-singleton pattern or 10-bit → 8-bit fallback | **Medium** |
| `saveOriginalAndGetMetadata` color signal integration | The full upload path from Sharp metadata → `detectColorSignals` → `resolveColorPipelineDecision` is not tested end-to-end | **Medium** |
| `extractExifForDb` `color_space` mapping (EXIF tag 0xA001) | No test for ColorSpace=1 (sRGB) vs 65535 (Uncalibrated) | **Low** |
| `stripGpsFromOriginal` | No tests at all | **Medium** |
| `normalizeName` in `color-detection.ts` | No direct tests; this is the root cause of R7-MEDIUM-1 | **High** |
| `parseCicpFromHeif` extended box size (size === 1, 64-bit) | No test for the `readBigUInt64BE` branch | **Low** |
| `parseCicpFromHeif` size === 0 (rest-of-buffer) | No test for the size-zero branch | **Low** |
| `getSupportsCanvasP3` | No direct tests; histogram and display capability both depend on it | **Medium** |
| `getAvifSupportPromise` / `probeAvifSupport` | No direct tests; histogram AVIF preference depends on it | **Medium** |

---

## 2. Edge Cases Missing from Test Fixtures

### 2.1 NCLX-only sources (no ICC profile)

**Confidence: High**

The NCLX parsing tests (`color-detection.test.ts:161-180`) use synthetic ISOBMFF files on disk and assert the returned `ColorSignals`. However, there is **no test** that pipes those same NCLX-derived signals through `resolveColorPipelineDecision(signals)` or `resolveAvifIccProfile(signals)` — the `signals` parameter path in both resolvers is entirely uncovered.

**Concrete gap:**
- `color-detection.test.ts:161-173` tests NCLX primaries=9/transfer=16/matrix=9 (BT.2020/PQ/BT.2020-NCL) and primaries=9/transfer=18/matrix=9 (BT.2020/HLG/BT.2020-NCL) through `detectColorSignals`.
- But there is no test that says: given `signals = { colorPrimaries: 'bt2020' }`, `resolveColorPipelineDecision(null, signals)` returns `'p3-from-rec2020'`.
- Same gap for `resolveAvifIccProfile(null, signals)` → `'p3-from-wide'`.

**Test files affected:** `color-pipeline-decision.test.ts`, `process-image-p3-icc.test.ts`

### 2.2 Custom ICC profiles (opaque names rescued by chromaticity)

**Confidence: High**

The chromaticity-based detection has good synthetic tests (`icc-chromaticity.test.ts`, `color-detection.test.ts:187-227`). However, the **end-to-end integration** — where `detectColorSignals` calls `detectGamutFromIccChromaticity` as a fallback when `inferColorPrimaries` returns `'unknown'` — is only tested once (`color-detection.test.ts:187-227`, the AdobeRGB-like custom profile).

**Missing edge cases:**
- A custom profile that matches **sRGB** chromaticities but has an opaque name → should map to `'bt709'` (the `'srgb'` → `'bt709'` boundary conversion in `detectColorSignals:340`).
- A custom profile with **low-confidence** chromaticity match → should NOT upgrade primaries (the `confidence !== 'low'` gate at `color-detection.ts:339`).
- A custom profile whose chromaticity is **off-gamut** → should stay `'unknown'`.

**Test files affected:** `color-detection.test.ts`

### 2.3 DCI-P3 sources

**Confidence: High**

DCI-P3 is tested in two places:
1. `color-detection.test.ts:175-180` — NCLX primaries=11 maps to `'dci-p3'`.
2. `process-image-p3-icc.test.ts:50-56` — `resolveAvifIccProfile('DCI-P3')` returns `'p3'`.

**Missing:**
- No integration test verifies that DCI-P3 sources skip the rgb16 pipeline (`isDciP3 = true` → `needsRgb16 = false`). This is the WI-12 Bradford D65 adaptation path.
- No test for DCI-P3 with alternate name variants (`"DCI_P3"`, `"DCI P3"`, `"DCIP3"`) that would expose the `normalizeName` vs `.toLowerCase()` mismatch (R7-MEDIUM-1).
- No test that the output AVIF/WebP/JPEG for DCI-P3 carries the correct ICC and white point.

**Test files affected:** `process-image-color-roundtrip.test.ts`, `process-image-p3-icc.test.ts`

### 2.4 HDR sources (PQ / HLG)

**Confidence: Medium**

HDR detection is tested:
1. `color-detection.test.ts:103-115` — ICC string hints (`"PQ HDR"`, `"HLG"`) → `transferFunction='pq'/'hlg'`, `isHdr=true`.
2. `color-detection.test.ts:161-173` — NCLX transfer=16 (PQ) and transfer=18 (HLG) → same.

**Missing:**
- No test for NCLX transfer=8 (linear) → should map to `'linear'` (R7-MEDIUM-3).
- No test for NCLX transfer=17 (SMPTE ST 428-1, DCI-P3 gamma 2.6) → should map to `'gamma22'` (R7-MEDIUM-2).
- No test for HDR ingest rejection at the upload layer (`allow_hdr_ingest=false`).
- No test for HDR ingest acceptance with warning (`allow_hdr_ingest=true`).
- No test that `has_gain_map` detection populates the `hasGainMap` field in `ColorSignals` for HEIF sources.

**Test files affected:** `color-detection.test.ts`, `images-actions.test.ts` (upload path)

### 2.5 Gain map detection

**Confidence: Medium**

`gain-map-detection.test.ts` has 11 tests with synthetic ISOBMFF containers. The test coverage is good for the structural heuristics.

**Missing:**
- No test with a **real iPhone HEIC** file (the synthetic fixtures may not match actual Apple container layouts).
- No test for the **integration** with `detectColorSignals`: the `hasGainMap` field is populated when `format === 'heif' || format === 'avif'`, but no test verifies the top-level `ColorSignals.hasGainMap` value for a gain-mapped file.
- No test for the false-positive scenario in heuristic 2 (non-HDR `auxl` pointing to `urim`/`tmap`) — R7-LOW-3.

**Test files affected:** `gain-map-detection.test.ts`, `color-detection.test.ts`

---

## 3. Would Tests Catch R7 Bugs?

### 3.1 R7-MEDIUM-1: ICC name matching inconsistency (`.toLowerCase()` vs `normalizeName`)

**Verdict: NO — tests would NOT catch this.**

**Evidence:**
- `color-pipeline-decision.test.ts:5-37` tests `resolveColorPipelineDecision` with canonical names (`"Display P3"`, `"display p3"`, `"P3-D65"`, `"p3-d65"`, `"DCI-P3"`, `"dci-p3"`).
- `process-image-p3-icc.test.ts:40-100` tests `resolveAvifIccProfile` with the same canonical names.
- Neither test includes `"DisplayP3"` (no space), `"P3D65"` (no hyphen), `"DCI_P3"` (underscore), or `"DCIP3"`.
- The `isDciP3` detection at `process-image.ts:704` is not tested at all — it is an inline expression, not a named export.

**Gap:** `normalizeName` strips non-alphanumeric characters (so `"DisplayP3"` → `"displayp3"`), but `resolveColorPipelineDecision` uses `.toLowerCase()` which preserves the missing space (`"displayp3"` does NOT match `"display p3"`). The test fixtures only use names that happen to work with both matchers.

**Fix needed:** Add test cases for normalized-name variants to `color-pipeline-decision.test.ts` and `process-image-p3-icc.test.ts`. Add a source-inspection or runtime test that `isDciP3` uses `normalizeName` or equivalent.

### 3.2 R7-MEDIUM-2: NCLX transfer 17 (SMPTE ST 428-1) not mapped

**Verdict: NO — tests would NOT catch this.**

**Evidence:**
- `color-detection.test.ts:161-173` tests NCLX transfer=16 (PQ) and transfer=18 (HLG).
- `NCLX_TRANSFER_MAP` at `color-detection.ts:175-184` has no entry for 17.
- No test iterates over the full set of expected NCLX transfer values to verify completeness.

**Gap:** The test only exercises the two HDR transfers. It does not verify that ALL documented ITU-T H.273 transfer values that map to known `ColorSignals['transferFunction']` enums are present.

**Fix needed:** Add a completeness test that iterates over a reference set of `(nclxValue, expectedTransfer)` pairs, or add explicit tests for transfer=8 and transfer=17.

### 3.3 R7-MEDIUM-3: NCLX transfer 8 (linear) not mapped

**Verdict: NO — tests would NOT catch this.**

**Evidence:** Same as MEDIUM-2 — the NCLX transfer map has no entry for 8, and no test exercises it.

### 3.4 R7-MEDIUM-4: LightboxColorPip omits `fallbackImageUrl` for Histogram

**Verdict: NO — tests would NOT catch this.**

**Evidence:**
- `histogram.test.ts` has exactly 1 test: worker message requestId routing. It does not test component props or integration.
- `lightbox-color-pip-hdr.test.ts` tests HDR gating and single-render contracts via source-inspection, but does NOT inspect the Histogram JSX props.
- `color-details-section-delivered.test.ts` tests the sidebar accordion wiring, not the lightbox pip.

**Gap:** No test verifies that `LightboxColorPip` passes `fallbackImageUrl` to `<Histogram>`. The `photo-viewer.tsx` and `info-bottom-sheet.tsx` do pass it (verified by source inspection), but the lightbox pip is not covered.

**Fix needed:** Add a source-inspection test in `lightbox-color-pip-hdr.test.ts` (or a new test file) that asserts `fallbackImageUrl` is passed to the Histogram component.

### 3.5 R7-LOW issues

All 5 LOW issues would NOT be caught by existing tests:

| Issue | Why Not Caught |
|-------|---------------|
| LOW-1: `wide_gamut_max_source_pixels` in hash | `settings-hash.test.ts:72-76` verifies the current (arguably incorrect) behavior, not semantic correctness |
| LOW-2: Histogram worker BT.709 coefficients | `histogram.test.ts` does not test the worker computation at all |
| LOW-3: `hasGainMap` heuristic 2 false-positive | `gain-map-detection.test.ts` does not test non-HDR `auxl` → `urim`/`tmap` scenarios |
| LOW-4: Missing NCLX primaries value 10 | `color-detection.test.ts` does not test primaries=10 |
| LOW-5: Redundant `dataSize >= 11` check | Source-inspection tests do not inspect `parseCicpFromHeif` implementation details |

---

## 4. Test Gaps in Specific Files

### 4.1 `__tests__/settings-hash.test.ts` (lines 19-83)

**Current state:** 9 tests. Covers format, stability, ordering, per-key diff, ignored keys.

**Gaps:**
1. **No completeness guard:** Does NOT verify that the test exercises EVERY key in `COLOR_IMPACTING_KEYS`. If a new key is added to the source but not to the test, the test silently passes. A source-inspection or reflection-based completeness test would prevent this.
2. **No semantic correctness test:** `wide_gamut_max_source_pixels` is tested as "differs when changed" (line 72-76), but there is no test asserting whether it SHOULD be in the hash at all. R7-LOW-1 argues it should not be.
3. **No `image_sizes` test:** `image_sizes` changes affect derivative bytes (different sized variants), so it SHOULD be in the hash, but there is no test for it.
4. **No collision/entropy test:** Two different settings maps could theoretically produce the same 8-char prefix; no test checks for collision resistance.

**Recommended additions:**
- Source-inspection: assert that `COLOR_IMPACTING_KEYS` in `settings-hash.ts` contains exactly the keys the test knows about.
- Add `image_sizes` to the diff test.
- Add a test that `wide_gamut_max_source_pixels` is NOT in `COLOR_IMPACTING_KEYS` (if the R7 fix is applied).

### 4.2 `__tests__/color-pipeline-decision-i18n.test.ts` (lines 48-76)

**Current state:** `it.each(ENUM_VALUES)` × 2 locales + 4 default/unknown cases.

**Gaps:**
1. **No string-value assertion:** Tests only assert `result.length > 0` and `result` is truthy. They do NOT assert the actual human-readable string. A contributor could change `"Display P3"` to `"P3"` and the test would pass.
2. **No compile-time enum exhaustiveness guard:** The test walks `COLOR_PIPELINE_DECISIONS` at runtime. If a new value is added to the TypeScript union but forgotten in `COLOR_PIPELINE_DECISIONS`, the test won't catch it (the runtime array is the source of truth).
3. **No test for the `t()` function being called with the correct key:** A refactor could change the key pattern from `viewer.colorPipelineDecision.${value}` to something else; the test only checks the return value.

**Recommended additions:**
- Snapshot the expected strings for each enum value (or at least assert known substrings like "P3" or "sRGB").
- Add a TypeScript-level exhaustiveness check: `type _AssertAllDecisionsCovered = ...`.

### 4.3 `__tests__/is-p3-pipeline.test.ts` (lines 27-124)

**Current state:** 8 runtime tests + 4 consumers × 4 source-inspection assertions.

**Gaps:**
1. **No runtime integration test:** The call-site lock verifies that `isP3Pipeline` is IMPORTED and CALLED, but does not verify the return value is actually USED to gate the UI. A consumer could import the helper, call it, and ignore the result.
2. **No test for `isP3Pipeline` with the `COLOR_PIPELINE_DECISIONS` type import:** The function accepts `ColorPipelineDecision | string | null | undefined`. No test verifies the TypeScript narrowing works correctly.
3. **No test for consumers' runtime behavior with a real image object:** Source-inspection is static; it doesn't prove the component renders correctly when `image.color_pipeline_decision` is `'p3-from-displayp3'`.

**Recommended additions:**
- React Testing Library integration test for at least one consumer (e.g., `color-details-section.tsx`) rendering with a P3 decision vs sRGB decision.

### 4.4 `__tests__/privacy-fields.test.ts` (lines 1-71)

**Current state:** 4 tests covering schema existence, admin containment, public exclusion, symmetric guard.

**Gaps:**
1. **No compile-time guard test:** The `_SensitiveKeysInPublic` and `_PrivacySensitiveKeys` type guards in `data.ts` are compile-time only. There is no test that verifies they actually exist or would fail if violated.
2. **No test for NEW sensitive field onboarding:** If a migration adds `icc_profile_data` (a new sensitive field), the symmetric guard catches it only if the developer remembers to add it to `SENSITIVE_KEYS`. There is no automated check that every column in `images` whose name suggests sensitivity is accounted for.
3. **No test for runtime query behavior:** The test verifies that `publicSelectFieldKeys` does not contain sensitive keys, but does not verify that actual Drizzle queries use `publicSelectFieldKeys` (not `adminSelectFieldKeys`) for public routes.

**Recommended additions:**
- Source-inspection test that every public API route / server action uses `publicSelectFieldKeys` (or a derived subset) and never spreads `adminSelectFieldKeys`.

---

## 5. Tests for Specific Functions

| Function | Tested? | Test File | Notes |
|----------|---------|-----------|-------|
| `resolveAvifIccProfile` | **Partial** | `process-image-p3-icc.test.ts` | ICC-name path covered; `signals` parameter (NCLX fallback) is **NOT tested** |
| `resolveColorPipelineDecision` | **Partial** | `color-pipeline-decision.test.ts` | ICC-name path covered; `signals` parameter (NCLX fallback) is **NOT tested** |
| `isDciP3` | **No** | — | Inline expression at `process-image.ts:704`, not an exported function |
| `detectColorSignals` | **Partial** | `color-detection.test.ts` | Mock-metadata path covered; HEIF/AVIF file-open path with gain map detection is **NOT tested** |
| `extractIccProfileName` | **Yes** | `process-image-metadata.test.ts` | mluc v4, locale selection, supplementary chars, byte bounds |
| `detectGamutFromIccChromaticity` | **Yes** | `icc-chromaticity.test.ts`, `color-fixtures.test.ts` | Synthetic + real fixtures |
| `hasGainMap` | **Yes** | `gain-map-detection.test.ts` | Synthetic ISOBMFF fixtures |
| `parseCicpFromHeif` | **Yes** | `color-detection.test.ts` | Walker, nesting, depth bounds, malformed |
| `inferColorPrimaries` | **No** | — | Private function in `color-detection.ts`, only tested through `detectColorSignals` |
| `inferTransferFunction` | **No** | — | Private function, only tested through `detectColorSignals` |
| `inferMatrixCoefficients` | **No** | — | Private function, only tested through `detectColorSignals` |
| `normalizeName` | **No** | — | Private function, root cause of R7-MEDIUM-1 |
| `isP3Pipeline` | **Yes** | `is-p3-pipeline.test.ts` | Full enum walk + edge cases |
| `isWideGamutPrimary` | **Yes** | `wide-gamut-primaries.test.ts` | Membership + null/undefined |
| `humanizeColorPipelineDecision` | **Partial** | `color-pipeline-decision-i18n.test.ts` | Non-empty assertion only; no value-level checks |
| `humanizeTransferFunction` | **Yes** | `humanize-transfer-function-i18n.test.ts` | Value-level checks for Latinate names |
| `humanizeColorPrimaries` | **Yes** | `humanize-color-primaries.test.ts` | Value-level checks for all canonical keys |
| `primariesMatchIccName` | **Yes** | `color-details-primaries-match-icc.test.ts` | Normalization + match logic |
| `getAvifSupportPromise` | **No** | — | No tests for the AVIF probe singleton |
| `getSupportsCanvasP3` | **No** | — | No tests for canvas P3 context creation |

---

## 6. Histogram Behavior Test Coverage

**Current state:** `histogram.test.ts` has **1 test** (lines 28-60): `requestHistogramFromWorker` requestId routing with a fake worker.

**Untested histogram behaviors:**

| Behavior | Component | Risk |
|----------|-----------|------|
| Canvas `colorSpace` selection (sRGB vs Display-P3) | `computeHistogramAsync` | **High** — R6-M2 specifically fixed this; no test locks the fix |
| Worker luminance computation | `public/histogram-worker.js` | **Medium** — BT.709 coefficients for all gamuts (R7-LOW-2) |
| Worker RGB channel computation | `public/histogram-worker.js` | **Medium** — not tested at all |
| `drawHistogram` canvas rendering | `drawHistogram` | **Medium** — grid lines, channel fills, RGB overlay |
| Clip indicator thresholds (≥0.5% bins) | `drawHistogram` | **Medium** — R5-H3 RGB mode worst-case channel logic |
| Clip percentage labels below histogram | JSX inline | **Low** — computed from histogramData, rendered conditionally |
| `toHistogramData` backward compat | `toHistogramData` | **Low** — legacy worker message format (r/g/b/l flat arrays) |
| `getGamutLabel` i18n key selection | `getGamutLabel` | **Low** — maps primaries to translation keys |
| AVIF probe resolution | `probeAvifSupport` | **Medium** — affects whether AVIF or JPEG is loaded |
| Canvas-P3 probe | `getSupportsCanvasP3` | **Medium** — affects whether P3 canvas context is requested |
| URL fallback chain (AVIF → JPEG → base) | `Histogram` component | **High** — R7-MEDIUM-4 (lightbox omits fallback) |
| `isClipped` gamut clipping hint | `Histogram` component | **Medium** — R7-Finding-3.1 (wording ambiguity) |
| Mode cycling (`cycleMode`) | `Histogram` component | **Low** — advances through 5 modes |
| Collapse/expand toggle | `Histogram` component | **Low** — state toggle |
| AbortSignal cleanup | `requestHistogramFromWorker` | **Low** — memory leak prevention |

**The histogram is the most under-tested surface in the color/HDR pipeline.** The single worker-routing test is valuable for preventing request-id mix-ups, but it covers none of the photographer-visible behavior: canvas rendering, color space selection, clip detection, or URL resolution.

**Recommended priority for histogram tests:**
1. **Canvas colorSpace selection** — test that `computeHistogramAsync` requests `{ colorSpace: 'display-p3' }` only when `isWideGamutPrimary(colorPrimaries) && getSupportsCanvasP3()` is true.
2. **Worker computation** — load the worker in a test environment (or extract the computation function) and verify luminance/RGB output for a known pixel buffer.
3. **URL fallback chain** — component-level test that verifies `fallbackImageUrl` is used when `imageUrl` 404s.
4. **Clip indicators** — test that `drawHistogram` renders red bars when bin 0 or bin 255 exceeds 0.5% of total.

---

## 7. Bootstrap Color Signal Preservation

**Current state:** `image-queue-bootstrap.test.ts` tests the queue bootstrapping logic (batching, capping, retry, continuation) but **does NOT test that color signals are preserved from DB → queue → encoder**.

**Gap:** The R6 review (and R7-code-reviewer positive observation #4) notes that `image-queue.ts` selects `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, and `has_gain_map` from the DB and passes them through `colorSignals` to `processImageFormats`. There is no test that verifies:
1. The DB select includes these columns.
2. They are passed to `processImageFormats` as the `signals` parameter.
3. `processImageFormats` uses them correctly when `iccProfileName` is null.

**Test files affected:** `image-queue-bootstrap.test.ts`, `image-queue.test.ts`

---

## 8. Recommendations

### Priority 1: Write failing tests for R7-MEDIUM bugs BEFORE fixing them

Per TDD discipline:

1. **MEDIUM-1 (ICC name mismatch):** Add tests to `color-pipeline-decision.test.ts` and `process-image-p3-icc.test.ts` for `"DisplayP3"`, `"P3D65"`, `"DCI_P3"`, `"DCIP3"`. They should fail against current code. Then fix `process-image.ts` to use `normalizeName`.
2. **MEDIUM-2 (NCLX transfer 17):** Add test to `color-detection.test.ts` for NCLX transfer=17 → `'gamma22'`. Fails now.
3. **MEDIUM-3 (NCLX transfer 8):** Add test to `color-detection.test.ts` for NCLX transfer=8 → `'linear'`. Fails now.
4. **MEDIUM-4 (lightbox fallback URL):** Add source-inspection test to `lightbox-color-pip-hdr.test.ts` asserting `fallbackImageUrl` is passed to `<Histogram>`. Fails now.

### Priority 2: Fill the NCLX fallback gap

Add tests to `color-pipeline-decision.test.ts` and `process-image-p3-icc.test.ts` that exercise `resolveColorPipelineDecision(null, { colorPrimaries: '...' })` and `resolveAvifIccProfile(null, { colorPrimaries: '...' })` for every canonical primary value.

### Priority 3: Histogram tests

Add component-level tests for canvas colorSpace selection and worker computation. Consider extracting the histogram computation to a testable pure function.

### Priority 4: Settings-hash completeness

Add a source-inspection or reflection test that `COLOR_IMPACTING_KEYS` contains exactly the keys exercised by the test suite.

### Priority 5: Bootstrap signal flow

Add a test to `image-queue-bootstrap.test.ts` (or a new file) that verifies the DB select includes color signal columns and that they flow through to `processImageFormats`.

---

## Appendix: Test File Inventory

| Test File | Relevant Lines | What It Tests | Coverage Rating |
|-----------|---------------|---------------|-----------------|
| `color-detection.test.ts` | 1-423 | `detectColorSignals`, `parseCicpFromHeif`, `extractIccProfileName` | Good |
| `color-pipeline-decision.test.ts` | 1-51 | `resolveColorPipelineDecision` (ICC-name path only) | Partial |
| `color-pipeline-decision-i18n.test.ts` | 1-76 | `humanizeColorPipelineDecision` i18n coverage | Partial |
| `is-p3-pipeline.test.ts` | 1-124 | `isP3Pipeline` runtime + consumer source-inspection | Good |
| `settings-hash.test.ts` | 1-83 | `_buildHashForTesting` format/stability/keys | Partial |
| `privacy-fields.test.ts` | 1-71 | Admin/public field separation | Good |
| `histogram.test.ts` | 1-60 | `requestHistogramFromWorker` requestId routing only | Poor |
| `icc-chromaticity.test.ts` | 1-226 | `detectGamutFromIccChromaticity` synthetic profiles | Excellent |
| `gain-map-detection.test.ts` | 1-214 | `hasGainMap` synthetic ISOBMFF | Good |
| `wide-gamut-primaries.test.ts` | 1-62 | `WIDE_GAMUT_PRIMARIES`, `isWideGamutPrimary` | Good |
| `humanize-color-primaries.test.ts` | 1-39 | `humanizeColorPrimaries` | Good |
| `humanize-transfer-function-i18n.test.ts` | 1-103 | `humanizeTransferFunction` | Good |
| `color-details-primaries-match-icc.test.ts` | 1-74 | `primariesMatchIccName`, `normalizeForCompare` | Good |
| `color-details-section-delivered.test.ts` | 1-90 | ColorDetailsSection source-inspection | Good |
| `color-fixtures.test.ts` | 1-72 | Real ICC fixtures through chromaticity detector | Good |
| `force-srgb-derivatives.test.ts` | 1-64 | Setting validation + target ICC decision matrix | Good |
| `lightbox-color-pip-hdr.test.ts` | 1-150 | HDR gating + single-render source-inspection | Good (but missing Histogram props) |
| `photo-viewer-no-hdr-download.test.ts` | 1-34 | HDR download removal source-inspection | Good |
| `og-image-icc.test.ts` | 1-97 | OG image sRGB post-processing | Good |
| `process-image-p3-icc.test.ts` | 1-144 | `resolveAvifIccProfile` + AVIF round-trip | Partial (missing signals fallback) |
| `process-image-color-roundtrip.test.ts` | 1-345 | Pixel + ICC round-trip through Sharp | Good |
| `process-image-icc-options-lockin.test.ts` | 1-61 | Source-inspection of ICC encode options | Good |
| `process-image-metadata.test.ts` | 1-166 | `extractIccProfileName` mluc + `extractExifForDb` bounds | Good |
| `use-display-capability.test.ts` | 1-251 | Display capability detection paths | Good |
| `backfill-color-pipeline.test.ts` | 1-133 | Backfill reprocessor smoke tests | Good |
| `hdr-filenames.test.ts` | 1-22 | `deriveHdrAvifFilename` | Good |
| `image-queue-bootstrap.test.ts` | 1-193 | Queue bootstrapping batching/retry | Good (missing color signal flow) |
