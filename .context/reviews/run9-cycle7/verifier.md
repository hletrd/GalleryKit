# Run-9 Cycle-7 Verifier Report

**HEAD**: feb63faa  
**Date**: 2026-06-21  
**Role**: PRE-FIX baseline (before LR upload settings fix lands)

---

## Quality Gate Evidence

| Gate | Command | Exit Code | Key Numbers |
|------|---------|-----------|-------------|
| ESLint | `npm run lint --workspace=apps/web` | 0 (PASS) | No warnings or errors |
| lint:api-auth | `npm run lint:api-auth --workspace=apps/web` | 0 (PASS) | 2 routes OK |
| lint:action-origin | `npm run lint:action-origin --workspace=apps/web` | 0 (PASS) | 37 actions OK, 5 exempt |
| lint:public-route-rate-limit | `npm run lint:public-route-rate-limit --workspace=apps/web` | 0 (PASS) | 6 routes OK |
| typecheck | `npm run typecheck --workspace=apps/web` | 0 (PASS) | 0 errors (app + scripts) |
| Vitest | `npm test --workspace=apps/web` | 0 (PASS) | 2058 passed, 4 skipped, 0 failed; 225 files passed, 2 skipped |
| Next.js build | `npm run build --workspace=apps/web` | 0 (PASS) | 10 static pages, 29 dynamic routes |

### SW Version Stamp
`public/sw.js` line 26: `const SW_VERSION = 'feb63faa-p7';`  
HEAD short-SHA is `feb63faa`, pipeline version is 7.  
**Match: YES** — stamp matches HEAD exactly.

---

## Special Focus: LR Upload 6-Settings Defect (Lead Preliminary Finding)

**Verdict: CONFIRMED DEFECT (Medium, High confidence)**

### Evidence

**Queue handler gate** (`apps/web/src/lib/image-queue.ts:336`):
```
if (!quality && !imageSizes) {
    // Bootstrap / legacy re-enqueue path: load all from current config.
```
The 6 settings (`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`) are read from `job.*` unconditionally at lines 326–335, then the gate at line 336 only re-loads them from DB config if BOTH `quality` AND `imageSizes` are absent.

**Browser upload path** (`apps/web/src/app/actions/images.ts:440–471`):  
Supplies `quality`, `imageSizes`, AND all 6 settings explicitly. CR-R9C6-01 fix is complete here.

**LR PAT upload path** (`apps/web/src/app/api/admin/lr/upload/route.ts:420–444`):  
Supplies `quality` (lines 428–432) and `imageSizes` (line 433), but does **NOT** supply any of the 6 settings (`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`).

Because `quality` is present, the `!quality && !imageSizes` gate at line 336 is **never entered**, so the 6 settings default to:
- `autoAltTextEnabled = false` (line 326: `?? false`)
- `forceSrgbDerivatives = false` (line 327: `?? false`)
- `wideGamutJpegChroma = undefined` (line 331)
- `avifEffort = undefined` (line 332)
- `sdrJpegChroma = undefined` (line 333)
- `wideGamutMaxSourcePixels = undefined` (line 335)

These `undefined` values fall back to Sharp/process-image hardcoded defaults rather than the admin-configured values.

**Config is loaded at LR route** (`apps/web/src/app/api/admin/lr/upload/route.ts:170`):  
`const config = await getGalleryConfig();` — the config object is already available in scope at the `enqueueImageProcessing` call site (line 420). All 6 settings are accessible as `config.forceSrgbDerivatives`, `config.wideGamutJpegChroma`, etc.

**Failure scenario**: An admin sets `force_srgb_derivatives=true` (or configures `avif_effort`, `wide_gamut_jpeg_chroma`, etc.) and publishes photos via Lightroom Classic. Those photos are processed with the hardcoded defaults, not the admin-configured values — the same class of defect as CR-R9C6-01, on the LR publish path. The admin has no indication the settings were ignored.

**Fix**: Add the 6 fields to the `enqueueImageProcessing` call at `route.ts:420`, drawing from the already-available `config` object:
```ts
forceSrgbDerivatives: config.forceSrgbDerivatives,
wideGamutJpegChroma: config.wideGamutJpegChroma,
avifEffort: config.avifEffort,
sdrJpegChroma: config.sdrJpegChroma,
wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
autoAltTextEnabled: config.autoAltTextEnabled,
```

### Other Entry Points Verified

| Path | File:line | Status |
|------|-----------|--------|
| Bootstrap | `image-queue.ts:674` | CORRECT — no `quality`/`imageSizes`, gate enters and loads all from config |
| Retry re-enqueue (claim retry) | `image-queue.ts:290` | CORRECT — re-enqueues same `job` object, preserving whatever was on the original |
| Retry re-enqueue (error retry) | `image-queue.ts:510` | CORRECT — same, re-enqueues same `job` object |
| `retryFailedImage` | `images.ts:1139` | CORRECT — no `quality`/`imageSizes`, gate enters and loads from config |
| Admin backfill runner | `admin-backfill-runner.ts:499` | CORRECT — calls `processImageFormats` directly (not via queue), receives `settings` object with all fields |
| Sidecar backfill | `backfill-color-pipeline.ts:203` | CORRECT — calls `processImageFormats` directly, receives `settings` object with all fields |

---

## Acceptance Criteria Assessment

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | All 4 lint gates pass | VERIFIED | All exit 0 with no violations |
| 2 | typecheck clean | VERIFIED | Exit 0, 0 errors |
| 3 | Vitest 0 failures | VERIFIED | 2058 passed, 0 failed |
| 4 | Next.js build succeeds | VERIFIED | Exit 0, 29 routes rendered |
| 5 | SW version matches HEAD | VERIFIED | `feb63faa-p7` matches HEAD `feb63faa` + pipeline v7 |
| 6 | LR upload enqueue forwards 6 settings | MISSING | `route.ts:420–444` omits all 6; `config` is in scope |
| 7 | Browser upload forwards 6 settings | VERIFIED | `images.ts:461–466` has all 6 (CR-R9C6-01) |
| 8 | Bootstrap / retry paths fall back to config | VERIFIED | Gate logic confirmed at `image-queue.ts:336` |

---

## Verdict

**Status**: FAIL (one defect blocks clean cycle completion)  
**Confidence**: high  
**Blockers**: 1

**Defect CR-R9C7-01** (Medium, High confidence):  
`apps/web/src/app/api/admin/lr/upload/route.ts:420–444` — `enqueueImageProcessing` call supplies `quality` + `imageSizes` but omits all 6 admin processing settings (`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`). Because `quality` is non-null the config-load gate (`!quality && !imageSizes`) never fires, so Lightroom Classic publishes always use hardcoded defaults regardless of admin configuration. The `config` object is already in scope — fix is a 6-line addition mirroring `images.ts:461–466`.

**Post-fix gates**: After the fix lands, all 7 quality gates must be re-run. No gate currently fails on any other finding.
