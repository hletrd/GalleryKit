# Debugger Review — Run 6 / Cycle 4

**HEAD:** f8147868
**Date:** 2026-06-16
**Angle:** latent bug surface, failure modes, regressions, off-by-one, null/undefined hazards, type coercion, async/await mistakes, unhandled rejections, resource leaks, error-path correctness.

## Verdict

**No new latent bugs survive scrutiny. 0 Crit / 0 High / 0 Med / 0 Low.** Honest convergence.

The prior-cycle (cycle-3) source changes in `b1e9e0da..f8147868` are all verified correct. The core failure surface (queue, Sharp pipeline, SW, GPS strip, parsers, backfill, analytics) is mature and well-hardened by ~58 prior closed findings. Typecheck is green; the 25 tests covering the cycle-3-touched files pass.

I did NOT re-report the cycle-3 closed items or the deferred AGG-C3-09 (their reasoning is sound — see below).

---

## Cycle-3 change scrutiny (b1e9e0da..f8147868) — highest regression risk

All five source-affecting commits were diffed and traced end-to-end. All clean.

### a3b8c557 — switch.tsx geometry rewrite — CORRECT
- `apps/web/src/components/ui/switch.tsx:32-52`. The thumb (`size-5`=20px) now lives inside the **visible** track (`<span>` `h-6 w-11 px-0.5`), NOT the 44px Root. Inner track width = 44 − 2×2 = 40px; thumb 20px; remaining travel 20px. `translate-x-full` resolves to 100% of the **thumb's own** width (Tailwind `translate-x-full` = `translateX(100%)`, % of the transformed element) = 20px = exactly the remaining travel. Checked-state thumb lands flush right, unchecked flush left. The "half-on" defect is genuinely fixed.
- The visible track color tracks Root's data-state via `group-data-[state=checked]:bg-primary` (Root carries `group`; Radix sets `data-state` on Root). Correct.
- NIT (not a finding): the header comment at `switch.tsx:14` says travel is `translate-x-[calc(100%-2px)]`, but the implemented value is `translate-x-full` (line 49). The implemented value is the correct one; only the prose is stale. Cosmetic.

### a033056d — backfill detectionFailures counter + exit code — CORRECT, no off-by-one / double-count
- `apps/web/scripts/backfill-color-pipeline.ts:339,439,481`. `detectionFailures++` fires ONLY in the `else if (result.derivativeOnly)` branch (mutually exclusive with the `result.signals` success branch), and only inside `outcome === 'processed'`. The `errors++` branch is the terminal `else` (mutually exclusive with `processed`). A row cannot increment both `detectionFailures` and `errors`. No double-count.
- Exit code `process.exit(errors > 0 || detectionFailures > 0 ? 1 : 0)` is correct — an all-detection-failure run now exits non-zero, closing AGG-C3-04. The WARN summary line is gated on `detectionFailures > 0`. Resume contract intact (`processed++` still counts these so the batch flush + cursor advance is unaffected; `pipeline_version` is deliberately NOT bumped so they remain retry candidates).
- Benign edge (NOT a finding): a `derivativeOnly` row deleted mid-reencode decrements `processed` (`:414`) but NOT `detectionFailures`, so a run that ONLY had detection-failures-on-now-deleted-rows could exit 1 with `processed=0`. The row is already gone (retry moot) and exiting non-zero on "color metadata not advanced" is the conservative/correct signal anyway. Cosmetic over-report on a deleted row; no incorrect behavior.

### 06a3c5e7 — process-topic-image.ts TOPIC_RESOURCES_ROOT override — CORRECT
- `apps/web/src/lib/process-topic-image.ts:11-26`. `process.env.TOPIC_RESOURCES_ROOT?.trim()` + truthy guard: undefined → optional-chain short-circuits; empty/whitespace → `''` falsy → falls through to the cwd-derived monorepo/simple path logic (unchanged). Mirrors the verified `upload-paths.ts:13,28` pattern exactly. No path-join bug, no undefined-env fallback hazard. The test (`process-topic-image.test.ts:41-42`) sets it to `mkdtempSync(os.tmpdir())` via a hoisted block so module-eval reads it. Verified isolated.

### 0ef29a10 — color-detection re-export removal + import repoint — CORRECT, no runtime breakage
- `apps/web/src/lib/color-detection.ts:43-50` removed `export { WIDE_GAMUT_PRIMARIES, isWideGamutPrimary } from '@/lib/color-primaries'`. `apps/web/src/app/actions/images.ts:29` now imports `isWideGamutPrimary` directly from `@/lib/color-primaries` (the client-safe leaf). Same symbol, same source module, just one fewer hop. `wide-gamut-primaries.test.ts` repointed too. Typecheck green confirms no other importer relied on the removed re-export. No runtime breakage.

### f603cd3f — serve-upload.ts comment change — COMMENT-ONLY, verified no logic change
- `apps/web/src/lib/serve-upload.ts:195-208`. The diff touches only the comment block (de-enumerates the COLOR_IMPACTING_KEYS list, points at the constant). The ETag-construction logic below is byte-identical. Verified via `git diff` — zero executable lines changed.

---

## Core failure-surface inventory (error paths / async / leaks) — all clean

- **image-queue.ts** (`enqueueImageProcessing`): claim acquired before processing; `finally` (`:544-557`) always releases the lock connection (`.catch`-guarded) and prunes the retry maps; the `retried` / `claimRetryScheduled` guards correctly avoid clearing `enqueued`/`claimRetryCounts` when a retry/claim-retry is in flight (no premature delete that would let a duplicate enqueue slip through). Fire-and-forget caption (`:395-410`) and embedding (`:434-478`) hooks are `void`'d / `.then().catch()`'d — no unhandled rejection. The `failed_at` MySQL-datetime fix (`toMySqlDateTime`, `:529`) is present (prevents the swallowed ER 1292 that emptied the failed-images panel). Bootstrap ECONNREFUSED handling + cursor-based pagination + permanently-failed exclusion all sound. No leaked pool connections on any path.
- **process-image.ts** (`processImageFormats`): the `try/catch/finally` (`:1263-1317`) unlinks every partial sized variant written THIS invocation across all 3 formats on any throw, and the `finally` cleans the WI-15 downscale intermediate. `writtenSizedPaths` tracks paths post-rename so cleanup never deletes a pre-existing prior-run file. AVIF 10-bit→8-bit per-image fallback (`:1165-1188`) uses `base.clone()` with explicit `bitdepth: 8` (the documented COR-R4C8-06 reset). Sharp instances are fresh-per-format (no cross-format state contamination). `metadata()` read at `:1019` guards `height > 0`. No resource leak, no unhandled Sharp rejection.
- **sw.js**: LRU `recordAndEvict` (`:95-126`) head-walks insertion-order (= recency via delete-then-set), guards the running total on the `deleted` boolean (browser quota-evicted entries don't corrupt the total). `touchMeta` (`:156-170`) repositions on 304 so a freshly-revalidated tile isn't evicted as stale. HEAD probe bounded by `AbortSignal.timeout(300)` with a `catch`→stale-serve fallthrough (`:235-256`). `networkFirstHtml` caches `networkResponse.clone().body` and returns the original — no double stream-consumption. `x-gk-admin-render` gate excludes admin-rendered HTML. No latent bug.
- **gps-exif-strip.ts**: every walker is bounds-checked and returns `null` on any structural anomaly (`stripGpsFromTiffRegion:104-110,117-119`, type-size table rejects unknown TIFF types), so a truncated/malformed box triggers the caller's re-encode fallback rather than reading OOB. Mature.
- **public.ts analytics** (`recordPhotoView`/`recordTopicView`/`recordSharedGroupView`, `:355-405`) + **data.ts view-count flush** (`:107-118`): all fire-and-forget `db.insert/update` carry explicit `.catch()` ("swallow errors so analytics never blocks render"); the flush path has retry-count-bounded re-buffering. No unhandled rejection.
- **env-var coercion**: `Number(process.env.QUEUE_CONCURRENCY) || 1` (`image-queue.ts:168`), `Math.max(1, Number(process.env.BACKFILL_CONCURRENCY) || 2)` (`backfill:329`) — garbage env → `NaN` → `|| fallback` → safe. No NaN escape.

---

## Re-verified, NOT re-reported

- **Deferred AGG-C3-09** (upload-tracker quota settled inside outer `try`, not `finally`; `images.ts` outer `finally` releases only the contract lock): reasoning still sound. The settlement path is reachable only by a throw escaping the per-file inner try/catch (which catches every realistic per-file fault and `continue`s) — framework-level failure only, effect is admin-self-impact quota over-count until window expiry. Correctly deferred; not re-raising.
- **Cycle-3 CLOSED items** (switch half-on, backfill exit code, settings-hash docstring, ETag de-enumeration, re-export layering trap, histogram contrast, topic-image tmpdir isolation, Stripe cross-ref): all verified fixed at HEAD. Not re-planning.

## Non-findings investigated

- Two `apps/web/public/resources/{uuid}.webp` orphans (timestamped ~3h before this run) exist on disk. They are **gitignored** (`.gitignore:51` `/public/resources/*`, only `.gitkeep` tracked) so `git status` is clean — no repo pollution. The only test exercising the real topic-image pipeline (`process-topic-image.test.ts`) is now isolated to `os.tmpdir()` via `TOPIC_RESOURCES_ROOT`; `topics-actions.test.ts` fully mocks `process-topic-image`. The orphans are out-of-band leftovers (a prior dev/test run in this sandbox), not produced by the current committed test suite. Not a regression, not a finding.

## Gates run this review
- `npm run typecheck --workspace=apps/web` → PASS (typecheck:app + typecheck:scripts both clean).
- `vitest run` over `process-topic-image.test.ts`, `backfill-color-pipeline.test.ts`, `wide-gamut-primaries.test.ts`, `admin-backfill-runner-detection-failure.test.ts` → 25/25 PASS.

## References
- `apps/web/src/components/ui/switch.tsx:32-52` — switch geometry fix (verified correct; comment/code prose nit only)
- `apps/web/scripts/backfill-color-pipeline.ts:339,439,481` — detectionFailures counter + exit code (verified no double-count, exit code correct)
- `apps/web/src/lib/process-topic-image.ts:11-26` — TOPIC_RESOURCES_ROOT override (verified guard + fallback correct)
- `apps/web/src/lib/color-detection.ts:43-50` / `apps/web/src/app/actions/images.ts:29` — re-export removal + import repoint (verified no breakage)
- `apps/web/src/lib/serve-upload.ts:195-208` — comment-only change (verified no logic delta)
- `apps/web/src/lib/image-queue.ts:544-557` — claim release in finally + retry guards (verified leak-free)
- `apps/web/src/lib/process-image.ts:1263-1317` — partial-file cleanup catch/finally (verified correct)
