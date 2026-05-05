# Debugger Review — Cycle 21

## Method
Latent bug surface analysis: race conditions, failure modes, regressions, and edge-case behavior. Focus on paths that fail silently or produce misleading output.

## Findings

### C21-DEBUG-01: Semantic Search Returns Nonsense with Plausible Scores
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 163-178)
**Confidence**: HIGH

The `scored` array contains cosine similarity scores in [-1, 1]. With random stub embeddings, these scores are uniformly distributed. The `COSINE_THRESHOLD = 0.18` filters out ~46% of random pairs, leaving ~54% as "matches." The `topK` then returns the highest random scores. To a user, this looks like a ranked search result. To a debugger, it is indistinguishable from a working system without inspecting the embedding source.

**Failure mode**: Impossible to detect from user reports alone. Users will say "search doesn't work well" rather than "search is random."

**Fix**: Add a `X-Semantic-Search-Mode: stub` response header in debug builds, or log at info level when stub mode is active.

---

### C21-DEBUG-02: `quiesceImageProcessingQueueForRestore` Returns While Job Is Running
**File**: `apps/web/src/lib/image-queue.ts` (lines 604-625)
**Confidence**: HIGH

If a job is in the middle of `processImageFormats` (which can take 5-30 seconds for large images), `quiesceImageProcessingQueueForRestore` will return immediately because `queue.onPendingZero()` only tracks queued items, not active ones.

**Failure mode**: Admin initiates restore. Quiescence returns. Restore drops tables. Active job finishes and tries to UPDATE `images` table or write files to `public/uploads/`. Errors are cryptic ("table does not exist" or "permission denied").

**Fix**: Track active job promises and await them in quiescence.

---

### C21-DEBUG-03: `decrementRateLimit` Can Delete a Concurrently Incremented Row
**File**: `apps/web/src/lib/rate-limit.ts` (lines 427-454)
**Confidence**: MEDIUM

**Failure mode**: Two concurrent requests:
- A: decrement (rollback after error) — UPDATE count=0, then DELETE removes row
- B: increment (new request) — INSERT/UPDATE sets count=1 between A's UPDATE and DELETE
- Result: B's increment is lost. The rate limit counter is now 0 instead of 1.

**Frequency**: Only occurs in rollback paths. Rare in practice.
**Fix**: Atomic operation or transaction.

---

### C21-DEBUG-04: OG Photo Route `arrayBuffer()` Without Chunked Encoding Guard
**File**: `apps/web/src/app/api/og/photo/[id]/route.tsx` (lines 96-100)
**Confidence**: MEDIUM

If the internal `/uploads/jpeg/` response uses chunked encoding (no Content-Length), `photoBuffer.length` is checked AFTER buffering. A large response would already be in memory.

**Fix**: Add `if (photoBuffer.length > OG_PHOTO_MAX_BYTES) return fallback` after `arrayBuffer()`.

---

### C21-DEBUG-05: Bootstrap Cleanup Can Run Multiple Times Per Minute
**File**: `apps/web/src/lib/image-queue.ts` (lines 576-592)
**Confidence**: LOW

After a failed job, `scheduleBootstrapRetry` fires in 30 seconds. Each bootstrap runs `purgeExpiredSessions` and `purgeOldAuditLog`. If multiple jobs fail in quick succession, these expensive queries run repeatedly.

**Failure mode**: During a DB outage, jobs fail continuously. Bootstrap retries every 30 seconds, running cleanup each time. This adds load to an already struggling system.

**Fix**: Gate cleanup to run at most once per hour or per process lifetime.

---

## No new regressions detected
- Prior cycle fixes remain stable.
- No new failure modes introduced by recent commits.
