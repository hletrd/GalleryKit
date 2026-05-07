# Code Review — Cycle 14

**Reviewer:** code-reviewer (automated)
**Date:** 2026-04-20
**Scope:** All source files under `apps/web/src/`
**Excluded:** Previously fixed issues C13-01 through C13-03, CR-13-04, DBG-13-02

---

## Summary

Full-scope review of ~85 TypeScript/TSX source files covering server actions, data layer, authentication, image processing, storage, components, and route handlers. Found **10 findings** across logic bugs, race conditions, data-flow issues, edge cases, and maintainability risks.

---

## Findings

### C14-01 — `selectFields` comment claims "admin-facing" but is used for ALL public queries

**File:** `apps/web/src/lib/data.ts:87-134`
**Confidence:** Medium

**Description:**
The comment on `selectFields` (line 87) says "selectFields is used by admin-facing queries" and "For public-facing queries, use `publicSelectFields` below instead." However, `publicSelectFields` is just a direct alias (`const publicSelectFields = selectFields` on line 134). The naming and comments imply two distinct field sets with different privacy scopes, but they are the same object. This is misleading to future maintainers who might add PII fields to `selectFields` thinking it's admin-only, while it would silently leak to all public queries.

**Failure scenario:** A developer adds `user_filename` to `selectFields` because the comment says it's "admin-facing." Since `publicSelectFields = selectFields`, the field is now exposed to all unauthenticated users. The compile-time privacy guard only checks for `latitude`, `longitude`, `filename_original`, and `user_filename` — it would catch this specific case, but the misleading comment increases the risk of a bypass (e.g., adding a new sensitive field not in the guard list).

**Suggested fix:** Either (a) create a genuinely separate `adminSelectFields` that includes additional fields like `user_filename` and `filename_original`, keeping `selectFields`/`publicSelectFields` as the restricted set, or (b) rename `selectFields` to something like `publicAndAdminSelectFields` and update the comment to accurately reflect that it is shared, and that adding sensitive fields here leaks them publicly.

---

### C14-02 — `getImageCached` deduplicates across `generateMetadata` and page render, returning stale data if metadata call modifies state

**File:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:38,121` + `apps/web/src/lib/data.ts:664`
**Confidence:** Low

**Description:**
Both `generateMetadata` (line 38) and the default page export (line 121) call `getImageCached(imageId)`. Since `getImageCached = cache(getImage)`, React deduplicates these within the same request. This is correct for performance. However, `getImage` performs three parallel DB queries (tags, prev, next). If a concurrent deletion or tag modification occurs between the SSR dedup cache hit and the actual query execution within the same render, the cached result could contain stale prev/next IDs pointing to deleted images. The 1-week `revalidate = 604800` on the photo page means the ISR cache may also serve stale data for an extended period after an image is deleted.

**Failure scenario:** Image B is deleted while photo page for image A is rendering. `getImage` returns `prevId: B` (which no longer exists). The prefetch `<Link>` for `/p/B` results in a 404.

**Suggested fix:** This is low-severity since the photo viewer gracefully handles navigation to non-existent images (the target page returns `notFound()`). The real improvement would be to reduce the ISR `revalidate` value or add error boundaries around the navigation prefetch links. No code change required unless the UX impact is deemed significant.

---

### C14-03 — `uploadImages` does not use `maxFileSizeMb` from gallery config for per-file size validation

**File:** `apps/web/src/app/actions/images.ts:48-293` + `apps/web/src/lib/process-image.ts:42`
**Confidence:** High

**Description:**
`saveOriginalAndGetMetadata` in `process-image.ts` validates per-file size against the hardcoded `MAX_FILE_SIZE = 200 * 1024 * 1024` (line 42). The admin can configure `max_file_size_mb` via gallery settings (range 1–1000), but this setting is never used to enforce the per-file upload limit. The `processTopicImage` function also uses its own separate `MAX_FILE_SIZE = 200 * 1024 * 1024`. Only the cumulative batch limit (`MAX_TOTAL_UPLOAD_BYTES`) uses an env var, but the per-file limit is not configurable at runtime.

**Failure scenario:** Admin sets `max_file_size_mb` to `50` expecting to reject files over 50MB. A user uploads a 150MB file, which passes the per-file check (200MB hardcoded limit) and is accepted, contradicting the admin's configuration.

**Suggested fix:** Read `getGalleryConfig().maxFileSizeMb` in `uploadImages` and validate each file's size against it before calling `saveOriginalAndGetMetadata`. Alternatively, pass the max size as a parameter to `saveOriginalAndGetMetadata`. Apply the same pattern to `processTopicImage` if topic images should respect the same limit.

---

### C14-04 — `uploadImages` does not use `maxFilesPerBatch` from gallery config

**File:** `apps/web/src/app/actions/images.ts:72` + `apps/web/src/lib/gallery-config.ts:110`
**Confidence:** High

**Description:**
Line 72 hardcodes the batch file limit: `if (files.length > 100) return { error: ... }`. The admin can configure `max_files_per_batch` (range 1–500) via gallery settings, but `uploadImages` never reads this setting. The cumulative tracker uses `UPLOAD_MAX_FILES_PER_WINDOW = 100` (also hardcoded on line 25). This means the admin-facing setting is a no-op for the actual enforcement.

**Failure scenario:** Admin sets `max_files_per_batch` to `10` to limit uploads to 10 files per batch. A user uploads 50 files in one call — it passes the hardcoded 100-file limit and succeeds.

**Suggested fix:** Read `getGalleryConfig().maxFilesPerBatch` and use it instead of the hardcoded `100` on line 72, and replace the `UPLOAD_MAX_FILES_PER_WINDOW` constant with the config-derived value.

---

### C14-05 — View count buffer loss on process crash — `flushGroupViewCounts` not called during graceful shutdown

**File:** `apps/web/src/lib/data.ts:8-85` + `apps/web/src/lib/image-queue.ts:106-111`
**Confidence:** Medium

**Description:**
The `viewCountBuffer` (line 9) accumulates shared-group view count increments in memory, flushed every 5 seconds. The `flushBufferedSharedGroupViewCounts` function (line 74) clears the timer and flushes remaining counts, but it is never called during the graceful shutdown sequence in `shutdownImageProcessingQueue` (`queue-shutdown.ts`). The `drainProcessingQueueForShutdown` function only pauses/clears the image processing queue — it doesn't flush the view count buffer. If the process exits between flush intervals, all buffered view counts are lost.

**Failure scenario:** A gallery receives 500 views during a 4-second window before a deployment restart. The buffer hasn't been flushed (5-second interval). All 500 increments are lost, permanently undercounting those views.

**Suggested fix:** Import and call `flushBufferedSharedGroupViewCounts()` in `drainProcessingQueueForShutdown` or in `shutdownImageProcessingQueue` before clearing the queue. Ensure it's called after the queue is paused but before the process exits.

---

### C14-06 — `original_format` derivation from filename is fragile and can produce `null` for valid files

**File:** `apps/web/src/app/actions/images.ts:174`
**Confidence:** Medium

**Description:**
Line 174: `original_format: (data.filenameOriginal.split('.').pop()?.toUpperCase() || '').slice(0, 10) || null`. The `filenameOriginal` is a UUID-based name like `abc123.arw` generated by `saveOriginalAndGetMetadata`. The extension is already validated by `getSafeExtension` against `ALLOWED_EXTENSIONS`. However, `split('.').pop()` on a filename like `.hiddenfile` (no base name) would return `".HIDDENFILE"` — though this is unlikely since `getSafeExtension` enforces known extensions. The real issue is that `getSafeExtension` already validated the extension, but the `original_format` extraction re-derives it from the filename instead of using the validated extension, creating a subtle inconsistency risk if `filenameOriginal` is ever modified between validation and insertion.

**Failure scenario:** If `filenameOriginal` were ever set to a value without an extension (e.g., due to a future bug in `saveOriginalAndGetMetadata`), `split('.').pop()` would return the entire filename, and `toUpperCase()` would produce a garbage format string up to 10 chars. The `.slice(0, 10)` truncation would mask the error silently.

**Suggested fix:** Extract the extension from `originalExt` (already validated by `getSafeExtension`) in `saveOriginalAndGetMetadata` and return it as part of `ImageProcessingResult`, rather than re-deriving it from the filename at insertion time.

---

### C14-07 — `revalidateLocalizedPaths` called with empty string arguments

**File:** `apps/web/src/app/actions/tags.ts:146,185,354` + `apps/web/src/app/actions/topics.ts:174`
**Confidence:** Low

**Description:**
Several calls pass conditional empty strings to `revalidateLocalizedPaths`, e.g.:
- `revalidateLocalizedPaths('/p/${imageId}', '/', '/admin/tags', img?.topic ? \`/${img.topic}\` : '', '/admin/dashboard')` (tags.ts:146)
- `revalidateLocalizedPaths('/admin/categories', '/admin/tags', '/', \`/${slug}\`, slug !== currentSlug ? \`/${currentSlug}\` : '')` (topics.ts:174)

The `revalidateLocalizedPaths` function in `revalidation.ts` iterates over all arguments and passes each to `getLocalizedPathVariants`, which calls `normalizePath`. The `normalizePath` function converts empty string to `/` (line 6: `if (!path) return '/'`), causing an unnecessary revalidation of the homepage that was already included. This is not a bug (the dedup `seen` set prevents duplicate `revalidatePath` calls), but it's wasteful and obscures intent.

**Failure scenario:** No functional bug — the `seen` set in `revalidateLocalizedPaths` deduplicates the extra `/` revalidation. But it adds unnecessary function calls and makes the code harder to reason about.

**Suggested fix:** Filter out empty/falsy path arguments before passing them to `revalidateLocalizedPaths`, or filter inside the function itself.

---

### C14-08 — `processImageFormats` hard-link of base filename races with parallel format generation

**File:** `apps/web/src/lib/process-image.ts:376-385`
**Confidence:** Medium

**Description:**
In `processImageFormats`, three formats (webp, avif, jpeg) are generated in parallel via `Promise.all` (line 390). Inside each format's `generateForFormat`, the largest size's output file is linked/copied to the "base" filename (lines 377-385). The base filename is shared across all three format directories, so there's no cross-format race. However, within a single format, the code does `await fs.unlink(basePath).catch(() => {})` (line 379) then `await fs.link(outputPath, basePath)` (line 381). If two concurrent jobs process the same image (e.g., due to queue retry after partial failure), both could unlink each other's base file, then one's `link` would succeed while the other's fails and falls back to `copyFile`. This is benign since the final state is correct, but the `unlink` before `link` creates a window where the base file doesn't exist.

**Failure scenario:** Two queue workers process the same image concurrently. Worker A's `unlink` removes Worker B's just-linked base file. Worker B's subsequent `link` of its own file succeeds. Worker A then tries to `link` its file, which also succeeds (overwriting B's). Both workers then verify the files exist. The final state is correct (one of the two valid outputs), but there's a brief window where the base file is missing.

**Suggested fix:** Replace `unlink` + `link` with `link` + fallback, using the `EEXIST` error to decide whether to overwrite. Or use `fs.rename()` which is atomic on the same filesystem. The current pattern works but is unnecessarily fragile.

---

### C14-09 — `deleteTopic` transaction doesn't delete topic aliases — relies on FK cascade which may not be immediate

**File:** `apps/web/src/app/actions/topics.ts:196-223` + `apps/web/src/db/schema.ts:13`
**Confidence:** Medium

**Description:**
`deleteTopic` (line 196) deletes the topic row inside a transaction but does not explicitly delete the associated `topicAliases` rows. The schema defines `onDelete: 'cascade'` on `topicAliases.topicSlug` (schema.ts:13), so the DB should handle this. However, the codebase uses explicit cascade deletion as a "defense in depth" pattern elsewhere (e.g., `deleteTag` explicitly deletes `imageTags` before `tags`, `deleteGroupShareLink` explicitly deletes `sharedGroupImages` before `sharedGroups`). This inconsistency means `deleteTopic` relies solely on FK cascade, while similar operations use both explicit deletion and FK cascade.

**Failure scenario:** If the FK cascade is disabled (e.g., the table was created without `ON DELETE CASCADE` due to a migration issue), orphaned `topicAliases` rows would remain, pointing to a non-existent topic. The `getTopicBySlug` function would then find the alias, join to `topics`, and get no result — returning a confusing null instead of a clear error.

**Suggested fix:** Add explicit deletion of `topicAliases` before deleting the topic, matching the pattern used in `deleteTag` and `deleteGroupShareLink`:
```ts
await tx.delete(topicAliases).where(eq(topicAliases.topicSlug, slug));
await tx.delete(topics).where(eq(topics.slug, slug));
```

---

### C14-10 — `updatePassword` rate-limit rollback on success doesn't also reset the in-memory `count`

**File:** `apps/web/src/app/actions/auth.ts:295-299`
**Confidence:** Low

**Description:**
After successful password verification (line 289), the code calls `clearSuccessfulPasswordAttempts(ip)` (line 296) which does `passwordChangeRateLimit.delete(ip)` and `resetRateLimit(ip, ...)`. This correctly clears both the in-memory Map entry and the DB bucket. However, the pre-increment on line 252-255 does `limitData.count += 1` and `passwordChangeRateLimit.set(ip, limitData)`. The `limitData` object is obtained from `getPasswordChangeRateLimitEntry` which returns a fresh or existing entry. The issue is that `getPasswordChangeRateLimitEntry` is called once (line 234) and the returned object reference is mutated (line 252). If `prunePasswordChangeRateLimit` (line 233) evicts the IP's entry between the `getPasswordChangeRateLimitEntry` call and the `.count += 1` mutation, the mutation operates on a stale object that's no longer in the Map. The subsequent `.set(ip, limitData)` on line 254 re-inserts it, but the evicted entry's count may have been reset to 0 by a new window.

**Failure scenario:** Practically impossible in normal operation — `prunePasswordChangeRateLimit` runs at the start of `updatePassword` before the pre-increment, and the time between pruning and incrementing is microseconds (no await in between). This is a theoretical race that would require an extraordinary scheduling event.

**Suggested fix:** No change needed — the risk is theoretical. Documenting for completeness only.

---

## Non-Issues (Verified Correct)

1. **Session token timing-safe comparison** — `verifySessionToken` correctly uses `timingSafeEqual` with length checks.
2. **Upload path traversal prevention** — `serveUploadFile` properly validates segments with `SAFE_SEGMENT`, checks containment with `resolvedPath.startsWith(resolvedRoot)`, and rejects symlinks.
3. **TOCTOU protections** — Login, password change, and user creation all use pre-increment-then-check patterns to prevent burst attacks.
4. **Privacy guard compile-time check** — `_AssertNoSensitiveFields` correctly prevents accidental addition of PII fields to `selectFields`.
5. **Image processing claim system** — MySQL advisory locks (`GET_LOCK`/`RELEASE_LOCK`) properly prevent concurrent workers from processing the same image.
6. **DB backup SQL injection** — `containsDangerousSql` scanner properly checks for dangerous patterns with comment/literal stripping.
7. **Rate limit Map pruning** — All in-memory Maps have both time-based expiry and hard-cap eviction to prevent unbounded growth.
8. **Filename validation** — `isValidFilename` properly rejects path traversal (`..`, `/`, `\`) and enforces safe character patterns.

---

## Statistics

- **Files reviewed:** ~85
- **Findings:** 10 (High: 2, Medium: 4, Low: 3, Informational: 1)
- **Previously fixed (excluded):** C13-01, C13-02, C13-03, CR-13-04, DBG-13-02
