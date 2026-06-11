# Plan 295 — Run-4 Cycle 12 fixes

**Source review:** `.context/reviews/run4-cycle12/_aggregate.md`

One scheduled correctness fix this cycle (HIGH — non-deferrable per the
deferred-fix rules). Repo policy applies: GPG-signed commits, Conventional
Commits + gitmoji, no `--no-verify`, all gates green before push, per-cycle
deploy.

---

## Task 1 — COR-R4C12-01: un-deadlock the restore quiesce (pause→clear→onIdle)

**File:** `apps/web/src/lib/image-queue.ts`
(`quiesceImageProcessingQueueForRestore`, lines 673-694). Caller:
`apps/web/src/app/[locale]/admin/db-actions.ts:334`.

**Defect:** the function runs `queue.pause(); await queue.onIdle();
queue.clear();`. p-queue 9.1.2 emits `idle` only when
`size === 0 && pending === 0` (`#tryToStartAnother`, and `clear()` itself).
A PAUSED queue never starts queued tasks, so `size` cannot reach 0 by
draining — and `clear()` (the only other `idle` emitter) sits AFTER the
await. With ≥1 queued job (batch-upload N≥2 photos at the default
QUEUE_CONCURRENCY=1, then restore while processing), `await onIdle()` never
resolves. The hung `restoreDatabase` action never reaches its `finally`:
`endRestoreMaintenance()` never runs (uploads, processing enqueue, and
view-count buffering stay suppressed process-wide), the `LOCK_DB_RESTORE`
and upload-contract pooled connections (2 of 10) are held forever, and every
subsequent restore fails fast with `restoreInProgress`. Recovery requires a
container restart. Introduced by `c6627ec8` (2026-05-06), which replaced the
original deadlock-free `onPendingZero()` (emitted unconditionally when
`pending` hits 0, pause-independent) on an inverted reading of p-queue's
semantics; the sibling `drainProcessingQueueForShutdown` got the safe
clear-before-await order in the same commit, which is why only quiesce
deadlocks.

**Fix:** reorder quiesce to the proven drain shape — `queue.pause();
queue.clear();` then the existing state clears, then `await queue.onIdle();`
last. Post-conditions unchanged: no job is running when `runRestore` begins
(the in-flight job's completion fires `#tryToStartAnother` → `size===0 &&
pending===0` → `idle`); queued jobs are intentionally dropped (they were
cleared after the await before) and re-discovered by the post-restore
bootstrap (`bootstrapped = false` is already set). New-job interleaving
between `clear()` and `onIdle()` is impossible: `beginRestoreMaintenance()`
precedes quiesce, so `enqueueImageProcessing` rejects, and the queue is
paused. Signature (`Pick<PQueue, 'pause' | 'clear' | 'onIdle'>`) unchanged.

**Tests (TEST-R4C12-01, folded in):** extend
`apps/web/src/__tests__/queue-shutdown.test.ts` (or a sibling
`image-queue-quiesce.test.ts`) with behavioral tests that inject a fake
queue via the existing parameters:
1. **Paused-queue semantics model:** fake `onIdle` REJECTS (fails fast — no
   suite hang) unless `clear()` was called first, modeling p-queue 9.1.2's
   reachability on a paused non-empty queue. Pre-fix source fails; post-fix
   passes.
2. **Call-order assertion:** record call sequence; expect
   `pause` → `clear` → `onIdle`, and expect state clears
   (enqueued/retryCounts/claimRetryCounts/lastErrors/permanentlyFailedIds,
   bootstrapped=false, cursor=null, bootstrapRetryTimer cleared) to hold
   after resolution.
Both proven failing against the pre-fix source.

**Acceptance:**
- New tests pass; the pre-existing quiesce fixture
  (`image-queue-permanent-failure.test.ts` — clears permanentlyFailedIds)
  still passes; full vitest suite green.
- All 8 gates green (eslint, typecheck, vitest, api-auth, action-origin,
  public-route-rate-limit, build, e2e).
- Commit body records the corrected p-queue semantics (DOC-R4C12-02) so the
  inverted claim in `c6627ec8`'s message has a discoverable correction.

**Status:** ⏳ pending (PROMPT 3 of this cycle).

---

## Non-scheduled items

DOC-R4C12-01 resolves via this code fix (the CLAUDE.md restore-recovery
claim becomes true again — no doc edit). DES-R4C12-A resolves via this fix
(the unbounded spinner was the backend hang; no client-side timeout wanted).
OBS-R4C12-B/C/D/E are recorded in `plan-296-run4-cycle12-deferred.md`.

## Regression review of cycle-11 commit — no follow-on work

`17b18321` independently re-verified SOUND at line level (entry-null
precedes guard; early-branch re-arm respects backoff; finally guard cannot
double-arm). The flush-machine pattern does not recur elsewhere in `src/`.

## Deploy record

- ⏳ pending — recorded after the per-cycle deploy completes.
