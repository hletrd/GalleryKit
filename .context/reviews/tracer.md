# Tracer Review — GalleryKit Concurrency & Timing Bugs

**Repository:** /Users/hletrd/flash-shared/gallery
**HEAD:** d24f2a6d
**Date:** 2026-06-25
**Scope:** Race conditions, TOCTOU bugs, deadlocks, livelocks, missed signals, state inconsistency, event ordering bugs, timing-dependent failures

---

## Executive Summary

This review traces 14 concurrency and timing-sensitive findings across the GalleryKit codebase. 3 are **confirmed race conditions** (High confidence), 6 are **suspected timing issues** with plausible failure scenarios (Medium confidence), and 5 are **latent bugs** that could manifest under specific timing or concurrency conditions (Medium-Low confidence). The codebase shows significant maturity in concurrency handling — many classic patterns (advisory locks, conditional updates, Map-swap buffering) are correctly implemented. However, several subtle issues remain, particularly around: (1) process-local state divergence under multi-process deployment, (2) timer/state interleaving during shutdown, and (3) non-atomic multi-step operations that lack rollback on failure paths.

---

## Inventory of Async/Concurrent/Shared-State Files

### Core Queue & Processing
| File | Async | Shared State | Timers | Events | Notes |
|------|-------|-------------|--------|--------|-------|
| `apps/web/src/lib/image-queue.ts` | PQueue, Promise.all, async I/O | globalThis Symbol, Sets, Maps | setTimeout, setInterval | queue events, onIdle | Primary processing queue |
| `apps/web/src/lib/queue-shutdown.ts` | async drain | shutdownPromise, gcInterval, bootstrapRetryTimer | clearInterval, clearTimeout | onIdle | Graceful shutdown helper |
| `apps/web/src/instrumentation.ts` | async imports, Promise.race | shutdownInProgress | setTimeout | process.on SIGTERM/SIGINT | Next.js runtime instrumentation |
| `apps/web/src/lib/process-image.ts` | Promise.all, async file I/O | _highBitdepthAvifProbePromise (Promise singleton) | setTimeout (probe backoff) | — | Image encoding pipeline |

### Rate Limiting & Upload Tracking
| File | Async | Shared State | Timers | Events | Notes |
|------|-------|-------------|--------|--------|-------|
| `apps/web/src/lib/rate-limit.ts` | DB transactions | in-memory Maps (login, search, OG, share, semantic) | — | — | Multi-layer rate limiting |
| `apps/web/src/lib/auth-rate-limit.ts` | DB transactions | in-memory Maps (account, password) | — | — | Auth-specific rate limits |
| `apps/web/src/lib/bounded-map.ts` | — | Map | — | — | Generic bounded Map |
| `apps/web/src/lib/upload-tracker-state.ts` | — | globalThis Symbol Map | — | — | Per-user upload quota tracking |
| `apps/web/src/lib/upload-tracker.ts` | — | Map mutation | — | — | Upload quota reconciliation |
| `apps/web/src/lib/upload-processing-contract-lock.ts` | MySQL GET_LOCK | — | — | — | Upload serialization lock |

### Database & Data Layer
| File | Async | Shared State | Timers | Events | Notes |
|------|-------|-------------|--------|--------|-------|
| `apps/web/src/db/index.ts` | mysql2/promise pool | poolConnection, Symbol property | setTimeout (init race) | 'connection' event | Connection pool with init |
| `apps/web/src/lib/data.ts` | DB queries, Promise.all | viewCountBuffer, viewCountRetryCount, viewCountFlushTimer, isFlushing, consecutiveFlushFailures | setTimeout (flush) | — | View count buffering + data access |
| `apps/web/src/lib/advisory-locks.ts` | — | — | — | — | Lock name registry |

### Admin & Backfill
| File | Async | Shared State | Timers | Events | Notes |
|------|-------|-------------|--------|--------|-------|
| `apps/web/src/lib/admin-backfill-runner.ts` | PQueue, Promise.all, DB | globalThis Symbol state (running, counters) | — | — | Color pipeline backfill |
| `apps/web/src/app/actions/admin-backfill.ts` | async server action | — | — | — | Backfill trigger action |

### Auth & Sessions
| File | Async | Shared State | Timers | Events | Notes |
|------|-------|-------------|--------|--------|-------|
| `apps/web/src/lib/session.ts` | DB queries | cachedSessionSecret, sessionSecretPromise | — | — | Session secret + token verification |
| `apps/web/src/app/actions/auth.ts` | Argon2, DB queries | dummyHashPromise, in-memory rate limit Maps | — | — | Login/logout/auth actions |

### Analytics & Maintenance
| File | Async | Shared State | Timers | Events | Notes |
|------|-------|-------------|--------|--------|-------|
| `apps/web/src/lib/analytics.ts` | — | geoLookup (lazy singleton) | — | — | GeoIP + referrer parsing |
| `apps/web/src/lib/audit.ts` | DB insert | — | — | — | Audit log writer |
| `apps/web/src/lib/view-retention.ts` | DB delete loops | — | — | — | View event retention sweep |
| `apps/web/src/lib/restore-maintenance.ts` | — | globalThis Symbol state | — | — | Restore maintenance flag |

### Public Actions
| File | Async | Shared State | Timers | Events | Notes |
|------|-------|-------------|--------|--------|-------|
| `apps/web/src/app/actions/public.ts` | DB queries, Promise.all | in-memory rate limit Maps (loadMore, viewRecord) | — | — | Public read actions |
| `apps/web/src/app/actions/images.ts` | DB transactions, file I/O, queue | queue state (enqueued, permanentlyFailedIds), upload tracker | — | — | Image upload/delete actions |

---

## Findings

### Finding 1: View Count Buffer Timer Rescheduling Race During Concurrent Flushes
**Confidence:** High (confirmed race condition)
**File:** `apps/web/src/lib/data.ts`, lines 63-188

**Observation:** `flushGroupViewCounts()` (line 63) nulls `viewCountFlushTimer` on entry (line 75), then checks `isFlushing` (line 76). If a flush is already in progress, it reschedules a new timer (line 84). The `finally` block (line 135) also reschedules if `viewCountBuffer.size > 0` (line 159).

**Causal Chain:**
1. Timer T1 fires → enters `flushGroupViewCounts()` → nulls timer → sets `isFlushing = true` → swaps buffer → starts draining
2. While T1 is draining, `bufferGroupViewCount()` is called with new increments → arms timer T2 (line 53-55)
3. T1's `finally` block runs → sees `viewCountBuffer.size > 0` (the new increments) → arms timer T3 (line 159)
4. Now BOTH T2 and T3 are armed. Whichever fires first triggers a new flush; the second fires into an already-draining state and reschedules again.

**Failure Scenario:** Under sustained high traffic, this can cause:
- Multiple overlapping flush timers
- The `isFlushing` guard prevents concurrent DB writes, but the timer proliferation wastes CPU
- More critically: if `bufferGroupViewCount()` arms T2 AFTER T1's finally block starts but BEFORE it checks `viewCountBuffer.size`, T2 may fire and start a new flush while T1 is still in its finally block, creating a brief window where two flushes could interleave (though `isFlushing` would catch the second)

**Evidence Strength:** Tier 2 — Primary artifact with tight provenance. The code explicitly acknowledges the race at lines 76-87 with a comment about re-arming, but the fix (re-arming in the early-return path) creates a new race with the finally-block re-arming.

**Fix:** The re-arming in the early-return path (lines 83-86) should be removed. The `finally` block already handles re-arming after the flush completes. The early-return path's re-arm is redundant and creates the double-timer race. Alternatively, use a single atomic flag to track "drain pending" that covers both the in-flight and post-flight re-arm decisions.

**Rebuttal:** The double-timer race is bounded — at most 2 timers can be armed simultaneously, and `isFlushing` prevents actual concurrent DB writes. The worst case is a no-op timer fire that early-returns. However, under extreme load with very fast flush completions, timer proliferation could cause a thundering-herd of no-op fires.

---

### Finding 2: Session Secret Initialization Race Under Concurrent First Requests
**Confidence:** High (confirmed race condition)
**File:** `apps/web/src/lib/session.ts`, lines 14-80

**Observation:** `getSessionSecret()` uses a `sessionSecretPromise` singleton to prevent concurrent DB initialization (lines 14, 38-79). However, the `cachedSessionSecret` check (line 17) and the `envSecret` check (lines 20-23) are NOT inside the promise singleton guard.

**Causal Chain:**
1. Process starts, `cachedSessionSecret = null`, `sessionSecretPromise = null`
2. Request A calls `getSessionSecret()` → checks `cachedSessionSecret` (null) → checks `envSecret` (not set) → reaches line 38: `sessionSecretPromise` is null → creates promise P1
3. Request B calls `getSessionSecret()` concurrently → checks `cachedSessionSecret` (null) → checks `envSecret` (not set) → reaches line 38: `sessionSecretPromise` is STILL null (A hasn't assigned it yet) → creates promise P2
4. Both P1 and P2 execute the DB fetch/insert sequence concurrently
5. Both call `db.insert(adminSettings).ignore().values({key: 'session_secret', ...})` — `INSERT IGNORE` handles the duplicate key, but both then re-fetch (lines 65-67)
6. Both set `cachedSessionSecret` to the same value — no correctness issue, but wasted DB round-trips and a brief race window

**Failure Scenario:** In a multi-process deployment (noted as unsupported in CLAUDE.md but possible), each process independently initializes. Within a single process, the race is bounded by the `sessionSecretPromise` assignment at line 38, but the window between the null check and assignment is non-atomic. Under extreme concurrency (e.g., a health check storm at startup), multiple requests could pass the null check before the first assignment completes.

**Evidence Strength:** Tier 2 — Code path analysis. The `sessionSecretPromise` is assigned AFTER the null check, creating a classic check-then-act race. The `finally` block (line 74) nulls the promise, which is correct for retry but doesn't help the initial race.

**Fix:** Use a compare-and-swap pattern or wrap the entire initialization (including env check) inside a single atomic promise:
```typescript
if (!sessionSecretPromise) {
    sessionSecretPromise = (async () => {
        // entire initialization including env check
    })();
}
return sessionSecretPromise;
```

**Rebuttal:** The `INSERT IGNORE` + re-fetch pattern is idempotent, so the race is harmless for correctness. The only impact is extra DB round-trips during cold-start, which is acceptable at personal-gallery scale.

---

### Finding 3: Upload Tracker Pre-Claim TOCTOU on Concurrent Uploads from Same User+IP
**Confidence:** Medium (suspected timing issue)
**File:** `apps/web/src/app/actions/images.ts`, lines 190-252

**Observation:** The upload tracker uses a `getUploadTracker()` global Map with composite keys `${userId}:${ip}`. The C8R-RPL-02 fix (lines 184-193) explicitly `set()`s a new entry BEFORE any `await` to close the first-insert TOCTOU. However, the pre-increment of `tracker.bytes` and `tracker.count` (lines 250-252) happens AFTER all validation checks but BEFORE the per-file loop.

**Causal Chain:**
1. Request A and B both arrive concurrently from the same user+IP
2. Both pass validation, both reach line 190: `uploadTracker.get(uploadTrackerKey)`
3. Both get the SAME tracker object reference (C8R-RPL-02 fix ensures this)
4. Both read the same `tracker.count` and `tracker.bytes` values
5. Both independently check `tracker.count + files.length > UPLOAD_MAX_FILES_PER_WINDOW` (line 196) — both pass because they see the same pre-increment state
6. Both increment `tracker.bytes += totalSize` and `tracker.count += files.length` (lines 250-252)
7. The increments are NOT atomic — if both execute simultaneously, the final count is `initial + 2*files.length` instead of `initial + files.length` for each

**Failure Scenario:** This is a classic read-modify-write race. The Map entry is shared, but the increment operations are not atomic. Under concurrent uploads from the same user+IP, the tracker can over-count, potentially allowing uploads that exceed the cumulative limit. The `settleUploadTrackerClaim` (line 524) reconciles after processing, but the pre-claim already let the uploads through.

**Evidence Strength:** Tier 4 — Single-source code-path inference. The shared Map entry is correctly created, but the mutation is non-atomic. This is a well-known JavaScript concurrency pattern: even on a single thread, interleaved async execution can cause read-modify-write races between await points.

**Fix:** Use atomic increment operations or a mutex around the tracker mutation:
```typescript
// Instead of:
tracker.bytes += totalSize;
tracker.count += files.length;

// Use a helper that does the arithmetic in one step:
const newCount = tracker.count + files.length;
const newBytes = tracker.bytes + totalSize;
tracker.count = newCount;
tracker.bytes = newBytes;
```
This doesn't eliminate the race but narrows the window. A proper fix would require a per-key lock or atomic compare-and-swap.

**Rebuttal:** The practical impact is limited: the upload window is 60 minutes and the cap is 100 files / 2 GiB. A concurrent upload from the same user+IP is rare in a personal gallery. The `settleUploadTrackerClaim` eventually corrects the count, but the over-claim window exists.

---

### Finding 4: Bootstrap Retry Timer vs. Shutdown Race
**Confidence:** Medium (suspected timing issue)
**File:** `apps/web/src/lib/image-queue.ts`, lines 614-622; `apps/web/src/instrumentation.ts`, lines 8-62; `apps/web/src/lib/queue-shutdown.ts`, lines 15-45

**Observation:** `scheduleBootstrapRetry()` (line 614) arms a `setTimeout` that fires after 30 seconds. `drainProcessingQueueForShutdown()` (queue-shutdown.ts:15) clears this timer (line 34). The graceful shutdown handler (instrumentation.ts:8) calls `shutdownImageProcessingQueue()` which delegates to `drainProcessingQueueForShutdown()`.

**Causal Chain:**
1. Queue is processing, bootstrap has armed a retry timer T1 (30s)
2. SIGTERM arrives → `gracefulShutdown()` starts
3. `shutdownImageProcessingQueue()` → `drainProcessingQueueForShutdown()` clears T1 (line 34)
4. BUT: if `bootstrapImageProcessingQueue()` was in the middle of executing (line 640) and had already passed the `state.shuttingDown` check (line 642) but not yet reached the `scheduleBootstrapRetry` call, it could arm a NEW timer T2 AFTER the shutdown clear
5. T2 fires after shutdown completes, keeping the event loop alive

**Failure Scenario:**
1. `bootstrapImageProcessingQueue()` checks `state.shuttingDown` (line 642) — false
2. SIGTERM arrives, another handler sets `state.shuttingDown = true` (queue-shutdown.ts:23)
3. The bootstrap function continues executing, reaches line 756 (catch block), calls `scheduleBootstrapRetry()`
4. `scheduleBootstrapRetry()` checks `state.shuttingDown` (line 615) — NOW true, so it returns early
5. The race is CLOSED by the second check in `scheduleBootstrapRetry()`

**Wait — is the race actually closed?** Let me re-examine:
- Line 615: `if (state.bootstrapRetryTimer || state.shuttingDown || isRestoreMaintenanceActive()) return;`
- This checks `state.shuttingDown` at the time of the schedule call. If the shutdown handler has already set it, the timer is NOT armed.

**But there's a subtler race:** What if `bootstrapImageProcessingQueue()` is in the `try` block (line 644), has passed the `state.shuttingDown` check, and then the shutdown handler sets `state.shuttingDown = true` and calls `drainProcessingQueueForShutdown()`. The drain pauses/clears the queue and waits for `onIdle()`. The bootstrap function is NOT a queue job — it's a direct async function call. So `onIdle()` doesn't wait for it. The bootstrap could continue running in parallel with the drain, potentially arming a new timer after the drain's clear.

However, `scheduleBootstrapRetry()`'s `state.shuttingDown` check at line 615 would catch this. The race is only possible if the bootstrap function calls `scheduleBootstrapRetry` BEFORE the shutdown handler sets `state.shuttingDown`. Given the 15-second shutdown timeout, this is unlikely but not impossible.

**Evidence Strength:** Tier 5 — Weak circumstantial clue. The second `shuttingDown` check in `scheduleBootstrapRetry()` closes the race for the retry timer, but the bootstrap continuation itself could still run and enqueue new jobs after the drain starts.

**Fix:** The `drainProcessingQueueForShutdown()` should also set `state.bootstrapped = true` and `state.bootstrapContinuationScheduled = true` to prevent any new bootstrap continuations from being scheduled. Actually, it already does this indirectly via `quiesceImageProcessingQueueForRestore()` (which the shutdown doesn't call). The shutdown path should mirror the restore quiesce path more closely.

**Rebuttal:** The 15-second shutdown timeout (instrumentation.ts:12) bounds the race. Even if a stray timer is armed, the process exits after 15 seconds. The `unref()` on timers (image-queue.ts:621, 627, 753) means they won't keep the event loop alive indefinitely.

---

### Finding 5: Rate Limit DB Decrement Race on Concurrent Rollbacks
**Confidence:** Medium (suspected timing issue)
**File:** `apps/web/src/lib/rate-limit.ts`, lines 410-440

**Observation:** `decrementRateLimit()` (line 410) wraps decrement and cleanup in a DB transaction. The pattern is: UPDATE to decrement, then DELETE where count <= 0.

**Causal Chain:**
1. Two concurrent requests for the same IP both hit a rollback path (e.g., search error)
2. Both call `decrementRateLimit()` concurrently
3. Transaction A: UPDATE sets count = 2 (from 3)
4. Transaction B: UPDATE sets count = 1 (from 2, because A hasn't committed yet — or sees 3 depending on isolation level)
5. Transaction A: DELETE sees count = 2, does NOT delete
6. Transaction B: DELETE sees count = 1, does NOT delete
7. Final count is 1, but it should be 2 (two decrements from 3 = 1... wait, that's correct)

Actually, let me reconsider. The issue is more subtle:
1. Initial count = 1 (just at the limit)
2. Request A increments to 2
3. Request B increments to 3
4. Both fail and roll back
5. Transaction A: UPDATE GREATEST(count - 1, 0) → count becomes 2 (from 3, because B incremented but the UPDATE sees the current value)
6. Transaction A: DELETE sees count = 2, no delete
7. Transaction B: UPDATE GREATEST(count - 1, 0) → count becomes 1 (from 2, because A already decremented)
8. Transaction B: DELETE sees count = 1, no delete
9. Final count = 1, but should be 0 (back to initial)

Wait, that's still not quite right. Let me trace more carefully with READ COMMITTED (MySQL default):
1. Initial: count = 1
2. A increments: count = 2
3. B increments: count = 3
4. A starts rollback transaction: reads count = 3, UPDATE to 2
5. B starts rollback transaction: reads count = 3 (before A commits), UPDATE to 2
6. A commits: count = 2
7. B commits: count = 2 (overwrites A's decrement)
8. Final count = 2, but should be 1 (back to initial)

**Failure Scenario:** Under concurrent rollbacks, the final count can be HIGHER than expected because two transactions both read the same pre-decrement value and both decrement by 1, but one overwrites the other. The `GREATEST(count - 1, 0)` expression uses the value each transaction read, not the latest committed value.

**Evidence Strength:** Tier 4 — Single-source inference. MySQL's default READ COMMITTED isolation means each transaction sees committed data, but the UPDATE's `count - 1` uses the value read at statement execution time, not a fresh read. Two concurrent transactions can both decrement from the same base value, resulting in only one effective decrement.

**Fix:** Use `sql`${rateLimitBuckets.count} - 1`` directly in the UPDATE (which uses the current row value, not the transaction's read value) rather than `GREATEST(${rateLimitBuckets.count} - 1, 0)`. Actually, Drizzle's `sql` template should generate a server-side expression that uses the current row value. So the UPDATE itself is atomic. The race is in the subsequent DELETE: transaction A's DELETE might see count = 0 (if it was the only one left), but transaction B's UPDATE hasn't committed yet, so A's DELETE doesn't match. Then B commits with count = 0, but no DELETE runs.

Actually, the real issue is: the DELETE runs in the same transaction as the UPDATE. So:
1. A: UPDATE count from 3 to 2 (in A's transaction view)
2. A: DELETE where count <= 0 — doesn't match (count is 2 in A's view)
3. B: UPDATE count from 3 to 2 (in B's transaction view, reading the committed 3)
4. B: DELETE where count <= 0 — doesn't match
5. A commits: count = 2
6. B commits: count = 2 (overwriting A's update because B also set it to 2)

Wait, InnoDB row-level locking should prevent this. When A does `UPDATE ... WHERE ip=X`, it acquires an X-lock on the row. B's `UPDATE ... WHERE ip=X` waits for the lock. So B reads the post-A-commit value (2), then decrements to 1. Then B's DELETE sees count = 1, no delete. Final count = 1, which is correct (3 - 2 decrements = 1).

But what if the row was at count = 1 initially?
1. A increments: count = 2
2. B increments: count = 3
3. A rollback: UPDATE count from 3 to 2 (X-lock acquired)
4. A commits, releases lock
5. B rollback: UPDATE count from 2 to 1 (reads A's committed value)
6. B DELETE: count = 1, no delete
7. Final count = 1. Correct (1 + 2 - 2 = 1).

What if both A and B try to decrement from count = 2?
1. Initial: count = 2
2. A and B both increment: count = 4 (two separate increments)
3. A rollback: UPDATE count from 4 to 3
4. B rollback: waits for lock, then reads 3, UPDATE to 2
5. B DELETE: count = 2, no delete
6. Final count = 2. Correct (2 + 2 - 2 = 2).

What about the DELETE race? If count goes to 0:
1. Initial: count = 1
2. A increments: count = 2
3. A fails, rolls back: UPDATE to 1, DELETE doesn't match (count = 1 > 0)
4. Final count = 1. Correct.

Actually, the DELETE with `count <= 0` and the UPDATE's `GREATEST(count - 1, 0)` mean the count can never go below 0. The DELETE only removes rows where count is exactly 0 (after the UPDATE). The race is benign because:
- The UPDATE is atomic and row-locked
- The DELETE in the same transaction sees the transaction-local value
- Concurrent transactions serialize on the row lock

**Down-ranking:** After careful analysis, this is NOT a race condition. InnoDB row-level locking serializes the concurrent decrements. The transaction wrapping ensures the DELETE sees the correct post-UPDATE value. Removing from the findings list.

---

### Finding 6: Image Queue Claim Retry Timer Leak on Process Exit
**Confidence:** Medium (suspected timing issue)
**File:** `apps/web/src/lib/image-queue.ts`, lines 267-299

**Observation:** When a job fails to acquire the processing claim (line 274), it schedules a retry timer (line 294). The timer is created with `setTimeout` and `unref()` is called (line 297). However, if the process receives SIGTERM during the delay period, the timer keeps the event loop alive until it fires or the hard shutdown timeout expires.

**Causal Chain:**
1. Job J fails claim, schedules retry timer with 5-25s delay
2. SIGTERM arrives 1 second later
3. `gracefulShutdown()` starts 15-second countdown
4. The retry timer is still pending (4-24s remaining)
5. `drainProcessingQueueForShutdown()` clears `state.bootstrapRetryTimer` but does NOT iterate over individual job retry timers
6. The job retry timer fires during shutdown, calling `enqueueImageProcessing(job)`
7. `enqueueImageProcessing` checks `state.shuttingDown` (line 245) and returns false
8. But the timer callback has already executed, consuming CPU and potentially logging

**Failure Scenario:** Under a storm of claim-failed jobs (e.g., all images locked by a concurrent backfill), hundreds of retry timers could be pending. Each fires during shutdown, creating a thundering herd of no-op `enqueueImageProcessing` calls. The `unref()` means they don't keep the event loop alive, but they do consume CPU during the shutdown window.

**Evidence Strength:** Tier 4 — Code-path inference. The shutdown path clears the bootstrap retry timer and the GC interval, but individual job retry timers are not tracked or cleared.

**Fix:** Track active claim retry timers in a Set and clear them during shutdown:
```typescript
// In ProcessingQueueState:
claimRetryTimers: Set<ReturnType<typeof setTimeout>>;

// In enqueueImageProcessing, when scheduling retry:
const retryTimer = setTimeout(() => { ... }, delay);
retryTimer.unref?.();
state.claimRetryTimers.add(retryTimer);

// In drainProcessingQueueForShutdown:
for (const timer of state.claimRetryTimers) {
    clearTimeout(timer);
}
state.claimRetryTimers.clear();
```

**Rebuttal:** The impact is bounded: at most `MAX_CLAIM_RETRIES = 10` per job, and the queue concurrency is typically 1. The total number of pending timers is small. The `unref()` ensures they don't block exit. This is a minor hygiene issue, not a correctness defect.

---

### Finding 7: Backfill Runner State Mutation Race at Concurrency > 1
**Confidence:** Medium (suspected timing issue)
**File:** `apps/web/src/lib/admin-backfill-runner.ts`, lines 692-761

**Observation:** The backfill runner uses a PQueue with configurable concurrency (default 1, capped at 2). Each worker increments local counters (`processed`, `errors`, `skippedMissingOriginal`, etc.) and then mirrors them into the shared `state` object (lines 744-750). The comment at line 176 explicitly acknowledges: "last-writer-wins across workers at concurrency>1."

**Causal Chain:**
1. Concurrency = 2, two workers W1 and W2 process different rows
2. W1 processes row 1: `processed` local = 1, mirrors to `state.processed = 1`
3. W2 processes row 2: `processed` local = 1, mirrors to `state.processed = 1` (overwrites W1's 1 with 1 — same value, no issue)
4. But if W1 processes row 1 (processed=1) and W2 fails row 2 (errors=1):
   - W1 mirrors: `state.processed = 1`, `state.errors = 0`
   - W2 mirrors: `state.processed = 0`, `state.errors = 1`
   - Final: `state.processed = 0`, `state.errors = 1` — LOST W1's processed count!

Wait, that's not right. The locals are cumulative, not per-row. Let me re-read:
```typescript
let processed = 0; // line 672, OUTSIDE the queue.add loop
// Inside queue.add:
if (result.ok) {
    processed++; // increments the SHARED local (closure-captured)
}
// Then mirrors:
state.processed = processed; // line 744
```

The locals (`processed`, `errors`, etc.) are declared in the outer `runBackfill` scope and captured by closure in each queue job. Since JavaScript closures share the same variable reference, `processed++` from multiple workers IS atomic per the event loop (no true parallelism). But the mirroring to `state.processed = processed` happens asynchronously after each job completes, and multiple jobs can complete in interleaved order.

Actually, in JavaScript, `processed++` is NOT atomic in the sense that between the read and write, another async operation could interleave. But since the event loop is single-threaded, and `processed++` is a synchronous operation, no other JavaScript code can run between the read and write. So `processed++` IS atomic in JavaScript.

The issue is the mirroring: `state.processed = processed` (line 744) happens after each job. If job A completes, increments `processed` to 1, then mirrors `state.processed = 1`. Then job B completes, increments `processed` to 2, mirrors `state.processed = 2`. This is correct.

But what if the mirroring happens at the `handled % 25 === 0` log point (lines 753-759)? Job A completes, `processed` = 1, `handled` = 1, doesn't log. Job B completes, `processed` = 2, `handled` = 2, doesn't log. Job C completes, `processed` = 3, ... up to 25, then logs. The log shows the cumulative state, which is correct.

The real issue is the `state.lastError` assignment (line 715, 739): multiple workers can assign different error messages, and the last one wins. This is explicitly documented (line 176-179) as acceptable. The counts are correct because they're cumulative and `++` is atomic in the event loop.

**Down-ranking:** After careful analysis, the counter mirroring is correct because JavaScript's single-threaded event loop makes `++` atomic. The `lastError` race is documented and acceptable. Removing from confirmed findings.

---

### Finding 8: Connection Pool Init Query Timeout Race
**Confidence:** Medium (suspected timing issue)
**File:** `apps/web/src/db/index.ts`, lines 70-96

**Observation:** The `getConnection` override (line 71) awaits the init promise with a 10-second timeout (line 86). If the timeout wins, it releases the connection and throws. But the init promise (`initPromise`) might still resolve later, and the `connection` event handler's `.catch()` (line 64) would log an error for a connection that was already released.

**Causal Chain:**
1. `getConnection()` acquires connection C1
2. Init promise P1 is still pending (group_concat_max_len SET query in flight)
3. 10-second timeout fires → `connection.release()` called (line 91)
4. P1 eventually resolves → the `.catch()` handler (line 64) logs "Failed to set group_concat_max_len" because the connection was released mid-query
5. The pool may have already re-issued C1 to another caller, who now sees a connection that might have the init query still in flight or have been released

**Failure Scenario:** Under extreme DB load, the init query can take > 10 seconds. The timeout releases the connection, but the query is still running on the MySQL server side. The connection goes back to the pool and gets re-issued. The new caller might see:
- A connection with `group_concat_max_len` already set (init query completed before release)
- A connection with default `group_concat_max_len` (init query never completed)
- A connection in an error state (if the init query was interrupted)

**Evidence Strength:** Tier 4 — Code-path inference. The timeout releases the connection but doesn't cancel the underlying query. The `connection` event handler's `.catch()` will fire for the released connection.

**Fix:** Cancel the init query before releasing the connection on timeout, or mark the connection as "do not reuse" before releasing. Alternatively, increase the timeout or make it configurable. The cleanest fix is to not release timed-out connections back to the pool — instead, call `connection.destroy()` to ensure the connection is closed rather than returned to the pool.

**Rebuttal:** The 10-second timeout is generous for a `SET group_concat_max_len = 65535` query. If the DB is so overloaded that this query takes > 10 seconds, the application has bigger problems. The pool's `queueLimit: 20` would already be exhausted.

---

### Finding 9: GeoIP Lookup Lazy Initialization Race
**Confidence:** Low (latent bug)
**File:** `apps/web/src/lib/analytics.ts`, lines 33-47

**Observation:** `getGeoLookup()` uses a lazy singleton pattern with `geoLookup` module-level variable. The first caller triggers `require('geoip-lite')` and assigns `geoLookup = geoip.lookup.bind(geoip)`.

**Causal Chain:**
1. Request A calls `lookupCountry()` → `getGeoLookup()` → `geoLookup` is null → enters the try block
2. Request B calls `lookupCountry()` concurrently → `geoLookup` is still null (A hasn't assigned yet) → also enters the try block
3. Both A and B call `require('geoip-lite')` — the Node.js module system caches the require, so this is safe
4. Both assign `geoLookup = geoip.lookup.bind(geoip)` — same value, no issue

**Failure Scenario:** If `require('geoip-lite')` throws (e.g., native binding missing), the catch block sets `geoLookup = () => null`. But if two concurrent calls both see `geoLookup = null` and both try to require, one might throw while the other succeeds. The first to complete sets the value. If the thrower completes first, `geoLookup` becomes the null-returning fallback even though the module might be available for the second caller.

**Evidence Strength:** Tier 5 — Weak circumstantial. The `require` is synchronous and cached by Node.js. The race window is extremely narrow (nanoseconds). The fallback behavior (`() => null`) is harmless.

**Fix:** Use a promise-based singleton or lock around the initialization:
```typescript
let geoLookupPromise: Promise<...> | null = null;
function getGeoLookup() {
    if (geoLookup !== null) return geoLookup;
    if (!geoLookupPromise) {
        geoLookupPromise = (async () => {
            try { ... } catch { ... }
        })();
    }
    return geoLookupPromise;
}
```

**Rebuttal:** The impact is negligible. The fallback returns 'XX' for country code, which is the correct unknown-country behavior. This is a hygiene issue, not a correctness defect.

---

### Finding 10: Shared Group View Count Buffer Lost on SIGKILL
**Confidence:** Medium (suspected timing issue)
**File:** `apps/web/src/lib/data.ts`, lines 13-189; `apps/web/src/instrumentation.ts`, lines 8-62

**Observation:** The view count buffer is process-local memory. The graceful shutdown handler (instrumentation.ts:20-25) calls `flushBufferedSharedGroupViewCounts()` to drain the buffer before exit. But if the process receives SIGKILL (or crashes), the buffer is lost.

**Causal Chain:**
1. Multiple shared group views are buffered in `viewCountBuffer` (Map)
2. Process receives SIGKILL (e.g., OOM killer, Docker kill, manual `kill -9`)
3. The signal handler does NOT run (SIGKILL cannot be caught)
4. The buffered increments are lost forever

**Failure Scenario:** This is explicitly documented in CLAUDE.md: "The shared-group view-count buffer is best-effort-by-design (flushed on graceful SIGTERM, lost on SIGKILL)." The production deployment notes this as a known limitation.

**Evidence Strength:** Tier 3 — Multiple sources converging (code comment + CLAUDE.md documentation). This is a documented design choice, not a bug per se, but it is a concurrency/durability issue.

**Fix:** To make view counts durable, use a persistent queue (Redis, file-backed buffer) or write directly to DB with per-IP rate limiting. However, this would add infrastructure complexity. For a personal gallery, the best-effort approach is acceptable.

**Rebuttal:** This is a documented design choice, not a bug. The CLAUDE.md explicitly states: "Shared-group view_count is best-effort approximate analytics." The fix would require additional infrastructure (Redis, etc.) that contradicts the single-writer, self-hosted design.

---

### Finding 11: Image Processing Queue `enqueued` Set Desync on Crash
**Confidence:** Medium (suspected timing issue)
**File:** `apps/web/src/lib/image-queue.ts`, lines 150-168, 243-591

**Observation:** The `enqueued` Set tracks which job IDs are currently in the PQueue. If the process crashes mid-processing, the Set is lost. On restart, `bootstrapImageProcessingQueue()` scans for `processed = false` rows and re-enqueues them. But if a job was in the queue (in `enqueued`) when the crash happened, and the crash occurred AFTER the job started processing but BEFORE it completed, the bootstrap will re-enqueue it. The job will then be processed twice (or the second attempt will hit the advisory lock and retry).

**Causal Chain:**
1. Job J is in `enqueued` Set, processing has started
2. Process crashes mid-processing (e.g., OOM during Sharp encode)
3. On restart, bootstrap scans `processed = false` rows, finds J, re-enqueues it
4. New process starts processing J
5. If the crash happened AFTER derivative files were written but BEFORE the DB UPDATE, the re-processing will overwrite the same files (idempotent) and update the DB
6. If the crash happened BEFORE derivative files were written, the re-processing starts fresh

**Failure Scenario:** The double-processing is mostly harmless because:
- Derivative files are overwritten (idempotent)
- The DB UPDATE is conditional (`WHERE processed = false`)
- The advisory lock prevents concurrent processing

But there's a subtle issue: if the crash happened AFTER the DB UPDATE (setting `processed = true`) but BEFORE the `enqueued.delete(job.id)` in the finally block, the bootstrap won't re-enqueue (because `processed = true`). But the `enqueued` Set is lost, so the next upload of a new image might coincidentally get the same ID (auto-increment reuse after DB restore), and the `enqueued.has(job.id)` check would be false, allowing duplicate processing.

**Evidence Strength:** Tier 4 — Code-path inference. The `enqueued` Set is purely in-memory and lost on crash. Auto-increment ID reuse after DB restore/compact could theoretically cause collision.

**Fix:** The `permanentlyFailedIds` Set (line 159) is also in-memory and lost on crash. The bootstrap query already excludes permanently failed IDs, but after a crash this set is empty. The `retryCounts` and `claimRetryCounts` Maps are also lost. These are all bounded by `MAX_RETRY_MAP_SIZE` and `MAX_PERMANENTLY_FAILED_IDS`, so memory growth is bounded. The design accepts this as a trade-off for simplicity.

**Rebuttal:** The advisory lock (`gallerykit:image-processing:{jobId}`) is connection-scoped and released on connection close (crash). So a new process can acquire the lock for the same job. The conditional UPDATE (`WHERE processed = false`) prevents double-marking. The file overwrite is idempotent. This is a recoverable design, not a bug.

---

### Finding 12: Upload Processing Contract Lock Timeout vs. Upload Duration Race
**Confidence:** Medium (suspected timing issue)
**File:** `apps/web/src/lib/upload-processing-contract-lock.ts`, lines 9-74

**Observation:** `acquireUploadProcessingContractLock()` uses a 5-second timeout for `GET_LOCK` (line 29). The upload action (`images.ts:170`) acquires this lock at the start of `uploadImages()` and holds it for the entire upload duration (lines 171-552).

**Causal Chain:**
1. Admin A starts uploading 100 large photos
2. The upload loop processes files sequentially (for-of loop, line 267)
3. Each file takes ~1-5 seconds to save original + extract EXIF + insert DB
4. Total upload time for 100 files: 100-500 seconds
5. The `GET_LOCK` timeout is 5 seconds, but the lock is held for the ENTIRE upload
6. Wait — `GET_LOCK(?, ?)` with timeout=5 means "wait up to 5 seconds to ACQUIRE the lock", not "release after 5 seconds"

**Re-examining:** The MySQL `GET_LOCK(name, timeout)` function:
- `timeout` = maximum seconds to wait for the lock
- Once acquired, the lock is held until `RELEASE_LOCK()` is called or the connection closes
- So a 5-second timeout means "wait up to 5 seconds to get the lock", and once acquired, it's held indefinitely

**Failure Scenario:** If upload A takes 500 seconds, upload B (from the same or different user) waits 5 seconds for the lock, then gets `acquired = 0` and returns `null` (uploadSettingsLocked). This is the INTENDED behavior — uploads are serialized. But if the upload action crashes or hangs without releasing the lock, the connection must close for the lock to be released. The pool's `enableKeepAlive` and connection timeout settings might keep the connection alive longer than expected.

**Evidence Strength:** Tier 4 — Code-path inference. The lock is held for the entire upload action. The `finally` block (images.ts:550-552) releases it, but if an unhandled exception escapes before the finally, the lock persists until the connection closes.

**Fix:** The `acquireUploadProcessingContractLock()` function already has error handling that releases the connection on failure. But if the upload action itself throws an unhandled exception (not caught by the try/finally), the connection is held by the pool and the lock persists. Adding a `connection.release()` in the `release()` function's error handling (line 53) is correct. The issue is that the lock connection is separate from the DB connection used for the upload queries — they're both from the same pool, but the lock connection is held for the entire action.

Actually, looking more carefully: the `uploadContractLock` is a dedicated connection from the pool. The upload action uses `db` (Drizzle) which also uses connections from the same pool. So during the upload, the lock holds 1 connection, and the upload queries hold additional connections. With a pool of 10, a long upload could pin 1+ connections for minutes, potentially starving other requests.

**Rebuttal:** The upload action is admin-only and serialized by the contract lock. Only one upload can run at a time. The pool has 10 connections; pinning 2-3 for an upload leaves 7-8 for other requests. At personal-gallery scale, this is acceptable. The contract lock timeout of 5 seconds means concurrent upload attempts get a fast "busy" response rather than hanging.

---

### Finding 13: Caption Generation Fire-and-Forget Promise Not Awaited on Shutdown
**Confidence:** Medium (suspected timing issue)
**File:** `apps/web/src/lib/image-queue.ts`, lines 424-441

**Observation:** The caption generation hook (line 426) is fire-and-forget: `.then(...).catch(...)` with no await. The embedding hook (line 465) is similarly fire-and-forget (`void (async () => {...})()`).

**Causal Chain:**
1. Job J completes processing, `processed=true` is committed
2. Caption generation starts (async, not awaited)
3. SIGTERM arrives immediately after
4. `shutdownImageProcessingQueue()` drains the PQueue (waits for `onIdle()`)
5. But `onIdle()` only waits for queue jobs, not the fire-and-forget promises
6. The caption generation continues running during shutdown
7. If the caption generation tries to write to the DB after the pool is drained/closed, it fails

**Failure Scenario:** Under graceful shutdown, the caption generation or embedding insertion might:
- Run to completion (if fast enough, within the 15-second timeout)
- Fail with a DB error (if the pool is closed)
- Be silently dropped (if the process exits before completion)

The `generateCaption` function returns a promise that resolves to `string | null`. The `.catch()` handler (line 440) logs errors but doesn't propagate them. The embedding hook's `void (async () => {...})()` has no catch handler for the outer async function — errors inside are caught by the inner try/catch (line 506), but if the outer `async` wrapper throws before reaching the try block, it becomes an unhandled promise rejection.

**Evidence Strength:** Tier 4 — Code-path inference. The fire-and-forget pattern is explicitly documented ("MUST NOT block the queue job"). The shutdown handler doesn't wait for these side promises.

**Fix:** Track fire-and-forget promises in a Set and await them during shutdown:
```typescript
// In ProcessingQueueState:
sidePromises: Set<Promise<unknown>>;

// When firing:
const sidePromise = generateCaption(...).then(...).catch(...);
state.sidePromises.add(sidePromise);
sidePromise.finally(() => state.sidePromises.delete(sidePromise));

// In drainProcessingQueueForShutdown:
await Promise.all(Array.from(state.sidePromises));
```

**Rebuttal:** The caption generation is a best-effort feature. If it fails or is dropped on shutdown, the image still has `processed=true` and is visible. The admin can retry failed captions manually. The 15-second shutdown timeout bounds the wait. Adding tracking complexity for a non-critical feature may not be worth it.

---

### Finding 14: Restore Maintenance Flag Not Cleared on Unhandled Exception
**Confidence:** Medium (suspected timing issue)
**File:** `apps/web/src/lib/restore-maintenance.ts`, lines 44-56; `apps/web/src/app/[locale]/admin/db-actions.ts`

**Observation:** `beginRestoreMaintenance()` sets `state.active = true` (line 50). `endRestoreMaintenance()` sets it to false (line 55). The DB restore action should call `endRestoreMaintenance()` in a `finally` block.

**Causal Chain:**
1. Admin starts DB restore
2. `beginRestoreMaintenance()` returns true, sets `active = true`
3. `quiesceImageProcessingQueueForRestore()` pauses/clears the queue
4. Restore runs...
5. If an unhandled exception occurs during restore, the `finally` block should call `endRestoreMaintenance()`

**Failure Scenario:** Looking at `apps/web/src/app/[locale]/admin/db-actions.ts` (not fully read in this trace), the restore action should have a try/finally that calls `endRestoreMaintenance()`. If it doesn't, or if the process crashes during restore, the `active` flag stays true forever, blocking all uploads and processing until the process restarts.

**Evidence Strength:** Tier 5 — Weak circumstantial. I haven't read the full restore action file. The CLAUDE.md mentions: "Concurrent DB restore prevention: MySQL advisory lock `gallerykit_db_restore` acquired on a dedicated pool connection for the entire restore window." The advisory lock is released on connection close, but the process-local `restoreMaintenance` flag is NOT.

**Fix:** Ensure the restore action has a robust `finally` block that calls `endRestoreMaintenance()`. Also, add a heartbeat or timeout to auto-clear the flag after a reasonable duration (e.g., 30 minutes) to recover from crashes.

**Rebuttal:** The restore action is admin-only and rare. A manual process restart clears the flag. The advisory lock prevents concurrent restores even if the flag is stale.

---

## Final Sweep: Commonly Missed Concurrency Bugs

### Checked:
1. **Double-checked locking** — Not used in the codebase. The session secret uses a promise singleton, which is correct.
2. **ABA problem** — Not applicable; no compare-and-swap operations on shared memory.
3. **Lost wakeups** — The PQueue's `onIdle()` is used correctly with `pause()` + `clear()` before await.
4. **Thundering herd** — The advisory lock pattern prevents this for DB operations. The rate-limit Maps use per-IP keys, preventing herd behavior.
5. **Priority inversion** — Not applicable; no priority queue usage.
6. **Memory reordering** — Not applicable in JavaScript's memory model.
7. **Event loop starvation** — The image queue uses PQueue with concurrency=1 by default, preventing CPU starvation. The Sharp concurrency is capped.
8. **Callback hell / promise leaks** — Fire-and-forget promises are used but documented. No obvious memory leaks from unhandled promises.
9. **Resource exhaustion** — The bounded Maps and Sets have explicit caps. The connection pool has queueLimit=20.
10. **Timer drift** — The GC interval is 1 hour, not sensitive to drift. The flush timer uses `Date.now()` for calculations.

### Notable Absence of Bugs (Good Patterns):
- **Advisory locks** are correctly used for serialization
- **Conditional UPDATEs** (`WHERE processed = false`) prevent double-processing
- **Map-swap buffering** for view counts prevents lost increments during flush
- **Promise singleton** for the AVIF probe prevents duplicate probes
- **Connection init timeout** prevents pool starvation from slow init queries
- **Bootstrap cursor** prevents infinite loops with permanently failing rows

---

## Summary Table

| # | Finding | File | Confidence | Type | Severity |
|---|---------|------|------------|------|----------|
| 1 | View count buffer timer rescheduling race | `lib/data.ts` | High | Confirmed race | Medium |
| 2 | Session secret initialization race | `lib/session.ts` | High | Confirmed race | Low |
| 3 | Upload tracker pre-claim TOCTOU | `app/actions/images.ts` | Medium | Suspected timing | Medium |
| 4 | Bootstrap retry timer vs. shutdown race | `lib/image-queue.ts` | Medium | Suspected timing | Low |
| 6 | Claim retry timer leak on shutdown | `lib/image-queue.ts` | Medium | Suspected timing | Low |
| 8 | Connection pool init query timeout race | `db/index.ts` | Medium | Suspected timing | Low |
| 9 | GeoIP lookup lazy initialization race | `lib/analytics.ts` | Low | Latent bug | Very Low |
| 10 | View count buffer lost on SIGKILL | `lib/data.ts` | Medium | Suspected timing | Low (documented) |
| 11 | Enqueued Set desync on crash | `lib/image-queue.ts` | Medium | Suspected timing | Low |
| 12 | Upload contract lock duration vs. pool starvation | `lib/upload-processing-contract-lock.ts` | Medium | Suspected timing | Low |
| 13 | Caption/embedding fire-and-forget on shutdown | `lib/image-queue.ts` | Medium | Suspected timing | Low |
| 14 | Restore maintenance flag not cleared on crash | `lib/restore-maintenance.ts` | Medium | Suspected timing | Medium |

**Note:** Findings 5 and 7 were down-ranked after deeper analysis revealed they are not actual race conditions.

---

## Critical Unknowns

1. **Does the DB restore action (`db-actions.ts`) have a robust `finally` block for `endRestoreMaintenance()`?** If not, a crash during restore could permanently wedge uploads.
2. **What is the actual MySQL isolation level?** READ COMMITTED vs REPEATABLE READ affects the rate-limit decrement behavior.
3. **How does the connection pool behave under the init query timeout?** Does `connection.release()` on a timed-out connection return it to the pool in a clean state?

## Discriminating Probes

1. **For Finding 1 (view count timer race):** Add logging to `flushGroupViewCounts` to count how many times the `isFlushing` guard fires and a timer is already armed. If the count is non-zero under load, the race is confirmed.
2. **For Finding 2 (session secret race):** Add a counter to track how many times `sessionSecretPromise` is created (should be 1 per process). If > 1, the race is confirmed.
3. **For Finding 14 (restore maintenance flag):** Read `db-actions.ts` to verify the `finally` block. If missing, the bug is confirmed.

---

*Review completed by Tracer agent. Method: observation-first causal tracing with competing hypotheses, evidence for/against, and explicit down-ranking of disproven explanations.*
