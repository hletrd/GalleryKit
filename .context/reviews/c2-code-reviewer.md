# Code Reviewer — Cycle 2 Deep Review

## C2-CR-01 (Medium/High): `deleteImage` does not remove from `permanentlyFailedIds`

- **File**: `apps/web/src/app/actions/images.ts:482-483`
- **Issue**: When an admin deletes an image, the code removes the image ID from `queueState.enqueued` but does NOT remove it from `queueState.permanentlyFailedIds`. If an image was permanently failed and then deleted, the ID remains in the `permanentlyFailedIds` set until it is evicted by FIFO. Since this set is capped at 1000, this is a minor memory leak, but more importantly, if the auto-increment counter wraps or the DB is restored, the stale ID could incorrectly exclude a new image from bootstrap.
- **Fix**: Add `queueState.permanentlyFailedIds.delete(id)` alongside the existing `queueState.enqueued.delete(id)` in `deleteImage()`. Also do the same in `deleteImages()`.
- **Confidence**: High

## C2-CR-02 (Medium/Medium): `deleteImages` does not remove from `permanentlyFailedIds`

- **File**: `apps/web/src/app/actions/images.ts:584-588`
- **Issue**: Same as C2-CR-01 but for the batch delete path. The loop only removes IDs from `enqueued`, not from `permanentlyFailedIds`.
- **Fix**: Add `queueState.permanentlyFailedIds.delete(id)` in the batch deletion loop.
- **Confidence**: High

## C2-CR-03 (Low/Medium): `searchImagesAction` rolls back rate limit on DB error but not on search error in `public.ts`

- **File**: `apps/web/src/app/actions/public.ts:165-170`
- **Issue**: The `searchImagesAction` function rolls back the rate limit counter when `searchImages` throws an exception. This is the same rollback-on-infrastructure-error pattern that was fixed in `auth.ts` (C1F-CR-04). The rationale for NOT rolling back in auth applies here too: an attacker who can trigger DB errors (e.g., via LIKE injection or by overwhelming the DB) gets extra search attempts. However, search is lower-risk than auth, so this is a lower severity finding.
- **Fix**: Consider whether rollback on search errors is intentional. If search is purely a public read path, the current behavior (rollback on error) is arguably OK because a DB failure wastes the user's attempt unfairly. Document the decision.
- **Confidence**: Medium

## C2-CR-04 (Medium/Medium): `getImage` does not handle NULL `capture_date` in `prevConditions` for undated images correctly when `capture_date` IS NULL but there are dated images

- **File**: `apps/web/src/lib/data.ts:715-732`
- **Issue**: For undated images (capture_date IS NULL), the `prevConditions` only match other undated images with later created_at/ids. This is intentional per the sort order (NULL sorts last in DESC). However, the `nextConditions` for undated images (lines 729-732) also only match other undated images with earlier created_at/ids. This means an undated image's "next" will never be a dated image, even though in the gallery grid, undated images appear AFTER all dated images. The navigation is correct for the prev direction (undated -> more undated -> eventually dated), but the next direction from the first undated image has no next link to any dated image. This is actually correct behavior given the DESC sort (undated = last), so the "next" of an undated image is always another undated image or null. This is a non-issue upon deeper analysis but worth noting for clarity.
- **Fix**: No fix needed. Add a comment block explaining the sort-order semantics.
- **Confidence**: Low (likely not an issue)

## C2-CR-05 (Medium/Medium): `restoreDatabase` temp file uses predictable name in `/tmp`

- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts`
- **Issue**: The restore function creates a temp file with a semi-predictable name. If an attacker can write to `/tmp`, they could pre-create a symlink at that path pointing to a sensitive file, which would then be overwritten. This was flagged in cycle 1 (A1-LOW-05) but the fix was deferred. Re-raising because the Docker deployment typically runs as root and `/tmp` is shared.
- **Fix**: Use `O_CREAT | O_EXCL` for atomic file creation, or use `os.tmpdir()` + `crypto.randomUUID()` for the temp file name.
- **Confidence**: Medium

## C2-CR-06 (Medium/Medium): `loadMoreImages` re-throws error after rollback but no error boundary on client

- **File**: `apps/web/src/app/actions/public.ts:105-108`
- **Issue**: When `getImagesLite` throws, `loadMoreImages` rolls back the rate limit and then re-throws the error. Since this is a server action, the re-thrown error will be sent to the client as a generic error message. There's no try/catch on the client-side `loadMoreImages` call in `load-more.tsx`, so an unhandled server action error could leave the UI in a broken state (the "Load More" button becomes non-functional).
- **Fix**: Wrap the client-side call in a try/catch and show a toast error on failure.
- **Confidence**: Medium

## C2-CR-07 (High/Medium): `searchImages` does not escape LIKE wildcards in tag name search

- **File**: `apps/web/src/lib/data.ts:1009`
- **Issue**: The `searchImages` function escapes LIKE wildcards for the main query (line 967: `query.trim().replace(/[%_\\]/g, '\\$&')`), but the tag search (line 1009: `like(tags.name, searchTerm)`) and alias search (line 1014: `like(topicAliases.alias, searchTerm)`) use the same `searchTerm` which is built from the escaped `query`. However, looking more carefully, the `searchTerm` is constructed at line 967-968 from `escaped` which already has LIKE wildcards escaped. So this is actually correctly handled. The LIKE wildcards ARE escaped before being used in all three LIKE queries.
- **Fix**: No fix needed. The escaping is correct.
- **Confidence**: Low (likely not an issue upon closer inspection)

## C2-CR-08 (Medium/Medium): `normalizeStringRecord` applies `stripControlChars` but not `sanitizeAdminString`

- **File**: `apps/web/src/lib/sanitize.ts:35-55`
- **Issue**: `normalizeStringRecord` uses `stripControlChars` which strips C0/C1 controls and Unicode formatting chars but does NOT return a `rejected` flag like `sanitizeAdminString` does. If a caller of `normalizeStringRecord` expects the same defense-in-depth rejection of Unicode formatting chars, they won't get it. Currently, `normalizeStringRecord` is used in `settings.ts` for admin settings, and those values are rendered in SEO meta tags and OG images. A Unicode bidi override in a SEO setting could cause visual spoofing in OG images.
- **Fix**: Add a `rejected` flag to `normalizeStringRecord`'s return value, or ensure all callers of `normalizeStringRecord` also call `containsUnicodeFormatting` on the result.
- **Confidence**: Medium

## Summary

- Total findings: 8
- High: 0 (1 reclassified as non-issue)
- Medium: 6
- Low: 1 (1 reclassified as non-issue)
