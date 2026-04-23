# Critic Review — Cycle 21

**Reviewer:** critic
**Date:** 2026-04-19

## Review Scope

Multi-perspective critique of the whole change surface.

## Findings

### CRI-21-01: Orphaned original files on upload failure — systemic issue across multiple failure paths [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/app/actions/images.ts` lines 135-259
- **Description:** This is the same finding as DBG-21-01 and VER-21-03 but viewed holistically. There are at least 3 failure paths where the original file is saved to disk but the DB record is not created:
  1. Invalid `insertId` (line 184-188) — file not cleaned up
  2. DB insert throws an error (general catch at line 255) — file not cleaned up
  3. Tag processing fails (line 237-239) — but image IS in the DB, so this is not an orphan
  The first two paths create orphaned files that accumulate over time. This is a systemic issue rather than an isolated bug.
- **Fix:** Add a cleanup step in the catch block and the invalid-insertId branch to delete the saved original file.

### CRI-21-02: Upload flow has two separate error-reporting mechanisms that can conflict [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/app/actions/images.ts` lines 262-299
- **Description:** When `successCount === 0 && failedFiles.length > 0`, the function returns `{ error: t('allUploadsFailed') }`. This is a different shape than the partial-success return `{ success: true, count, failed, replaced }`. The client must handle two different return shapes from the same action. This is a minor API design concern — the client code must check for both `error` and `success` properties.
- **Concrete failure scenario:** Client code checks `result.success` without also checking `result.error`. When all uploads fail, `result.success` is undefined and `result.error` is set. Client shows nothing instead of an error message.
- **Fix:** This is a pre-existing pattern that works because the client already handles both shapes. Low priority.

### CRI-21-03: Codebase quality is high — consistent patterns, good error handling, clear documentation [INFO]
- **Description:** The codebase consistently applies security patterns (pre-increment rate limits, timing-safe comparisons, privacy guards), handles errors gracefully (try/catch with rollback), and documents design decisions clearly. The recent fixes (C20-01, C20-02, C19-01, C19-02, C19-03) are all well-implemented and follow the established patterns.

## Summary
- 0 CRITICAL findings
- 1 MEDIUM finding (orphaned files — same as DBG-21-01/VER-21-03)
- 1 LOW finding (dual return shapes)
- 1 INFO finding
