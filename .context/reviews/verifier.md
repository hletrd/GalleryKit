# Verifier Review — verifier (Cycle 16)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Evidence-based correctness check

### Verified behavior

1. **C15-AGG-01 (deleteTopic redundant guard removed)**: VERIFIED — topics.ts:352-358 now has unconditional audit log after `deletedRows === 0` early return. Comment correctly documents the invariant.

2. **C1F-DB-02 (permanently-failed IDs prevent infinite re-enqueue)**: VERIFIED — `permanentlyFailedIds` Set in image-queue.ts, bootstrap query at line 434-435 excludes them via `notInArray`. Queue test at `__tests__/image-queue.test.ts:84-113` verifies the bootstrapped=false + retry behavior.

3. **C1F-SR-08 (sanitizeStderr redacts sensitive connection parameters)**: VERIFIED — `sensitiveValues` parameter in `sanitizeStderr` (sanitize.ts:108-115). Call sites in db-actions.ts:173 and db-actions.ts:475 pass `[DB_USER, DB_HOST, DB_NAME]`.

4. **C1F-DB-01 (viewCountBuffer cap after re-buffering)**: VERIFIED — data.ts:119-126 enforces cap with FIFO eviction.

5. **C1F-CR-08/C1F-TE-05 (sanitizeAdminString returns null when rejected)**: VERIFIED — sanitize.ts:156-158. All callers check `rejected` before using `value`.

6. **Privacy enforcement**: `publicSelectFields` still omits all sensitive fields. Compile-time guard `_SensitiveKeysInPublic` still enforces no leakage.

7. **Auth flow**: Login rate limiting pre-increments. Password change validates form fields before consuming rate-limit attempts. No rollback on infrastructure errors.

8. **Upload flow**: Upload tracker pre-increment prevents TOCTOU. `assertBlurDataUrl` enforced at producer and consumer.

9. **Image processing queue**: Per-image advisory lock prevents duplicate processing. Cursor-based bootstrap continuation handles large pending sets.

### New Finding

#### C16-V-01 (Medium / Medium). `image-queue.ts` lines 346-352: comment contradicts code — says "Do NOT reset bootstrapped / scheduleBootstrapRetry" but code does both

- Location: `apps/web/src/lib/image-queue.ts:346-352`
- Same finding as C16-CR-01. The comment at lines 346-349 says "Do NOT reset bootstrapped / scheduleBootstrapRetry here — that was the old pattern that caused infinite re-enqueue." But lines 350-352 DO reset `state.bootstrapped = false`, null the cursor, and call `scheduleBootstrapRetry()`.
- Verified that the CODE is actually correct (the `permanentlyFailedIds` exclusion prevents the specific failed job from being re-enqueued, but other pending images need to be discovered by a rescan). The COMMENT is wrong.
- Verified via git blame: the comment was added in commit ec24cc1 ("prevent infinite re-enqueue of permanently-failed images") but the code lines 350-352 are from older commits that were left in place.
- The test at `image-queue.test.ts:84-113` verifies the bootstrapped=false + retry timer behavior, confirming the code's current behavior is intentional.

## Carry-forward (unchanged — existing deferred backlog)

- C6-V-02: `bootstrapImageProcessingQueue` cursor continuation path untested.
- C4-CR-03/C5-CR-03/C6-V-01: NULL `capture_date` navigation integration test gap.
