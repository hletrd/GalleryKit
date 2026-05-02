# Performance Reviewer — Cycle 2 Deep Review

## C2-PR-01 (Medium/High): `getSharedGroup` fetches all images + tags in separate queries — N+1 pattern on shared group pages

- **File**: `apps/web/src/lib/data.ts:826-906`
- **Issue**: `getSharedGroup` runs 3 sequential queries: (1) fetch the group, (2) fetch all group images with a JOIN, (3) fetch tags for all images. Query 3 uses a single batched query with `inArray`, which avoids N+1. However, queries 1 and 2 could be combined into a single query using a JOIN. Additionally, the `inArray(imageTags.imageId, imageIds)` in query 3 could return a very large result set if a group has 100 images with many tags each.
- **Fix**: Combine queries 1 and 2 using a LEFT JOIN on sharedGroups. The current separation is a minor optimization tradeoff (simpler query logic vs. one fewer DB round-trip). The impact is low because shared group pages are typically low-traffic.
- **Confidence**: Medium

## C2-PR-02 (Medium/Medium): `searchImages` runs up to 3 sequential/parallel queries on every search

- **File**: `apps/web/src/lib/data.ts:961-1074`
- **Issue**: The search function first queries title/description/camera_model/topic/label, then conditionally runs tag and alias queries in parallel. The short-circuit (line 998) helps when the main query fills the limit, but common short queries (e.g., "sunset") may trigger all 3 queries. Each query involves LIKE scans without FULLTEXT indexes. On a gallery with 10K+ images, these queries can be slow.
- **Fix**: Consider adding MySQL FULLTEXT indexes on title, description, and camera_model. The current LIKE-based search is acceptable for personal gallery scale but will degrade with growth.
- **Confidence**: Medium

## C2-PR-03 (Low/Medium): View count buffer re-buffering on flush failure can amplify load

- **File**: `apps/web/src/lib/data.ts:98-106`
- **Issue**: When a flush chunk partially fails, the failed increments are re-buffered. On the next flush cycle, these re-buffered increments are included in the next batch, potentially creating a cycle where a sustained DB outage causes the buffer to fill faster than it drains. The VIEW_COUNT_MAX_RETRIES cap (3) limits this, but in a scenario where flushes succeed for some groups but fail for others, the retry count resets for successful groups but not for persistently-failing ones. The FIFO eviction on the retry counter handles this, but the interaction between partial success and retry counting could cause some groups to lose increments faster than others.
- **Fix**: The current implementation is acceptable given the best-effort analytics nature of view counts. The FIFO eviction and max retry cap provide adequate bounds. No fix needed unless view counts become billing-grade.
- **Confidence**: Low

## C2-PR-04 (Medium/Medium): `getImage` runs 3 parallel queries — prev and next could be combined with UNION

- **File**: `apps/web/src/lib/data.ts:735-767`
- **Issue**: This was identified in cycle 1 (A1-MED-01 / C1F-PR-06) and a UNION optimization was planned in plan-336 but deferred. Re-confirming: each photo view runs 3 parallel DB queries (tags, prev, next), consuming 3 of the 10 pool connections. The UNION optimization would reduce this to 2 queries (tags + combined prev/next), saving 1 connection per photo view.
- **Fix**: Implement the UNION query as planned in plan-336.
- **Confidence**: High

## C2-PR-05 (Low/Low): `getTopicsWithAliases` fetches all topics and all aliases — unbounded memory on large catalogs

- **File**: `apps/web/src/lib/data.ts:290-311`
- **Issue**: The function fetches ALL topics and ALL aliases in two parallel queries, then joins them in memory. On a gallery with thousands of topics (unlikely for a personal gallery), this could use significant memory. The current scale makes this a non-issue.
- **Fix**: No fix needed at current scale. Re-evaluate if topic count exceeds 1000.
- **Confidence**: Low

## C2-PR-06 (Medium/Medium): `getAdminImagesLite` uses `adminSelectFields` which includes EXIF data — inflates admin dashboard payload

- **File**: `apps/web/src/lib/data.ts:639-661`
- **Issue**: The admin images listing query selects ALL admin fields including 12+ EXIF columns (camera_model, lens_model, iso, f_number, exposure_time, focal_length, etc.) that are not needed for the admin dashboard grid. These columns inflate the query result size and the InnoDB buffer pool pressure. The dashboard only needs id, filenames, topic, user_filename, processed, and created_at for the grid display.
- **Fix**: Create a separate `adminListSelectFields` that omits EXIF and other non-display fields, or add a `selectFields` parameter to `getAdminImagesLite`.
- **Confidence**: Medium

## Summary

- Total findings: 6
- Medium: 4
- Low: 2
