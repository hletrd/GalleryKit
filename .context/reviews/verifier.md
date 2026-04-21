# Cycle 6 Verifier Notes

## Findings

### C6-01 — `runRestore()` has no listener for the writable side of the child-process pipe
- **Severity:** HIGH
- **Confidence:** High
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:362-416`
- **What I verified:** the code registers handlers for `readStream`, `restore`, and `restore.stderr`, but not for `restore.stdin`. The final `readStream.pipe(restore.stdin)` therefore depends on default stream behavior when the child closes early.
- **Failure scenario:** early `mysql` exit can surface a writable-stream error that bypasses the existing typed restore result handling.

### C6-03 — There is still no regression proof for the restore-stream and fatal-shell fallback contracts
- **Severity:** LOW
- **Confidence:** High
- **Citations:** `apps/web/src/__tests__/restore-maintenance.test.ts:1-43`
- **What I verified:** the current test suite covers restore-maintenance flags only; there is no unit coverage for classifying benign restore-pipe errors or deriving the fatal-shell brand from live metadata.
