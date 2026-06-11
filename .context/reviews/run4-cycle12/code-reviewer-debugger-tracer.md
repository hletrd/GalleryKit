# Run-4 Cycle 12 — code-reviewer / debugger / tracer angle

Single-subagent constraint (same as run2/run3/run4-c1..c11): nested Agent
spawning is unavailable in this orchestrator context, so this angle ran as a
distinct full-inventory in-context pass. No sampling.

## Inventory examined
- Regression review (line level) of the cycle-11 fix commit `17b18321`
  (`lib/data.ts` flush entry-null + isFlushing re-arm) and its locking test.
- Rotation to the least-run-4-covered shutdown/maintenance surface:
  `lib/image-queue.ts` (full read: claim machine, retry/permanent-failure
  bookkeeping, bootstrap cursor, quiesce/resume), `lib/queue-shutdown.ts`,
  `lib/restore-maintenance.ts`, `app/[locale]/admin/db-actions.ts`
  (restore lock + maintenance window), `lib/upload-processing-contract-lock.ts`.
- Upload quota path: `lib/upload-tracker.ts`, `lib/upload-tracker-state.ts`,
  `lib/upload-limits.ts`, `app/actions/images.ts` (uploadImages full flow).
- Serving path: `lib/serve-upload.ts`. Sessions: `lib/session.ts`.
  Datetime helpers: `lib/exif-datetime.ts`, `lib/mysql-datetime.ts`.
  PAT lib: `lib/admin-tokens.ts`. Middleware: `proxy.ts`.
- Authoritative dependency source: `node_modules/p-queue` (v9.1.2)
  `dist/index.js` — `onIdle`, `onPendingZero`, `clear`, `#tryToStartAnother`,
  `#next` event-emission sites read line-by-line.
- Pattern sweeps: other `setTimeout`-armed flush machines (only `data.ts`
  has one — the COR-R4C11-01 pattern does NOT recur elsewhere); floating
  promises in the queue job (none unhandled); unradixed parseInt (none new).

## Regression review of cycle-11 commit — SOUND
`17b18321` verified at line level in `lib/data.ts:63-88`:
- Entry-null (`viewCountFlushTimer = null`) now precedes the `isFlushing`
  guard, so a timer firing mid-flush can no longer strand a stale handle.
- The isFlushing branch re-arms via `getNextFlushInterval()` (backoff
  respected) and `.unref?.()`. After the in-flight flush ends, its
  finally-guard (`!viewCountFlushTimer`) correctly skips because the re-armed
  handle is live — no double-arm.
- If the buffer is empty at the early-return, no timer is armed and the
  in-flight flush's finally re-arms if needed. All paths converge.
No follow-on work required.

## FINDINGS

### COR-R4C12-01 — restore quiesce deadlocks on a non-empty paused queue (HIGH / High confidence — CONFIRMED from dependency source)

**File:** `apps/web/src/lib/image-queue.ts:673-694`
(`quiesceImageProcessingQueueForRestore`), caller
`apps/web/src/app/[locale]/admin/db-actions.ts:334`.

**Code region:**
```ts
queue.pause();
await queue.onIdle();   // <-- hangs forever if queue.size > 0
queue.clear();
```

**Why it is a problem.** p-queue 9.1.2 emits `idle` ONLY when
`queue.size === 0 && pending === 0` (`#tryToStartAnother`,
`dist/index.js:224-240`; `clear()`, `dist/index.js:489-493`). A paused queue
never starts queued tasks, so `size` can never reach 0 by draining — the only
remaining `idle` emitter is `clear()`, which this function calls AFTER the
`await`. Therefore: if ≥1 job is queued (not yet started) when quiesce runs,
the in-flight job (if any) completes, `pendingZero` fires, but `idle` never
does — `await queue.onIdle()` never resolves.

**Causal trace (tracer).** Introduced by commit `c6627ec8` (2026-05-06,
"use onIdle instead of onPendingZero for quiescence and shutdown"). The
commit message asserts "queue.onPendingZero() only waits for queued (not
active) jobs" — that is INVERTED. p-queue's own doc-comment and source say
the opposite: `onPendingZero` "only waits for currently running tasks to
finish, ignoring queued tasks", and `pendingZero` is emitted unconditionally
in `#next()` when `--pending === 0` (`dist/index.js:149-151`) — pause-state
and queue-size independent. The ORIGINAL `pause(); await onPendingZero();
clear();` was deadlock-free and exactly matched the quiesce intent (stop new
starts, wait for the in-flight Sharp job, drop queued work). The same commit
changed `drainProcessingQueueForShutdown` too, but THAT function's order is
`pause(); clear(); await onIdle()` — clear-before-await — which is why the
shutdown path does not deadlock and why the bug hid in quiesce only.

**Concrete failure scenario.** `QUEUE_CONCURRENCY` defaults to 1. Admin
batch-uploads N ≥ 2 photos → 1 job pending (in-flight in Sharp), N−1 queued.
Admin starts a DB restore while the spinner is still running (the natural
"restore right after I imported the wrong batch" moment):
1. `restoreDatabase` acquires `LOCK_DB_RESTORE` (pooled conn held) and the
   upload-processing-contract lock (second pooled conn held).
2. `beginRestoreMaintenance()` sets the process-global maintenance flag.
3. `quiesceImageProcessingQueueForRestore()` pauses the queue and awaits
   `onIdle()` → **hangs forever** (queued jobs can never start or drain).
4. The `finally` at `db-actions.ts:341` is never reached:
   `endRestoreMaintenance()` never runs, both advisory-lock connections stay
   checked out of the 10-connection pool forever, and the restore request
   never responds.
5. Process-wide consequences while wedged: every upload fails
   (`restoreInProgress` / late-maintenance cleanup), `enqueueImageProcessing`
   ignores all jobs, `bufferGroupViewCount` no-ops, every subsequent restore
   attempt fails fast with `restoreInProgress`. Only a container restart
   recovers. Note this also falsifies the CLAUDE.md claim "a crashed restore
   never wedges the next attempt" — a HUNG restore (this mode) wedges
   everything because the connection never closes.

**Suggested fix.** Reorder quiesce to mirror the proven drain order:
`pause(); clear(); state.enqueued.clear(); …; await queue.onIdle();`. With
clear-first, `clear()` empties `size` and emits `empty` (+ `idle` when
`pending === 0`); when an in-flight job finishes later, `#tryToStartAnother`
sees `size === 0 && pending === 0` and emits `idle`. All paths resolve, and
the post-quiesce guarantee (no job running when `runRestore` begins) is
unchanged. Queued-job loss is the intended semantic — quiesce already cleared
them after the await, and the restore resets `bootstrapped = false` so the
post-restore bootstrap re-discovers any `processed = false` rows.
(Equivalent alternative: revert to `onPendingZero()` — rejected only to keep
ONE quiesce/drain mental model and the existing `onIdle`-based signature.)

New-job interleaving between `clear()` and `onIdle()` is impossible:
`beginRestoreMaintenance()` ran before quiesce, so `enqueueImageProcessing`
rejects, and the queue is paused anyway.

**Confidence: High.** Verified directly against the installed p-queue source,
not docs alone. CONFIRMED issue (not merely likely).

### OBS-R4C12-C — claim-retry timers survive quiesce untracked (LOW / Medium, observation)
`image-queue.ts:275-278`: the per-job claim-retry `setTimeout` handles are
not stored in state, so `quiesceImageProcessingQueueForRestore` cannot cancel
them; one can fire mid- or post-restore. Harmless today: the re-enqueue
re-checks `isRestoreMaintenanceActive()` (mid-restore → ignored) and the
post-restore path re-validates the row via the `processed = false` claim
check before doing any work. Recorded so a future refactor does not remove
either guard without revisiting this. No action this cycle.

### OBS-R4C12-D — tautological guard in the c11 re-arm branch (INFO)
`lib/data.ts:83`: inside the isFlushing early-return branch,
`!viewCountFlushTimer` is always true (the handle was nulled at entry three
lines above). Dead condition kept for symmetry with the other two arm sites;
zero behavioral impact. Not worth a churn commit; note only.

## Final sweep
- No other `pause()`+`onIdle()` orderings exist
  (`drainProcessingQueueForShutdown` is clear-before-await; the backfill
  runner awaits `onIdle()` on a RUNNING queue, which drains normally).
- `admin-backfill-runner.ts` onIdle usage re-checked: queue not paused there.
- No relevant file in the rotation surface was skipped.
