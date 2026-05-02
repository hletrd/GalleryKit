# Cycle 12 Code Review — Code Reviewer

## Review Scope
All source files under `apps/web/src/` excluding `__tests__/` and `ui/` component library.

## Findings

### C12-CR-01 (Medium/Medium): `restoreDatabase` does not release advisory lock on `beginRestoreMaintenance()` early-return when `uploadContractLock` acquisition fails

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:293-299`
- **Issue**: When `beginRestoreMaintenance()` returns true but `acquireUploadProcessingContractLock(0)` returns null (upload in progress), the code correctly releases the DB restore advisory lock and the upload contract lock. However, the `endRestoreMaintenance()` call is missing. The `beginRestoreMaintenance()` call sets an in-process flag that `isRestoreMaintenanceActive()` checks. Without calling `endRestoreMaintenance()`, the flag remains set and ALL subsequent upload/restore attempts see "restore in progress" until the process restarts. This is not just a UI inconvenience — it blocks all uploads indefinitely.
- **Fix**: Add `endRestoreMaintenance()` before the early return at line 319.
- **Confidence**: Medium — the `beginRestoreMaintenance` flag is a module-level boolean that only resets on `endRestoreMaintenance()` or process restart. The missing call creates a persistent stuck state.

### C12-CR-02 (Medium/Medium): `restoreDatabase` does not call `endRestoreMaintenance()` on `quiesceImageProcessingQueueForRestore` failure

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:323-329`
- **Issue**: When `flushBufferedSharedGroupViewCounts()` or `quiesceImageProcessingQueueForRestore()` throws, the function returns an error without calling `endRestoreMaintenance()`. The `beginRestoreMaintenance()` flag was set at line 301, so this early return leaves the process in permanent "restore in progress" state — same impact as C12-CR-01.
- **Fix**: Add `endRestoreMaintenance()` in the catch block before the early return at line 329.
- **Confidence**: Medium — same stuck-state risk as C12-CR-01.

### C12-CR-03 (Low/Low): `exportImagesCsv` uses `results = [] as typeof results` pattern to release GC reference

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:98`
- **Issue**: The comment says "Release reference to allow GC" but the cast `as typeof results` retains the full type width. This is a style concern — the pattern works but the cast is misleading. A more conventional approach would be `results.length = 0` or scoping the results in a block. No functional impact.
- **Fix**: Consider using a block scope or `results.length = 0` instead of the type-asserted reassignment.
- **Confidence**: Low — cosmetic, no functional issue.

### C12-CR-04 (Low/Low): `db-actions.ts` `restoreDatabase` holds advisory lock through `runRestore` but `runRestore` spawns a child process

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:331`
- **Issue**: `runRestore` spawns a `mysql` child process and waits for it to complete. The advisory lock is held on a dedicated pool connection for the entire duration. If the mysql process hangs (e.g., very large import), the advisory lock connection is consumed indefinitely. This is documented behavior (CLAUDE.md mentions the advisory lock is held for the entire restore window), but the connection is not released until the child process completes. In a single-writer topology this is acceptable but worth noting.
- **Fix**: No fix needed — this is by design per CLAUDE.md.
- **Confidence**: Low — informational only.

### C12-CR-05 (Low/Medium): `getImageByShareKey` sequential tag query timing side-channel

- **File+line**: `apps/web/src/lib/data.ts:895-901`
- **Issue**: Already flagged as C6F-06 / C11-LOW-02 in prior cycles. The sequential tag query after the main image query creates a minor timing difference between "valid key, image found" and "invalid key, no image found". The 57-bit key entropy makes brute-force impractical. Confirming this remains valid and deferred.
- **Fix**: Already deferred.
- **Confidence**: Low — confirming existing deferred item.

## Summary
- Total findings: 5
- Medium severity: 2 (C12-CR-01, C12-CR-02 — both `endRestoreMaintenance` missing)
- Low severity: 3
