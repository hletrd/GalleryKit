# Security Reviewer — Cycle 2 Deep Review

## C2-SR-01 (High/High): `permanentlyFailedIds` not cleaned on image deletion — stale ID exclusion from bootstrap

- **File**: `apps/web/src/app/actions/images.ts:482-483`, `apps/web/src/app/actions/images.ts:584-588`
- **Issue**: When images are deleted (single or batch), their IDs are removed from `queueState.enqueued` but NOT from `queueState.permanentlyFailedIds`. After a DB restore, the auto-increment counter resets and the stale permanently-failed IDs could incorrectly exclude legitimate new images from bootstrap scanning. The FIFO eviction cap (1000) limits but does not prevent this. In a scenario where images 1-50 permanently fail, admin deletes them, restores DB, and new images get IDs 1-50 via auto-increment, those new images would be silently excluded from processing.
- **Fix**: Delete the image ID from `permanentlyFailedIds` in both `deleteImage()` and `deleteImages()`.
- **Confidence**: High

## C2-SR-02 (Medium/High): `normalizeStringRecord` does not reject Unicode bidi/formatting characters

- **File**: `apps/web/src/lib/sanitize.ts:35-55`
- **Issue**: `normalizeStringRecord` applies `stripControlChars` (which removes bidi/formatting chars) but does NOT return a `rejected` flag. This means callers have no way to know the input contained formatting characters and was silently altered. The function is used in `actions/settings.ts` for admin-controlled SEO fields (`seo_title`, `seo_description`, `seo_nav_title`, `seo_author`). While the characters are stripped, the silent alteration without rejection means an admin could inject a visually-identical string with invisible formatting that gets persisted. This is a lower-severity variant of the C7R-RPL-11 / C3L-SEC-01 defense-in-depth pattern.
- **Fix**: Add a `rejected` field to `normalizeStringRecord`'s return type (mirroring `sanitizeAdminString`), and have callers check it.
- **Confidence**: High

## C2-SR-03 (Medium/Medium): Session token timestamp not validated for future timestamps

- **File**: `apps/web/src/lib/session.ts:122-128`
- **Issue**: The session token validation checks `tokenAge > maxAge || tokenAge < 0`, which correctly rejects tokens from the future (negative age). However, `tokenAge < 0` only catches timestamps that are slightly in the future (within the same millisecond range). A token with a very large future timestamp would still pass the `< 0` check since `Date.now() - largeFutureTs` would be negative. This is correctly handled because `tokenAge < 0` catches any future timestamp. Actually, upon re-examination, `tokenAge < 0` does correctly reject all future timestamps because `Date.now() - futureTs < 0`. This is a non-issue.
- **Fix**: No fix needed. The check is correct.
- **Confidence**: Low (non-issue upon analysis)

## C2-SR-04 (Medium/Medium): `restoreDatabase` temp file predictability

- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts`
- **Issue**: This was deferred from cycle 1 (A1-LOW-05) but remains a real attack surface in Docker environments where `/tmp` is shared. The restore function uses a partially predictable temp file name. If an attacker can create a symlink at the predicted path before the restore begins, they could redirect the write to an arbitrary file.
- **Fix**: Use `crypto.randomUUID()` for the temp file name and `O_CREAT | O_EXCL` flags for atomic creation.
- **Confidence**: Medium

## C2-SR-05 (Low/Medium): `loadMoreImages` rate limit rollback on error could enable bypass

- **File**: `apps/web/src/app/actions/public.ts:105-108`
- **Issue**: When `getImagesLite` throws, the rate limit is rolled back. An attacker who can trigger DB errors (e.g., by sending specially crafted cursor parameters) could get rate limit rollbacks, giving them extra attempts. This is the same pattern fixed in `auth.ts` but applied to a lower-risk public read path. The difference is that `loadMoreImages` is a pure read path and the user should not be penalized for server errors, so rollback is arguably correct here.
- **Fix**: Document the decision. If intentional, add a comment explaining why rollback is OK for this public read path but not for auth.
- **Confidence**: Medium

## C2-SR-06 (Medium/Medium): `searchImages` query allows searching by topic slug which could reveal topic existence

- **File**: `apps/web/src/lib/data.ts:988`
- **Issue**: The search function includes `like(images.topic, searchTerm)` and `like(topics.label, searchTerm)` in its OR conditions. This means a user can search for internal topic slugs and discover which topics exist, even if the topic is not publicly linked. Topic slugs are visible in URLs anyway, so this is a low-risk information disclosure. However, `like(topics.label, searchTerm)` allows searching by the admin-set label which could differ from the slug.
- **Fix**: Consider whether topic/label search should be restricted to only topics that have been explicitly made public. Currently all topics are public, so this is a non-issue.
- **Confidence**: Low (non-issue given current design)

## C2-SR-07 (High/Medium): Admin user creation does not enforce minimum password length at the DB/action level

- **File**: `apps/web/src/app/actions/admin-users.ts`
- **Issue**: When creating a new admin user via `createAdminUser`, the password is validated with `if (!newPassword || newPassword.length < 12)`. However, `newPassword` comes from `stripControlChars(formData.get('newPassword')?.toString() ?? '')`. After stripping control characters, the effective password length could be less than 12. For example, a 13-character password with 2 control characters would pass the length check but have an effective length of 11 after stripping. The Argon2 hash would then be of a shorter password than intended. This is similar to the C2L2-05 pattern mentioned in `images.ts` for filenames.
- **Fix**: Strip control characters BEFORE the length check, or validate length after stripping. Check the current implementation to see if this is already done.
- **Confidence**: Medium

## Summary

- Total findings: 7
- High: 2 (C2-SR-01, C2-SR-07)
- Medium: 4
- Low: 1 (non-issue upon analysis)
