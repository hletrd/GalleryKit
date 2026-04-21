# Cycle 6 Test Engineer Notes

## Findings

### C6-03 — Missing regression coverage for restore-stream failure handling
- **Severity:** LOW
- **Confidence:** High
- **Citations:** absence of tests covering `apps/web/src/app/[locale]/admin/db-actions.ts:362-416` and `apps/web/src/lib/db-restore.ts`
- **Failure scenario:** a future refactor drops or broadens stdin error handling and restore failures go back to surfacing raw stream exceptions.
- **Suggested fix:** add focused unit tests for the restore-pipe error classifier/helper.

### C6-04 — Missing regression coverage for fatal-shell brand derivation
- **Severity:** LOW
- **Confidence:** High
- **Citations:** absence of tests covering `apps/web/src/app/global-error.tsx`
- **Failure scenario:** a future metadata/layout refactor removes the brand handoff and the fatal shell silently reverts to stale static branding.
- **Suggested fix:** move the brand-derivation logic into a small pure helper and unit test dataset/document-title/fallback behavior.
