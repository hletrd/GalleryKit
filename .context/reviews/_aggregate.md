# Cycle 10 Aggregate Review

**Date**: 2026-04-30
**Scope**: Full repository deep review after 9 prior cycles (24+12+6+4+3+7+10+7+4 = 77 findings across 9 cycles)
**Method**: Single-agent deep read of all core source files with multi-perspective analysis (code quality, security, performance, architecture, test coverage, UX)

## New Findings

### C10-LOW-01: `buildCursorCondition` lacks `isNotNull(capture_date)` guards (consistency with C6F-02)

- **File+line**: `apps/web/src/lib/data.ts:559-563`
- **Severity**: Low | **Confidence**: High
- **Detail**: The `buildCursorCondition` function for a dated cursor includes `lt(images.capture_date, cursor.capture_date)` and `eq(images.capture_date, cursor.capture_date)` branches without `isNotNull(capture_date)` guards. The `getImage` adjacency queries added explicit `isNotNull(capture_date)` guards per C6F-02 "to make the intent explicit -- MySQL NULL comparisons are already falsy, but without the guard the code depends on implicit NULL semantics and is fragile." The cursor builder should have the same guards for consistency and maintainability.
- **Failure scenario**: Not a runtime bug (MySQL NULL comparison semantics make the `lt`/`eq` branches naturally exclude NULL rows). A future developer unfamiliar with NULL semantics could misinterpret the missing guards and introduce a bug.
- **Fix**: Add `isNotNull(images.capture_date)` as a conjunction on the `lt` and `eq` branches in `buildCursorCondition`, matching the `getImage` pattern.

### C10-LOW-02: `getImage` undated adjacency uses raw `sql` template instead of `isNull()`

- **File+line**: `apps/web/src/lib/data.ts:798,805`
- **Severity**: Low | **Confidence**: High
- **Detail**: The undated-image adjacency branches in `getImage` use `sql\`${images.capture_date} IS NULL\`` (raw SQL template) while the dated branches use `isNotNull(images.capture_date)` from drizzle-orm. Both produce identical SQL, but the raw template bypasses Drizzle's identifier quoting and is inconsistent with the import of `isNull` at line 3 (which is imported but not used for these conditions). The `isNull()` helper from drizzle-orm should be used for consistency and to benefit from any future Drizzle-level identifier safety improvements.
- **Failure scenario**: If a column name required quoting (e.g., reserved word), the raw template could produce invalid SQL. `capture_date` is safe today, but the inconsistency creates a maintenance hazard.
- **Fix**: Replace `sql\`${images.capture_date} IS NULL\`` with `isNull(images.capture_date)` at lines 798 and 805.

### C10-LOW-03: `deleteImage`/`deleteImages` don't clean queue retry maps for deleted IDs

- **File+line**: `apps/web/src/app/actions/images.ts:484-486,590-594` and `apps/web/src/lib/image-queue.ts:89-102`
- **Severity**: Low | **Confidence**: High
- **Detail**: When an image is deleted, `queueState.enqueued.delete(id)` and `queueState.permanentlyFailedIds.delete(id)` are called, but `retryCounts` and `claimRetryCounts` entries for the deleted ID are not cleaned up. These stale entries persist until `pruneRetryMaps` evicts them when the Maps exceed `MAX_RETRY_MAP_SIZE` (10000). For a personal gallery scale, this is negligible, but the cleanup would be more complete and consistent with the `permanentlyFailedIds` cleanup added in C7-MED-05.
- **Failure scenario**: Stale entries consume Map slots. At personal-gallery scale, the Maps rarely approach capacity, so this is a minor memory concern, not a correctness issue.
- **Fix**: Add `queueState.retryCounts.delete(id)` and `queueState.claimRetryCounts.delete(id)` alongside the existing cleanup in `deleteImage` and `deleteImages`.

### C10-LOW-04: `seo.ts` `seo_locale`/`seo_og_image_url` Unicode formatting error message is generic

- **File+line**: `apps/web/src/app/actions/seo.ts:67-70,88-92`
- **Severity**: Low | **Confidence**: Medium
- **Detail**: `seo_locale` and `seo_og_image_url` skip the `sanitizeAdminString` early gate (by design -- they have stricter validators `normalizeOpenGraphLocale` and `validateSeoOgImageUrl`). However, if these fields contain Unicode formatting characters, `normalizeStringRecord` at line 88 catches them and returns `invalidInput` -- a generic error key. Other fields (e.g., `seo_title`) get specific error messages like `seoTitleInvalid` from the early `sanitizeAdminString` check. The `seo_locale`/`seo_og_image_url` path produces a less helpful error.
- **Failure scenario**: Admin enters a locale value with an embedded zero-width space. The error message is generic (`invalidInput`) rather than field-specific. Unlikely to be hit in practice because these fields have strict format validators that would reject the input before the Unicode formatting check.
- **Fix**: Either add `sanitizeAdminString` checks for `seo_locale`/`seo_og_image_url` before `normalizeStringRecord`, or map the `invalidInput` error to a field-specific key in the SEO settings error handler.

### C10-LOW-05: `uploadImages` disk space pre-check threshold doesn't account for `MAX_TOTAL_UPLOAD_BYTES`

- **File+line**: `apps/web/src/app/actions/images.ts:207-217`
- **Severity**: Low | **Confidence**: Medium
- **Detail**: The disk space pre-check requires at least 1GB free, but `MAX_TOTAL_UPLOAD_BYTES` is 2GB. A 2GB upload could pass the 1GB-free check but fail during file writing when disk space is exhausted. The error would be caught by the stream-to-disk logic at line 352-356, and the original file would be cleaned up, so there's no data corruption. However, the user would see a generic "Failed to process file" error instead of a clear "insufficient disk space" message.
- **Failure scenario**: Server has 1.5GB free disk. Admin uploads 2GB of images. Pre-check passes (1.5GB > 1GB). Write fails partway through. User sees an upload error. No data corruption, but confusing UX.
- **Fix**: Consider checking against `Math.min(MAX_TOTAL_UPLOAD_BYTES, 1024 * 1024 * 1024)` or making the threshold configurable. Alternatively, document that the 1GB floor is a system health indicator, not a per-upload guarantee.

## Verified: Prior Fixes Still Correct

- C1-C9 rate-limit rollback patterns are intact (login no-rollback, search/load-more rollback, sharing conditional rollback)
- C5F-01/F-03 adjacency fixes with `isNotNull(capture_date)` guards are correct in `getImage`
- C9 collect-then-delete pattern is consistently applied in `pruneRetryMaps`, `viewCountRetryCount` eviction, `upload-tracker-state.ts` prune, and `BoundedMap.prune()`
- C7-HIGH-01 advisory lock scoping per user ID in `deleteAdminUser` is correct
- C8-MED-01 collect-then-delete in `pruneUploadTracker` is correct
- C4F-11 hard link for same-size variant dedup is implemented correctly
- C4F-08/C4F-09 blur_data_url and topic_label in `getImageByShareKey` are present
- Privacy guard (`_SensitiveKeysInPublic` compile-time check) is intact
- C6R-RPL-03 symmetric rollback of both in-memory and DB rate-limit counters in sharing.ts

## Items Confirmed as Correctly Deferred

All items in plan-366-deferred-cycle9.md remain valid with no change in status. No new information emerged that would change their deferral rationale.
