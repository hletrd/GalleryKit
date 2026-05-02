# Cycle 12 Test Engineer Review

## Review Scope
Test coverage, test quality, missing tests for recent fixes, flaky test risk.

## Findings

### C12-TE-01 (Medium/High): No test for `restoreDatabase` missing `endRestoreMaintenance()` on error paths

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:293-329`
- **Issue**: The `restoreDatabase` function has two error paths after `beginRestoreMaintenance()` that do not call `endRestoreMaintenance()`. This is a correctness bug (not just a test gap), but it also means there is no test covering the maintenance flag lifecycle on error paths. The existing `restore-maintenance.test.ts` and `restore-upload-lock.test.ts` tests cover the happy path and lock contention, but not the specific scenario where `acquireUploadProcessingContractLock` returns null or `quiesceImageProcessingQueueForRestore` throws.
- **Fix**: Add `endRestoreMaintenance()` to both error paths AND add a test that verifies `isRestoreMaintenanceActive()` returns false after these error scenarios.
- **Confidence**: High — the bug and test gap coexist.

### C12-TE-02 (Low/Medium): `buildCursorCondition` boundary tests still deferred

- **File+line**: `apps/web/src/lib/data.ts:547-570`
- **Issue**: Already flagged as C9-TE-03 in prior cycles. The cursor condition builder handles dated/undated transitions but lacks edge-case boundary tests (e.g., exactly equal `created_at` + `capture_date` with different IDs). Confirming this remains valid and deferred.
- **Fix**: Already deferred.
- **Confidence**: Low — confirming existing deferred item.

### C12-TE-03 (Low/Low): `pruneRetryMaps` does not prune `permanentlyFailedIds`

- **File+line**: `apps/web/src/lib/image-queue.ts:89-101`
- **Issue**: Already flagged as C11-LOW-04 in prior cycles. The `permanentlyFailedIds` set has its own cap but `pruneRetryMaps` does not check it. The cap is enforced at insertion time. Confirming this remains valid and deferred.
- **Fix**: Already deferred.
- **Confidence**: Low — confirming existing deferred item.

## Summary
- Total findings: 3
- Medium severity: 1 (C12-TE-01, overlaps with C12-CR-01 and C12-SR-01)
- Low severity: 2
