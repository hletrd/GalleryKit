# Debugger — Cycle 5 (RPL loop)

Generated: 2026-04-24. HEAD: `0000000789a97f7afcb515eacbe40555cee7ca8f`.

Scope: latent bug surface, failure modes, regressions.

## Findings

### D5-01 — `check-action-origin.ts` silently passes arrow-function mutating actions
- **Severity:** LOW. **Confidence:** HIGH. Cross-ref C5-01 / S5-01 / V5-F01 / CR5-01 / TR5-01.
- **Failure mode:** future refactor converts a server action to arrow form, omits `requireSameOriginAdmin()`, lint returns 0, CI passes, the defense-in-depth layer vanishes.

### D5-02 — `flushGroupViewCounts` re-buffer path uses `viewCountBuffer.set(groupId, ...)` without `Number.isFinite` check on `count`
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/lib/data.ts:72-77`.
- **Evidence:** the re-buffer updates `count` with `viewCountBuffer.get(groupId) ?? 0) + count`. If `count` were somehow NaN (e.g. a DB-update rejection that mutated the count before the catch), the re-buffered value would be NaN. `Map.set(key, NaN)` propagates in subsequent flushes as `NaN + 1 = NaN`, ultimately turning into a `view_count = view_count + NaN` SQL which MySQL rejects as a runtime error, creating a never-resolving re-buffer loop.
- **Likelihood:** very low — the code path that sets count is `viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + 1)` with +1 integers. Count cannot become NaN via normal flow. Observational.
- **Fix direction:** none needed unless we want belt-and-suspenders.

### D5-03 — `bootstrapImageProcessingQueue` swallows non-ECONNREFUSED errors as `console.error` but still continues with `state.bootstrapped = false`
- **Severity:** LOW. **Confidence:** HIGH.
- **File:** `apps/web/src/lib/image-queue.ts:337-343`.
- **Evidence:** the catch block logs but does not re-throw. Subsequent calls to `bootstrapImageProcessingQueue` check `state.bootstrapped` first; since it was never set to `true` on error, retries can happen via `resumeImageProcessingQueueAfterRestore`. Good.
- **Disposition:** verified, no finding.

### D5-04 — `enqueueImageProcessing` retry recursion may stack `setTimeout` timers forever if job claim keeps failing
- **Severity:** LOW. **Confidence:** HIGH.
- **File:** `apps/web/src/lib/image-queue.ts:155-175`.
- **Evidence:** claim failures retry up to `MAX_CLAIM_RETRIES = 10`, then give up. Retry delay escalates up to 25s. Bounded. Good.
- **Disposition:** verified, no finding.

### D5-05 — `deleteImage` + concurrent queue processing races on `enqueued.delete(id)` before transaction commits
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/app/actions/images.ts:378-388`.
- **Evidence:** the delete flow calls `queueState.enqueued.delete(id)` BEFORE starting the DB transaction. If the queue worker claims the image between this call and the transaction commit, the worker sees a row still-present-but-about-to-be-deleted. The worker's conditional UPDATE (`WHERE processed = false`) will flip `processed = true` after the delete's `SELECT ... WHERE eq(images.id, id)` fetched filenames but before the transaction commits. On the delete side, the transaction may then try to delete a now-`processed=true` row that has had variants already written.
- **Actual impact:** the queue worker writes WebP/AVIF/JPEG files, then tries to UPDATE with `WHERE processed = false`. If `deleteImage` has started a transaction that's holding row locks, the worker's UPDATE waits. When deleteImage commits the delete, the worker's UPDATE `affectedRows` is 0 and it cleans up the variants it just wrote. Correct behavior.
- **Disposition:** verified, no bug. The delete-files-after-DB-commit flow works.

### D5-06 — `exportImagesCsv` may hit V8 string length limits for very large galleries
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:83-102`.
- **Evidence:** the final `csvLines.join("\n")` creates a single string. V8's max string length is 2^30 - 1 characters (~1GB). At 50k rows, it would fit. Observational.
- **Disposition:** existing deferred (D2-03 CSV streaming). No new work.

### D5-07 — `updateTopic` slug-rename transaction hoists affectedRows out of the transaction via mutable closure variable
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/app/actions/topics.ts:209-251`.
- **Evidence:** `affectedRows` is declared `let` outside the transaction callback, mutated inside. If the transaction retries (e.g. on deadlock), the previous value leaks. In practice `db.transaction` doesn't retry automatically; if it did, we'd have a bug.
- **Disposition:** verified current behavior is correct. If retry semantics change, this is a latent bug. Observational.

### D5-08 — `saveOriginalAndGetMetadata` streams to disk but does not fsync before sharp reads
- **Severity:** LOW. **Confidence:** LOW.
- **File:** `apps/web/src/lib/process-image.ts:242-257`.
- **Evidence:** `pipeline(nodeStream, createWriteStream(originalPath, { mode: 0o600 }))` — `pipeline` waits for finish but not for fsync. On SIGKILL during upload, the file may be partially flushed. Sharp reads directly by path; on most filesystems with kernel cache, this works fine because the data is in the page cache even without fsync. Only a power-loss scenario would be affected.
- **Disposition:** no action. Fsync is expensive and adds no value for the upload-then-process flow.

### D5-09 — `cleanOrphanedTmpFiles` readdir fails silently
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/lib/image-queue.ts:26-37`.
- **Evidence:** if `fs.readdir(dir)` throws (e.g. permission denied because the dir was created with wrong uid), the catch swallows the error. The tmp file leak persists forever.
- **Fix direction:** log when readdir fails for a reason other than ENOENT. Low priority; legitimate ENOENT during cold-start is expected.

### D5-10 — `restoreDatabase` temp file may leak if `containsDangerousSql` throws (not just returns true)
- **Severity:** LOW. **Confidence:** LOW.
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:347-365`.
- **Evidence:** the scan loop's try/finally closes `scanFd` but only calls `fs.unlink(tempPath)` on the dangerous-SQL return path. If `containsDangerousSql` throws synchronously, the temp file leaks to /tmp until the next reboot.
- **Fix direction:** wrap the scan block in try/catch that unlinks tempPath on any throw. Low priority — `containsDangerousSql` is regex-only, very unlikely to throw.

### D5-11 — `/api/admin/db/download` concurrency — multiple admins downloading simultaneously
- **Severity:** LOW. **Confidence:** HIGH.
- **Evidence:** from prior cycle verification, route uses stream-pipe. Concurrent downloads each get their own read stream; no shared state. No bug.

## Summary

11 LOW findings, mostly observational or matched to existing backlog. Actionable:
- D5-01 — matches consensus on the lint gap (cross-ref C5-01).
