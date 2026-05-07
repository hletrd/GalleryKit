# debugger — cycle 9 rpl

HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f`.

## Latent bug surface

### D-1. `updatePassword` form-field validation vs rate-limit ordering (confirmed bug) [MEDIUM / HIGH]
See C9R-RPL-01. This is the highest-severity defect this cycle.

### D-2. `getNextFlushInterval` exponent overflow [LOW / LOW]
- `data.ts:22-26`.
- `Math.pow(2, Math.min(consecutiveFlushFailures - 3, 5))` caps exponent at 5 → max 2^5 = 32 → base*32 = 160000ms = 2m40s. Then `Math.min(backoff, MAX_FLUSH_INTERVAL_MS)` enforces 5-minute cap. No overflow; the cap-at-5 plus MAX bound makes this defensive. Not a bug, confirmation pass.

### D-3. `enqueueImageProcessing` recursive retry has no backoff for DB claim failures [LOW / MEDIUM]
- `image-queue.ts:194-200`.
- `CLAIM_RETRY_DELAY_MS = 5000` and `delay = CLAIM_RETRY_DELAY_MS * Math.min(claimRetries, 5)` gives max 25-second retry. That's reasonable. But `enqueueImageProcessing` is called recursively (line 197 via setTimeout → line 163 → state.queue.add). If the claim keeps failing, the queue is getting its add-back call 10 times × 25s apart. Fine for correctness; observational only.

### D-4. `processImageFormats` atomic-rename cascade can leak .tmp files on `fs.link` / `fs.rename` double-failure [LOW / MEDIUM]
- `process-image.ts:417-435`.
- Nested try/catch with `fs.link → fs.rename`, fallback to `fs.copyFile → fs.rename`, then final fallback to `fs.copyFile → basePath`. The `finally` does `fs.unlink(tmpPath).catch(() => {})`. If the FINAL fs.copyFile succeeds but `fs.unlink(tmpPath)` fails, an orphan .tmp file remains. But `cleanOrphanedTmpFiles` at boot handles this. Good architecture.

### D-5. `restoreDatabase` `conn.release()` runs AFTER `endRestoreMaintenance` and queue resume [LOW / MEDIUM]
- `db-actions.ts:300-314`.
- Order: `endRestoreMaintenance()` → `resumeImageProcessingQueueAfterRestore()` (async) → `RELEASE_LOCK` → `conn.release()` (in outer finally).
- If `resumeImageProcessingQueueAfterRestore()` throws, execution still reaches the outer finally and `conn.release()` runs — OK.
- If the `RELEASE_LOCK` query itself hangs (DB deadlock, network timeout), the pool connection is held until that query times out. Pool default mysql2 has `connectTimeout` but not `queryTimeout` on individual queries. If `gallerykit_db_restore` holds one pool connection forever, that's 1 of 10 pool slots — manageable but not infinite-safe.
- Fix: add a query timeout wrapper around the RELEASE_LOCK call, or use `conn.query({ sql: '...', timeout: 5000 })`.

### D-6. `recordFailedLoginAttempt` is exported but no longer called [LOW / LOW]
- `auth-rate-limit.ts:20-27`.
- Exported function is used only in tests (grep confirms). Removing or marking internal would reduce API surface. Dead export — observational.

### D-7. `bufferGroupViewCount` cannot distinguish "first flush after outage" from "steady-state" [LOW / LOW]
- `data.ts:28-42`.
- When the process restarts after a long outage, `viewCountBuffer` is empty so the first view re-triggers the timer. That timer picks `getNextFlushInterval()` = BASE_FLUSH_INTERVAL_MS because `consecutiveFlushFailures` was reset. Correct behavior — the backoff state correctly resets on process restart. No bug.

## Not issues / positive audits

- `deleteImages` transaction-wrapped FK-cascade delete — correct.
- `createTopic` catches `ER_DUP_ENTRY` instead of check-then-insert — correct TOCTOU handling.
- Session secret caching with `sessionSecretPromise` singleton is race-free.
- Image queue shutdown drain uses `onPendingZero` — correct API.
- `pruneRetryMaps` runs in queue gc cycle — prevents unbounded retry-count memory growth.
- `cleanOrphanedTmpFiles` narrowed ENOENT catch (C8R-RPL-04) to avoid silencing EACCES/EIO/EMFILE.
- `isIgnorableRestoreStdinError` only ignores EPIPE and ERR_STREAM_DESTROYED (both expected during shutdown) — correct.
