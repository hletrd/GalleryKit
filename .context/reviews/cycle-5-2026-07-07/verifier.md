# Cycle 5 — Verifier Lane Report

**Date:** 2026-07-07
**Repository:** /Users/hletrd/flash-shared/gallery (GalleryKit, Next.js 16)
**Branch:** master
**HEAD verified:** `d9bcbf4cc37ac33f213471803e51301f052776f4` (`docs(review): 📝 sync top-level review mirrors to cycle-4 lanes`)
**Working tree:** only 5 modified `.context/reviews/*.md` top-level mirror docs (non-source); no source drift.
**Node:** v24.14.0 · **Vitest:** v4.1.9

## Verdict

**ALL GATES GREEN at HEAD.** Zero RED. Every fast gate passes with exit 0, the (slow) production build passes with exit 0, and all three spot-checked cycle-4 invariant claims reproduce exactly. No failing or flaking tests observed.

---

## 1. Gate results (real output captured)

| Gate | Command | Result | Evidence |
|------|---------|--------|----------|
| ESLint | `npm run lint --workspace=apps/web` | **PASS** exit 0 | Clean, no output beyond banner. `LINT_EXIT=0` |
| Typecheck | `npm run typecheck --workspace=apps/web` | **PASS** exit 0 | `typecheck:app` (next typegen ✓ + tsc) + `typecheck:scripts` ("Checked 8 JavaScript script files"). `TYPECHECK_EXIT=0` |
| Vitest | `npm test --workspace=apps/web` | **PASS** exit 0 | **Test Files 333 passed \| 2 skipped (335); Tests 3113 passed \| 4 skipped (3117)**; Duration ~11.9s. `VITEST_EXIT=0` |
| lint:api-auth | `npm run lint:api-auth --workspace=apps/web` | **PASS** exit 0 | 2 admin routes OK (db/download, lr/upload). `API_AUTH_EXIT=0` |
| lint:action-origin | `npm run lint:action-origin --workspace=apps/web` | **PASS** exit 0 | "All mutating server actions enforce same-origin provenance." `ACTION_ORIGIN_EXIT=0` |
| lint:public-route-rate-limit | `npm run lint:public-route-rate-limit --workspace=apps/web` | **PASS** exit 0 | 10 public routes OK (rate-limit helper or reasoned exemption each). `PUBLIC_RL_EXIT=0` |
| Build (slow) | `npm run build --workspace=apps/web` | **PASS** exit 0 | Full route table rendered, standalone output. `BUILD_EXIT=0` |

Playwright e2e was not re-run this cycle (cycle-4 claimed 42 passed; not in the fast-gate scope and DB/browser-dependent). Not a regression signal — flagged only as "not re-verified this cycle."

### Cross-check vs cycle-4 claims

Cycle-4 aggregate claimed: eslint clean, typecheck 0, Vitest ~3113 passed/4 skipped, build exit 0, 3 lint gates 0, Playwright 42 passed. **Every re-runnable claim reproduces at HEAD** — Vitest count is an exact match (3113 passed / 4 skipped), not merely "~".

### Skipped tests — skipped BY DESIGN, not failing

The 2 skipped files / 4 skipped tests are the CLIP suites, gated on model weights that are absent in this environment:
- `src/__tests__/clip-offline-load.test.ts` — `const d = SEEDED ? describe : describe.skip;` (needs seeded jina-clip-v2 weights). 2 tests.
- `src/__tests__/clip-semantic-integration.test.ts` — `const d = RUN ? describe : describe.skip;` ("CI (no model weights) skips the whole suite"). 2 tests.

These are conditional `describe.skip`, and Vitest exit code is 0 (skips are never failures). Distinct from "failing." Confirmed skipped-by-design.

---

## 2. Invariant spot-checks (all reproduce)

### 2a. SW version hash = `<template-hash>-p{IMAGE_PIPELINE_VERSION}` — CONFIRMED

- `IMAGE_PIPELINE_VERSION = 7` (`src/lib/gallery-config-shared.ts:22`).
- `public/sw.js:26` → `const SW_VERSION = 'ccbc2e28-p7';`
- Recomputed independently with the exact `build-sw.ts` formula `sha256(template + "\nPIPELINE=7").slice(0,8)`:
  ```
  recomputed template hash: ccbc2e28
  expected SW_VERSION: ccbc2e28-p7
  actual sw.js SW_VERSION: ccbc2e28-p7
  MATCH: true
  ```
- The `-p7` suffix tracks the pipeline version and the `ccbc2e28` prefix is a genuine hash of the committed `sw.template.js` (not stale). **Confirmed.**

### 2b. COLOR_IMPACTING_KEYS count = 9 — CONFIRMED

`src/lib/settings-hash.ts:47` → `COLOR_IMPACTING_KEYS = DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS`, defined at `gallery-config-shared.ts:75` with exactly 9 entries:
`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`. Matches the CLAUDE.md "all **9** COLOR_IMPACTING_KEYS" contract. **Confirmed.**

### 2c. i18n key parity en.json vs ko.json — CONFIRMED

Recursive flatten of both message files:
```
en key count: 856
ko key count: 856
en-only keys: 0 []
ko-only keys: 0 []
PARITY: true
```
Identical key set (856/856), zero divergence. (Value shape may differ per the intentional ICU-plural-vs-Korean-fixed-form asymmetry; keys match, which is what the parity check enforces.) **Confirmed.**

---

## 3. Findings

**No RED gates. No failing/flaking tests. No non-reproducing claims.** Nothing to report as a defect.

Minor note (informational, not a finding): the working tree carries 5 modified `.context/reviews/*.md` top-level mirror files at verification time. These are documentation mirrors, not source; they do not affect any gate and gates were run against them in place.

---

## 4. Confidence

- Gate results: **Confirmed** (all commands executed at HEAD, real exit codes captured).
- SW hash / COLOR_IMPACTING_KEYS=9 / i18n parity: **Confirmed** (independently recomputed / counted, not merely read).
- Skipped-by-design classification: **Confirmed** (conditional `describe.skip` on weight availability; exit 0).
- Playwright 42-passed claim: **Not re-validated this cycle** (out of fast-gate scope; no evidence of regression).
