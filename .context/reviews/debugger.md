# Debugger — Cycle 3 Deep Review (2026-04-27)

**HEAD:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`

## Findings (New — Not in Prior Cycles)

### LOW Severity (2)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-D01 | `instrumentation.ts` calls `process.exit(0)` in the SIGTERM handler after draining the queue and flushing view counts. If `flushBufferedSharedGroupViewCounts` partially completes (some chunks succeed, some fail), the Map swap has already occurred — new increments go to a fresh Map, and the partially-flushed old Map entries that failed are re-buffered. But `process.exit(0)` terminates immediately after, so the re-buffered entries are lost. This is an inherent limitation of process termination and is documented in CLAUDE.md as "best-effort approximate analytics." Not a bug, but the failure mode is worth noting. | `instrumentation.ts:9-36` | Medium |
| C3-D02 | `restoreDatabase` has a nested try/finally structure where the inner `finally` calls `endRestoreMaintenance()` and `resumeImageProcessingQueueAfterRestore()`. If `resumeImageProcessingQueueAfterRestore()` throws, the error is caught and logged, but the advisory lock `RELEASE_LOCK` at line 316 still runs in the same `finally` block. This is correct — the lock release must happen regardless of whether resume succeeds. No bug, but the error-handling interleaving is fragile and worth documenting. | `app/[locale]/admin/db-actions.ts:308-323` | Low |

### INFO (1)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-D03 | `acquireImageProcessingClaim` in `image-queue.ts` uses `GET_LOCK(?, 0)` (zero timeout) for the per-job advisory lock. If two workers start processing the same job simultaneously, one fails to acquire the lock and retries with exponential backoff (up to 10 retries). After 10 failures, the job is abandoned and the bootstrap is re-triggered. This is correct but means a persistently-locked job (e.g., from a crashed worker that didn't release the lock) will block for 10 retries before the queue re-bootstraps. The lock is automatically released when the holding connection closes, so this only happens if the connection is leaked (not returned to pool). | `lib/image-queue.ts:153-170` | Info |

## Verified Controls (No New Bugs)

- Delete-while-processing: queue checks row existence + conditional UPDATE
- Concurrent tag creation: `INSERT IGNORE` + slug collision detection
- Topic slug rename: transaction wraps reference updates
- Batch delete: transactional (imageTags + images atomic)
- `createTopic` TOCTOU: catches `ER_DUP_ENTRY`
- `ensureDirs`: Promise-based singleton
- Session secret init: `INSERT IGNORE` + re-fetch
- Concurrent DB restore: advisory lock
- Upload-processing contract: advisory lock
- Per-image claim: advisory lock with retry
