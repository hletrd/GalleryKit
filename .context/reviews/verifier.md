# Verifier Report — Cycle 3 (review-plan-fix)

**HEAD:** `ada92ba5` (`test(security): ✅ pin shared og-sanitize global-strip contract`)
**Date:** 2026-06-13
**Scope:** Evidence-based correctness verification. Every gate RUN, not trusted. Prior-cycle fixes re-verified against live code. CLAUDE.md claims spot-checked against source.

---

## Verdict

**Status:** PASS (with 1 flaky-test caveat — non-blocking, see VER-1)
**Confidence:** High
**Blockers:** 0

All six declared gates (eslint, typecheck, vitest, lint:api-auth, lint:action-origin, lint:public-route-rate-limit) are GREEN. The single vitest RED on the first run was proven to be a pre-existing parallel-contention flake (passed clean on a second full run + every isolation run); it does not touch this cycle's changes. All five prior-cycle fixes (AGG-R8-01/02/03/05/13) verified behaving as claimed.

---

## STEP 1 — Gate Results Table

| Gate | Command | Exit | Result |
|------|---------|------|--------|
| ESLint | `npm run lint --workspace=apps/web` | 0 | **PASS** (clean) |
| Typecheck | `npm run typecheck --workspace=apps/web` | 0 | **PASS** — typecheck:app (next typegen + tsc tsconfig.typecheck.json) + typecheck:scripts (7 JS files) both clean |
| lint:api-auth | `npm run lint:api-auth --workspace=apps/web` | 0 | **PASS** — all admin route method-exports wrap `withAdminAuth` |
| lint:action-origin | `npm run lint:action-origin --workspace=apps/web` | 0 | **PASS** — "All mutating server actions enforce same-origin provenance." |
| lint:public-route-rate-limit | `npm run lint:public-route-rate-limit --workspace=apps/web` | 0 | **PASS** — semantic-search uses helper; stripe webhook carries exempt tag; OG/live routes have no mutating handlers |
| Vitest (full) | `npx vitest run` (run 1) | **1** | **RED** → 2 failed / 2058 passed (2060). Both failures = AVIF flake (VER-1). |
| Vitest (full) | `npx vitest run` (run 2) | **0** | **GREEN** → 213 files / **2060 passed (2060)**. Confirms flake. |

**Net gate status: GREEN.** The vitest RED is a non-deterministic flake (VER-1), not a regression — the authoritative second full run is 2060/2060.

---

## VER-1 — Vitest flake: AVIF color tests fail under full parallelism (LOW, non-blocking)

**Confidence:** High

**Run 1 failures (exact output):**
```
FAIL  src/__tests__/backfill-color-pipeline.test.ts > … P3 source → P3-tagged AVIF output via backfill (A2)
AssertionError: expected 'error' to be 'processed'   (backfill-color-pipeline.test.ts:124)

FAIL  src/__tests__/process-image-color-roundtrip.test.ts > … P3-source AVIF raw pixel values preserved (R10-C1)
Error: Input file has corrupt header: VipsForeignLoad: ".../public/uploads/avif/rt-p3-green-raw.avif" is not a known file format
   (process-image-color-roundtrip.test.ts:152, readRawPixel → toBuffer)

 Test Files  2 failed | 211 passed (213)
      Tests  2 failed | 2058 passed (2060)
```

**Isolation re-runs (all GREEN):**
| Re-run | Exit | Result |
|--------|------|--------|
| `npx vitest run backfill-color-pipeline` | 0 | 6/6 passed |
| `npx vitest run process-image-color-roundtrip` | 0 | 11/11 passed |
| both color files together | 0 | 17/17 passed |
| **`npx vitest run` (2nd full)** | **0** | **2060/2060 passed** |

**Root cause:** 13 test files funnel through `processImageFormats` / `reprocessRow` into the SHARED real `apps/web/public/uploads/{avif,webp,jpeg}` tree (verified via `grep -rl processImageFormats`). The roundtrip test writes derivatives to `UPLOAD_DIR_AVIF` (not a per-test tmpdir; tmpdir holds only the source) and reads them back with `sharp(...).raw().toBuffer()`. `vitest.config.ts` sets NO pool override → default `fileParallelism: true` at CPU count. Under full 213-file parallel load the AVIF/libheif encoder transiently produces a truncated/invalid file (→ "corrupt header") or rejects (→ `outcome: 'error'`). The config comment in `vitest.config.ts` (testTimeout note) already documents contention-induced flakiness on this host.

**Not introduced this cycle:** neither file appears in the last 10 commits' name-only log (`git log --oneline -10 --name-only | grep …` → empty). Last touch was `37cca4c6` / `124cccbc` (earlier runs).

**Suggestion (LOW):** isolate AVIF-writing color tests into per-test `mkdtemp` output roots (parameterize `UPLOAD_DIR_AVIF` for tests) OR mark the AVIF-encode color files `test.sequential` / a dedicated single-fork pool project. Do NOT widen the pixel tolerances — the flake is encoder I/O under contention, not a tolerance issue. Risk if unaddressed: intermittent red CI runs that look like color regressions but aren't.

---

## STEP 2 — Prior-cycle fixes re-verified

### AGG-R8-01 — client-server-only-boundary cold-run + timeout + memoization → VERIFIED
- `npx vitest run client-server-only-boundary` cold → **exit 0, 2/2 passed, 1.18s**.
- Explicit timeout present: `}, 60_000);` at `apps/web/src/__tests__/client-server-only-boundary.test.ts:177` ("AGG-R8-01: generous explicit timeout").
- Memoized file reads: `const readCache = new Map<…>()` (line 39) + `const importSpecCache = new Map<…>()` (line 53). Docstring (lines 28-33) explains the prior un-cached `readFileSync` flake that masked real violations. **Behaves as claimed.**

### AGG-R8-02 — home og:image points at OG route (1200×630), not base JPEG → VERIFIED
- `apps/web/src/app/[locale]/(public)/page.tsx:112-116`: `ogImages = latestImage ? [{ url: absoluteImageUrl(\`/api/og/photo/${latestImage.id}\`, seo.url), width: 1200, height: 630, … }] : []`.
- Points at the per-photo **OG route** `/api/og/photo/[id]` (Satori-rendered 1200×630 card, capped at `OG_PHOTO_MAX_BYTES`), consistent with the 4 sibling OG paths — NOT the base JPEG. (Nuance vs prompt wording "/api/og": the home card reuses the per-photo card route, which IS the correct 1200×630 OG surface; intent satisfied.)
- Fallback (`seo.og_image_url`, 1200×630) at line 64 when no latest image.
- **Regression tests:** `home-metadata-title.test.ts`, `og-photo-fallback.test.ts`, `photo-og-metadata.test.ts` → `npx vitest run` these 3 → **exit 0, 20/20 passed**.

### AGG-R8-03 — image-manager checkboxes `min-h-11 min-w-11` + audit scans raw checkboxes → VERIFIED
- `apps/web/src/components/image-manager.tsx`: both checkboxes wrapped in `<label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">` (select-all line 418, per-row line 444). Inner `<input type="checkbox">` is the visible 20px box; the label supplies the 44px tap area.
- `touch-target-audit.test.ts` adds `scanRawCheckboxes` (line 602), wired into `scanSource` at line 598 (`issues.push(...scanRawCheckboxes(relPath, lines))`).
- **Synthetic-violation proof (the prompt's ask):** I imported the REAL `scanSource` in a throwaway vitest probe and stripped the first label's sizing class. Result written to `/tmp/probe_report.json`:
  - Baseline image-manager: `scanSource` → 1 total issue, **0** raw-checkbox issues (properly wrapped).
  - After stripping `min-h-11 min-w-11` → label: raw-checkbox issues **0 → 1** (flagged at line 414), total 1 → 2.
  - → `scanRawCheckboxes` genuinely catches a sub-44 checkbox. Probe removed; tree clean.
- Dedicated unit test `scanSource catches a raw <input type="checkbox"> … (AGG-R8-03)` at line 839 covers: violating `min-h-8` wrapper (flagged), compliant `min-h-11` wrapper (empty), radio variant (flagged), and shadcn `<Checkbox>` primitive (NOT false-positived). `npx vitest run touch-target-audit` → **exit 0, 12/12 passed**.

> **Side observation (VER-2, LOW, pre-existing, non-blocking):** `KNOWN_VIOLATIONS['components/image-manager.tsx'] = 6` (line 182) is STALE — the file's actual `scanSource` count is now 1. The aggregate assertion is `issues.length > allowed`, so up to 5 *new* violations in THIS one file would slip past the aggregate test (a fresh raw checkbox there would need to push the count above 6). The dedicated checkbox unit test still independently guards the checkbox logic, so AGG-R8-03's mechanism is sound; only the per-file budget for this single file is loose. The test itself documents stale entries as "informational, not a hard failure." Suggestion: tighten `image-manager.tsx` budget toward its real count when convenient. Not a regression introduced this cycle.

### AGG-R8-05 — SW HEAD probe bounded by AbortSignal.timeout in BOTH template and generated, matching → VERIFIED
- `public/sw.template.js`: `const HEAD_REVALIDATE_TIMEOUT_MS = 300;` (line 38), `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` on `method: 'HEAD'` (line 230).
- `public/sw.js` (generated): **identical** — `HEAD_REVALIDATE_TIMEOUT_MS = 300` (line 38), `AbortSignal.timeout(...)` (line 230), same surrounding AGG-R8-05 comment block at the same line numbers. They match in this region.
- Contract test `npx vitest run sw-template-contract` → **exit 0, 11/11 passed** (pins template↔generated against drift).

### AGG-R8-13 — both OG routes import the SAME sanitizeForOg from lib/og-sanitize → VERIFIED
- `apps/web/src/app/api/og/route.tsx:5`: `import { sanitizeForOg } from '@/lib/og-sanitize';` (used lines 82, 83, 88).
- `apps/web/src/app/api/og/photo/[id]/route.tsx:8`: `import { sanitizeForOg } from '@/lib/og-sanitize';` (used lines 81, 83). Comment line 19 confirms the relocation ("sanitizeForOg now lives in @/lib/og-sanitize (AGG-R8-13)").
- Both import from the SAME module. Contract tests `npx vitest run sanitize-for-og-global og-sanitize` → **exit 0, 10/10 passed (2 files)**.

---

## STEP 3 — CLAUDE.md claims vs code

| Claim | Source-of-truth | Observed | Status |
|-------|-----------------|----------|--------|
| i18n key parity (en==ko) | `messages/en.json` / `ko.json` | **837 leaf keys each, 0 missing either direction** (recursive leaf-key diff) | VERIFIED |
| `IMAGE_PIPELINE_VERSION = 7` | `src/lib/gallery-config-shared.ts:21` | `export const IMAGE_PIPELINE_VERSION = 7;` | VERIFIED (value 7). Doc imprecision: CLAUDE.md attributes it to `process-image.ts`; actual canonical def is `gallery-config-shared.ts` (re-used there). |
| `COLOR_IMPACTING_KEYS` count | `src/lib/settings-hash.ts:37` | **9 keys** (5 color + 3 quality `image_quality_{webp,avif,jpeg}` + 1 `image_sizes`) | **MISMATCH vs CLAUDE.md (VER-3)** |
| SW_VERSION stamp freshness | `public/sw.js:26` | `ee0f38bd-p7` — `ee0f38bd` is 8 commits BEHIND HEAD `ada92ba5` | **STALE in committed source (VER-4)** |

### VER-3 — CLAUDE.md ETag section understates COLOR_IMPACTING_KEYS (LOW, doc-only)
**Confidence:** High. CLAUDE.md (ETag/cache-invalidation section) states the settings hash "covers all **5** `COLOR_IMPACTING_KEYS`" and lists only the 5 color keys. The authoritative array in `settings-hash.ts:37-48` has **9** entries (adds `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg` per R7-H2 and `image_sizes` per R8-R6). The **code's own docstring (lines 6-14) is correct** and already lists all three groups (AGG-R7-08 corrected it from a stale 3-key summary). Only the top-level CLAUDE.md prose is stale. No functional defect — the hash correctly covers 9 keys at runtime. Suggestion: update the CLAUDE.md ETag paragraph "5" → "9" and list the quality + size keys.

### VER-4 — committed sw.js stamp is 8 commits stale (LOW, cosmetic)
**Confidence:** High. `public/sw.js` carries `SW_VERSION = 'ee0f38bd-p7'`; `ee0f38bd` is a real ancestor but HEAD is 8 commits ahead (`git rev-list --count ee0f38bd..HEAD` → 8). The `prebuild` hook (`apps/web/package.json:10` → `tsx scripts/build-sw.ts`) re-stamps `sw.js` with the live `git rev-parse --short HEAD` on every production build, so the DEPLOYED SW always carries the deploy-time SHA — the staleness is confined to the committed artifact and does not affect cache-busting in production. `-p7` correctly matches `IMAGE_PIPELINE_VERSION=7`. CLAUDE.md's "After editing the template, regenerate and commit sw.js" guidance was not followed for the last 8 commits, but none of those edited the SW template (only `9b7bb240` touched SW logic, and it DID re-stamp at the time). Suggestion: re-run `tsx scripts/build-sw.ts` and commit before the next release, or accept that prebuild handles it. Non-blocking.

---

## Evidence Summary

| Check | Result | Command | Output |
|-------|--------|---------|--------|
| ESLint | pass | `npm run lint -w apps/web` | exit 0, clean |
| Types | pass | `npm run typecheck -w apps/web` | exit 0 |
| api-auth | pass | `npm run lint:api-auth -w apps/web` | exit 0 |
| action-origin | pass | `npm run lint:action-origin -w apps/web` | exit 0 |
| public-rate-limit | pass | `npm run lint:public-route-rate-limit -w apps/web` | exit 0 |
| Vitest | pass* | `npx vitest run` (2nd run) | 2060/2060 (1st run 2 AVIF flakes, VER-1) |
| Prior fixes | 5/5 verified | per-test runs | AGG-R8-01/02/03/05/13 all confirmed behaving |
| i18n parity | pass | leaf-key diff | 837==837, 0 drift |

\* gate is GREEN on the authoritative full run; first-run RED is the VER-1 flake.

---

## Findings Index

| ID | Severity | Blocking | Summary |
|----|----------|----------|---------|
| VER-1 | LOW | No | AVIF color tests (backfill-color-pipeline, process-image-color-roundtrip) flake under full vitest parallelism (shared public/uploads + encoder contention). Pass clean in isolation and on 2nd full run. Not introduced this cycle. |
| VER-2 | LOW | No | `KNOWN_VIOLATIONS['components/image-manager.tsx']=6` is stale (actual scanSource count 1); aggregate could miss up to 5 new violations in that one file. Dedicated checkbox unit test still guards AGG-R8-03 logic. Pre-existing. |
| VER-3 | LOW | No | CLAUDE.md ETag section says "5 COLOR_IMPACTING_KEYS"; code has 9 (code docstring is correct). Doc-only drift. |
| VER-4 | LOW | No | Committed `public/sw.js` SW_VERSION stamp (`ee0f38bd-p7`) is 8 commits behind HEAD; prebuild re-stamps at build so deploy is unaffected. Cosmetic. |

## Recommendation

**APPROVE.** All six gates GREEN (vitest authoritative run 2060/2060). All five prior-cycle fixes (AGG-R8-01/02/03/05/13) independently re-verified behaving as claimed, including a synthetic-violation proof for the AGG-R8-03 checkbox scanner. The four findings are all LOW/non-blocking: one pre-existing test flake (VER-1) and three minor doc/test-hygiene items (VER-2/3/4). No correctness regression in this cycle's changes. The flake (VER-1) is the only item with CI-noise impact and is the highest-value follow-up.
