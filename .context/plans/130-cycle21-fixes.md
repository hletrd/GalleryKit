# Plan 130 — Cycle 21 Fixes

**Created:** 2026-04-19 (Cycle 21)
**Status:** COMPLETE

---

## Findings Addressed

### C21-01: `uploadImages` does not clean up original file when DB insert fails or returns invalid insertId
- **Severity:** MEDIUM / Confidence: HIGH
- **Files:** `apps/web/src/app/actions/images.ts` lines 183-188, 255-259
- **Implementation:** Add cleanup of the saved original file in two places:
  1. **Invalid insertId branch** (after `failedFiles.push(file.name)` at line 188): Call `fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal)).catch(() => {})` to remove the orphaned file.
  2. **Catch block** (around line 258): The `data` variable is scoped inside the `try` block for the per-file loop. Need to restructure slightly so that after a successful `saveOriginalAndGetMetadata()` but a failed DB insert, the original file is cleaned up. Approach: track the saved filename and clean up in the catch.
  Additionally, clean up the other generated filenames (webp, avif, jpeg) if they were generated before the failure — but since `processImageFormats` runs async after DB insert (queued), only the original file exists at this point. So only the original needs cleanup.
- **Progress:** [x] Complete — added `savedOriginalFilename` tracking and cleanup in both invalid-insertId branch and catch block

### C21-02: Missing unit tests for recent correctness fixes
- **Severity:** MEDIUM / Confidence: HIGH
- **Files:** `apps/web/src/__tests__/` — new test files needed
- **Implementation:**
  1. **Upload tracker test** (`apps/web/src/__tests__/upload-tracker.test.ts`): Test that tracker count and bytes don't go negative after all-failed uploads. Test the clamping behavior of `Math.max(0, ...)`. Test partial-failure adjustment. This requires extracting the tracker logic or testing the action with mocks.
  2. **deleteAdminUser test** (`apps/web/src/__tests__/admin-users.test.ts`): Test that deleting a non-existent user returns an error (not success). This is hard to unit test without a DB mock, so this will be deferred pending a test infrastructure improvement.
  3. **revokePhotoShareLink test**: Same DB mock issue. Deferred.
  Given the DB dependency, the most practical approach is to test the **tracker math logic** directly, since it's pure computation. The server action tests will be deferred until a DB mock infrastructure is in place.
- **Progress:** [x] Complete — added upload-tracker.test.ts with 8 tests covering all-fail, partial-fail, full-success, and edge cases. Server action tests deferred pending DB mock infrastructure.

### C21-04: `deleteImage` audit log records event even when transaction deletes 0 rows
- **Severity:** LOW / Confidence: MEDIUM
- **Files:** `apps/web/src/app/actions/images.ts` lines 343-350
- **Implementation:** Check `affectedRows` from the `images` delete inside the transaction. If the images table delete returns 0 rows, skip the audit log. Alternatively, move the audit log inside the transaction and conditionally log only when rows were affected. The simplest approach: capture the delete result in the transaction and conditionally log after.
- **Progress:** [x] Complete — capture `affectedRows` from images delete in transaction, only log audit when `deletedRows > 0`

### C21-07: `deleteAdminUser` doc comment doesn't mention `USER_NOT_FOUND` guard
- **Severity:** LOW / Confidence: LOW
- **Files:** `apps/web/src/app/actions/admin-users.ts` lines 156-157
- **Implementation:** Update the comment from "Atomically check last-admin and delete inside a transaction to prevent TOCTOU race" to "Atomically check last-admin, verify user exists, and delete inside a transaction to prevent TOCTOU race and no-op success on concurrent deletion."
- **Progress:** [x] Complete — updated comment to mention both TOCTOU race and no-op success prevention

---

## Deferred Items

### C21-03: Session cookie `Secure` flag depends on `x-forwarded-proto` which can be spoofed
- **File:** `apps/web/src/app/actions/auth.ts` lines 172-174
- **Original severity:** MEDIUM / Confidence: HIGH
- **Reason for deferral:** Deployment-dependent risk, not a code bug. The Docker deployment uses nginx which correctly sets this header. Adding a `TRUST_PROXY` env var would be a new feature that requires careful consideration of backward compatibility.
- **Exit criterion:** App is deployed without a properly configured reverse proxy, or a security audit flags header trust as a risk.

### C21-05: `searchImages` runs two sequential DB queries
- **File:** `apps/web/src/lib/data.ts` lines 612-652
- **Original severity:** LOW / Confidence: MEDIUM
- **Reason for deferral:** Low-priority performance optimization. Search is admin-only and the current approach is optimized for the common case (main query returns enough results).
- **Exit criterion:** Search latency becomes a user-reported issue, or search is opened to public users.

### C21-06: Mobile EXIF section scrolling
- **File:** `apps/web/src/components/info-bottom-sheet.tsx`
- **Original severity:** LOW / Confidence: MEDIUM
- **Reason for deferral:** Minor UX concern. The bottom sheet already supports scrolling and the fields are in an expandable section. A "Show more" toggle would be a UI feature addition.
- **Exit criterion:** User feedback about scrolling difficulty on mobile, or a general mobile UX improvement sprint.
