# Test-Engineer Review — Run 6 / Cycle 4

**HEAD:** f8147868
**Date:** 2026-06-16
**Angle:** test coverage gaps, flaky tests, test-isolation hazards, TDD opportunities, assertions that don't assert.

## Test-run result

Ran `npm test --workspace=apps/web` **TWICE** (same HEAD f8147868, no code changes between):

| Run | Result | Duration |
|-----|--------|----------|
| 1 | **2 FAILED** / 2163 passed / 2 skipped (2167) — both in `image-queue-bootstrap.test.ts` | 190.71s |
| 2 | **0 failed** / 2165 passed / 2 skipped (2167) | 98.05s |

**This is a confirmed non-deterministic flake** (see TE-C4-01). Isolated runs of the bootstrap file pass 3/3 in ~3.4s every time. The failure correlates with the slow (190s, ~2× the fast run) full-suite pass — i.e. host/worker-pool contention.

**Working-tree status after both runs:** CLEAN of tracked changes (the only `git status` entries are the sibling reviewer `.md` files written by other agents in this same fan-out — no source/test files modified). The prior-cycle ORCH-C3-TMPDIR / AGG-C3-03 test-isolation fix **HELD** — see verification below.

---

## TE-C4-01 — `image-queue-bootstrap.test.ts` is FLAKY under full-suite load (HIGH, High)

**This is the headline finding and the only genuinely new/serious one.**

- **File:** `apps/web/src/__tests__/image-queue-bootstrap.test.ts:131` (test 1, timeout) and `:165` (test 2, wrong call count).
- **Observed failures (run 1):**
  - Test 1 `caps each bootstrap pass and schedules a continuation`: `Error: Test timed out in 15000ms` (the file's whole isolated run is 3.4s).
  - Test 2 `continues scanning after the previous batch cursor`: `expected "vi.fn()" to be called 2 times, but got 1 times` at the `vi.waitFor(() => expect(limitMock).toHaveBeenCalledTimes(2))` on line 165.
- **Root cause — NOT an SUT logic bug; a timing-budget bug in the TEST:**
  1. The test body does `vi.resetModules()` then `await import('@/lib/image-queue')` *inside each test* (`loadQueueModule`). `image-queue.ts` has a large transitive import graph (`@/db`, `process-image`→sharp, `clip-model`, `caption-generator`, …). Re-evaluating that fresh, under a saturated worker pool, can exceed the 15s `testTimeout` for test 1. The SUT itself resolves fast in isolation — `cleanOrphanedTmpFiles()` ENOENTs immediately on `/tmp/{webp,avif,jpeg}` and the never-resolving `queueOnIdleMock` is only consumed by a fire-and-forget `.then()` in `scheduleBootstrapContinuation` (`image-queue.ts:595`), so it does NOT block `await bootstrapImageProcessingQueue()`.
  2. Test 2's `vi.waitFor(...)` on line 165 has **no explicit timeout/interval**, so it uses vitest's default (~1000ms). The 2nd `limit` call is driven by the `queue.onIdle().then(() => bootstrapImageProcessingQueue())` microtask continuation; under load that microtask + the dynamic re-import doesn't complete inside the default 1s window → "called 1 time" instead of 2.
- **Concrete scenario where a bug ships undetected:** because the failure is load-correlated, CI sees red ~half the time on an *unchanged* bootstrap. Teams habituate to "just re-run it," and a *real* regression to the bootstrap continuation/cursor logic (`bootstrapCursorId`, `scheduleBootstrapContinuation`) would be dismissed as "the usual flake" and merged.
- **Suggested fix (the repo already has the gold-standard pattern):** mirror `admin-backfill-runner-detection-failure.test.ts:178` — `await vi.waitFor(() => { … }, { timeout: 20_000, interval: 25 })`, poll an authoritative completion signal, and give test 2's line-165 `waitFor` an explicit `{ timeout: 10_000, interval: 25 }`. For test 1, either bump that single test's timeout (`it(..., { timeout: 30_000 })`) or move the heavy `await import` into a `beforeAll` so the import cost isn't inside the timed assertion window. The backfill suite already documents (R4C1 TEST-R4C1-06) fixing this exact class of flake the same way; the bootstrap suite was simply never migrated.
- **Note:** the bootstrap test was NOT modified in b1e9e0da..f8147868 (last touched `c6627ec8`), so this is pre-existing latent fragility — but it reproduced live this cycle and is the single highest-value test fix available. It is the only suite member with an unparameterized `vi.waitFor` (every `admin-backfill-runner-*` sibling passes explicit `{ timeout, interval }`).
- **Confidence:** High (reproduced: failed run 1, passed run 2, passed isolated 3/3; mechanism traced in source).

---

## TE-C4-02 — Switch geometry fix (AGG-C3-01) has NO regression test; the fix re-introduces the same blind spot (MEDIUM, High)

- **Files:** `apps/web/src/components/ui/switch.tsx` (fix commit `a3b8c557`); no test references Switch geometry (`grep translate-x|thumb` across `src/__tests__` → 0 hits; the only Switch mention is `touch-target-audit.test.ts`, which checks the 44px hit area, NOT thumb travel).
- **The gap:** AGG-C3-01 was a *user-visible* defect (every toggle read "half-on") that shipped because no test asserted thumb travel. The fix is correct today but rests on a **silent Tailwind coincidence** documented in the source comment: track is `w-11` + `px-0.5` → 40px inner, thumb is `size-5` (20px), so remaining travel = 40−20 = 20px = exactly `translate-x-full` (100% of the thumb's *own* width). If a future edit changes the thumb to `size-6`, the track to `w-12`, or the padding, `translate-x-full` no longer lands flush and the half-on bug returns — **with no test to catch it.** The touch-target audit will still pass (the 44px Root box is untouched), giving false confidence.
- **Concrete scenario:** a designer bumps the thumb to `size-6` for visual weight. `translate-x-full` now = 24px travel in a 40px-inner track → thumb overshoots/clips. Audit green, unit suite green, ships.
- **Suggested test (source-inspection, matching repo convention e.g. `wide-gamut-predicate-wiring.test.ts`):** a fixture that reads `switch.tsx` and pins the three load-bearing tokens together — track inner width, thumb size, and travel — asserting `translate-x-full` is paired with a thumb whose width equals the remaining track travel. Cheaper/sturdier alternative: a jsdom render asserting `data-[state=checked]` thumb `transform` is non-zero and the track width class is present. Either kills the silent-coincidence regression.
- **Confidence:** High (no geometry test exists; the coincidence is real and documented in the fix's own comment).

---

## TE-C4-03 — Backfill sidecar `detectionFailures` exit-code (AGG-C3-04) is the untested half of the fix (MEDIUM, Medium)

- **Files:** `apps/web/scripts/backfill-color-pipeline.ts:439` (`detectionFailures++`), `:464-470` (summary line), `:485` (`process.exit(errors > 0 || detectionFailures > 0 ? 1 : 0)`) — fix commit `a033056d`. Existing test: `apps/web/src/__tests__/backfill-detection-failure-contract.test.ts`.
- **The gap:** the contract test exercises only `reprocessRow` (asserts `derivativeOnly` set + `signals` undefined on the detection-throw branch — the *data-integrity* half, correct and locked). It does **NOT** touch `main()`'s `detectionFailures` accumulation or the new exit-code decision, which is the *entire point* of AGG-C3-04 (a CI/cron wrapper keying on exit code must see non-zero when every row's detection failed). All other `detectionFailures` assertions in the suite are against the *in-app runner* (`admin-backfill-runner.ts`), asserting `=== 0` — none cover the sidecar exit path.
- **Concrete scenario:** a refactor of `main()` drops the `|| detectionFailures > 0` clause (e.g. consolidating exit logic). Every test stays green; the sidecar silently returns 0 on an all-detection-failure run again — the exact AGG-C3-04 regression, undetected. CI wrapper sees green while color metadata went stale gallery-wide.
- **Suggested fix (TDD-friendly):** `main()` calls `process.exit()` directly (hard to unit-test in-process), so extract the decision into a tiny pure helper, e.g. `computeBackfillExitCode({ errors, detectionFailures }): 0 | 1`, and unit-test the matrix (`{0,0}→0`, `{0,3}→1`, `{2,0}→1`, `{1,1}→1`). Have `main` call the helper. Net-new but small; it converts a load-bearing one-liner from "untested" to "locked."
- **Confidence:** Medium (the fix is correct at HEAD; this is a durability gap on a freshly-shipped fix, not a live defect).

---

## Verified-OK (closed / adequately covered — recorded to prevent re-flagging)

- **AGG-C3-03 ORCH-C3-TMPDIR — FIX HELD.** `process-topic-image.test.ts` sets `TOPIC_RESOURCES_ROOT` via `vi.hoisted()` *before* module-eval and `afterAll` does `fs.rm(topicResourcesDir, {recursive:true})`. Verified empirically: ran the file isolated (12 tests pass) with a before/after snapshot of `public/resources/` — count unchanged (no new leak), and no `gk-topic-res-*` tmpdir survived. The two stray `public/resources/*.webp` (mtime 18:05, pre-dating my 20:53 run) are **pre-fix orphans and are gitignored** (`.gitignore:51 /public/resources/*`, confirmed `!!` in `git status --ignored`). They are harmless debris, NOT a live leak and NOT a tracked-tree regression. (Optional one-time hygiene: `rm` the two orphans; not a code issue.)
- **AGG-C3-03 sibling (uploads-family leak) — still a deferred hygiene-only item, NOT a flake.** The `.nfs.*` files under `public/uploads/{avif,webp,jpeg}` are stale NFS handles dated Apr/May, unrelated to this run. The uploads-family tests (`process-image-color-roundtrip` etc.) write into gitignored `public/uploads/*` and rely on per-id `afterAll` unlink; this remains AGG-C3-03's deferred sibling — confirmed it is a hygiene concern only (those dirs are gitignored, so no tracked-tree dirtying, no flake). No change in disposition.
- **AGG-C3-18 (re-export layering) — covered.** `actions/images.ts:29` now imports `isWideGamutPrimary` from the client-safe `@/lib/color-primaries`; `color-detection.ts` no longer re-exports it. Predicate wiring locked by `wide-gamut-predicate-wiring.test.ts` + `is-p3-pipeline.test.ts` (Part-2 source-inspection consumer list) + `wide-gamut-primaries.test.ts`.
- **Env overrides — covered.** `TOPIC_RESOURCES_ROOT` exercised implicitly by the topic-image suite; `UPLOAD_ROOT`/`UPLOAD_ORIGINAL_ROOT` by `upload-paths.test.ts`; `BACKFILL_CONCURRENCY` by `admin-backfill-concurrency-cap.test.ts`.
- **AGG-C3-02 (histogram contrast) / AGG-C3-05 / AGG-C3-06 / AGG-C3-07** — presentational CSS-token and comment/docstring fixes; not meaningfully unit-testable and not worth net-new coverage. No action.
- **HARD GUARD honored:** did not propose activating CLIP semantic search.

## Do-NOT-re-report (prior-cycle deferred, reasoning confirmed still valid)

AGG-C3-19 (processing-claim race harness), AGG-C3-20 (untested admin-mutation actions: `updateGallerySettings`, login/updatePassword, smart-collection CRUD, `backfillClipEmbeddings`), AGG-C3-21 (`analytics-data.ts` no tests), AGG-C3-22 (`data-tag-names-sql.test.ts` rebuilds query inline), AGG-C3-23 (e2e gaps). All remain legitimately deferred; their exit criteria are unchanged. Honest convergence on these is valid.

---

## Disposition

| ID | Severity | Conf | Recommendation |
|----|----------|------|----------------|
| TE-C4-01 | HIGH | High | **FIX THIS CYCLE** — flake reproduced live; one-file fix using the repo's existing `vi.waitFor({timeout,interval})` + completion-poll pattern. |
| TE-C4-02 | MEDIUM | High | FIX or PLAN — regression test for Switch geometry; the just-fixed user-visible defect has zero guard. |
| TE-C4-03 | MEDIUM | Medium | PLAN — extract `computeBackfillExitCode` + unit-test it; locks the untested half of AGG-C3-04. |

Prioritize **TE-C4-01**: it is the only finding where the harm (a real bootstrap regression dismissed as "the usual flake") is already live, the fix is small, and the correct pattern is already proven elsewhere in this very suite.
