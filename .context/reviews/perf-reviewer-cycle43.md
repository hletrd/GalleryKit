# Performance Reviewer — Cycle 43 (2026-04-20)

## Findings

### P43-01: `getImagesLite` subquery for tag_names executes per row without index optimization [LOW] [MEDIUM confidence]
**File:** `apps/web/src/lib/data.ts` lines 280-283
The scalar subquery `(SELECT GROUP_CONCAT(DISTINCT t.name ...) FROM imageTags it JOIN tags t ...)` executes for every row in the result set. While this avoids the GROUP BY + GROUP_CONCAT at the outer level (which was the original expensive approach), the correlated subquery still executes once per image row. For galleries with many tags per image, this could be slower than a JOIN-based approach with proper indexing. The `idx_image_tags_tag_id` index exists, which helps the JOIN, but the subquery approach means N+1 subquery executions for N images.
**Fix:** This is an acceptable trade-off for small-to-medium galleries (typical limit of 100 images). For very large galleries, consider using a CTE or materialized subquery. Low priority.

### P43-02: `exportImagesCsv` loads up to 50K rows with GROUP_CONCAT into memory simultaneously [LOW] [HIGH confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 37-52
The CSV export fetches up to 50,000 rows with a GROUP_CONCAT for tags in a single query, holding all results in memory. The code does release the `results` array after building CSV lines (line 76), but both arrays coexist briefly. With 50K rows and potentially long tag strings, this could use significant memory.
**Status:** Already noted as PERF-38-02 in deferred items. No new finding.

### P43-03: `flushGroupViewCounts` creates up to 1000 concurrent UPDATE queries [LOW] [HIGH confidence]
**File:** `apps/web/src/lib/data.ts` lines 49-64
The flush uses `Promise.all` with up to 1000 concurrent DB updates. The connection pool (10 connections) naturally throttles this, but the Promise.all still creates 1000 promises in memory simultaneously.
**Status:** Already noted as D10 in plan-143 deferred items. No new finding.

## Summary
No new actionable performance findings. The codebase's performance characteristics are well-understood from prior cycles and all significant issues are already deferred.
