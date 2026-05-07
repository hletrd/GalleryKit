# Verifier Review — Cycle 21

**Reviewer:** verifier
**Date:** 2026-04-19

## Review Scope

Evidence-based correctness check against stated behavior.

## Findings

### VER-21-01: Upload tracker clamping fix (C20-01) verified — correctly implemented [INFO]
- **File:** `apps/web/src/app/actions/images.ts` lines 276-281
- **Description:** Verified that `Math.max(0, ...)` is applied to both `count` and `bytes` after adjustment. The comment accurately describes the additive adjustment pattern. The fix matches the specification from the cycle 20 review.

### VER-21-02: `deleteAdminUser` no-op fix (C20-02) verified — correctly implemented [INFO]
- **File:** `apps/web/src/app/actions/admin-users.ts` lines 163-167, 179-181
- **Description:** The transaction now checks for the target user's existence before deleting. If the user is not found, it throws `USER_NOT_FOUND` which is caught and returned as an error. This correctly prevents the no-op success scenario.

### VER-21-03: `uploadImages` does not delete original file when DB insert returns invalid insertId [MEDIUM] [MEDIUM confidence]
- **File:** `apps/web/src/app/actions/images.ts` lines 183-188
- **Description:** When `insertId` is invalid (not finite or <= 0), the code logs an error and pushes the file to `failedFiles`, then `continue`s. However, the original file was already saved to disk by `saveOriginalAndGetMetadata`. The code does not delete this orphaned file. This is the same root cause as DBG-21-01 but for a different failure path (invalid insertId vs. DB connection failure).
- **Concrete failure scenario:** A MySQL driver bug returns `NaN` as insertId. The original file is saved but the image is not in the DB. The file remains on disk indefinitely.
- **Fix:** After the `failedFiles.push(file.name)`, add cleanup:
  ```typescript
  await fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal)).catch(() => {});
  ```

### VER-21-04: `processImageFormats` correctly uses atomic rename for base filename — verified [INFO]
- **File:** `apps/web/src/lib/process-image.ts` lines 378-396
- **Description:** The link-then-rename pattern is correctly implemented with proper fallback chains and cleanup in the `finally` block.

## Summary
- 0 CRITICAL findings
- 1 MEDIUM finding (orphaned file on invalid insertId — same as DBG-21-01)
- 0 LOW findings
- 3 INFO findings
