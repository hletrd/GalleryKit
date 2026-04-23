# Test Engineer -- Cycle 1 (Fresh)

## Files Reviewed
All test files in `apps/web/src/__tests__/` plus action files and lib modules

## T1-01: No tests for `proxy.ts` middleware auth guard logic
**File:** `apps/web/src/proxy.ts`
**Severity:** HIGH | **Confidence:** High
**Problem:** The `isProtectedAdminRoute` function and middleware auth guard have zero test coverage. This is the first line of defense for all admin routes -- a bug here would expose the admin dashboard to unauthenticated access.
**Fix:** Create `apps/web/src/__tests__/proxy.test.ts` covering:
- `/admin/dashboard` (protected)
- `/admin` (NOT protected -- login page)
- `/en/admin/dashboard` (protected with locale prefix)
- `/admin/` (protected)
- Valid vs invalid cookie format (3 colon-separated parts)

## T1-02: No tests for EXIF extraction edge cases
**File:** `apps/web/src/lib/process-image.ts` `extractExifForDb` function
**Severity:** MEDIUM | **Confidence:** Medium
**Problem:** The `extractExifForDb` function has many conditional branches (metering modes, flash bits, exposure programs, GPS conversion) with no direct test coverage. The `parseExifDateTime` function IS tested, but the extraction function itself is not.
**Fix:** Create `apps/web/src/__tests__/exif-extraction.test.ts` covering:
- All metering modes (0-6)
- Flash bit combinations
- Exposure programs (0-8)
- GPS coordinate conversion with valid/invalid DMS
- Color space mapping
- White balance mapping

## T1-03: No test for `updateImageMetadata` with null existingImage
**File:** `apps/web/src/app/actions/images.ts` lines 575-576
**Severity:** MEDIUM | **Confidence:** Medium
**Problem:** There's no test verifying what happens when `updateImageMetadata` is called for an image that was deleted between the caller's check and the SELECT. The code proceeds to UPDATE even when `existingImage` is undefined.
**Fix:** Add a test case in `images-actions.test.ts` for the null existingImage scenario.

## T1-04: `images-actions.test.ts` does not cover upload tracker cumulative limits
**File:** `apps/web/src/app/actions/images.ts` upload tracker logic
**Severity:** LOW | **Confidence:** Low
**Problem:** The upload tracker's cumulative byte/file counting across per-file invocations is not tested. This is a critical anti-abuse mechanism.
**Fix:** Add test cases for: cumulative byte limit exceeded, file count limit exceeded, window expiry reset, tracker pruning.

## Existing Test Coverage Assessment

**Good coverage:**
- `auth-rate-limit.test.ts` -- login/password rate limiting
- `session.test.ts` -- session token generation/verification
- `sql-restore-scan.test.ts` -- dangerous SQL detection
- `sanitize.test.ts` -- control character stripping
- `request-origin.test.ts` -- same-origin validation
- `serve-upload.test.ts` -- file serving security
- `validation.test.ts` -- slug/filename validation
- `privacy-fields.test.ts` -- compile-time privacy guard
- `exif-datetime.test.ts` -- EXIF date parsing
- `base56.test.ts` -- share key generation

**Missing coverage:**
- `proxy.ts` middleware (0 tests)
- `extractExifForDb` function (0 tests)
- Upload tracker cumulative limits (0 tests)
- `db-actions.ts` backup/restore (0 tests -- requires child process mocking)
