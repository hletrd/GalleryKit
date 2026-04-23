# Document Specialist Review — Cycle 21

**Reviewer:** document-specialist
**Date:** 2026-04-19

## Review Scope

Doc/code mismatches against authoritative sources.

## Findings

### DOC-21-01: CLAUDE.md states "TypeScript 6" but current TypeScript version should be verified [LOW] [LOW confidence]
- **File:** `CLAUDE.md` line "TypeScript 6"
- **Description:** The CLAUDE.md states the tech stack uses "TypeScript 6" but this should be verified against the actual `package.json` dependency. This is a known deferred item (DOC-38-01). The actual version in `package.json` should be checked and the doc updated if there's a mismatch.
- **Status:** DEFERRED (matches existing DOC-38-01)

### DOC-21-02: Upload tracker comment now accurate after C20-03 fix [INFO]
- **File:** `apps/web/src/app/actions/images.ts` lines 266-275
- **Description:** The upload tracker adjustment comment was updated in cycle 20 to accurately describe the additive adjustment pattern and clamping behavior. The comment now matches the code implementation.

### DOC-21-03: `deleteAdminUser` doc comment could clarify the `USER_NOT_FOUND` error [LOW] [LOW confidence]
- **File:** `apps/web/src/app/actions/admin-users.ts` lines 156-157
- **Description:** The comment says "Atomically check last-admin and delete inside a transaction to prevent TOCTOU race" but doesn't mention the `USER_NOT_FOUND` guard added in cycle 20. Adding a brief note would help future developers understand why the `SELECT` before `DELETE` exists.
- **Fix:** Update the comment to: "Atomically check last-admin, verify user exists, and delete inside a transaction to prevent TOCTOU race and no-op success on concurrent deletion."

## Summary
- 0 CRITICAL findings
- 0 MEDIUM findings
- 2 LOW findings (1 deferred, 1 new)
- 1 INFO finding
