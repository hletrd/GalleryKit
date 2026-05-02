# Performance Review — Cycle 1 Fresh

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30
Scope: whole repository — CPU, memory, concurrency, UI responsiveness, DB query efficiency.

## Inventory reviewed

All `apps/web/src/` files with focus on: image processing pipeline, DB query patterns, connection pool, in-memory data structures, view count buffering, upload tracking, and SSR performance.

---

## Findings

### C1F-PR-01 (High / High). `exportImagesCsv` materializes up to 50K rows as a single in-memory CSV string

- Location: `apps/web/src/app/[locale]/admin/db-actions.ts:58-106`
- The CSV export loads up to 50K rows from the DB, materializes them into an in-memory `csvLines` array, then joins into a single string. For large galleries, this peaks at ~25MB heap. The `results = [] as typeof results` trick at line 97 releases the DB array, but the CSV string and csvLines array coexist briefly.
- **Severity**: Medium — 25MB is within typical Node.js heap limits (1.7GB default), but on memory-constrained Docker containers (256MB limit), this could cause OOM.
- **Fix**: Implement a streaming CSV API route that writes chunks to the response stream instead of materializing the entire CSV in memory.

### C1F-PR-02 (Medium / Medium). `getImagesLite` and `getImagesLitePage` use GROUP BY with LEFT JOIN — potential full table scan on large galleries

- Location: `apps/web/src/lib/data.ts:510-537, 561-597`
- The `tagNamesAgg` uses `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` with a LEFT JOIN on `imageTags` and `tags`. MySQL must sort and group by `images.id` for every listing query. With composite indexes on `(processed, capture_date, created_at)`, MySQL can use the index for ordering but still needs a filesort for GROUP BY.
- **Severity**: Low — at personal-gallery scale (a few thousand images, paginated 30 at a time), the cost is acceptable as documented in CLAUDE.md.
- **Fix**: No fix needed at current scale. If gallery grows beyond 10K images, consider pre-computing tag_names in a denormalized column.

### C1F-PR-03 (Medium / Medium). View count buffer flush uses exponential backoff but never alerts on sustained failure

- Location: `apps/web/src/lib/data.ts:62-148`
- When the DB is unavailable, the view count flush backs off exponentially up to 5 minutes. After `VIEW_COUNT_MAX_RETRIES` (3), increments are dropped with a console.warn. However, there's no external alerting (e.g., structured log level, metric counter) for this condition. An operator monitoring a dashboard would not know that view counts are being lost.
- **Severity**: Low — view counts are best-effort per CLAUDE.md.
- **Fix**: Consider incrementing a process-level counter of dropped view counts that can be exposed via the `/api/health` endpoint.

### C1F-PR-04 (Low / Medium). `searchImages` runs 2-3 sequential DB queries

- Location: `apps/web/src/lib/data.ts:966-1059`
- The search function first queries images, then (if needed) tags and aliases in parallel. The main query runs first to enable short-circuit optimization. This is a good pattern but means 3 DB round-trips in the worst case.
- **Severity**: Low — the short-circuit optimization (line 984) avoids the extra queries for popular search terms.
- **Fix**: No fix needed — the optimization is appropriate.

### C1F-PR-05 (Low / Low). `bootstrapImageProcessingQueue` scans all unprocessed images on startup

- Location: `apps/web/src/lib/image-queue.ts:397-474`
- On startup, the bootstrap scans up to 500 unprocessed images (BOOTSTRAP_BATCH_SIZE) and enqueues them. If the queue was previously processing a large batch when the process crashed, the bootstrap will re-enqueue all of them, potentially overwhelming the single-concurrency queue.
- **Severity**: Low — the advisory lock prevents duplicate processing, and the queue has MAX_RETRIES=3.
- **Fix**: No fix needed at current scale.

### C1F-PR-06 (Medium / Medium). `getImage` runs 4 parallel DB queries (image + tags + prev + next) for every photo view

- Location: `apps/web/src/lib/data.ts:649-764`
- The `getImage` function runs 4 parallel DB queries for every photo page view. While `Promise.all` parallelizes them, each query consumes a connection from the 10-connection pool. Under concurrent photo views, the pool could be exhausted (10 connections / 4 per view = 2.5 concurrent views max before queuing).
- **Severity**: Medium — the pool queue limit is 20, so additional requests wait rather than fail, but perceived latency increases.
- **Fix**: Consider combining prev/next into a single query using UNION, or increase the connection pool size for high-traffic deployments.
