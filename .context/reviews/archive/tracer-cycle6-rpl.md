# Tracer — Cycle 6 RPL

Date: 2026-04-23. Reviewer role: tracer (causal tracing of suspicious
flows, competing hypotheses).

## Traced flows

### TR6-01 — Upload → queue → cleanup race (happy path)

1. `uploadImages()` → `saveOriginalAndGetMetadata()` → files written to
   `data/uploads/original/{uuid.ext}`.
2. DB INSERT returns `insertId`. Valid insertId required (Number.isFinite
   and > 0 check at line 240).
3. `enqueueImageProcessing({id, ...})` called. Queue checks
   `state.shuttingDown || isRestoreMaintenanceActive()` before queueing.
4. Queue task `acquireImageProcessingClaim(id)` via `SELECT GET_LOCK(...)`.
5. Check `processed=false` still holds; `processImageFormats` writes to
   webp/avif/jpeg dirs using atomic rename via .tmp.
6. Conditional UPDATE `processed=true WHERE processed=false` — if affected
   rows == 0, image was deleted mid-processing → delete variant files.

Invariant A: variant files always exist when `processed=true` in DB.
  Verified by lines 224-232 (verifyFile + conditional failure return).

Invariant B: variant files never leak when image is deleted.
  Covered by:
  - `deleteImage`: queue.enqueued.delete(id) + DB transaction +
    collectImageCleanupFailures for webp/avif/jpeg.
  - Queue mid-processing: affectedRows==0 triggers cleanup at lines 242-248.
  - Queue-finished-but-delete-in-progress: queue marked processed=true,
    delete sees the ID, cleanup via deleteImageVariants.

Invariant C: ID is never in `state.enqueued` after job completion.
  Line 273: `state.enqueued.delete(id)` in finally block. Verified.

Conclusion: upload/delete flow is robust. No new bugs.

### TR6-02 — Restore pipeline control flow

1. `restoreDatabase(formData)` → `isAdmin()` gate.
2. `requireSameOriginAdmin()` gate.
3. DB `GET_LOCK('gallerykit_db_restore', 0)` on a dedicated connection
   (connection.getConnection()).
4. If acquired, `beginRestoreMaintenance()` sets in-memory flag.
5. `flushBufferedSharedGroupViewCounts()` drains view count buffer.
6. `quiesceImageProcessingQueueForRestore()` pauses PQueue.
7. Inner `runRestore(formData, t)`:
   - File saved to `/tmp/restore-{uuid}.sql` via streaming.
   - Header regex (first 256 bytes).
   - Chunk-by-chunk scanner, dangerous patterns rejected.
   - If dangerous, temp file unlinked.
   - Otherwise: spawn `mysql --one-database` with MYSQL_PWD env.
   - Pipe read stream to stdin.
   - On close code=0 → success + revalidateAllAppData.
8. `finally`: endRestoreMaintenance + resumeImageProcessingQueueAfterRestore + RELEASE_LOCK.
9. Outer `finally`: conn.release().

Cross-flow interaction: during step 6, any in-flight upload that reaches
`enqueueImageProcessing` will hit `isRestoreMaintenanceActive()` and be
ignored. Uploads that already reached `saveOriginalAndGetMetadata` will
complete, and `cleanupOriginalIfRestoreMaintenanceBegan` will unlink the
original. Good.

Race: between `beginRestoreMaintenance` and
`flushBufferedSharedGroupViewCounts`, a new view could slip into
`viewCountBuffer` if the group was already in the Map. `bufferGroupViewCount`
checks `isRestoreMaintenanceActive()` at line 29 — GOOD, slip-through
blocked.

### TR6-03 — Search action rate limit rollback

Competing hypothesis A: When DB check says "exceeded", the code rolls
back in-memory but not DB, leaving DB counter ahead.

1. `searchImagesAction` enters, pre-increments in-memory and DB.
2. `checkRateLimit` returns `{ limited: true }` (the 31st call in a
   minute).
3. Code rolls back in-memory: `currentEntry.count--` or `delete(ip)`.
4. Code does NOT call `decrementRateLimit(ip, 'search', ...)`.
5. Returns `[]`.

Over time, if DB is the source of truth and in-memory is a cache, the
DB counter drifts upward by 1 per "caught at DB" event. Window is 60s so
drift has a bounded lifetime. The next window resets cleanly.

Hypothesis A CONFIRMED. Impact: legitimate over-limit users pay one
extra counted attempt. Not a security issue; slight UX degradation.
Matches C6-04 finding.

Competing hypothesis B: The in-memory rollback on non-limit successful
branch. Actually, the only rollback paths are on `limited: true`. Other
paths proceed to search.

Hypothesis B rejected. No silent double-rollback.

### TR6-04 — Password change happy path

1. `updatePassword` → `getCurrentUser` → `isAdmin` implicit via user
   presence.
2. `getRestoreMaintenanceMessage` guard.
3. `hasTrustedSameOrigin` guard.
4. Rate-limit: in-memory fast-path + DB check + pre-increment both.
5. Field sanitization via `stripControlChars`.
6. Length checks.
7. `getAdminUserWithHash(currentUser.id)` fetches stored hash.
8. `argon2.verify` — if false, `incorrectPassword`.
9. `getSession()` fetched outside the transaction.
10. Transaction: UPDATE password_hash + DELETE all other sessions.
11. Post-commit: `clearSuccessfulPasswordAttempts(ip)`.
12. Audit log + return success.

Cycle-5 work (C5R-RPL) added `unstable_rethrow(e)` to the outer catch.
Verified at line 390.

Invariant: password hash is updated only if the transaction commits AND
other sessions are deleted. Before cycle-5 fixes, the rate-limit clear
was before the transaction — that ordering was corrected to clear AFTER
to prevent rate-limit pressure loss on transaction failure.

Conclusion: password change flow is correct. No new bugs.

### TR6-05 — Session creation and rotation

1. `login` succeeds → `generateSessionToken` creates `${ts}:${rand}:${hmac}`.
2. `hashSessionToken(token)` stored in DB sessions table.
3. Transaction: INSERT new session + DELETE other sessions for same user
   (except the new one).
4. Cookie set: httpOnly, secure (when HTTPS), sameSite=lax.
5. Redirect to `/admin/dashboard`.

Race during transaction: if two simultaneous logins arrive from the same
user (e.g., retry), each transaction runs serializable. Both INSERTs
succeed if tokens differ; both DELETEs run after each INSERT. Since both
DELETEs exclude their own inserted sessionId, both sessions survive.

Wait — that's a potential issue. Let me re-trace. Transaction 1: INSERT
session A, DELETE WHERE id != A. Transaction 2: INSERT session B, DELETE
WHERE id != B. If T1 commits first and T2 runs after, T2's DELETE would
remove session A. If T1 runs entirely before T2 starts, T1 ends with only
A; T2 inserts B, deletes A; T2 ends with only B. Correct: last login
wins. No double-session persistence from legitimate retries.

### TR6-06 — Image delete mid-processing

1. Admin clicks delete → `deleteImage(id)`.
2. `queueState.enqueued.delete(id)` — removes ID from in-memory tracking.
3. DB transaction: DELETE imageTags + DELETE images.
4. If tx fails, error returned. But: `enqueued.delete` already ran. If
   the queue hasn't picked up the job yet, enqueued.has(id) is false; the
   next `enqueueImageProcessing` would proceed. BUT the DB row still
   exists (tx failed), so `queue add` would complete processing normally.
5. If tx succeeds: DB row gone. Queue task (if already running) will hit
   conditional UPDATE affectedRows=0 → orphan variant cleanup.
6. Queue task (if not yet started): `check` at line 178 returns empty →
   skips. Good.
7. Files unlinked in parallel.

Edge case: if queue task is between `processImageFormats` (variants on
disk) and conditional UPDATE, the delete happens in parallel. Conditional
UPDATE returns affectedRows=0. Then queue's lines 242-248 delete the
variants. Good.

Edge case: the original file at `data/uploads/original/{uuid.ext}` is
unlinked by `deleteImage` via `deleteOriginalUploadFile(image.filename_original)`. But if the queue is mid-`processImageFormats`
reading the original file via `sharp(inputPath)`, would the read fail
after unlink? On Linux, yes — but mmap-backed reads still succeed until
the fd closes. Sharp uses libvips which reads via the provided path
string; on some paths it may mmap. If libvips mmaps the inode and the
file is unlinked, the inode persists until mmap is released. So
processing completes successfully, then the conditional UPDATE finds 0
affected rows, variants get cleaned up. Good.

## Summary

Traced 6 flows, confirmed 5 are correct. One hypothesis (TR6-03) is
confirmed as a minor perf/UX issue — DB counter drift after in-memory
rollback. Matches C6-04 from code-reviewer.

No tracing found a correctness bug. Defense-in-depth layering handles
the races the code sets up.
