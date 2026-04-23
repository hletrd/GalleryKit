# Comprehensive Code Review — Cycle 29 (2026-04-19, fresh pass)

**Scope:** Full repository — all server actions, lib modules, components, middleware, database schema, and API routes.

---

## Methodology

Reviewed every server action (`auth.ts`, `images.ts`, `topics.ts`, `tags.ts`, `sharing.ts`, `admin-users.ts`, `public.ts`, `db-actions.ts`), all library modules (`data.ts`, `process-image.ts`, `session.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `serve-upload.ts`, `sql-restore-scan.ts`, `image-queue.ts`, `validation.ts`, `audit.ts`, `revalidation.ts`, `api-auth.ts`, `upload-limits.ts`, `gallery-config.ts`, `gallery-config-shared.ts`, `sanitize.ts`), key components (`image-manager.tsx`, `search.tsx`, `photo-viewer.tsx`, `tag-filter.tsx`, `upload-dropzone.tsx`), schema, DB connection, middleware, and API routes.

---

## Findings

### C29-01: [MEDIUM] `updateImageMetadata` does not revalidate topic page when title/description changes
- **File:** `apps/web/src/app/actions/images.ts:543`
- **Confidence:** HIGH
- **Description:** When `updateImageMetadata` is called, it revalidates `/p/${id}`, `/admin/dashboard`, and `/` (line 543). However, it does not revalidate the topic page. If the image has a title that appears in the topic page's masonry grid (e.g., as alt text or a title overlay), the topic page will serve stale data until its ISR cache expires. Compare with `deleteImage` (line 386) which does revalidate the topic path.
- **Concrete scenario:** Admin updates an image's title from "Untitled" to "Sunset Over Mountains". The photo page `/p/123` shows the new title, but the topic page `/landscapes` still shows "Untitled" in the masonry grid until the 1-hour ISR cache expires.
- **Suggested fix:** Add the topic path to `revalidateLocalizedPaths` when `existingImage?.topic` exists, matching `deleteImage`'s pattern.

### C29-02: [MEDIUM] `searchImagesAction` does not strip control characters from query
- **File:** `apps/web/src/app/actions/public.ts:93-94`
- **Confidence:** MEDIUM
- **Description:** The function trims and slices the query to 200 characters (line 93), but does not strip control characters before passing it to `searchImages()`. While `searchImages()` in `data.ts` does its own trimming and LIKE-wildcard escaping, control characters (null bytes, etc.) could still reach the database query. The `stripControlChars` utility exists in `@/lib/sanitize` but is not applied here. This is defense-in-depth — the current LIKE escaping handles `%`, `_`, and `\`, but null bytes and other control characters in a LIKE pattern could cause unexpected MySQL behavior (e.g., truncated comparisons, bypassed patterns).
- **Concrete scenario:** A search query containing `\x00` (null byte) could truncate the LIKE pattern in MySQL, causing the search to return unexpected results or bypass intended filtering.
- **Suggested fix:** Apply `stripControlChars()` to the query before passing to `searchImages()`.

### C29-03: [LOW] `seo.ts` and `data.ts` duplicate `SEO_SETTING_KEYS` constant
- **File:** `apps/web/src/app/actions/seo.ts:12-19`, `apps/web/src/lib/data.ts:689-696`
- **Confidence:** HIGH
- **Description:** The `SEO_SETTING_KEYS` array is defined independently in both `seo.ts` (line 12) and `data.ts` (line 689). If a new SEO key is added to one but not the other, they'll diverge silently. The `data.ts` version is used for reading settings, while `seo.ts` uses its own copy for validation. The `GALLERY_SETTING_KEYS` constant is already shared via `gallery-config-shared.ts` — the same pattern should be used for SEO keys.
- **Suggested fix:** Extract `SEO_SETTING_KEYS` to `gallery-config-shared.ts` (or a new `seo-config-shared.ts`) and import it in both places.

### C29-04: [LOW] `serve-upload.ts` does not validate file extension matches the directory
- **File:** `apps/web/src/lib/serve-upload.ts:24-95`
- **Confidence:** LOW
- **Description:** The route validates that the top-level directory is in `ALLOWED_UPLOAD_DIRS` (jpeg, webp, avif) and validates the file extension against `CONTENT_TYPES`. However, it does not check that the file extension matches the directory — e.g., a request for `/uploads/jpeg/foo.webp` would be served with `image/webp` content type from the jpeg directory. While not a security issue (containment and symlink checks are correct), it violates the logical contract and could mask misconfiguration or corrupted filenames.
- **Suggested fix:** Add a cross-check that the file extension matches the expected format for the directory (e.g., `.jpg`/`.jpeg` for `jpeg/`, `.webp` for `webp/`, `.avif` for `avif/`).

### C29-05: [LOW] Missing `tags` key in `uploadImages` audit log metadata
- **File:** `apps/web/src/app/actions/images.ts:295-299`
- **Confidence:** LOW
- **Description:** The audit log for image upload records `count`, `failed`, and `topic`, but does not record the `tagNames` that were bulk-applied. This makes it impossible to audit which tags were bulk-applied during upload. While this is minor for a personal gallery, it reduces the audit trail's completeness compared to individual tag operations (`addTagToImage`, `batchAddTags`) which do record tag names.
- **Suggested fix:** Add `tags: tagNames.join(',')` to the audit metadata object.

### C29-06: [LOW] `flushGroupViewCounts` re-buffers entire failed batch without per-group retry limit (carry-forward)
- **File:** `apps/web/src/lib/data.ts:40-76`
- **Confidence:** HIGH
- **Description:** Carry-forward from deferred items (C30-03 / C36-03). When `flushGroupViewCounts` encounters individual group-update failures, it re-buffers the failed increments back into `viewCountBuffer` (line 62) without a per-group retry limit. During a prolonged DB outage, a specific group's counter value could grow unbounded across re-buffer cycles. While the buffer *size* is capped at 1000 entries, individual values within those entries are not bounded. The `consecutiveFlushFailures` counter resets on any success (line 70), so partial outages (some groups succeed, some fail) prevent the backoff from engaging.
- **Suggested fix:** Add a per-group retry counter or cap the re-buffered value per group. If a group's increment has been re-buffered more than N times, drop it and log a warning.

---

## Previously Fixed — Confirmed Resolved

All cycle 28 findings (C28-01 through C28-09) are confirmed resolved in the current code:
- C28-01/C28-02: Topic and tag actions now have full audit logging
- C28-03/C28-04: `createTopic` and `deleteTopic` now revalidate `/admin/dashboard`
- C28-05: `deleteTag` now revalidates `/admin/dashboard`
- C28-06: `createTopicAlias` and `deleteTopicAlias` now have audit logging
- C28-07: `updatePassword` now logs audit event
- C28-08: `logout` now logs audit event
- C28-09: `addTagToImage`, `removeTagFromImage`, `batchAddTags` now revalidate `/admin/tags`

No regressions detected from prior cycles.

---

## Deferred Carry-Forward

All previously deferred items from cycles 5-28 remain deferred with no change in status. See `.omc/plans/plan-deferred-items.md` for the full list.

---

## Summary

- **0 CRITICAL** findings
- **2 MEDIUM** findings (C29-01 revalidation gap, C29-02 defense-in-depth)
- **4 LOW** findings (C29-03 through C29-06)
- **6 total** findings
