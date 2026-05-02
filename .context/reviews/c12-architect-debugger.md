# Cycle 12 Architect/Debugger Review

## Review Scope
Architectural risks, coupling, layering, latent bugs, failure modes, causal tracing of error paths.

## Findings

### C12-AD-01 (Medium/High): `restoreDatabase` `beginRestoreMaintenance` flag not reset on error — stuck state analysis

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:293-329`
- **Issue**: Full causal trace of the `beginRestoreMaintenance()` lifecycle:
  1. `restoreDatabase` calls `beginRestoreMaintenance()` at line 301 — sets module-level boolean to `true`.
  2. If `acquireUploadProcessingContractLock(0)` returns null (line 293-294): the code releases the advisory lock but does NOT call `endRestoreMaintenance()`. The boolean stays `true`.
  3. If `quiesceImageProcessingQueueForRestore()` throws (line 323-328): the code returns error but does NOT call `endRestoreMaintenance()`. The boolean stays `true`.
  4. `isRestoreMaintenanceActive()` is checked by: `uploadImages`, `deleteImage`, `updateImageMetadata`, `createTopic`, `updateTopic`, `deleteTopic`, `createPhotoShareLink`, `createGroupShareLink`, `updatePassword`, `createAdminUser`, `deleteAdminUser`, `loadMoreImages`, `searchImagesAction`, `bufferGroupViewCount`. ALL of these will return "restore in progress" errors.
  5. The flag only resets on: `endRestoreMaintenance()` (called in the inner `finally` at line 333) or process restart.
  
  **Impact**: The `acquireUploadProcessingContractLock(0)` path is reachable whenever an upload is in progress — this is a common state during normal operation. An admin clicking "restore" while an upload is processing will lock out ALL admin mutations until the process restarts.
  
  This is the same finding as C12-CR-01, C12-CR-02, C12-SR-01, and C12-TE-01, but I'm providing the full causal trace here to establish the severity.
- **Fix**: Add `endRestoreMaintenance()` before both early returns (lines 319 and 329). Also add unit tests for the flag lifecycle.
- **Confidence**: High — traced the full call chain.

### C12-AD-02 (Low/Medium): `data.ts` is approaching 1300 lines and growing

- **File+line**: `apps/web/src/lib/data.ts`
- **Issue**: Already flagged as D2-MED/D3-MED in prior cycles. The file contains view count buffering, privacy guards, cursor normalization, multiple listing queries, and SEO settings. Confirming this remains valid and deferred.
- **Fix**: Already deferred.
- **Confidence**: Low — confirming existing deferred item.

### C12-AD-03 (Low/Low): `image-queue.ts` `bootstrapContinuationScheduled` flag is only cleared inside `onIdle` callbacks

- **File+line**: `apps/web/src/lib/image-queue.ts:423-437`
- **Issue**: `scheduleBootstrapContinuation` sets `state.bootstrapContinuationScheduled = true` and clears it in the `onIdle().then()` and `.catch()` callbacks. If the PQueue `onIdle` promise never resolves (unlikely but theoretically possible if the queue enters a stuck state), the continuation flag would remain set and `bootstrapImageProcessingQueue` would skip all subsequent bootstrap attempts. The `bootstrapRetryTimer` provides a fallback for claim-retry scenarios, but a permanently stuck queue would not be retried. This is a theoretical risk at personal-gallery scale.
- **Fix**: Consider a timeout on `onIdle()` to detect stuck queues. Low priority.
- **Confidence**: Low — theoretical risk with no observed reproduction.

## Summary
- Total findings: 3
- Medium severity: 1 (C12-AD-01, overlaps with findings from other agents)
- Low severity: 2
