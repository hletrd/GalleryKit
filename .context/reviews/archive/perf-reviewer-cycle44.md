# Performance Reviewer — Cycle 44 (2026-04-20)

## Review Scope
Full performance review: query efficiency, memory management, concurrency, UI responsiveness, and resource utilization.

## New Findings

### P44-01: `getAdminTags` query uses LEFT JOIN + GROUP BY without index-covered grouping [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/tags.ts` lines 24-33
**Description:** The `getAdminTags` query does `LEFT JOIN imageTags` + `GROUP BY tags.id` with `ORDER BY count(imageTags.imageId) desc`. For each tag row, this requires a temp table for grouping. With many tags (thousands) and many image-tag associations (millions), this could be slow. The `idx_image_tags_tag_id` index helps the JOIN but not the GROUP BY + sort.
**Fix:** Consider a separate `SELECT tag_id, COUNT(*) FROM image_tags GROUP BY tag_id` subquery joined to tags, or add a `image_count` denormalized column to the tags table for admin listing.
**Impact:** LOW — admin-only, infrequent, and typical galleries have <1000 tags.

### P44-02: `exportImagesCsv` loads up to 50K rows into memory before streaming [LOW] [HIGH confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 40-79
**Description:** The CSV export fetches up to 50,000 rows from the DB into a single array, then iterates to build CSV lines, then joins them. The code already releases the DB results array (line 79) before materializing the CSV string (line 81), which is good. However, for very large galleries, both `results` (50K rows) and `csvLines` (50K strings) exist simultaneously during the loop. This is a known deferred item (PERF-38-02).
**Status:** Already deferred.

## Previously Deferred Items (No Change)

- PERF-38-02: `exportImagesCsv` memory usage
- CR-38-06: `Histogram` null-safety in photo-viewer
- ARCH-38-03: `data.ts` is a god module

## No Critical or High Performance Issues Found

The codebase has good performance patterns: React `cache()` deduplication, `Promise.all` for parallel queries, indexed lookups, lazy Sharp loading, and ISR caching. No new actionable performance issues beyond the low-severity items above and previously deferred items.
