# Test Engineer Review — Color/HDR Pipeline Coverage (Photographer Perspective)

**Reviewer:** Test Engineer (oh-my-claudecode:test-engineer)
**Date:** 2026-05-12
**Scope:** GalleryKit color/HDR pipeline — `apps/web/src/__tests__/` and `apps/web/e2e/`
**Premise:** Photos arrive AFTER editing. The pipeline must accurately reproduce photographer intent (gamut, tonality, dynamic range).

---

## Summary

| Category | Status |
|----------|--------|
| Pure-function detection tests | **Strong** — NCLX parsing, ICC name matching, chromaticity fallback, gain map detection, display capability, pipeline decisions, privacy field guards are well covered. |
| Integration / round-trip tests | **Moderate** — AVIF/WebP/JPEG ICC round-trip, color pixel conversion, backfill, force_srgb_derivatives WebP/JPEG path tested. |
| End-to-end UI tests | **Weak** — Zero e2e coverage of Color Details accordion, wide-gamut hint, histogram, HDR badge, or lightbox color pip. |
| Upload pipeline safety gates | **Missing** — HDR rejection at upload (`allow_hdr_ingest=false`) has no test. |
| Encoder output assertions | **Gaps** — Chroma subsampling (4:4:4 vs 4:2:0), 10-bit AVIF metadata, DCI-P3 Bradford adaptation, and ETag revalidation are not verified against actual files. |

**Overall verdict:** The pipeline has good unit-test coverage for detection logic, but the integration boundary between detection and encoder output is under-tested. Critical photographer-facing promises — DCI-P3 white-point adaptation, 10-bit AVIF delivery, wide-gamut JPEG chroma fidelity, and HDR upload rejection — lack regression guards. The e2e suite covers navigation and upload but ignores the color metadata audit surface entirely.

---

## Test Inventory (What Exists)

| File | Tests | Coverage |
|------|-------|----------|
| `color-detection.test.ts` | 18+ | `detectColorSignals`, `parseCicpFromHeif`, ICC name allowlist, NCLX precedence over ICC, chromaticity fallback, `extractIccProfileName` |
| `process-image-p3-icc.test.ts` | 15+ | `resolveAvifIccProfile` decision matrix, AVIF ICC round-trip via Sharp |
| `color-pipeline-decision.test.ts` | 10+ | `resolveColorPipelineDecision` string normalization, chromaticity fallback |
| `is-p3-pipeline.test.ts` | 12 | `isP3Pipeline` enum coverage, call-site locks in 3 consumer files |
| `backfill-color-pipeline.test.ts` | 3 | `reprocessRow` skip-on-missing, success path, P3 source -> P3 AVIF via backfill |
| `color-details-section-delivered.test.ts` | 8 | Source-bit-depth row, delivered-bit-depth row, delivered formats row — source-text locks |
| `color-details-primaries-match-icc.test.ts` | 8 | `normalizeForCompare`, `primariesMatchIccName` dedup logic |
| `settings-hash.test.ts` | 11 | `_buildHashForTesting` stability, ordering invariance, per-setting diff |
| `force-srgb-derivatives.test.ts` | 7 | Setting validation, `getTargetIcc` decision matrix (pure function) |
| `process-image-color-roundtrip.test.ts` | 5 | Untagged sRGB -> sRGB AVIF; Display-P3 -> P3 AVIF/WebP/JPEG; Adobe/ProPhoto/Rec.2020 -> P3; pixel sanity; forceSrgbDerivatives on WebP/JPEG |
| `icc-chromaticity.test.ts` | 8 | `detectGamutFromIccChromaticity` — sRGB, P3-D65, AdobeRGB, ProPhoto, BT.2020, Eizo-flavored, off-gamut, truncated buffer |
| `color-fixtures.test.ts` | 5 | On-disk ICC fixtures -> chromaticity detection (high-confidence) |
| `gain-map-detection.test.ts` | 12 | `hasGainMap` — empty, JPEG, plain HEIF, pre-iOS-17 urim, iOS-17+ tmap+auxl, false positives |
| `use-display-capability.test.ts` | 8 | `screen.colorGamut`, MQ fallback, canvas-P3 probe, SSR, HDR MQ |
| `lightbox-color-pip-hdr.test.ts` | 5 | HDR gate on `transfer_function`, single-render lock, `hasData` short-circuit |
| `humanize-transfer-function-i18n.test.ts` | 8 | Transfer function i18n for EN/KO, null/unknown handling |
| `process-image-icc-options-lockin.test.ts` | 5 | Source-text locks for `withIccProfile`, no `withMetadata({icc:...})`, `toColorspace`, `autoOrient`, `failOn` |
| `og-image-icc.test.ts` | 6 | OG JPEG always sRGB-tagged regardless of source gamut |
| `wide-gamut-primaries.test.ts` | 5 | `WIDE_GAMUT_PRIMARIES` canonical set, `isWideGamutPrimary` helper |
| `privacy-fields.test.ts` | 4 | Sensitive keys exist in schema, admin fields contain them, public fields omit them, symmetric guard |
| `touch-target-audit.test.ts` | 6 | 44px floor across components + admin, multi-line normalizer, FORBIDDEN regex fixture |
| `histogram.test.ts` | 1 | Worker request-reply matching |
| `photo-viewer-no-hdr-download.test.ts` | 2 | No `_hdr.avif` references in download dropdown (P3-1 deferred) |
| `serve-upload.test.ts` | 4 | File serving, ETag pipeline-version prefix, extension/directory mismatch, symlink traversal |
| **e2e/** | 14 tests across 5 files | Public nav, search, lightbox open/close, admin login/nav/upload, origin guard, mobile/desktop responsive |

---

## Coverage Gap Analysis (The 12 Questions)

### 1. NCLX Primary Codes (1, 9, 11, 12)

| Code | Name | Tested? | Notes |
|------|------|---------|-------|
| 1 | BT.709 | **Partial** | `parseCicpFromHeif` tests use `makeColrNclx(1,1,1)` in depth-bound test, but no top-level `detectFromNclx(1, ...)` asserts `bt709`. ICC-name path covers sRGB but not NCLX primaries=1. |
| 9 | BT.2020 | **Yes** | `detectFromNclx(9, 16, 9)` and `(9, 18, 9)` both assert `bt2020`. |
| 11 | DCI-P3 | **Yes** | `detectFromNclx(11, 1, 1)` asserts `dci-p3`. |
| 12 | P3-D65 | **No** | `parseCicpFromHeif` uses `makeColrNclx(12, 1, 0)` in flat-box test, but `detectColorSignals` top-level integration never tests primaries=12. |

**Severity:** MEDIUM. A photographer exporting P3-D65 NCLX-tagged HEIF/AVIF from an iPhone or camera has no test guaranteeing the pipeline detects their intent. The `parseCicpFromHeif` unit test proves the walker finds the box, but `detectColorSignals` could regress the mapping at the integration layer.

**Suggested test:** Add `it('maps nclx primaries=12 to p3-d65', async () => { ... })` to `color-detection.test.ts` using `detectFromNclx(12, 13, 0)`. Also add `detectFromNclx(1, 1, 1)` asserting `bt709` to close the BT.709 gap.

---

### 2. Transfer Functions (srgb, gamma22, gamma18, gamma26, pq, hlg, linear)

| Value | NCLX Codes | Tested? | Notes |
|-------|------------|---------|-------|
| `srgb` | 1 | **Partial** | ICC-name path tested. NCLX transfer=1 not asserted in top-level `detectColorSignals`. NCLX transfer=13 (sRGB IEC61966-2-1) untested entirely. |
| `gamma22` | 2, 6, 14, 15 | **No** | Adobe RGB ICC name path infers gamma22, but no NCLX test for codes 2/6/14/15. |
| `gamma18` | — | **No** | ProPhoto ICC name path infers gamma18, but no NCLX or direct test. |
| `gamma26` | 17 | **Yes** | `detectFromNclx(11, 17, 1)` asserts `gamma26`. |
| `pq` | 16 | **Yes** | `detectFromNclx(9, 16, 9)` and ICC string 'PQ HDR'. |
| `hlg` | 18 | **Yes** | `detectFromNclx(9, 18, 9)` and ICC string 'HLG'. |
| `linear` | 8 | **Yes** | `detectFromNclx(1, 8, 1)` asserts `linear`. |

**Severity:** MEDIUM. NCLX transfer codes 2, 6, 14, 15 (all gamma22) and 13 (sRGB IEC61966-2-1) are unmapped in tests. A refactor of `NCLX_TRANSFER_MAP` could silently break Adobe RGB or BT.2020 SDR detection from NCLX containers.

**Suggested tests:** Add `detectFromNclx` cases for:
- `(1, 2, 1)` -> `gamma22`
- `(1, 13, 1)` -> `srgb` (was previously mis-mapped to `pq` in a bug)
- `(1, 14, 1)` -> `gamma22`
- Also test the ICC-name path for `gamma18` explicitly (ProPhoto name -> `gamma18` is covered but only as a side effect of primaries testing; add a standalone assertion).

---

### 3. ICC Chromaticity-Based Detection (Custom Monitor Profiles)

**Status:** COVERED.

`icc-chromaticity.test.ts` (8 tests) and `color-fixtures.test.ts` (5 tests) cover:
- sRGB, P3-D65, AdobeRGB, ProPhoto, BT.2020 at high confidence
- Eizo CG2700X-flavored drift (medium confidence)
- Off-gamut profiles returning `unknown`
- Truncated buffers not throwing

`color-detection.test.ts` has one integration test (line 201-241) for the chromaticity fallback rescuing an opaquely-named ICC to `adobergb`.

**Gap:** No integration test verifies that an opaquely-named ICC with **Display P3**, **BT.2020**, **ProPhoto**, or **sRGB** chromaticities is promoted correctly through the full `detectColorSignals` pipeline. Only AdobeRGB is covered at the integration layer.

**Severity:** MEDIUM.

**Suggested test:** Add `detectColorSignals` integration tests for synthetic ICC buffers with Display P3 / BT.2020 / ProPhoto / sRGB chromaticities but opaque names, asserting the correct `colorPrimaries` resolution.

---

### 4. Apple HDR Gain Map Detection

**Status:** COVERED.

`gain-map-detection.test.ts` (12 tests) covers:
- Empty/tiny buffers, plain JPEG, plain HEIF (no gain map)
- Pre-iOS-17 `urim` + Apple URI inline
- iOS-17+ `tmap` + `auxl` iref
- Standalone `tmap` without `auxl` correctly rejected (R5-M3)
- `auxl` pointing at non-urim/tmap item rejected
- Unrelated `urim` URI rejected
- Truncated/malformed containers (no throw)
- Multiple gain map items

---

### 5. DCI-P3 White-Point Adaptation (WI-12)

**Status:** NOT TESTED.

The encoder in `process-image.ts:801-807` skips `pipelineColorspace('rgb16')` for DCI-P3 sources to preserve the source ICC (with DCI white point) for a `toColorspace('p3')` Bradford adaptation to D65. This is a photographer-intent-critical path.

`process-image-color-roundtrip.test.ts` covers Display-P3, Adobe RGB, ProPhoto, and Rec.2020 sources, but **not DCI-P3**.
`color-detection.test.ts` maps NCLX primaries=11 to `dci-p3`, but doesn't test the encoder.
`process-image-p3-icc.test.ts` tests `resolveAvifIccProfile('DCI-P3')` -> `'p3'`, but that's a pure-function decision, not the actual encoding.

**Severity:** HIGH. DCI-P3 sources have a different white point (DCI ~0.314, 0.351) than Display P3 (D65, 0.3127, 0.3290). Without this test, a regression in the Bradford adaptation or the `skip rgb16` branch would silently deliver DCI-white images tagged as D65-P3, shifting neutrals warm.

**Suggested test:** In `process-image-color-roundtrip.test.ts`, add a DCI-P3 source fixture and assert:
1. Output AVIF carries P3 ICC (not DCI-P3 ICC — the adaptation should have happened).
2. Output white point is D65 (can be verified by sampling a neutral gray patch before/after).
3. The `needsRgb16` flag was false (source-inspection or metadata assertion).

---

### 6. 10-Bit AVIF Output Actually Carrying P3 ICC

**Status:** NOT TESTED.

The pipeline gates 10-bit AVIF on `canUseHighBitdepthAvif()` (a Promise-singleton probe that tries a 2x2 `bitdepth: 10` encode). When the probe passes, wide-gamut sources get `bitdepth: 10` in the AVIF encoder options.

`process-image-color-roundtrip.test.ts` verifies P3-tagged AVIF output, but does NOT verify:
- That the output is actually 10-bit (not 8-bit).
- That the 10-bit AVIF still carries P3 ICC.
- The fallback path when the probe says 10-bit is unavailable.

`backfill-color-pipeline.test.ts` verifies AVIF has ICC, but doesn't check bit depth.

**Severity:** MEDIUM-HIGH. 10-bit AVIF is the flagship wide-gamut delivery format. If the probe silently fails or the `bitdepth: 10` option is dropped in a refactor, photographers lose the extra precision with no signal.

**Suggested test:** Add to `process-image-color-roundtrip.test.ts`:
1. Mock `canUseHighBitdepthAvif` to return `true`.
2. Process a Display-P3 source.
3. Read AVIF metadata via Sharp and assert `meta.depth` is `'10'` or `'12'` (or at least not `'uchar'` / `'8'`).
4. Assert AVIF ICC is P3-tagged.
5. Also test the fallback: mock probe returning `false`, assert AVIF is still produced and is P3-tagged but at lower bit depth.

---

### 7. Wide-Gamut JPEG 4:4:4 Chroma Output

**Status:** NOT TESTED.

The pipeline sets `chromaSubsampling` on JPEG output based on `wideGamutJpegChroma` (default `'4:4:4'`) for wide-gamut sources and `sdrJpegChroma` (default `'4:2:0'`) for sRGB sources.

Existing tests:
- `force-srgb-derivatives.test.ts`: pure-function decision matrix only.
- `settings-hash.test.ts`: hash changes when `wide_gamut_jpeg_chroma` flips.
- `process-image-color-roundtrip.test.ts`: verifies P3-tagged JPEG for P3 sources, but NOT the chroma subsampling.

**Severity:** MEDIUM. Photographers delivering P3 JPEG to Safari/Chrome P3-capable viewers expect full chroma fidelity. A regression to 4:2:0 would introduce color bleeding on saturated edges.

**Suggested test:** In `process-image-color-roundtrip.test.ts`, after processing a wide-gamut source, read the JPEG metadata via Sharp (`sharp(...).metadata()`) and assert `meta.chromaSubsampling` equals `'4:4:4'`. For an sRGB source, assert `'4:2:0'`. Also test the admin-tunable override path: process with `wideGamutJpegChroma: '4:2:2'` and assert `'4:2:2'`.

---

### 8. E2E Tests for Color Metadata Display in the UI

**Status:** NOT TESTED.

The 5 Playwright e2e files (`admin.spec.ts`, `public.spec.ts`, `test-fixes.spec.ts`, `origin-guard.spec.ts`, `nav-visual-check.spec.ts`) contain 14 tests covering:
- Homepage, search, locale switching, lightbox open/close
- Admin login, navigation, upload, GPS toggle
- Mobile nav, desktop nav, photo info sheet
- Origin guard, nav screenshots

**Zero coverage** of:
- Color Details accordion opening (desktop sidebar or mobile bottom sheet)
- Wide-gamut hint appearing for P3 photos viewed on sRGB displays
- Histogram rendering in lightbox color pip
- HDR badge visibility in accordion and lightbox pip
- Delivered bit depth / formats chips
- `force_show_color_chips` admin override

**Severity:** MEDIUM. The UI is the photographer's audit surface. A React refactor that breaks the accordion gate (`isNonTrivialColor`) or removes the `WideGamutHint` component would silently hide color metadata from photographers.

**Suggested tests (e2e):**
1. **Color Details accordion:** Navigate to a P3-tagged photo, click the accordion, assert ICC name, primaries, transfer function, and delivered bit depth are visible.
2. **Wide-gamut hint:** On an sRGB-display-emulated viewport, navigate to a P3 photo, assert the wide-gamut hint banner is visible.
3. **Histogram:** Open lightbox on a P3 photo, open the color pip, assert the histogram canvas is rendered.
4. **HDR badge:** Upload a simulated HDR source (or use a pre-seeded HDR photo), assert the HDR badge appears in the accordion and lightbox pip.
5. **Mobile info sheet:** On mobile viewport, open photo info sheet, assert color metadata rows are present.

---

### 9. `force_srgb_derivatives` Behavior

**Status:** PARTIALLY TESTED.

`force-srgb-derivatives.test.ts` tests the pure `getTargetIcc` decision matrix.
`process-image-color-roundtrip.test.ts` has ONE integration test: "P3 source with forceSrgbDerivatives=true: WebP/JPEG carry sRGB".

**Gaps:**
- AVIF behavior is **not tested** when `force_srgb_derivatives=true`. The spec says AVIF remains gamut-preserved; a bug that also forces sRGB on AVIF would defeat the purpose.
- Wider-than-P3 sources (Adobe RGB, ProPhoto, Rec.2020) with `force_srgb_derivatives=true` are not tested.
- The setting is tested at the validation layer (`isValidSettingValue`), but the end-to-end upload -> process -> serve flow with the setting flipped is untested.

**Severity:** MEDIUM.

**Suggested tests:**
1. In `process-image-color-roundtrip.test.ts`: P3 source + `forceSrgbDerivatives=true` -> assert AVIF is **still** P3-tagged (WebP/JPEG are sRGB).
2. Adobe RGB source + `forceSrgbDerivatives=true` -> assert WebP/JPEG are sRGB-tagged, AVIF is P3-tagged.
3. E2E: Toggle `force_srgb_derivatives` in admin settings, re-upload a P3 photo, assert served WebP/JPEG have sRGB ICC while AVIF has P3 ICC.

---

### 10. HDR Rejection at Upload

**Status:** NOT TESTED.

`color-detection.test.ts` covers `isHdr` detection from PQ/HLG signals (ICC strings and NCLX), but the **upload server action** rejecting HDR sources when `allow_hdr_ingest=false` has no test.

`apps/web/src/app/actions/images.ts:289-299` contains the rejection logic:
```typescript
if (data.colorSignals?.isHdr && !uploadConfig.allowHdrIngest) {
    // reject with localized error
}
```

`images-actions.test.ts` (the unit test for upload actions) covers tag validation, topic validation, blur data URL wiring, but NOT HDR rejection.

**Severity:** HIGH. This is a safety gate preventing PQ/HLG sources from entering the SDR-only delivery pipeline. Without a test, a refactor that accidentally removes the `!uploadConfig.allowHdrIngest` guard would silently accept HDR uploads, misleading photographers into thinking their HDR intent is preserved.

**Suggested test:** In `images-actions.test.ts`, add a test that:
1. Creates a synthetic PQ-tagged image (or mocks `colorSignals.isHdr = true`).
2. Calls `uploadImages` with `allowHdrIngest: false`.
3. Asserts the upload is rejected with the HDR-specific error message.
4. Repeats with `allowHdrIngest: true` and asserts the upload is accepted (with warning).

---

### 11. Display Capability Detection

**Status:** COVERED.

`use-display-capability.test.ts` (8 tests) covers:
- `screen.colorGamut === 'p3'` (Chromium 121+)
- `screen.colorGamut === 'rec2020'`
- `screen.colorGamut === 'srgb'`
- matchMedia `(color-gamut: p3)` fallback when `screen.colorGamut` unavailable
- matchMedia `(color-gamut: rec2020)`
- Canvas-P3 probe fallback (Firefox path)
- Pure sRGB displays (no P3 signal)
- HDR via `(dynamic-range: high)` MQ
- SSR safe fallback (`window` undefined)

This is the strongest coverage area in the color pipeline.

---

### 12. Settings Hash Changing When Color Settings Flip

**Status:** PARTIALLY TESTED.

`settings-hash.test.ts` (11 tests) covers the pure `_buildHashForTesting` function:
- Returns 8 lowercase hex characters
- Stable for identical inputs
- Ordering-invariant
- Differs when each of 8 color-impacting settings flips
- Ignores keys outside the canonical set

`serve-upload.test.ts` verifies the ETag starts with `W/"v{IMAGE_PIPELINE_VERSION}-` but does NOT assert:
- The settings hash component is present in the ETag.
- The ETag changes when a color setting is toggled.

**Severity:** MEDIUM. Without end-to-end ETag verification, a settings change could ship to new uploads but cached browsers would keep stale variants. The `getColorSettingsHash()` is wired into `serve-upload.ts`, but the test only checks the prefix.

**Suggested test:** In `serve-upload.test.ts`:
1. Set a specific settings hash via mock or environment.
2. Serve a file and assert the ETag contains the expected hash suffix.
3. Change a color-impacting setting, re-serve, assert ETag changed.

---

## Additional Gaps Not in the 12 Questions

### A. `canUseHighBitdepthAvif` probe has no unit test

The Promise-singleton probe (`_probeHighBitdepthAvif` / `canUseHighBitdepthAvif`) gates all 10-bit wide-gamut AVIF output. There is no test that:
- The probe returns `true` when Sharp supports 10-bit AVIF.
- The probe returns `false` when it doesn't (without throwing).
- Concurrent callers during the first probe await the same promise (C12-LOW-04).

**Severity:** MEDIUM. A broken probe silently falls all wide-gamut AVIF back to 8-bit.

**Suggested test:** Mock Sharp's `.avif({ bitdepth: 10 })` to succeed/fail and assert the singleton behavior.

### B. No `humanizeColorPrimaries` i18n contract test

`humanize-transfer-function-i18n.test.ts` exists, but there is no equivalent for `humanizeColorPrimaries`. The function is used in `color-details-section.tsx` and `lightbox-color-pip.tsx`.

**Severity:** LOW. A missing translation would show a raw key like `viewer.colorPrimariesBt2020` instead of "Rec. 2020".

**Suggested test:** Mirror `humanize-transfer-function-i18n.test.ts` for `humanizeColorPrimaries`, covering all known primaries in EN and KO.

### C. No ETag end-to-end revalidation test

There is no test that simulates a browser sending `If-None-Match` with a stale ETag (from before a settings change or pipeline version bump) and asserts the server returns `200` with a fresh body rather than `304`.

**Severity:** MEDIUM.

**Suggested test:** In `serve-upload.test.ts`, simulate the conditional GET scenario.

---

## Risk-Weighted Priority Matrix

| Gap | Photographer Impact | Regression Risk | Test Effort | Priority |
|-----|---------------------|-----------------|-------------|----------|
| HDR rejection at upload (10) | High — safety gate | High — one-line deletion | Medium | **P0** |
| DCI-P3 Bradford adaptation (5) | High — color accuracy | Medium — logic branch | High | **P0** |
| 10-bit AVIF + P3 ICC (6) | High — flagship format | Medium — probe logic | High | **P1** |
| E2e color metadata UI (8) | Medium — audit surface | Medium — React refactor | High | **P1** |
| Wide-gamut JPEG chroma (7) | Medium — fidelity | Low — encoder option | Medium | **P1** |
| NCLX primary code 12 + transfer gaps (1, 2) | Medium — detection | Low — map lookup | Low | **P2** |
| force_srgb_derivatives AVIF path (9) | Medium — admin setting | Low — param pass | Medium | **P2** |
| Settings hash in ETag end-to-end (12) | Medium — cache invalidation | Low — string concat | Low | **P2** |
| ICC chromaticity integration for P3/BT2020/ProPhoto (3 addendum) | Medium — fallback | Low — same pattern | Medium | **P2** |
| canUseHighBitdepthAvif probe (A) | Medium — 10-bit gate | Low — singleton | Low | **P2** |
| humanizeColorPrimaries i18n (B) | Low — UX polish | Low — translation | Low | **P3** |
| ETag conditional GET (C) | Medium — cache correctness | Low — HTTP semantics | Medium | **P3** |

---

## Recommended Next Steps

1. **Write the failing test first** for HDR upload rejection (P0). The implementation exists; the test is missing. This is pure TDD-in-reverse — add the regression guard.
2. **Add DCI-P3 integration test** to `process-image-color-roundtrip.test.ts` (P0). This requires understanding the Bradford adaptation path in Sharp/libvips.
3. **Add 10-bit AVIF metadata assertion** to `process-image-color-roundtrip.test.ts` with a mocked probe (P1).
4. **Add JPEG chroma subsampling assertions** using Sharp metadata read-back (P1).
5. **Extend e2e coverage** for Color Details accordion and wide-gamut hint (P1). Use seeded P3-tagged photos in the e2e fixture set.
6. **Backfill NCLX test cases** for primaries=12, transfer=1/2/13/14/15, and gamma18 (P2).
7. **Add ETag hash component assertion** in `serve-upload.test.ts` (P2).
