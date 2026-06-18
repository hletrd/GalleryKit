# Verifier Report — Run-7 Cycle-2

**Date:** 2026-06-18
**HEAD:** `1cdbb883f0d713f8988cfbc3183c309a8896419f` (1cdbb883)
**Repo:** /Users/hletrd/flash-shared/gallery
**Working tree:** clean (no uncommitted changes)
**Role:** Verifier (separate reviewer pass — no code authored in this context)

---

## Verdict

**Status:** PASS
**Confidence:** high
**Blockers:** 0

All six gate commands exit 0 with fresh output. The two Run-7 cycle-1 fixes (AGG-R7C1-01 NCLX YCgCo, AGG-R7C1-02 Firefox MQ doc) are intact at HEAD and correctly pinned by tests. Five spot-checked CLAUDE.md behavioral claims match the code. Regression spot-checks on color-pipeline and invariant tests pass.

---

## Evidence — Fresh Gate Suite (run at 05:27–05:29 local)

| # | Check | Result | Command | Output |
|---|-------|--------|---------|--------|
| 1 | ESLint | pass (exit 0) | `npm run lint --workspace=apps/web` | clean, no warnings |
| 2 | API-auth lint | pass (exit 0) | `npm run lint:api-auth --workspace=apps/web` | 2 admin route files OK |
| 3 | Action-origin lint | pass (exit 0) | `npm run lint:action-origin --workspace=apps/web` | all mutating actions enforce same-origin; 1 read-only exempt |
| 4 | Public-route rate-limit lint | pass (exit 0) | `npm run lint:public-route-rate-limit --workspace=apps/web` | 9 routes OK (7 helpers + 2 exempt) |
| 5 | Typecheck (app + scripts) | pass (exit 0) | `npm run typecheck --workspace=apps/web` | `typecheck:app` + `check:js-scripts` + `typecheck:scripts` all clean |
| 6 | Vitest suite | pass (exit 0) | `npm test --workspace=apps/web` | **2231 passed, 4 skipped, 0 failed** (237 files passed, 2 skipped); duration 27.91 s |

The 4 skips are the documented design-gated skips (unchanged from cycle-1 verifier). No new failures, no new skips.

No divergence from any background run is observable — every gate is green and self-consistent.

---

## Run-7 Cycle-1 Fixes — Intactness at HEAD

### AGG-R7C1-01 — NCLX matrix code 8 = YCgCo (commit 60a5690c)

**Verdict: VERIFIED — intact and correctly pinned**

| Sub-check | Evidence | Status |
|---|---|---|
| Map `8 → 'ycgco'` | `lib/color-detection.ts:207` — `8: 'ycgco', // ITU-T H.273 Table 4 value 8 = YCgCo (NOT BT.2020-NCL; that is value 9)` | VERIFIED |
| Map `9 → 'bt2020-ncl'` (distinct, not aliased) | `lib/color-detection.ts:208` — `9: 'bt2020-ncl',` | VERIFIED |
| Union type includes `'ycgco'` | `lib/color-detection.ts:27` — `matrixCoefficients: 'bt709' \| 'bt2020-ncl' \| 'bt2020-cl' \| 'identity' \| 'ycgco' \| 'unknown'` | VERIFIED |
| Humanizer case `'ycgco'` | `components/color-details-section.tsx:106` — `case 'ycgco': return 'YCgCo';` | VERIFIED |
| Test asserts matrix=8 → 'ycgco' | `__tests__/color-detection.test.ts:296-298` — `it('maps nclx matrix=8 to ycgco', …)` with `expect(signals.matrixCoefficients).toBe('ycgco')` | VERIFIED |
| Test pins UI case label | `__tests__/color-details-section-delivered.test.ts:104` — `expect(SOURCE).toContain("case 'ycgco': return 'YCgCo'")` | VERIFIED |
| Pinning tests pass fresh | `vitest run color-detection.test.ts color-details-section-delivered.test.ts` → **62 passed, 0 failed** | VERIFIED |

The regression guard is concrete: if any of the map entry, union member, or humanizer case were reverted, one of these two tests would fail. The matrix=8 assertion specifically would catch the original bug returning.

### AGG-R7C1-02 — Firefox MQ always-false doc/comment (commit 10108963)

**Verdict: VERIFIED — intact (doc/comment-only fix, no behavioral change)**

| Sub-check | Evidence | Status |
|---|---|---|
| Code comment states always-false | `lib/use-display-capability.ts:64-69` — "Firefox parses the (color-gamut: p3) MQ syntax since v110, but it ALWAYS returns false because Firefox does not implement wide-gamut rendering (Mozilla bug 162664, still open)" | VERIFIED |
| Behavior unchanged | The runtime fallback to `'srgb'` was already correct pre-fix; comment-only change. Code at line 61 `matchMedia('(color-gamut: p3)').matches` will evaluate false on Firefox, falling through to the `'srgb'` default. | VERIFIED |
| CLAUDE.md browser matrix row | `CLAUDE.md:327` — Firefox 124+ cell reads `✓ (parsed, always false — bug 162664)` | VERIFIED |
| CLAUDE.md Firefox impact section | `CLAUDE.md:332-340` — consistent "always returns false" / "all Firefox versions" wording across R10-H4 section, display-change limitations, and WideGamutHint description (line 270) | VERIFIED |
| Internal consistency | No remaining "behaves like Chrome" / "MQ path on Firefox 110+" overstatement found in either the code comment or the doc | VERIFIED |

This is a documentation-honesty fix; there is no behavioral surface to regression-test, and the change correctly does not introduce one.

---

## Documented Behavioral Claims — Spot-check vs Code

Five CLAUDE.md claims independently verified against source.

| # | Claim | Code Evidence | Status |
|---|---|---|---|
| 1 | Checkout pinned to card-only (AGG-H1) | `app/api/checkout/[imageId]/route.ts:207` — `payment_method_types: ['card']`, with AGG-H1 comment at :196. Locked by `__tests__/checkout-route.test.ts` (passes, part of 26/26 run) | VERIFIED |
| 2 | Settings hash covers 9 COLOR_IMPACTING_KEYS (5 color + 3 quality + 1 size) | `lib/settings-hash.ts:41-53` — array contains exactly: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes` = 9 | VERIFIED |
| 3 | ETag format `W/"v{PIPELINE_VERSION}-{mtimeMs}-{size}-{settingsHash}"` (no `.slice(0,8)` at site) | `lib/serve-upload.ts:215` — ``W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`` exactly; `HASH_LENGTH = 8` enforced at producer in settings-hash.ts | VERIFIED |
| 4 | Six advisory lock names exist as documented | `lib/advisory-locks.ts` defines all six: `gallerykit_db_restore` (:19), `gallerykit_upload_processing_contract` (:22), `gallerykit_topic_route_segments` (:25), `gallerykit_admin_delete` (:34), `gallerykit:image-processing:${jobId}` (:41), `gallerykit_color_pipeline_backfill` (:44) | VERIFIED |
| 5 | Card-only checkout test passes | `__tests__/checkout-route.test.ts` + `__tests__/settings-hash.test.ts` → 26 passed, 0 failed | VERIFIED |

No documentation drift detected on any of the spot-checked claims.

---

## Test Adequacy / Regression Risk

| Surface | Pinning test? | Would fail on regression? | Risk |
|---|---|---|---|
| NCLX matrix=8 mapping (AGG-R7C1-01) | `color-detection.test.ts:296` + `color-details-section-delivered.test.ts:104` | Yes — direct `toBe('ycgco')` + source-content assertion | low |
| YCgCo UI label rendering | `color-details-section-delivered.test.ts:104` | Yes — `expect(SOURCE).toContain(...)` pins the case label | low |
| Settings-hash 9-key coverage | `settings-hash.test.ts` (part of passing 26) | Yes — fixture-driven key enumeration | low |
| Card-only checkout | `checkout-route.test.ts` | Yes — asserts `payment_method_types: ['card']` in payload | low |
| SW ETag HEAD revalidation / template contract | `sw-template-contract.test.ts` (44/44 pass with neighbors) | Yes — template + generated `sw.js` pinned | low |
| Touch-target 44px floor | `touch-target-audit.test.ts` (44/44 group) | Yes — blocking scan of all interactive JSX | low |
| OG sanitizer symmetry (3 consumers) | `sanitize-for-og-global.test.ts` (44/44 group) | Yes — asserts all three consumers import shared helper | low |

**Regression risk assessment:** low. Every prior-cycle fix spot-checked has a concrete, failing-on-regression test. The 4 design-gated skips are unchanged and documented (not silently dropped).

---

## Gaps

None blocking.

- **Cosmetic / non-blocking:** the shell prints a `zoxide` configuration warning on every Bash invocation ("zoxide: detected a possible configuration issue"). This is a host shell-init artifact, not a repo or test issue — it does not affect any gate's exit code or output parsing. Suggestion: optionally `export _ZO_DOCTOR=0` in the user shell profile to silence it. **Risk: none.**
- **No fresh behavioral claim from cycle-2 to verify yet:** this cycle-2 verifier pass ran at the start of cycle-2 (immediately after the SW_VERSION stamp build commit `1cdbb883`). The only cycle-2 change at HEAD is the regenerated `public/sw.js` stamp. That file is covered by `sw-template-contract.test.ts` (which asserts the template and generated file agree) — already passing. No cycle-2 code change exists to re-verify beyond confirming the cycle-1 fixes survived.

---

## Recommendation

**APPROVE.**

Cycle-1's two fixes are intact and test-pinned at HEAD 1cdbb883; the full gate suite (lint ×4, typecheck, vitest 2231/2231 pass) is fresh and green; five spot-checked CLAUDE.md behavioral claims match the code exactly. No blockers, no gaps requiring changes.

---

## Files Referenced (absolute paths)

- /Users/hletrd/flash-shared/gallery/apps/web/src/lib/color-detection.ts (lines 27, 207-208 — AGG-R7C1-01)
- /Users/hletrd/flash-shared/gallery/apps/web/src/components/color-details-section.tsx (line 106 — YCgCo humanizer)
- /Users/hletrd/flash-shared/gallery/apps/web/src/lib/use-display-capability.ts (lines 64-69 — AGG-R7C1-02 comment)
- /Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/color-detection.test.ts (lines 294-298 — matrix=8 pin)
- /Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/color-details-section-delivered.test.ts (line 104 — UI label pin)
- /Users/hletrd/flash-shared/gallery/apps/web/src/lib/settings-hash.ts (lines 41-53 — 9 keys)
- /Users/hletrd/flash-shared/gallery/apps/web/src/lib/serve-upload.ts (line 215 — ETag format)
- /Users/hletrd/flash-shared/gallery/apps/web/src/app/api/checkout/[imageId]/route.ts (line 207 — card-only pin)
- /Users/hletrd/flash-shared/gallery/apps/web/src/lib/advisory-locks.ts (six lock names)
- /Users/hletrd/flash-shared/gallery/CLAUDE.md (Firefox matrix + impact section)
