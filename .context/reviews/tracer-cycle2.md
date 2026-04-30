# Tracer — Cycle 2/100 (2026-04-28)

## Causal Tracing of Suspicious Flows

### Flow 1: Login Rate Limit Rollback
- **Path**: `login()` → `incrementRateLimit()` → Argon2 verify → success → `clearSuccessfulLoginAttempts()` / failure → skip (already counted)
- **Rollback paths**: Unexpected error → `rollbackLoginRateLimit()` + `decrementRateLimit()` for account-scoped bucket
- **Verdict**: Correct. Pre-increment, check, then either clear on success or rollback on unexpected error. Failed auth attempts are intentionally NOT rolled back (they count as failed attempts).

### Flow 2: View Count Flush Swap-and-Drain
- **Path**: `bufferGroupViewCount()` → `setTimeout(flushGroupViewCounts)` → `const batch = viewCountBuffer; viewCountBuffer = new Map()` → chunk-by-chunk drain
- **Failure path**: Failed increments re-buffered to fresh Map with capacity check. Backoff on consecutive failures.
- **Verdict**: Correct. The swap-and-drain pattern (C2-F01 fix) prevents losing buffered increments if the process crashes mid-flush.

### Flow 3: Upload Tracker Pre-Increment
- **Path**: `uploadImages()` → `tracker.bytes += totalSize; tracker.count += files.length` → per-file processing → `settleUploadTrackerClaim()` reconciles
- **TOCTOU fix**: First-insert pattern (C8R-RPL-02) ensures concurrent requests share the same tracker object.
- **Verdict**: Correct. Pre-claim + settle pattern prevents concurrent uploads from bypassing limits.

### Flow 4: Topic Rename Transaction
- **Path**: `updateTopic()` → `withTopicRouteMutationLock()` → advisory lock → transaction: INSERT new topic, UPDATE images.topic, UPDATE topicAliases.topicSlug, DELETE old topic
- **Rollback**: Transaction rollback on any failure. Advisory lock released in finally.
- **Verdict**: Correct. The insert-then-delete pattern (rather than UPDATE PK) avoids FK cascade issues.

### Flow 5: Image Delete While Processing
- **Path**: `deleteImage()` → remove from queue's enqueued set → transactional delete (imageTags + images) → conditional UPDATE in queue job detects `affectedRows === 0` → cleanup variant files
- **Verdict**: Correct. The queue detects the missing row and cleans up orphaned files.

## Findings

No causal tracing failures found. All suspicious flows have correct rollback and error handling paths.

## Convergence Note

Fourth consecutive cycle with zero tracing failures.
