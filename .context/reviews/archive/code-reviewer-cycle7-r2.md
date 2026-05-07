# Code Reviewer Review — Cycle 7 (R2)

**Date:** 2026-04-19
**Reviewer:** code-reviewer
**Scope:** Full codebase

## Findings

### CR-7R2-01: `flushGroupViewCounts` re-buffering loop can exceed `MAX_VIEW_COUNT_BUFFER_SIZE` [MEDIUM] [MEDIUM confidence]
- **File:** `apps/web/src/lib/data.ts` lines 53-58
- **Description:** When a DB update fails for a group, the catch handler re-buffers the count by calling `bufferGroupViewCount(groupId)` in a loop (`for (let i = 0; i < count; i++)`). However, `bufferGroupViewCount` itself checks the buffer size cap and drops increments when at capacity. If the buffer is nearly full and a large count fails (e.g., 100), the re-buffering loop calls `bufferGroupViewCount` 100 times sequentially. On each call, the buffer may grow by 1. This could push the buffer past the cap by up to `count` entries before the cap kicks in on subsequent calls, because `viewCountBuffer.set()` happens before the next `bufferGroupViewCount` call checks the size. In practice, this only matters during DB outages with high concurrent traffic.
- **Fix:** Check the buffer size before the re-buffering loop and log a warning if increments will be dropped, or batch-set the count directly with a single `viewCountBuffer.set()` call (adding the failed count atomically) instead of incrementing one at a time.
- **Cross-reference:** C30-03 / C36-03 (previously deferred with same concern about retry limits, but this finding adds the buffer-overflow angle).

### CR-7R2-02: `searchImages` in `data.ts` searches `filename_jpeg`, `filename_webp`, `filename_avif` columns via LIKE [MEDIUM] [MEDIUM confidence]
- **File:** `apps/web/src/lib/data.ts` lines 598-604
- **Description:** The `searchImages` function selects `filename_jpeg`, `filename_webp`, `filename_avif` in its `searchFields` and returns them as part of `SearchResult`. However, these are UUID-based filenames (e.g., `abc123.jpg`) — not user-meaningful data. Including them in the search result type is fine, but the function does NOT search these columns via LIKE (the WHERE clause only searches `title`, `description`, `camera_model`, `topic`). The `searchFields` selection is just for the return type. This is NOT a bug, but the inclusion of these fields in `searchFields` when they're never searched is misleading. The real issue: `SearchResult` exposes `filename_jpeg`, `filename_webp`, `filename_avif` to callers — if any caller renders search results, these internal UUID filenames could leak to users. On review, `searchImagesAction` in `public.ts` returns the full array to the client, meaning search results expose internal UUID filenames to unauthenticated users.
- **Fix:** Create a `searchSelectFields` that omits filename columns from `SearchResult`, or filter them out before returning to the client.

### CR-7R2-03: `uploadImages` tag batch uses slug-only lookup (inconsistent with name-first pattern) [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/app/actions/images.ts` lines 188-190
- **Description:** The `uploadImages` function's tag processing batch (Phase 3) inserts tags and then fetches tag records using `inArray(tags.slug, slugs)` — a slug-only lookup. All other tag operations (`addTagToImage`, `batchAddTags`, `batchUpdateImageTags`, `removeTagFromImage`) now use the name-first-then-slug-fallback pattern to handle slug collisions. This code path is inconsistent and will link images to the wrong tag when slug collisions exist (e.g., "SEO" and "S-E-O" both produce slug "seo").
- **Fix:** After the batch `INSERT IGNORE`, fetch tag records by name first, then fall back to slug for any not found by name. This matches the pattern used everywhere else.

### CR-7R2-04: `db-actions.ts` `dumpDatabase` env passthrough includes `LANG` and `LC_ALL` [LOW] [HIGH confidence]
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts` line 121
- **Description:** The `env` option for the `mysqldump` spawn includes `LANG` and `LC_ALL` from the Node.js process. While these are not secrets, they could theoretically leak locale-specific environment details. The previous review (CR-38-05) flagged the env passthrough as overly broad. This is a known deferred item but worth re-confirming.
- **Fix:** Already deferred as CR-38-05.

### CR-7R2-05: `updateSeoSettings` and `updateGallerySettings` loop individual DB upserts without transaction [LOW] [MEDIUM confidence]
- **Files:** `apps/web/src/app/actions/seo.ts` lines 100-111, `apps/web/src/app/actions/settings.ts` lines 57-67
- **Description:** Both functions iterate over settings keys and perform individual `INSERT ... ON DUPLICATE KEY UPDATE` operations inside a for loop. If the process crashes mid-loop, some settings will be updated and others won't, leaving the configuration in an inconsistent state. For example, changing `storage_backend` to `minio` and `image_quality_webp` to `80` — if the process crashes after the storage_backend update but before the quality update, the backend switches but quality doesn't.
- **Fix:** Wrap the loop in a `db.transaction()`.

## Previously Deferred Items Confirmed (No Change)

All previously deferred items from cycles 5-39 remain deferred with no change in status. No regressions found.
