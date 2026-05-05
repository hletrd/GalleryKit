# Data Flow & State Tracing Review — Cycle 7

## Summary

Data flows are generally well-traced with clear ownership boundaries. A few state transitions lack explicit tracing or have distributed state that complicates debugging.

---

## C7-TRACE-01: View count buffer state is split across two Maps with independent cleanup — Medium

**File:** `apps/web/src/lib/data.ts`
**Lines:** 17-27

**Finding:** The view-count system uses THREE separate Maps:
1. `viewCountBuffer` — buffered increments (swapped atomically during flush)
2. `viewCountRetryCount` — retry counters for failed flushes
3. `consecutiveFlushFailures` — scalar backoff counter

These are all module-level state with no unified accessor. To debug a "missing view count" issue, an operator must check all three plus the DB. The retry Map and the buffer Map can diverge (an ID in retryCount but not in buffer means a dropped increment after max retries).

**Fix:** Encapsulate the view-count state in a single class or object with a `toDebugSnapshot()` method that dumps all state in one log line.

**Confidence:** Medium

---

## C7-TRACE-02: Image processing state machine is implicit — Low

**File:** `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`

**Finding:** An image transitions through: uploaded (original on disk) → enqueued (in memory) → claimed (advisory lock) → processing (Sharp pipeline) → processed=true (DB) → variants on disk. There is no explicit state machine or enum tracking these stages. Debugging a stuck image requires checking: DB `processed` flag, disk files, queue Maps, advisory locks, and retry counts.

**Fix:** Add a `processing_status` enum column to `images` (`pending`, `claimed`, `processing`, `done`, `failed`). This makes the state explicit and queryable. Deferred — requires migration.

**Confidence:** Low

---

## C7-TRACE-03: `uploadTracker` claim/settle flow lacks request-scoped correlation ID — Low

**File:** `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`

**Finding:** Upload tracking uses a global Map keyed by session/token hash. When multiple admins upload simultaneously, the logs show interleaved "claim" and "settle" messages with no way to correlate which claim belongs to which settle. A burst upload of 100 files produces logs that are hard to trace.

**Fix:** Add a `uploadBatchId` (UUID) to the claim/settle messages and include it in all related log lines.

**Confidence:** Low

---

## C7-TRACE-04: `og/photo/[id]` data flow fetches image THREE times — Low

**File:** `apps/web/src/app/api/og/photo/[id]/route.tsx`
**Lines:** 46-68

**Finding:** The OG route calls `getImageCached(imageId)` which fetches from DB, then fetches the JPEG derivative via HTTP (`fetch(photoUrl)`), then Satori processes it. This is three distinct I/O operations for a single OG image. The DB result and the HTTP fetch are sequential (photoUrl construction depends on DB result).

**Fix:** Acceptable for the OG use case (not on critical path). Document the flow: DB → HTTP derivative → Satori render → PNG output.

**Confidence:** Low
