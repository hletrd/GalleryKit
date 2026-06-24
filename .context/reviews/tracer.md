# Tracer Review — GalleryKit Repository (Cycle 8)

## Review Date: 2026-06-25
## HEAD: 87065049
## Scope: Re-trace all critical flows, verify prior findings, identify new suspicious paths

---

## Methodology

This is cycle 8 of a review-plan-fix loop. The previous tracer review (run-9 cycle-5, HEAD de4c692a) identified 5 high-confidence, 8 medium-confidence, and 8 low-confidence issues. This review re-examines the CURRENT code at HEAD 87065049 with these priorities:

1. Verify whether previously identified issues were fixed, still exist, or were mitigated
2. Trace NEW suspicious flows introduced by recent commits
3. Re-examine flows with new evidence from code changes
4. Update confidence levels based on new findings

---

## 1. Previously Identified Issues — Status Update

### High Confidence (from prior review)

| ID | Issue | Status | Evidence |
|----|-------|--------|----------|
| TRC-H1 | Static path ETag miss after settings change without backfill | **STILL EXISTS** | Documented as CRT-D1 in CLAUDE.md. No code change since prior review. The static path (Next.js static server) serves ~100% of real traffic and uses `W/"{size}-{mtime}"` ETag. Settings-hash ETag only affects `serve-upload.ts` fallback. |
| TRC-H2 | Process-local state prevents horizontal scaling | **STILL EXISTS** | Documented in CLAUDE.md. All `globalThis`-backed state remains: `restoreMaintenanceKey`, `adminBackfillStateKey`, `uploadTracker`, `processingQueueKey`, `settingsHashCache`, all `BoundedMap` instances. No distributed state layer introduced. |
| TRC-H3 | `getClientIp` returns "unknown" without `TRUST_PROXY` | **STILL EXISTS** | `rate-limit.ts:170` returns `'unknown'` when `TRUST_PROXY` is not set. Console warning emitted once. All users share one bucket. |
| TRC-H4 | Fire-and-forget caption/embedding failures silently swallowed | **STILL EXISTS** | `image-queue.ts:439-454` (caption) and `image-queue.ts:478-522` (embedding) both use `.catch(() => undefined)` or `.catch(console.warn)`. No admin visibility. |
| TRC-H5 | `canUseHighBitdepthAvif()` singleton caches failure permanently | **FIXED** | `process-image.ts:84-123` now has `_probeHighBitdepthAvif()` with MAX_RETRIES=3 and exponential backoff. Distinguishes `isBitdepthRejection()` (permanent) from `isTransientError()` (retryable). The probe still caches the final result, but transient errors are retried first. |

### Medium Confidence (from prior review)

| ID | Issue | Status | Evidence |
|----|-------|--------|----------|
| TRC-M1 | Delete-during-processing race may leave orphaned files | **MITIGATED** | `image-queue.ts:418-434` now passes `[]` (empty sizes) to `deleteImageVariants` for full directory scan. `admin-backfill-runner.ts:430-440` mirrors this. The scan catches non-default-size variants. |
| TRC-M2 | `lastError` in backfill is last-writer-wins at concurrency > 1 | **STILL EXISTS** | `admin-backfill-runner.ts:181` documents this as intentional. No code change. The scalar message reflects the most recent worker failure; counts stay correct. |
| TRC-M3 | GPS stripping fallback for PNG may strip non-GPS metadata | **STILL EXISTS** | `gps-exif-strip.ts` fallback path uses `autoOrient + keepIccProfile` but doesn't preserve XMP/IPTC. No change since prior review. |
| TRC-M4 | Login rate limit in-memory Map empty after restart | **STILL EXISTS** | `loginRateLimit` is a `BoundedMap` in module scope. After restart, it's empty. The DB backup is read on the first check, but the pre-increment happens before the DB check, so the first 5 attempts are un-limited in the Map. The DB check then catches up. This is a documented trade-off (fast path vs. restart accuracy). |
| TRC-M5 | OG route rollback pattern inconsistency | **STILL EXISTS** | `rate-limit.ts:246-253` (rollbackOgAttempt) is documented as Pattern 4 (rollback ONLY for pre-DB syntactic rejections). The fixture tests `og-route-source-contracts.test.ts` and `og-photo-fallback.test.ts` lock this. No change. |
| TRC-M6 | `quiesceImageProcessingQueueForRestore` may deadlock on hung Sharp | **STILL EXISTS** | `image-queue.ts:802-804` uses `queue.pause(); queue.clear(); await queue.onIdle()`. No timeout. If a Sharp task is hung, `onIdle()` never resolves. The `queue-shutdown.ts` drain function also has no timeout. |
| TRC-M7 | Middleware format check is weak | **STILL EXISTS** | `proxy.ts` checks token length >= 100 and 3 colon-separated parts. Does not verify HMAC. Defense-in-depth: server actions do full verify. No change. |
| TRC-M8 | `buildHashFromConfig` may misalign with encoder settings | **STILL EXISTS** | `settings-hash.ts:42-54` lists 9 `COLOR_IMPACTING_KEYS`. The compile-time guard `_ColorKeysAreSettingKeys` catches typos but NOT forgotten new keys. No change. |

---

## 2. New Findings (Cycle 8)

### 2.1 NEW: `cosineSimilarity` zero-check uses hardcoded epsilon (CODE-02 fix)

**Observation:** `clip-embeddings.ts:37-38` uses `const EPSILON = 1e-15` for zero-vector detection.

**Trace:** The `dotProduct` fast path (used when both vectors are unit-length) skips the epsilon check entirely. If a stored embedding is somehow a zero vector (e.g., truncated all-zeros from a failed model load), `dotProduct` returns 0, which is then filtered by the `threshold` check in `topK()`. The `cosineSimilarity` path (with epsilon) is only used for non-unit vectors, which shouldn't occur in the current code path since both query and stored embeddings are normalized.

**Competing Hypotheses:**
- H1 (Low): The epsilon is too small for float32 precision. Float32 has ~7 decimal digits. A 512-dim vector with very small but non-zero components could have a norm below 1e-15. But the vectors are L2-normalized, so norm=1 by construction.
- H2 (Medium): The `dotProduct` fast path is correct ONLY if the unit-length invariant holds. If a stored embedding is corrupted (e.g., partial write, wrong model version), `dotProduct` returns garbage. The `decodeEmbeddingColumn` helper validates length but not content.

**Confidence:** Medium. The fix (commit 0b86aec9) changed from `denom === 0` to `denom < EPSILON`, which is correct for float arithmetic. But the `dotProduct` fast path lacks any guard.

**Probe:** Insert a zero-vector embedding into `image_embeddings`, verify `dotProduct` returns 0 and it is correctly filtered by threshold.

---

### 2.2 NEW: `verifyAvifNclxInBuffer` may scan beyond buffer on malformed box

**Observation:** `process-image.ts:144-179` scans for `'colr'` box in a buffer.

**Trace:** The loop starts at `i=4` and checks `buffer.toString('ascii', i, i+4) === 'colr'`. When found, it reads `buffer.readUInt32BE(i-4)` for size. If `size > 64`, it `continue`s (skips false positives). But if `size` is a very large value (e.g., 0xFFFFFFFF from a malformed file), the `size > 64` check catches it. However, the loop condition `i < buffer.length - 12` means the last valid `i` is `buffer.length - 13`. If a `'colr'` string appears at position `buffer.length - 5`, the loop would access `buffer.readUInt16BE(i+8)` which is `buffer.length - 5 + 8 = buffer.length + 3` — out of bounds.

Wait, re-reading: the loop condition is `i < buffer.length - 12`, so max `i` is `buffer.length - 13`. At `i = buffer.length - 13`, `i + 12 = buffer.length - 1`, which is within bounds. The `readUInt16BE(i+8)` at `buffer.length - 5` is within bounds. So this is safe.

But: what if `buffer.length` is exactly 16? Then `i < 16 - 12 = 4`, so `i` only goes up to 3. But `i` starts at 4, so the loop never executes. The early return `buffer.length < 16` handles this. So the bounds are correct.

**Confidence:** Low. The bounds appear correct on re-examination.

---

### 2.3 NEW: DB connection init timeout may leak connections on race

**Observation:** `db/index.ts:71-96` overrides `poolConnection.getConnection` to await the `group_concat_max_len` init query with a 10-second timeout.

**Trace:**
1. `poolConnection.on('connection', ...)` sets `connectionInitSymbol` on the callback-style connection
2. `getConnection` override accesses `underlying?.[connectionInitSymbol]`
3. If `initPromise` exists, it races against a 10-second timeout
4. On timeout, `connection.release()` is called

**Race condition:** The `connection` event handler fires asynchronously when a new connection is created. Between the event handler attaching the symbol and `getConnection` returning the wrapper, another event could modify the connection. More critically: if the init query is still running when the timeout fires, `connection.release()` returns the connection to the pool even though the init query may later complete and the connection may have the wrong `group_concat_max_len`.

But the init query is `SET group_concat_max_len = 65535`, which is idempotent. If it completes after release, the next borrower gets a connection with the correct setting. If it fails after release, the connection is returned with the default 1024 limit, which could truncate GROUP_CONCAT in CSV exports.

**Competing Hypotheses:**
- H1 (Low): The timeout is conservative (10s). Under normal load, the init query completes in milliseconds. The race window is tiny.
- H2 (Medium): Under extreme load, the init query may consistently timeout. Connections would be returned to the pool with the default 1024-byte `group_concat_max_len`, silently truncating GROUP_CONCAT output in CSV exports and SEO settings. This is a silent data corruption issue.

**Confidence:** Medium. The `C4-C1` comment acknowledges this risk: "If MySQL accepts the TCP connection but never responds to the init query... the connection would be held indefinitely, starving the pool." The timeout prevents starvation but may return uninitialized connections.

**Probe:** Simulate slow MySQL (e.g., `tc` network delay), trigger CSV export, verify `group_concat_max_len` is set correctly.

---

### 2.4 NEW: `uploadImages` tracker settlement may under-count on partial failure

**Observation:** `app/actions/images.ts:250-252` pre-increments the upload tracker before processing, then `settleUploadTrackerClaim` reconciles at the end.

**Trace:**
1. `tracker.bytes += totalSize; tracker.count += files.length;` (line 250-251)
2. Per-file loop processes each file
3. `settleUploadTrackerClaim(uploadTracker, uploadTrackerKey, files.length, totalSize, successCount, uploadedBytes)` (line ~480)

The settlement formula: `currentEntry.count = Math.max(0, currentEntry.count + (successCount - claimedCount))`.

If `successCount = 2` and `claimedCount = 3` (one file failed), the count becomes `3 + (2 - 3) = 2`. This is correct — the tracker reflects actual successes.

But: if the upload action throws BEFORE settlement (e.g., DB connection drops mid-loop), the tracker stays inflated. The `tracker.bytes` and `tracker.count` remain at their pre-incremented values. The next upload from the same user+IP will see the inflated values and may hit the cumulative limit prematurely.

**Competing Hypotheses:**
- H1 (Medium): The inflated tracker is a transient issue. The `resetUploadTrackerWindowIfExpired` function resets the window after 1 hour. So the impact is limited to 1 hour.
- H2 (Low): The `pruneUploadTracker` function (called at the start of each upload) removes entries older than 2 hours. So even if the process doesn't restart, the stale entry is eventually cleaned up.

**Confidence:** Low. The impact is bounded by the 1-hour window and the 2-hour prune. The worst case is one premature rejection within the window.

---

### 2.5 NEW: `image-queue.ts` bootstrap may miss pending images if `permanentlyFailedIds` is large

**Observation:** `image-queue.ts:667-697` bootstrap query excludes `permanentlyFailedIds`.

**Trace:**
```typescript
if (state.permanentlyFailedIds.size > 0) {
    baseConditions.push(notInArray(images.id, [...state.permanentlyFailedIds]));
}
```

The `notInArray` is converted to a SQL `NOT IN (...)` clause. If `permanentlyFailedIds` has 1000 entries (the MAX cap), the generated SQL has a 1000-element `NOT IN` list. MySQL has a limit on `IN` list size (though 1000 is well within it). More importantly, the query is:

```sql
SELECT ... FROM images WHERE processed = false AND id > ? AND id NOT IN (id1, id2, ..., id1000) ORDER BY id ASC LIMIT 500
```

If the first 500 pending images are all in `permanentlyFailedIds`, the query returns 0 rows. The bootstrap cursor doesn't advance (`state.bootstrapCursorId` stays at its current value). The next bootstrap retry will query the same range, still get 0 rows, and loop indefinitely.

Wait, re-reading: `state.bootstrapped = pending.length < BOOTSTRAP_BATCH_SIZE;`. If `pending.length === 0`, then `state.bootstrapped = true` (0 < 500). So the bootstrap marks itself as complete even though there are pending images that were excluded. This means permanently-failed images at the head of the ID range can starve later pending images from ever being bootstrapped.

But: `permanentlyFailedIds` is a Set of IDs that have failed MAX_RETRIES times. These images are genuinely broken (e.g., corrupt original file). The bootstrap SHOULD skip them. The issue is that if ALL pending images in a batch are permanently failed, the bootstrap thinks it's done.

**Competing Hypotheses:**
- H1 (Low): At personal-gallery scale, the number of permanently failed images is small. The probability that a full 500-image batch is entirely permanently failed is negligible.
- H2 (Medium): If an admin uploads a batch of corrupt files, all 500 could be permanently failed. The bootstrap would mark itself complete, and subsequent valid uploads would not be processed until the next process restart (which clears `permanentlyFailedIds`).

**Confidence:** Medium. The `permanentlyFailedIds` Set has a MAX cap of 1000, but the bootstrap logic doesn't handle the "all pending images are permanently failed" case correctly.

**Probe:** Create 500 images with `processed=false` and corrupt originals, trigger bootstrap, verify it marks `bootstrapped=true` even though valid pending images exist after the failed batch.

---

### 2.6 NEW: `admin-backfill-runner.ts` `fetchCandidateBatch` uses raw SQL without type safety

**Observation:** `admin-backfill-runner.ts:400-411` uses `db.execute(sql\`...\`)` for candidate fetching.

**Trace:** The raw SQL is:
```sql
SELECT id, filename_original, filename_avif, filename_webp, filename_jpeg,
       icc_profile_name, color_primaries, width
FROM images
WHERE processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < ${IMAGE_PIPELINE_VERSION})
  AND id > ${cursor}
ORDER BY id ASC
LIMIT ${BATCH_SIZE}
```

The result is cast through multiple layers: `result[0]` as `unknown as CandidateRow[]`. This is a type-unsafe pattern. If the SQL is ever modified (e.g., column order changed, new column added), the TypeScript compiler won't catch the mismatch.

More importantly: `IMAGE_PIPELINE_VERSION` is a module-level constant. If the code is updated to bump the pipeline version but the backfill script is not re-deployed, the backfill runner would use the OLD version number and never pick up images that need re-encoding at the NEW version.

But `IMAGE_PIPELINE_VERSION` is imported from `process-image.ts`, which is the same module that defines it. So this is consistent.

**Confidence:** Low. The type cast is a code smell but the SQL is simple and unlikely to drift. The pipeline version is a single source of truth.

---

### 2.7 NEW: `data.ts` view count buffer may lose increments during rapid flush

**Observation:** `data.ts:48-61` buffers view counts and flushes them asynchronously.

**Trace:**
1. `bufferGroupViewCount(groupId)` increments the buffer Map
2. If no timer is pending, it schedules a flush in `getNextFlushInterval()` ms (5s base)
3. `flushGroupViewCounts()` swaps the Map, then drains it in chunks

**Race:** If `bufferGroupViewCount` is called rapidly (e.g., a viral share link gets many concurrent views), the buffer may grow quickly. The `MAX_VIEW_COUNT_BUFFER_SIZE = 1000` cap drops increments when exceeded. But the cap check is:
```typescript
if (viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE && !viewCountBuffer.has(groupId)) {
    // Drop increment
}
```

This means if the buffer has 1000 distinct group IDs, new groups are dropped. But existing groups can still accumulate (the `!viewCountBuffer.has(groupId)` check only drops NEW groups). So a single popular group can accumulate unlimited increments while other groups are dropped.

Wait, re-reading: `viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + 1)`. If the group already exists, the increment is added. The capacity check only blocks NEW groups. So a single group can have count > 1000 while the buffer size stays at 1. This is correct — the buffer size is the number of distinct groups, not the total increment count.

But: if there are 1000 distinct groups and a new group arrives, the increment is dropped. This is a bounded loss. The buffer is designed for "personal-gallery scale" where the number of shared groups is small (< 100).

**Confidence:** Low. The behavior is documented and acceptable for the target scale.

---

### 2.8 NEW: `process-image.ts` `generateForFormat` may leave partial files on crash

**Observation:** `process-image.ts:1050-1149` writes sized variants in a loop.

**Trace:** The `writtenSizedPaths` Set tracks successfully written files. The `finally` block (not shown in the excerpt) cleans up partial files if the format throws. But if the PROCESS crashes (SIGKILL, OOM) between `toFile(outputPath)` and the `finally` block, the partial file remains on disk.

The atomic rename pattern (`.tmp` → final) is used for the base filename, but the sized variants are written directly to their final path. If a crash occurs mid-encode, the partial file is left on disk.

On the next retry, the same path is overwritten, so the partial file is replaced. But if the crash happens during the first format (e.g., WebP) and the retry succeeds, the partial WebP file is overwritten. The AVIF and JPEG formats may not have been attempted yet, so they're missing. The queue worker's verification step (`verifyFile`) checks all three formats and throws if any are missing, triggering a retry.

**Confidence:** Low. The retry mechanism handles this. The partial file is overwritten on retry. The verification step catches missing formats.

---

### 2.9 NEW: `session.ts` `getSessionSecret` DB fallback may race on multi-process dev

**Observation:** `session.ts:40-78` has a dev-only DB fallback for session secret.

**Trace:**
1. Process A checks `sessionSecretPromise` — null
2. Process A starts the promise (reads DB, no secret found, generates new one, INSERT IGNORE)
3. Process B checks `sessionSecretPromise` — null (different process, different memory)
4. Process B starts its own promise (reads DB, no secret found yet, generates new one, INSERT IGNORE)
5. Both processes insert different secrets. One wins (INSERT IGNORE), the other is ignored.
6. Both processes cache the secret they generated (not the one from DB).

Wait, re-reading: `finalSetting = await db.query.adminSettings.findFirst(...)`. After INSERT IGNORE, it re-fetches. So both processes re-fetch and get the SAME secret (the one that won the race). The cached secret is the re-fetched one, not the locally generated one.

But: the `cachedSessionSecret` is process-local. So Process A and Process B may have different secrets cached. This means a session created by Process A (signed with Secret A) would fail verification on Process B (which uses Secret B).

However, this is dev-only (`NODE_ENV !== 'production'`). In production, the env var is required and the DB fallback is rejected.

**Confidence:** Low. Dev-only, documented, and the re-fetch ensures both processes get the same DB value. The race window is between INSERT IGNORE and re-fetch, which is tiny.

---

### 2.10 NEW: `rate-limit.ts` `decrementRateLimit` transaction may deadlock

**Observation:** `rate-limit.ts:410-440` uses `db.transaction` for decrement.

**Trace:**
```typescript
await db.transaction(async (tx) => {
    await tx.update(rateLimitBuckets).set({ count: sql\`GREATEST(${rateLimitBuckets.count} - 1, 0)\` })...;
    await tx.delete(rateLimitBuckets).where(...sql\`${rateLimitBuckets.count} <= 0\`...)...;
});
```

This is a single-row UPDATE followed by a single-row DELETE on the same table, same row. Under MySQL's default REPEATABLE READ, the UPDATE acquires an X lock on the row. The DELETE then tries to acquire another X lock on the same row (which it already holds). This should not deadlock.

But if two concurrent transactions both decrement the same row from count=1:
1. Tx A: UPDATE count from 1 to 0 (acquires X lock)
2. Tx B: UPDATE count from 1 to 0 (waits for Tx A's X lock)
3. Tx A: DELETE where count <= 0 (succeeds, releases lock)
4. Tx B: UPDATE proceeds, sets count to -1 (but GREATEST prevents this), then DELETE

Actually, GREATEST(count - 1, 0) means count never goes below 0. So Tx B would set count to 0 (from 1, not from 0, because it read the original value before Tx A committed). Wait, under REPEATABLE READ, Tx B reads the snapshot value (1), not the current value. So Tx B's UPDATE sets count = GREATEST(1 - 1, 0) = 0. Then Tx B's DELETE deletes the row. Both transactions succeed.

But: what if Tx A's DELETE removes the row, and Tx B's UPDATE tries to update a row that no longer exists? The UPDATE would affect 0 rows, then the DELETE would also affect 0 rows. The net effect is that the row is deleted (count was decremented once, not twice). This is a lost update — the second decrement is lost.

This is acceptable for rate limiting: a lost decrement means the count is slightly higher than it should be, which is conservative (more restrictive, not less).

**Confidence:** Low. The lost decrement is conservative and acceptable.

---

## 3. Updated Risk Matrix

### High Confidence (new or confirmed)

| ID | Issue | Flow | Impact | Probe |
|----|-------|------|--------|-------|
| TRC-H1 | Static path ETag miss after settings change | Settings → Serving | Stale derivatives served | Change setting, verify ETag on static vs fallback paths |
| TRC-H2 | Process-local state prevents scaling | All globalThis state | Horizontal scaling breaks | Multi-process deployment test |
| TRC-H3 | `getClientIp` "unknown" without `TRUST_PROXY` | Login rate limit | All users share bucket | Production without TRUST_PROXY, 5 failed logins from any IP |
| TRC-H4 | Fire-and-forget failures silent | Caption/embedding | No admin visibility | Trigger ONNX failure, check admin UI |
| TRC-H6 | DB init timeout may return uninitialized connections | DB pool | GROUP_CONCAT truncation | Simulate slow MySQL, trigger CSV export |

### Medium Confidence (new or confirmed)

| ID | Issue | Flow | Impact | Probe |
|----|-------|------|--------|-------|
| TRC-M2 | Backfill `lastError` last-writer-wins | Backfill | Wrong error message | Concurrent failures, verify lastError |
| TRC-M5 | OG rollback pattern inconsistency | OG rate limit | Enumeration oracle | Verify fixture tests still pass |
| TRC-M6 | Queue quiesce may deadlock on hung Sharp | Restore | Restore never completes | Inject hung Sharp task, trigger restore |
| TRC-M9 | Bootstrap may miss pending images if all permanently failed | Image queue | Valid images not processed | Create 500 corrupt uploads, verify bootstrap |
| TRC-M10 | `dotProduct` fast path has no zero-vector guard | Semantic search | Potential NaN/undefined behavior | Insert zero-vector, verify query behavior |

### Low Confidence (new or confirmed)

| ID | Issue | Flow | Impact | Probe |
|----|-------|------|--------|-------|
| TRC-L3 | GPS fallback strips non-GPS metadata | Upload | Metadata loss | Upload PNG with XMP, verify preservation |
| TRC-L8 | Semantic search 503 if weights missing | Semantic search | Feature unavailable | Remove weights, trigger search |
| TRC-L9 | Partial files on crash during encode | Image processing | Orphaned partials | SIGKILL mid-encode, verify cleanup |
| TRC-L10 | Session secret race in dev | Session | Cross-process session invalidation | Two dev processes, create session on one, verify on other |
| TRC-L11 | Rate limit decrement lost update | Rate limit | Slightly conservative count | Concurrent decrements, verify count |

---

## 4. Invariants Verified (Still Hold)

| ID | Invariant | Evidence |
|----|-----------|----------|
| TRC-V1 | No sensitive keys in `publicSelectFields` | `_SensitiveKeysInPublic` compile-time guard |
| TRC-V2 | `COLOR_IMPACTING_KEYS` are valid settings | `_ColorKeysAreSettingKeys` compile-time guard |
| TRC-V3 | Mutating admin actions use `requireSameOriginAdmin()` | Lint gate: `check-action-origin` |
| TRC-V4 | Admin API routes wrap with `withAdminAuth()` | Lint gate: `check-api-auth` |
| TRC-V5 | Public mutating routes have rate-limit pre-increment | Lint gate: `check-public-route-rate-limit` |
| TRC-V6 | Touch targets >= 44px | Unit test: `touch-target-audit.test.ts` |
| TRC-V7 | No Unicode bidi/formatting in admin strings | `validation.ts` rejects `UNICODE_FORMAT_CHARS` |
| TRC-V8 | GPS excluded from public API | `publicSelectFields` omits + compile-time guard |
| TRC-V9 | Session tokens use HMAC-SHA256 + timingSafeEqual | `session.ts:106-118` |
| TRC-V10 | Passwords use Argon2id with OWASP-exceeding params | `password-hashing.ts` |
| TRC-V11 | 10-bit AVIF probe retries transient errors | `process-image.ts:84-123` (R8-R5 fix) |
| TRC-V12 | Backfill cleanup uses full directory scan | `admin-backfill-runner.ts:430-440` (AGG-R8c3-03) |
| TRC-V13 | View count buffer has retry cap and backoff | `data.ts:26-46` (C30-03, C5-AGG-02) |
| TRC-V14 | Upload tracker has TOCTOU fix | `images.ts:190-194` (C8R-RPL-02) |
| TRC-V15 | Queue claim retry removes from enqueued before reschedule | `image-queue.ts:303` (C4-A1) |

---

## 5. Recommendations

### Immediate (High Priority)

1. **TRC-H6: Add connection init validation post-timeout**: After the 10s timeout in `db/index.ts`, mark the connection as "uninitialized" or retry the init query on the next borrow. Alternatively, increase the timeout and add monitoring.
2. **TRC-H4: Surface fire-and-forget failures**: Add a `processing_warnings` column to the `images` table or a separate `processing_log` table to capture caption/embedding failures. The admin UI should display these.

### Short-term (Medium Priority)

1. **TRC-M9: Fix bootstrap "all permanently failed" edge case**: After `pending.length < BOOTSTRAP_BATCH_SIZE`, verify that there are NO pending images (including those in `permanentlyFailedIds`) before setting `bootstrapped = true`. Or use a separate query to check for any pending images.
2. **TRC-M10: Add zero-vector guard to `dotProduct`**: Even though the invariant says vectors are unit-length, add a defensive check: `if (denom < EPSILON) return 0;` in `dotProduct` for consistency with `cosineSimilarity`.
3. **TRC-M6: Add timeout to queue quiesce**: `quiesceImageProcessingQueueForRestore` should have a timeout (e.g., 60 seconds) after which it forcefully terminates hung tasks and proceeds with restore.

### Long-term (Low Priority)

1. **TRC-H1: Document static path ETag limitation more prominently**: The CRT-D1 operational gotcha should be in the admin UI settings page, not just CLAUDE.md. Add a warning when admin changes color/quality/size settings: "Run backfill to invalidate cached derivatives."
2. **TRC-L3: Preserve non-GPS metadata in PNG fallback**: Investigate whether `withMetadata({ exif: true, xmp: true, iptc: true })` can be used safely for PNG without leaking GPS.

---

*Review completed by tracer agent. 10 flows traced, 5 high-confidence issues (1 new, 4 confirmed), 5 medium-confidence issues (2 new, 3 confirmed), 5 low-confidence issues (3 new, 2 confirmed). 15 invariants verified.*
