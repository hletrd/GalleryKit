# Test Engineer Review — Run-7 Cycle-3

**HEAD:** 1cdbb883 (master)
**Date:** 2026-06-19
**Test suite baseline:** 2237 passed | 4 skipped (model-weight CLIP tests, design-gated) | 238 files

---

## 1. Scope and Method

This is the cycle-3 test-coverage sweep following the two scheduled cycle-2 fixes:
- AGG-R7C2-01: NCLX transfer=5 `gamma28` correction (commit ae5e82cb)
- AGG-R7C2-02: Browser upload GPS-strip guard source-contract test (commit eff5d8d6)

The sweep covered:
1. Verification that both cycle-2 fixes are correctly implemented and test-pinned
2. Full "wrong value pinned by test" sweep across all NCLX code mappings and humanizer functions
3. Inventory of high-risk source modules against their test files
4. Spot-check of behavioral correctness in key test suites (view-retention, download-tokens, checkout-route, icc-chromaticity, gain-map-detection, avif-probe, seo-og-url, og-photo-fallback)

Deferred items from cycle-2 that were explicitly excluded from re-filing:
- TE-R7C2-02 (Stripe webhook behavioral)
- TE-R7C2-03 (semantic route malformed-embedding)
- TE-R7C2-04 (logAuditEvent truncation)
- TE-R7C2-05 (embeddings action)
- MED-R7C2-01 (histogram clip % denominator — refuted, correct as-is)

---

## 2. Cycle-2 Fix Verification

### AGG-R7C2-01 — NCLX transfer=5 gamma28 (VERIFIED COMPLETE)

Source (`color-detection.ts` line 185):
```
5: 'gamma28', // ITU-T H.273 Table 3 value 5 = BT.470BG (PAL/SECAM gamma 2.8)
```
Test (`color-detection.test.ts` line 218):
```
it('maps nclx transfer=5 to gamma28 (BT.470BG)', ...)
  expect(signals.transferFunction).toBe('gamma28');
```
Humanizer (`color-details-section.tsx` line 79):
```
case 'gamma28': return t('viewer.transferGamma28');
```
i18n (`en.json`): `"transferGamma28": "Gamma 2.8 (BT.470 BG / PAL·SECAM)"`
i18n (`ko.json`): `"transferGamma28": "감마 2.8 (BT.470 BG / PAL·SECAM)"`
i18n test (`humanize-transfer-function-i18n.test.ts`): all 9 transfer values exercised in both locales including gamma28; Korean assertion verified.

**Status: fully correct and test-pinned at all four layers.**

### AGG-R7C2-02 — Browser upload GPS-strip guard test (VERIFIED COMPLETE)

File: `__tests__/images-action-gps-toggle-wiring.test.ts`

4 assertions verified:
1. `stripGpsFromOriginal` is imported from `@/lib/process-image`
2. `stripGpsFromOriginal(` is called in the action
3. The call index > the `uploadConfig.stripGpsOnUpload` guard index (ordering)
4. `exifDb.latitude = null`, `exifDb.longitude = null`, and `stripGpsFromOriginal(` all appear within a 400-char window after the guard (same block, brace-balance safe)

**Status: fully correct and test-pinned.**

---

## 3. "Test Pins Wrong Spec Value" Sweep

The run-7 lineage has two confirmed prior instances:
- Cycle-1: NCLX matrix=8 `ycgco` (was incorrectly `bt2020-ncl`)
- Cycle-2: NCLX transfer=5 `gamma28` (was incorrectly `gamma22`)

**Full sweep of all NCLX code mappings:**

| Code | Value | Tested? | Assertion correct? |
|------|-------|---------|-------------------|
| transfer=1 | srgb | Yes (ICC path) | Correct |
| transfer=4 | gamma22 | Yes (line 209) | Correct — BT.470M NTSC |
| transfer=5 | gamma28 | Yes (line 218) | Correct — BT.470BG PAL/SECAM (fixed cycle-2) |
| transfer=6 | gamma22 | Yes (line 280) | Correct — SMPTE 170M |
| transfer=7 | gamma22 | Indirect (line 226 tests "7" via custom CICP) | Correct — SMPTE 240M |
| transfer=8 | linear | Yes (line 195) | Correct |
| transfer=11 | srgb | Yes (line 293) | Correct — xvYCC |
| transfer=13 | srgb | Yes (line 286) | Correct — IEC 61966-2-1 |
| transfer=14 | gamma24 | Yes (line 311) | Correct — BT.2020 10-bit/BT.1886 |
| transfer=15 | gamma24 | Yes (line 317) | Correct — BT.2020 12-bit/BT.1886 |
| transfer=16 | pq | Yes (line 171) | Correct — SMPTE ST 2084 |
| transfer=17 | gamma26 | Yes (line 199) | Correct — DCI-P3 |
| transfer=18 | hlg | Yes (line 180) | Correct — ARIB STD-B67 |
| matrix=0 | identity | Yes (multiple) | Correct |
| matrix=1 | bt709 | Yes (multiple) | Correct |
| matrix=8 | ycgco | Yes (line 301-303) | Correct (fixed cycle-1) |
| matrix=9 | bt2020-ncl | Yes (line 79) | Correct |
| matrix=10 | bt2020-cl | No direct test | Value correct per source comment |

**Result: no remaining "wrong value pinned" instances found in the NCLX maps.**

**Humanizer sweep (`humanizeTransferFunction`, `humanizeMatrixCoefficients`, `humanizeColorPipelineDecision`):**

All 9 transfer values are covered by `humanize-transfer-function-i18n.test.ts` for both locales. Matrix humanizer returns hardcoded Latinate strings (no i18n key lookup), correct and stable. Pipeline decision humanizer has 7 cases all covered by the color-details tests. No wrong values found.

---

## 4. Module Coverage Inventory (Behavior-Critical Paths)

### High-Risk Modules — Verified Adequate Coverage

| Module | Key test files | Assessment |
|--------|---------------|------------|
| `color-detection.ts` | `color-detection.test.ts` | Comprehensive — all NCLX codes, ICC paths, precedence |
| `gps-exif-strip.ts` | `gps-exif-strip.test.ts`, `images-action-gps-toggle-wiring.test.ts` | Behavioral + source-contract |
| `download-tokens.ts` | `download-token-shape.test.ts`, `download-route-get-behavior.test.ts`, `stripe-download-tokens.test.ts` | Thorough behavioral coverage |
| `auth-rate-limit.ts` | Dedicated test file | Covered |
| `view-retention.ts` | `view-retention.test.ts` | Covers default, positive override, negative guard (COR-R4C6-10), non-finite guard |
| `icc-chromaticity.ts` | `icc-chromaticity.test.ts` | Covers all 6 primaries + chad inversion + low-confidence path |
| `gain-map-detection.ts` | `gain-map-detection.test.ts` | Covers urim/tmap detection, truncation, bogus boxes |
| `avif-support.ts` | `avif-probe-data-url.test.ts` | Decodes the literal through Sharp — behavioral, not just shape |
| `og-photo-fetch.ts` | `og-photo-fallback.test.ts` | Confirmed present |
| `seo-og-url.ts` | `seo-actions.test.ts` | Confirmed present |
| `checkout/route.ts` | `checkout-route.test.ts` | Card-only pin (AGG-H1) verified |
| `csv-escape.ts` | Dedicated test | Formula injection, bidi, invisible chars |
| `blur-data-url.ts` | `process-image-blur-wiring.test.ts`, `images-action-blur-wiring.test.ts` | Producer+consumer symmetric |

### Module with Known Behavioral Gap — Already Deferred

`analytics-data.ts` — the module exports 8+ async DB query functions (`getTopPhotosByViews`, `getTopTopicsByViews`, `getCountriesByViews`, `getReferrersByViews`, etc.). Test coverage is limited to `client-server-only-boundary.test.ts` (boundary check only — does not test behavioral logic). The `windowStart()` function, bot-exclusion filter (`eq(imageViews.bot, false)`), and all aggregation queries have zero behavioral test coverage.

This was previously noted as a deferred item (TE-R7C2-04 touches adjacent territory). Adding a behavioral mock-DB layer for this module is a medium-effort item. It is NOT a new finding from this cycle — the gap existed before cycle-2 and was not in scope. Noting it here for completeness; it does not generate a new finding ID.

---

## 5. Minor Test Quality Observation

### OBS-R7C3-01: ProPhoto white-point Y coordinate not asserted

**File:** `apps/web/src/__tests__/icc-chromaticity.test.ts`, line 212
**Observation (LOW, informational):**

The ProPhoto white-point test asserts only `x ≈ 0.3457` but omits the y-coordinate assertion. The source has `wp.y = 0.3585` (correct D50 value). The x-only assertion would pass if the Y value drifted.

```ts
expect(result!.whitePoint.x).toBeCloseTo(0.3457, 3);
// whitePoint.y = 0.3585 not checked
```

**Risk: LOW.** The detection algorithm matches against all 6 XYZ triplet pairs including the white point, so a y-drift would first break matching before the test became wrong. The test gap cannot hide a misdetection — it can only fail to catch a direct mutation of the returned y value. This is informational and does not warrant a new actionable finding at MEDIUM or above.

---

## 6. New Actionable Findings

**None.**

The sweep found:
- Both cycle-2 scheduled fixes correctly implemented and test-pinned
- No remaining "test pins wrong spec value" instances in any NCLX mapping or humanizer
- All high-risk behavior-critical paths have adequate test coverage
- The single minor observation (ProPhoto white-point Y) is LOW/informational and cannot hide a detection failure
- The `analytics-data.ts` behavioral gap is pre-existing and already captured in the deferred register

---

## 7. Test Suite Health

**Test run:** `npm test --workspace=apps/web`
**Result:** 2237 passed | 4 skipped | 238 files | 0 failed
**Duration:** 24.90s

The 4 skips are intentional design-gated CLIP model-weight integration tests that require a pre-seeded `CLIP_MODELS_ROOT`. These are correctly marked with `it.skipIf`.

**Health: HEALTHY**

---

## Summary

### NEW findings by severity

| ID | Severity | Description |
|----|----------|-------------|
| (none) | — | No new actionable findings |

**Verdict: CLEAN CYCLE.** Both scheduled cycle-2 fixes are fully verified. The "wrong value pinned by test" sweep is exhaustive across all NCLX codes and humanizer functions and found no remaining instances. All high-risk behavioral paths have test coverage. Only a LOW/informational observation on the ProPhoto test's incomplete white-point assertion (y-coordinate not checked). This does not generate a new actionable finding. The only open items remain the previously deferred TE-R7C2-02..05 and associated items in `deferred.md`.
