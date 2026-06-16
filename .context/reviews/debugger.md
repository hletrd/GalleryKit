# Debugger Review — Run 6 / Cycle 5 — ZERO new latent bugs; the 5 cycle-4 fix commits are all HEAD-verified correct.

**HEAD:** 2f603716 (branch master, working tree CLEAN)
**Date:** 2026-06-16
**Angle:** latent bug surface, failure modes, regressions, error/cleanup-path correctness, numeric/parsing edge cases, resource leaks, race regressions, boundary conditions.

## Verdict

**No new latent bugs survive scrutiny. 0 Crit / 0 High / 0 Med / 0 Low.** Honest convergence.

The entire delta since the prior review (f8147868) is the five cycle-4 fix commits (`24159f36..2f603716`), which implement AGG-C4-01..05. I diffed and traced every source-affecting one end-to-end against HEAD — all clean, no regressions introduced. The core failure surface (queue continuation lifecycle, Sharp catch/finally cleanup, GPS-strip byte walkers, ICC/ISOBMFF parsers, SW LRU, analytics `.catch()` guards, env coercion NaN-safety, bounded rate-limit maps) is unchanged since the prior deeply-reviewed cycles and remains bounds-checked and leak-free.

**Note on the brief's commit references:** the prompt cites bb463062 (bidi strip), 170297ed (OG/JSON-LD bidi), 13ae79ca (backfill processed count) as "recent fix commits since f8147868." All three are **ancestors of f8147868** (`git merge-base --is-ancestor` confirms) — they were already covered in cycle-1..cycle-4 reviews. They are not part of this cycle's delta. I re-verified the bidi-strip surface anyway (see below) since it is a Trojan-Source attack surface; it is complete.

---

## Cycle-4 change scrutiny (24159f36..2f603716) — highest regression risk this cycle

All five commits diffed and traced. The two that touch executable logic (`1fd350be`, `6ab40644`) get the deepest scrutiny.

### 1fd350be — backfill `detectionFailures` walkback for deleted-mid-reencode rows — CORRECT, slice index verified

`apps/web/scripts/backfill-color-pipeline.ts:454-455`. The fix adds, in `flushBatch`'s deleted-mid-reencode partition:
```
const derivativeResults = updateResults.slice(items.length);
detectionFailures -= countDeletedMidReencodeDetectionFailures(derivativeResults);
```
The slice index is the load-bearing claim, and it is correct. In the transaction (`:407-432`), `items` (success rows) are pushed to `updateResults` FIRST, then `derivativeItems` (detection-failure rows) are pushed SECOND. So `updateResults.slice(items.length)` recovers EXACTLY the derivative-slice UPDATE outcomes — no off-by-one. `countDeletedMidReencodeDetectionFailures` (`:159-164`) counts `affectedRows === 0` in that slice = the detection-failure∩deleted overlap, which is exactly what must be walked back.

Counter consistency verified:
- `detectionFailures++` fires per-row ONLY in the `else if (result.derivativeOnly)` branch (`:480`), pushing to `derivativeBatch`.
- `processed -= deletedMidReencodeFiles.length` (`:444`) decrements by the TOTAL deleted count (success-slice + derivative-slice). Consistent: `processed++` (`:467`) fires for BOTH `signals` and `derivativeOnly` rows (both inside `outcome === 'processed'`), so both decrement on delete. No asymmetry.
- The extracted `computeBackfillExitCode` (`:177`) is a pure 1-line predicate, exit expression unchanged (`errors>0 || detectionFailures>0 ? 1 : 0`).

Test coverage (`backfill-color-pipeline-deleted-mid-reencode.test.ts`) is comprehensive and **non-vacuous**: `countDeletedMidReencodeDetectionFailures` matrix (2 deleted of 3 → 2; all-alive → 0; empty → 0), `computeBackfillExitCode` matrix (0/0→0, errors→1, detectionFailures→1, both→1), plus source-shape pins that `flushBatch` invokes the walkback and `main()` routes through the helper. The in-app twin (`admin-backfill-runner.ts:605-609`) does NOT have this over-count because it determines `deleted-mid-reencode` vs `detection-failed` per-row as mutually-exclusive outcomes — verified at HEAD; the sidecar asymmetry is purely an artifact of batching DB writes decoupled from the per-row encode, which this fix correctly compensates for.

### 6ab40644 — image-queue bootstrap flake fix — CORRECT, keys on a real deterministic state field

`apps/web/src/__tests__/image-queue-bootstrap.test.ts:165-176`. The bare `vi.waitFor(() => expect(limitMock).toHaveBeenCalledTimes(2))` (~1s default) now carries `{ timeout: 20_000, interval: 25 }` and additionally asserts `getProcessingQueueState().bootstrapped === true`. Verified the keyed state is REAL and deterministic, not vacuous: `bootstrapped` is set at `image-queue.ts:679` (`pending.length < BOOTSTRAP_BATCH_SIZE`); in the 2-batch test scenario the second (short) batch sets it true. The continuation lifecycle it guards is leak-free: `scheduleBootstrapContinuation` (`:592-606`) guards on `bootstrapContinuationScheduled` against double-schedule, sets it true, and resets it to false in BOTH the `.then` and `.catch` of `queue.onIdle()` — the flag never sticks. `bootstrapImageProcessingQueue` early-returns on that flag (`:610`), preventing re-entrancy. Test is now deterministic, asserts the correct end-state, no global timeout inflation.

### 9a262e3f — switch geometry contract test — CORRECT, non-vacuous static scan

`apps/web/src/__tests__/switch-geometry-contract.test.ts` (new, +99). Static source-scan pinning the load-bearing triple (visible-track `w-11`+`px-0.5`+`h-6`, thumb `size-5`, travel `translate-x-0`/`translate-x-full`) + a guard banning the half-on `translate-x-5`. Commit message documents it was proven RED on reverting the travel class. Mirrors the touch-target-audit / sw-template-contract idiom. Pins the cycle-3 fix against silent re-break. No runtime code touched.

### 24159f36 — switch.tsx header comment fix — COMMENT-ONLY, verified no logic delta

Corrects the `:13-14` docblock to cite `translate-x-full` (matching the shipped code) instead of `calc(100%-2px)`. AGG-C4-05. Zero executable lines changed. Closes the 6-agent-corroborated comment drift.

### 7541c92d / 2f603716 — docs/reviews + plans — non-code.

---

## Re-verified failure-prone surface (unchanged since prior cycles) — all clean

- **bidi / zero-width strip (Trojan-Source surface, re-audited since it's security-relevant):** every STRIPPING site (`og-sanitize.ts:29`, `validation.ts:94` `stripUnicodeFormatting`, `sanitize.ts:22`, `download-filename.ts:40`, `csv-escape.ts:54`) uses a fresh `/g` instance derived from `UNICODE_FORMAT_CHARS.source` (avoiding shared `lastIndex` state corruption), and every REJECTION/`.test()` site (`validation.ts:74,106,120`, `sanitize.ts:60,177`) uses the non-global `UNICODE_FORMAT_CHARS`. The `.source`-derived separation is deliberately documented (`validation.ts:77-82`). `sanitizeForOg` (`og-sanitize.ts:28-30`) is a single shared module — no symmetry gap between the per-photo and home OG routes. No remaining non-global `.replace(UNICODE_FORMAT_CHARS, …)` anywhere. The 170297ed fix is complete and leak-free.
- **gps-exif-strip.ts** (`stripGpsFromTiffRegion:103-199`): every walker bounds-checks before read/fill. `inBounds(entriesStart, count*12+4)` (`:122,166`) fits entries + next-pointer; `MAX_IFD_ENTRIES=1024` / `MAX_IFD_CHAIN=8` caps; unknown TIFF type → `null` (`:128,182`); value-offset checked before fill (`:132,185`); IFD0-offset `<= tiffStart+7` → `null` (`:157`, the d17e5cc2 fix, correct fail-safe); `visited` set catches IFD cycles (`:160`). Any anomaly returns `null` → caller's metadata-free re-encode fallback. Mature.
- **image-queue.ts** `enqueueImageProcessing`: claim before processing; `finally` releases the lock connection (`.catch`-guarded) and prunes retry maps; `failed_at` MySQL-datetime coercion present; fire-and-forget caption/embedding hooks `.then().catch()`'d. Env coercion `Number(process.env.QUEUE_CONCURRENCY) || 1` NaN-safe. No leaked connections.
- **process-image.ts** `processImageFormats`: `try/catch/finally` unlinks every partial sized variant written THIS invocation on any throw; `finally` cleans the WI-15 downscale intermediate; `writtenSizedPaths` tracks post-rename so cleanup never deletes a prior-run file; AVIF 10→8-bit per-image fallback uses `base.clone()` with explicit `bitdepth:8`. No Sharp leak.
- **admin-backfill-runner.ts** `reprocessRow` (`:560-614`): `deleted-mid-reencode` vs `detection-failed` are mutually-exclusive per-row outcomes (the `affectedRows===0` re-check at `:573` and `:605` returns `deleted-mid-reencode` BEFORE `detection-failed`); the per-worker counters sum to the total (`:752`); `finally` (`:610-613`) always releases the claim with `.catch(()=>undefined)`. No double-count, no leak.
- **auth-rate-limit.ts**: both maps are `createWindowBoundedMap` with explicit max-key caps (`LOGIN_RATE_LIMIT_MAX_KEYS`, `PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS=5000`) → bounded, no unbounded growth. Rollback uses decrement-not-delete (C1-07) so concurrent rollbacks don't lose counts.
- **sw.js / sw-cache.ts**: LRU `recordAndEvict` head-walks insertion-order, guards the running total on the `deleted` boolean; `touchMeta` repositions on 304; HEAD probe `AbortSignal.timeout(300)` with stale-serve catch; `networkFirstHtml` clones the body and returns the original (no double stream consumption). No latent bug.
- **color-detection.ts / icc-chromaticity.ts / icc-extractor.ts / gain-map-detection.ts**: unchanged since prior cycles; bounded ISOBMFF walker (max depth 5, max scan 1 MB), capped tagCount / string lengths, ΔE thresholds. Already deeply verified; no regression in scope this cycle.

---

## Gates run this review
- `npm run typecheck --workspace=apps/web` → **PASS** (exit 0; typecheck:app + typecheck:scripts both clean).
- `vitest run` over `backfill-color-pipeline-deleted-mid-reencode.test.ts`, `switch-geometry-contract.test.ts`, `image-queue-bootstrap.test.ts` → **23/23 PASS** (3.65s).

## References (verified this cycle, NOT findings)
- `apps/web/scripts/backfill-color-pipeline.ts:454-455` — detectionFailures walkback slice index (verified correct: items pushed before derivativeItems, so slice(items.length) = derivative slice)
- `apps/web/scripts/backfill-color-pipeline.ts:159-164,177` — extracted pure helpers (countDeletedMidReencodeDetectionFailures, computeBackfillExitCode)
- `apps/web/src/__tests__/image-queue-bootstrap.test.ts:165-176` — flake fix keys on real `bootstrapped` state (image-queue.ts:679)
- `apps/web/src/lib/image-queue.ts:592-606,610` — bootstrap continuation flag lifecycle (verified leak-free, no double-schedule)
- `apps/web/src/lib/admin-backfill-runner.ts:573,605-613` — in-app twin: mutually-exclusive deleted/detection outcomes + claim release in finally
- `apps/web/src/lib/og-sanitize.ts:28-30` / `apps/web/src/lib/validation.ts:77-94` — bidi strip: global-flag twin, .source-derived, no shared lastIndex
- `apps/web/src/lib/gps-exif-strip.ts:104,122,132,157,166,185` — GPS-strip byte-offset bounds (verified all checked before read/fill)

## Summary count by severity
- **Critical: 0**
- **High: 0**
- **Medium: 0**
- **Low: 0**
