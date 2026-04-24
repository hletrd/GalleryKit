# Tracer — Cycle 14 (current run)

**Reviewer:** tracer (causal investigation, competing hypotheses)
**Scope:** Trace the lifecycle of a single upload + share + restore through the codebase to detect any divergence from the documented flow.

## Methodology

Walked the upload → process → share → revoke → restore lifecycle:

1. **Upload.** `uploadImages()` → `pruneUploadTracker()` → register entry → validate topic/tags → `statfs` disk-space check → `MAX_TOTAL_UPLOAD_BYTES` check → cumulative byte check → pre-claim → per-file `saveOriginalAndGetMetadata` → DB insert with `Number(insertId)` validation → tags via `ensureTagRecord` → `enqueueImageProcessing` (fire-and-forget) → `settleUploadTrackerClaim` reconciles → audit log → revalidate.
2. **Process.** `enqueueImageProcessing` → `getProcessingQueueState` (global symbol) → check `shuttingDown / restoreMaintenance` → claim DB advisory lock via `GET_LOCK` → row-exists check → `fs.access(originalPath)` → `processImageFormats` (parallel webp+avif+jpeg, sized variants, atomic rename via `.tmp`) → file verify → conditional UPDATE only if `processed = false` → if 0 rows affected, image was deleted mid-processing — clean up variants → release advisory lock → exponential retry on transient failures.
3. **Share.** `createPhotoShareLink` → `requireSameOriginAdmin` → image existence + `processed` check → in-memory rate limit pre-increment → DB rate limit pre-increment + check → `generateBase56` → conditional UPDATE on `share_key IS NULL` → on collision retry up to 5 times → on non-retryable error roll back BOTH rate-limit counters.
4. **Revoke.** `revokePhotoShareLink` → conditional UPDATE on `share_key = oldShareKey` → returns `noActiveShareLink` if a concurrent admin already changed it.
5. **Restore.** `restoreDatabase` → `requireSameOriginAdmin` → dedicated pool connection → MySQL advisory lock `gallerykit_db_restore` → `beginRestoreMaintenance` → `flushBufferedSharedGroupViewCounts` → `quiesceImageProcessingQueueForRestore` → `runRestore` (header validation, chunk-scan SQL, spawn `mysql --one-database`) → `endRestoreMaintenance` → `resumeImageProcessingQueueAfterRestore` → release advisory lock.

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| (none new) | Each step in the trace matches the documented behavior. | — | — | — |

### Specific edge re-checks

- **Race: upload-while-processing.** Conditional `WHERE processed = false` UPDATE + claim advisory lock guarantees only one worker processes a given id.
- **Race: delete-while-processing.** `getProcessingQueueState().enqueued.delete(id)` is called inside `deleteImage` and `deleteImages`. Both single + batch delete are wrapped in transactions for `imageTags + images` atomicity.
- **Race: share-key collision.** Conditional UPDATE on `share_key IS NULL` + collision-only retry catches `ER_DUP_ENTRY`.
- **Race: concurrent restore + new uploads.** `cleanupOriginalIfRestoreMaintenanceBegan` is called after `saveOriginalAndGetMetadata`.
- **Race: queue bootstrap during restore.** `bootstrapImageProcessingQueue` checks `state.shuttingDown || isRestoreMaintenanceActive()` before scanning unprocessed rows.

### Historical 2026-04-19 trace findings re-checked

- **DBG-14-01.** Verification-failure return without throw bypasses in-process retry. Bootstrap on restart catches it. DEFER (C14-DEFER-01).
- **DBG-14-02.** `deleteImage` deletes the original BEFORE the queue's claim check. NO orphan in normal flow. NOT a finding.

## Verdict

No causal-flow regressions. Trace is consistent with cycle 13's verdict.
