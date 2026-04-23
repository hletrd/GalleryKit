# Code Reviewer -- Cycle 1 (Fresh)

## Files Reviewed
- `apps/web/src/proxy.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/exif-datetime.ts`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/serve-upload.ts`

## CR1-01: `updateImageMetadata` SELECT result not validated before UPDATE
**File:** `apps/web/src/app/actions/images.ts` lines 575-576
**Severity:** MEDIUM | **Confidence:** High
**Problem:** The function SELECTs `existingImage` from the DB but then proceeds to UPDATE regardless of whether the SELECT returned a result. If `existingImage` is undefined (image was deleted between the caller's check and this point), the revalidation path construction uses `existingImage?.topic` which yields `undefined`, causing `revalidateLocalizedPaths` to receive a topic path of `/undefined`.
**Fix:** Add `if (!existingImage) return { error: t('imageNotFound') };` before the UPDATE.

## CR1-02: `stripControlChars` misses Unicode C1 control characters (0x80-0x9F)
**File:** `apps/web/src/lib/sanitize.ts` line 8
**Severity:** LOW | **Confidence:** Medium
**Problem:** The regex `/[\x00-\x1F\x7F]/g` strips C0 controls and DEL but misses C1 controls (0x80-0x9F) which include soft hyphen (0xAD), non-breaking space variants, and other formatting characters. These can cause subtle display issues or be used for obfuscation.
**Fix:** Change regex to `/[\x00-\x1F\x7F-\x9F]/g`.

## CR1-03: `isValidSlug` allows uppercase with case-insensitive flag
**File:** `apps/web/src/lib/validation.ts` line 11
**Severity:** MEDIUM | **Confidence:** High
**Problem:** `isValidSlug` uses `/[a-z0-9_-]+/i` which allows uppercase letters. This creates case-sensitive URLs: `/en/My-Topic` and `/en/my-topic` would be different routes. Since slugs are stored as-is, mixed-case slugs lead to confusing URL behavior and potential SEO duplicate content issues.
**Fix:** Remove the `i` flag from the regex: `/^[a-z0-9_-]+$/`. Also lowercase the slug in `createTopic` and `updateTopic` before validation.

## CR1-04: `searchImages` runs 3 sequential DB queries instead of parallel
**File:** `apps/web/src/lib/data.ts` lines 685-754
**Severity:** LOW | **Confidence:** High
**Problem:** `searchImages` runs the main query, then the tag query (only if needed), then the alias query (only if needed). These could be parallelized for better latency. The current sequential approach means a search takes ~3x the single-query latency in the worst case.
**Fix:** Run all 3 queries in parallel with `Promise.allSettled` when remainingLimit > 0, or use `Promise.all` with early termination.

## CR1-05: `createTopicAlias` lacks pre-validation of topic existence
**File:** `apps/web/src/app/actions/topics.ts` lines 305-361
**Severity:** MEDIUM | **Confidence:** High
**Problem:** `createTopicAlias` only validates the slug format but doesn't check if the referenced topic actually exists before attempting the INSERT. It relies solely on the FK constraint (`ER_NO_REFERENCED_ROW_2`) which returns a generic error message. The error message from the FK violation says "failed to create topic" which is misleading -- it should say "topic not found".
**Fix:** Add a SELECT for the topic before inserting the alias. Keep FK as defense-in-depth, but provide a clear error message.

## CR1-06: `processImageFormats` assumes sizes array is sorted
**File:** `apps/web/src/lib/process-image.ts` line 406
**Severity:** LOW | **Confidence:** Medium
**Problem:** The function uses `sizes[sizes.length - 1]` as the "largest" size to determine the base filename. If admin-configured sizes are not sorted ascending, the last element may not be the largest, causing the base filename to be generated from a non-largest size variant.
**Fix:** Add `sizes = [...sizes].sort((a, b) => a - b)` at the start of `processImageFormats`.

## CR1-07: `loadMoreImages` doesn't sanitize topicSlug before isValidSlug check
**File:** `apps/web/src/app/actions/public.ts` line 12
**Severity:** LOW | **Confidence:** Low
**Problem:** `loadMoreImages` passes `topicSlug` directly to `isValidSlug` without `stripControlChars`. While `isValidSlug` rejects most dangerous characters, it doesn't strip control characters, so a topic slug with control characters would be rejected by `isValidSlug` rather than being sanitized first. This is inconsistent with other action functions.
**Fix:** Apply `stripControlChars` before the `isValidSlug` check for consistency.
