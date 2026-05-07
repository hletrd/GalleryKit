# Debugger — Cycle 4 RPL (2026-04-23, loop 2)

Reviewer focus: latent bug surface, failure modes, regressions.

## Findings

### C4R-RPL2-DBG-01 — `poolConnection.on('connection')` UHR risk [LOW] [MEDIUM]
**File:** `apps/web/src/db/index.ts:28-30`

Duplicates CQ-01/SEC-02/VER-03/TE-01/ARCH trace. `connection.query(...)` unhandled rejection.

**Latent failure mode:** under Node 24 with default strict UHR behaviour, this can terminate the process. Even if not fatal, subsequent queries on that connection silently use the default `group_concat_max_len = 1024`, truncating CSV exports and SEO settings (anything using GROUP_CONCAT).

### C4R-RPL2-DBG-02 — `image-queue.ts` claim-retry uses `setTimeout` without bounding retry-map size check between scheduling and execution [LOW] [LOW]
**File:** `apps/web/src/lib/image-queue.ts:165-174`

If `enqueueImageProcessing(job)` is called during shutdown (`state.shuttingDown = true`), the `setTimeout` callback still fires and calls `enqueueImageProcessing` again. The function re-checks `state.shuttingDown` at the top, so the retry is dropped correctly. Confirmed safe. No change.

### C4R-RPL2-DBG-03 — `flushGroupViewCounts` re-buffers failed increments but resets timer without re-checking buffer capacity [LOW] [LOW]
**File:** `apps/web/src/lib/data.ts:72-77`

If the re-buffer capacity check trips (`viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE`), the failed increment is dropped. The subsequent `if (viewCountBuffer.size > 0 && !viewCountFlushTimer)` check at line 91 schedules another flush. Under persistent DB outage, this loop could repeatedly drop new increments. Existing `consecutiveFlushFailures` backoff mitigates (max 5-minute interval). Acceptable.

### C4R-RPL2-DBG-04 — `createPhotoShareLink` retries 5 times on collision but not on non-collision failure [LOW] [LOW]
**File:** `apps/web/src/app/actions/sharing.ts:120-166`

When `ER_DUP_ENTRY` occurs, retry; else `return { error: t('failedToGenerateKey') }` immediately. Correct: retrying on a non-collision error (e.g., FK violation) would loop forever on a permanent bug. No change.

### C4R-RPL2-DBG-05 — `withTopicRouteMutationLock` does not check maintenance state [LOW] [LOW]
**File:** `apps/web/src/app/actions/topics.ts:37-57`

If the DB advisory lock is acquired but the restore maintenance starts between `acquireClaim` and `action()`, the action proceeds. This is a narrow TOCTOU. All callers of `withTopicRouteMutationLock` check `getRestoreMaintenanceMessage` before entering, so the window is bounded. Acceptable.

## Confidence Summary

- 1 LOW issue that surfaces as data corruption under DB hiccup (DBG-01 == CQ-01/SEC-02).
- 4 other latent patterns reviewed; all currently acceptable.
