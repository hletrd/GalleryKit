# Code Reviewer — Cycle 20

## Review Scope
All server actions (auth, images, topics, tags, sharing, admin-users, settings, seo, public), middleware, data layer, image processing pipeline, session management, rate limiting, storage abstraction, upload serving, sanitization, and queue management.

## New Findings

### CR-20-01: `searchImagesAction` pre-increments in-memory counter BEFORE checking if the query is too short/empty — wasted rate-limit budget on no-op calls [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/public.ts` lines 24-59
- **Description**: The function checks `query.trim().length < 2` at line 26 and returns early, but the in-memory rate limit pre-increment at lines 55-59 runs before the DB check at line 63. However, looking more carefully, the pre-increment happens at lines 55-59, and the early return at line 26 happens BEFORE the rate-limit code. So the early-return path correctly skips the rate limit. This finding is NOT an issue upon deeper analysis — the control flow is correct.
- **Verdict**: Not an issue — control flow is correct.

### CR-20-02: `deleteAdminUser` transaction does not verify the target user exists before deletion [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/admin-users.ts` lines 157-166
- **Description**: The transaction counts all admins to prevent deleting the last one, then deletes sessions and the admin user by ID. But it never checks that the target user ID actually exists in `adminUsers`. If `id` refers to a non-existent user, the transaction succeeds silently — the `sessions` delete removes 0 rows (since `userId` doesn't match), and the `adminUsers` delete removes 0 rows. The function returns `{ success: true }` even though nothing was deleted.
- **Concrete failure scenario**: An admin clicks delete on a user who was already deleted by another admin in a different tab. The function returns success, but no deletion actually occurred. The admin is misled into thinking the user was removed.
- **Fix**: Check `affectedRows` after the `adminUsers` delete and return an error if 0.

### CR-20-03: `updateImageMetadata` does not validate `title` and `description` after `stripControlChars` — could result in empty-but-not-null values [LOW] [LOW confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 502-504
- **Description**: `stripControlChars` is applied after the length checks. If a title consists entirely of control characters (e.g., `"\x01\x02\x03"`), it passes the `title.length > 255` check (length 3), then `stripControlChars` produces an empty string. The `|| null` fallback converts empty string to null, which is valid DB-wise. However, this means the length check was applied to a string that was then stripped to nothing — a minor inconsistency but not a bug since the null result is correct.
- **Verdict**: Not an issue — the `|| null` fallback handles it correctly.

### CR-20-04: `seo.ts` validates field lengths on raw input but stores sanitized input — length mismatch possible [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/seo.ts` lines 69-98 vs 104
- **Description**: Length validation (e.g., `settings.seo_title.length > MAX_TITLE_LENGTH`) checks the raw client-sent value. Then `stripControlChars(value.trim())` is applied at line 104. Since `stripControlChars` only removes control characters, the sanitized value could be shorter than the raw value. This is harmless — the raw check prevents storing overly long inputs, and the sanitized value is always shorter or equal. Not an issue.
- **Verdict**: Not an issue — validation is correctly conservative.

### CR-20-05: `uploadTracker` adjustment uses `successCount - files.length` which can produce negative count when all uploads fail [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 273-278
- **Description**: The tracker adjustment at line 275 adds `(successCount - files.length)` to `currentTracker.count`. When `successCount === 0` (all uploads failed), this adds `-files.length`, potentially making the tracker count negative. A negative count means the next upload from the same IP could exceed `UPLOAD_MAX_FILES_PER_WINDOW` before the rate limit kicks in, effectively granting extra uploads.
- **Concrete failure scenario**: An admin uploads 100 files that all fail (e.g., corrupt images). The tracker count becomes `100 - 100 = 0` + `(0 - 100) = -100`. The next upload window, the admin can upload 200 files before hitting the limit (100 + 100), bypassing the intended 100-file-per-hour cap.
- **Fix**: Clamp the adjusted count to a minimum of 0: `currentTracker.count = Math.max(0, currentTracker.count + (successCount - files.length));`

## Previously Fixed — Confirmed

All previously reported findings from cycles 1-19 remain fixed. The C19-01, C19-02, and C19-03 fixes are verified in the current codebase:
- C19-01: `revokePhotoShareLink` now uses conditional WHERE (sharing.ts line 261)
- C19-02: `updateGallerySettings` now rolls back storage_backend on switch failure (settings.ts lines 86-97)
- C19-03: Mobile bottom sheet now includes all 6 missing EXIF fields (info-bottom-sheet.tsx lines 291-326)
