# Plan 354 — Run 6 / Cycle 4 — Fixes

**Source:** `.context/reviews/_aggregate.md` (cycle 4, HEAD f8147868) + 11 per-agent reviews.
**Status:** COMPLETE — all 5 tasks implemented, committed, pushed. Gates green.
**Repo policy:** GPG-signed commits (`-S`), conventional + gitmoji, no `--no-verify`, `git pull --rebase` before push, fine-grained commits (one per fix), push after every commit, run `npm run typecheck --workspace=apps/web` before committing test changes. Per-cycle deploy via `npm run deploy` after all gates green.

This plan schedules the 5 actionable findings from cycle 4. Every other review finding is the prior-cycle deferred register (`plan-353-run6-cycle3-deferred.md`), re-confirmed factually correct at HEAD by the relevant specialist agents and carried forward unchanged — see `plan-355-run6-cycle4-deferred.md`. No finding silently dropped. No NEW deferrals this cycle (all 5 new findings are scheduled here).

**HARD GUARD:** CLIP semantic search stays disabled-by-design. No task here touches `semantic_search_mode`, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, weight seeding, or `--production` backfill.

---

## TASK 1 — image-queue-bootstrap.test.ts is flaky under full-suite load [AGG-C4-01]

**Severity:** HIGH. **Confidence:** High.
**File:** `apps/web/src/__tests__/image-queue-bootstrap.test.ts:165`

**Problem:** Test 2 ("continues scanning after the previous batch cursor so later rows are not starved") does `await vi.waitFor(() => expect(limitMock).toHaveBeenCalledTimes(2))` with **no explicit timeout** → Vitest's `vi.waitFor` defaults to ~1000 ms. The 2nd `limit()` call is fired by a bootstrap continuation scheduled off a `queueOnIdle` promise resolution; under a contended full 233-file suite run (sharp/clip/db transitive import graphs competing for CPU) the continuation can land after the 1 s default, so the wait times out and the test fails. Reproduced empirically: isolated 3/3 pass in ~3.4 s; full-suite run failed ~50% in this file (2 failed / 2163 passed in one run, 0 failed in an immediate re-run at the same HEAD with no code change → confirmed non-deterministic). A flaky gate is a live problem: a real continuation regression would be dismissed as "the usual flake," and green CI stops being trustworthy.

**Repo has the fix pattern already:** `admin-backfill-runner-*.test.ts` uses `vi.waitFor(..., { timeout: 20_000, interval: 25 })` + completion-signal polling, documented there as the R4C1 fix for this exact flake class. The bootstrap suite was never migrated.

**Implementation:**
1. Add an explicit generous timeout + small interval to the `vi.waitFor` at `:165`: `await vi.waitFor(() => expect(limitMock).toHaveBeenCalledTimes(2), { timeout: 20_000, interval: 25 })`.
2. Consider keying the wait on the deterministic end-state in addition to the call count — assert `getProcessingQueueState().bootstrapped === true` (which test 2 already asserts at `:170` AFTER the waitFor) — but the minimal correct fix is the explicit timeout. Do NOT inflate global test timeouts; fix the one under-specified wait.
3. Re-run the FULL suite (`npm test --workspace=apps/web`) at least twice to confirm the flake no longer reproduces and the working tree stays clean.

**Acceptance:** Two consecutive full-suite runs pass with 0 failures in `image-queue-bootstrap.test.ts`; the `vi.waitFor` at `:165` carries an explicit timeout. No global timeout change.

**Status:** DONE

---

## TASK 2 — Switch geometry regression test [AGG-C4-02]

**Severity:** MEDIUM. **Confidence:** High.
**File:** new fixture under `apps/web/src/__tests__/` (pin `apps/web/src/components/ui/switch.tsx`)

**Problem:** The cycle-3 half-on-switch fix (AGG-C3-01, commit a3b8c557) rests on a silent Tailwind arithmetic coincidence: visible track `w-11` (44px) + `px-0.5` → 40px inner; `size-5` thumb (20px); `translate-x-full` (= 100% of the thumb's own 20px width = exactly the 40−20 remaining travel) → flush edge-to-edge. A future edit changing the thumb to `size-6`, the track padding, or the travel class silently re-introduces the half-on defect: the touch-target audit only checks the ≥44px hit-zone (still green), and the unit suite has nothing pinning the visible geometry.

**Implementation:** Add a source-inspection fixture (mirror the `touch-target-audit.test.ts` / `sw-template-contract.test.ts` static-scan pattern — read the file, assert on class presence). Pin the load-bearing geometry triple so a regression is a red test:
- Visible track is `w-11` and `px-0.5` (44px outer, 40px inner).
- Thumb is `size-5` (20px).
- Thumb travel is `translate-x-full` for the checked state and `translate-x-0` for unchecked.
- Root retains `min-h-11`/`min-w-11` (the 44px hit-zone — belt-and-braces alongside the audit).

Add a comment block in the test explaining WHY the triple must co-vary (the 40−20=20=100%-of-thumb-width arithmetic) so a future maintainer who legitimately changes the geometry knows to update all three together.

**Acceptance:** New test passes at HEAD; flipping any one of the three classes in a scratch edit makes it fail. `npm run typecheck --workspace=apps/web` clean (test-file types gate through `tsconfig.typecheck.json`).

**Status:** DONE

---

## TASK 3 — Sidecar backfill main() exit-code: extract + test [AGG-C4-03]

**Severity:** MEDIUM. **Confidence:** High.
**File:** `apps/web/scripts/backfill-color-pipeline.ts:485` (exit-code expression) + test `apps/web/src/__tests__/backfill-detection-failure-contract.test.ts` (or a new sibling)

**Problem:** The cycle-3 fix (AGG-C3-04, commit a033056d) added `process.exit(errors > 0 || detectionFailures > 0 ? 1 : 0)` at `:485` — the exit-code/summary behavior is the entire point of the fix, yet no test exercises `main()`'s counting or the exit-code computation. `backfill-detection-failure-contract.test.ts` only pins `reprocessRow`'s `derivativeOnly` return (the data-integrity half).

**Implementation:**
1. Extract a pure exported helper `computeBackfillExitCode({ errors, detectionFailures }: { errors: number; detectionFailures: number }): 0 | 1` from the `:485` expression (module-level export, mirroring `collectDeletedMidReencodeFiles`/`cleanupDeletedMidReencodeVariants` already exported for the same testability reason at `:404-405`). Call it from `main()`.
2. Add a unit test (extend `backfill-detection-failure-contract.test.ts` or a new `backfill-exit-code.test.ts`) covering the matrix: `{0,0}→0`, `{errors:2,0}→1`, `{0,detectionFailures:3}→1`, `{errors:1,detectionFailures:1}→1`.
3. This pairs with TASK 4 — the same test should also pin the corrected `detectionFailures` accounting once TASK 4 lands.

**Acceptance:** `computeBackfillExitCode` exported + used in `main()`; matrix test green; existing backfill tests still green; typecheck clean.

**Status:** DONE

---

## TASK 4 — Sidecar detectionFailures not decremented for deleted-mid-reencode rows [AGG-C4-04]

**Severity:** LOW. **Confidence:** High.
**File:** `apps/web/scripts/backfill-color-pipeline.ts:413-414` (flushBatch deleted-mid-reencode partition) vs `:439` (per-row `detectionFailures++`)

**Problem:** `detectionFailures++` fires per-row in the queue task when `result.derivativeOnly` is set (`:439`). In batched `flushBatch`, rows whose `UPDATE` affected 0 rows are reclassified as deleted-mid-reencode and `processed` is decremented + `deletedMidReencode` incremented (`:413-414`), but `detectionFailures` is never walked back. A row that had detection fail after a successful encode (→ counted) AND was then deleted before its derivative UPDATE committed leaves `detectionFailures > 0` for a row that no longer exists, so `process.exit(... detectionFailures > 0 ...)` at `:485` exits non-zero spuriously — a CI/cron wrapper needlessly retriggers an idempotent backfill. Bounded, NOT data-integrity (resume contract intact; the row was correctly deleted). In-app runner is clean (mutually-exclusive `deleted-mid-reencode` vs `detection-failed` outcomes); the asymmetry is a sidecar-only artifact of batching DB writes decoupled from the per-row encode.

**Implementation:**
1. In `flushBatch`, when partitioning `derivativeBatch`/`updateBatch` into the deleted-mid-reencode set, detect how many of the deleted rows came from the `derivativeBatch` (i.e. were detection-failures) and subtract that overlap from `detectionFailures`. The `derivativeBatch` entries are the ones that incremented `detectionFailures`, so the partition that maps deleted rows back to their source batch gives the exact decrement. Keep `deletedMidReencode`/`processed` adjustments as-is.
2. Verify the final summary line (`:464`) and WARN (`:470`) reflect the corrected `detectionFailures`.
3. Add/extend a test (alongside TASK 3) asserting: a batch where a detection-failed row is also deleted-mid-reencode ends with `detectionFailures` net-zero for that row and the exit code reflects the corrected count. Reuse the existing `collectDeletedMidReencodeFiles`/deleted-mid-reencode test harness (`backfill-color-pipeline-deleted-mid-reencode.test.ts`) if it already exercises this partition.

**Acceptance:** A row that is both detection-failed and deleted-mid-reencode no longer leaves `detectionFailures` elevated; exit code correct; deleted-mid-reencode + detection-failure tests green; typecheck clean.

**Status:** DONE

---

## TASK 5 — switch.tsx:14 header comment cites wrong travel class [AGG-C4-05]

**Severity:** LOW / cosmetic. **Confidence:** High (6-agent corroboration — highest of the cycle).
**File:** `apps/web/src/components/ui/switch.tsx:13-14`

**Problem:** The top docblock (`:13-14`) says the thumb travels via `translate-x-[calc(100%-2px)]`, but the shipped code (`:49`) uses `translate-x-full`, and the inline comment (`:41-44`) correctly documents `translate-x-full`. **The CODE is correct** — `translate-x-full` (100% of the thumb's own 20px width) is exactly right for the 40px inner box; `calc(100%-2px)` would under-travel by 2px. So fix the COMMENT, not the code. Six independent review agents tripped over this same line — it is actively misleading the next reader.

**Implementation:** Edit the `:13-14` header comment to cite `translate-x-full` (the actual shipped class) instead of `translate-x-[calc(100%-2px)]`. Keep the rest of the explanation intact. Do NOT touch line 49 or any code.

**Acceptance:** Header comment matches the code (`translate-x-full`); no code change; typecheck + touch-target audit still green.

**Status:** DONE

---

## Gate requirements (all tasks)

Before commit+push and deploy, the full repo must pass:
- `npm run lint --workspace=apps/web` (ESLint)
- `npm run typecheck --workspace=apps/web`
- `npm test --workspace=apps/web` (Vitest) — run TWICE for TASK 1 to confirm the flake is gone
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`

Errors are blocking. No suppressions unless repo rules authorize (quote in commit body). Warnings best-effort; defer with a note if not cleanly fixable.

## Progress log
- TASK 5 (switch comment): `24159f36` — header comment cites `translate-x-full` (the shipped, correct class) instead of `translate-x-[calc(100%-2px)]`; code untouched.
- TASK 1 (image-queue flake): `6ab40644` — explicit `{ timeout: 20_000, interval: 25 }` on the bootstrap-continuation `vi.waitFor` + keyed on `bootstrapped` end-state; full suite ran twice with 0 failures.
- TASK 2 (switch geometry test): `9a262e3f` — new `switch-geometry-contract.test.ts` static source-scan pinning the w-11/px-0.5/h-6 + size-5 + translate-x-0/translate-x-full triple; verified non-vacuous (reverting to translate-x-5 flips it RED).
- TASK 3 + TASK 4 (backfill exit code + accounting): `1fd350be` — extracted pure `computeBackfillExitCode` + `countDeletedMidReencodeDetectionFailures`; flushBatch now decrements detectionFailures for detection-failed∩deleted rows; matrix + source-shape tests added (backfill suite 23/23 green).
- Gates: ESLint, typecheck (app+scripts), full Vitest (run twice — flake gone), lint:api-auth, lint:action-origin, lint:public-route-rate-limit — all green (see end-of-cycle verification).
