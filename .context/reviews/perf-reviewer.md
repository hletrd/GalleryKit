# Perf Reviewer Report - Cycle 21

Review lane: `perf-reviewer`
Scope: current `HEAD` (`2cc619bb`)
Mode: review-only. Implementation files were not modified.

## Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then reviewed the current repository for performance, concurrency, CPU/memory pressure, DB query shape, UI responsiveness, image/CLIP pipeline costs, caching, rate-limit/data-structure growth, and deployment/runtime behavior. I also compared the current code against prior cycle perf reports so stale findings were not re-filed as current evidence.

Relevant files and regions inventoried:

- Public listing flow: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/app/actions/public.ts`, and `apps/web/src/lib/data.ts`.
- Timeline/archive flow: `apps/web/src/app/[locale]/(public)/timeline/page.tsx`, `apps/web/src/components/on-this-day-widget.tsx`, and `apps/web/src/lib/data-timeline.ts`.
- Search/CLIP flow: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/image-queue.ts`, and `apps/web/scripts/backfill-clip-embeddings.ts`.
- Image/upload processing: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, browser upload actions, Lightroom upload route, restore/backfill helpers, and deploy scripts.
- Admin and analytics flow: `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx`, `apps/web/src/app/[locale]/admin/db-actions.ts`, and `apps/web/src/lib/analytics-data.ts`.
- Runtime controls: `apps/web/src/db/index.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/bounded-map.ts`, `apps/web/src/lib/upload-tracker-state.ts`, service worker files, feed/sitemap/OG routes, Docker/deploy helpers, and Drizzle schema/index definitions.

## Findings

### PERF-C21-01 - Initial public gallery pages do full grouped count work on every dynamic request

Severity: Medium
Confidence: High

Files/regions:

- `apps/web/src/lib/data.ts:878-907` builds `getImagesLitePage()` with `LEFT JOIN imageTags`, `LEFT JOIN tags`, `GROUP BY images.id`, `COUNT(*) OVER()`, sort, offset, and `LIMIT`.
- `apps/web/src/app/[locale]/(public)/page.tsx:14-16` disables ISR for the public home page, and `apps/web/src/app/[locale]/(public)/page.tsx:164-166` calls `getImagesLitePage()` for the first 30 cards.
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17` disables ISR for topic pages, and `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:174-176` calls the same counted query.
- `apps/web/src/components/home-client.tsx:267-269` renders the exact `totalCount`, making the count part of the hot page contract.

Problem: the initial home/topic render returns only a small page, but the query shape asks MySQL to join tag rows, group by image, sort, and compute an exact window count over the full matching set before returning that page. Because these routes are `revalidate = 0`, this work is paid on every uncached request rather than amortized by ISR.

Concrete failure scenario: a gallery grows to tens of thousands of processed images with multiple tags per image. A crawler or a burst of visitors hitting `/`, topic pages, or filtered tag variants causes repeated full-match grouped count work to return about 30 cards, competing with uploads, rate-limit checks, semantic search, and analytics on the same runtime.

Suggested fix: split the first page into a bounded page-id/keyset query plus a tag fetch only for the returned IDs. Remove exact totals from the public hot path, cache them briefly, or compute them through a separate low-priority count query. If the UI still needs a count, keep it independent of the tag aggregation and avoid `COUNT(*) OVER()` on the grouped card query.

### PERF-C21-02 - Infinite masonry keeps every loaded card in client state and DOM

Severity: Medium
Confidence: High

Files/regions:

- `apps/web/src/components/home-client.tsx:124-129` stores the current gallery in `allImages` and appends every loaded page with a full array copy.
- `apps/web/src/components/home-client.tsx:195-197` derives render count directly from the accumulated array.
- `apps/web/src/components/home-client.tsx:286-340` starts mapping every accumulated image into masonry card DOM and picture elements.
- `apps/web/src/components/load-more.tsx:41-64` fetches the next page and passes it back to append, while `apps/web/src/components/load-more.tsx:116-132` auto-triggers more loading via an IntersectionObserver sentinel.

Problem: the load-more path has no virtualization, windowing, or auto-load cap. Every page the visitor scrolls through remains live in React state, DOM, image bookkeeping, and layout calculations.

Concrete failure scenario: a visitor scrolls deeply through a large gallery on a mid-range phone. Heap, DOM nodes, image observer work, style/layout cost, and React reconciliation grow linearly with every loaded page, eventually degrading scroll smoothness and INP.

Suggested fix: use a virtualized/windowed masonry implementation, or cap automatic infinite loading after a bounded number of pages and switch to explicit page navigation. If scroll restoration is required, preserve page/cursor anchors while recycling offscreen cards instead of keeping the whole history mounted.

### PERF-C21-03 - CSV export materializes the full export in server and browser memory

Severity: Medium
Confidence: High

Files/regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:79-84` documents that the server action materializes up to 50,000 rows as one CSV string.
- `apps/web/src/app/[locale]/admin/db-actions.ts:102-117` loads a grouped result set with `GROUP_CONCAT(...)` and `.limit(50000)`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:124-152` builds a `csvLines` array, clears the DB results array, then joins the full CSV string.
- `apps/web/src/app/[locale]/admin/db-actions.ts:156-159` returns the full CSV string through the server action response.

Problem: the export is bounded, but it still holds a large DB result set, per-row CSV strings, and the joined CSV string in one Node request. The client then receives the full string before it can create the download, duplicating the payload in browser memory.

Concrete failure scenario: an admin exports a 50,000-row gallery while image processing or public traffic is active. Long descriptions and many tags can make the payload much larger than the comment's nominal 15-25 MB estimate, creating GC pressure in the Node process and a visible pause in the admin tab before the download starts.

Suggested fix: move CSV export to an authenticated streaming route or background export job. Stream rows with backpressure into CSV output, or write a temp file and return a file response. Keep the row cap/truncation warning, but avoid returning the full CSV as a server-action string.

### PERF-C21-04 - Admin analytics fans out multiple aggregate scans against the shared pool

Severity: Low-Medium
Confidence: Medium

Files/regions:

- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-36` starts five analytics queries in one `Promise.all`.
- `apps/web/src/lib/analytics-data.ts:28-46` aggregates top photos.
- `apps/web/src/lib/analytics-data.ts:62-79` aggregates top topics.
- `apps/web/src/lib/analytics-data.ts:112-127` aggregates countries.
- `apps/web/src/lib/analytics-data.ts:161-180` aggregates shared-group views.
- `apps/web/src/lib/analytics-data.ts:192-207` aggregates referrers.

Problem: the analytics page runs five grouped aggregate queries concurrently. For the default 30-day window this is bounded by time predicates, but the supported `all` window removes the date predicate and several queries fall back to wider covering-index or grouped scans. They run against the same DB pool used by public pages, uploads, queue state, rate limits, and view flushing.

Concrete failure scenario: an admin opens `/admin/analytics?window=all` during an upload/backfill window or while public traffic is active. Five aggregate scans start together, occupying pool slots and CPU/temp-table capacity, increasing latency for unrelated requests.

Suggested fix: materialize daily/hourly rollups for analytics and query those for admin summaries. Short term, cache analytics results per window for a small TTL and cap/sequence admin aggregate concurrency so the page does not consume a large share of the shared pool at once.

### PERF-C21-05 - Timeline/archive date filters are non-sargable on dynamic public pages

Severity: Low
Confidence: High

Files/regions:

- `apps/web/src/lib/data-timeline.ts:88-116` uses `MONTH(capture_date)` and `DAY(capture_date)` for the On This Day widget.
- `apps/web/src/lib/data-timeline.ts:129-142` selects and orders distinct years with `YEAR(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:178-207` documents and uses `YEAR(capture_date) = ?` plus optional `MONTH(capture_date) = ?` for timeline pages.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:16` disables ISR for the timeline route, and `apps/web/src/app/[locale]/(public)/timeline/page.tsx:62-84` loads years and the selected year's images on render.

Problem: the timeline code already notes that these date-function predicates are not sargable. MySQL can narrow on `processed`, but it still evaluates date functions across the processed-date slice before joining/grouping tags for the selected timeline page. The route is dynamic, so repeated hits pay the query cost repeatedly.

Concrete failure scenario: a larger gallery's `/timeline` or `?year=` pages become crawl or visitor hotspots. MySQL repeatedly scans processed rows, evaluates `YEAR()`/`MONTH()` per row, then does tag joins for up to 501 rows even though a range predicate could seek directly into the year/month portion of the existing date index.

Suggested fix: rewrite year and month filters as range predicates, for example `capture_date >= 'YYYY-01-01' AND capture_date < 'YYYY+1-01-01'`, with month-specific ranges when needed. For On This Day, add generated `capture_month` and `capture_day` columns plus a composite index, or precompute a small archive/date table.

## Final Missed-Issues Sweep

- CLIP semantic and similar search were rechecked across `semantic/route.ts`, `similar/[id]/route.ts`, `clip-model.ts`, and `clip-embeddings.ts`. Request-path vector scans are bounded by `SEMANTIC_SCAN_LIMIT`, inference uses explicit slot/queue limits, and aborted semantic requests pass the request signal into embedding. No new cycle 21 finding beyond monitoring scan-limit cost.
- Image processing and backfill were rechecked across `process-image.ts` and `image-queue.ts`. Sharp concurrency/cache, queue concurrency caps, missing-embedding bootstrap batching, and verification sampling are intentional bounded costs in current HEAD. I did not re-file generic encoder CPU cost without stronger production evidence.
- Rate-limit and in-memory maps were rechecked across `rate-limit.ts`, `auth-rate-limit.ts`, `bounded-map.ts`, and `upload-tracker-state.ts`. The high-cardinality maps observed in current code use bounded containers or cleanup paths; no unbounded growth issue was confirmed.
- Feed, sitemap, OG, service worker, and upload-serving paths were rechecked for cache headers, caps, and whole-buffer work. I did not find a higher-confidence cycle 21 issue than the five above.
- Deployment/runtime scripts were rechecked against `CLAUDE.md` constraints. The deploy path remains intentionally single-host and prunes after `up -d`; no new deploy-runtime performance finding was confirmed.

## Validation Notes

This was a source-review pass, not a benchmark pass. No tests or `EXPLAIN ANALYZE` runs were executed. The DB-query findings should be prioritized with production-like row counts and query plans before choosing exact indexes or rollup shapes.

Finding count: 5 confirmed issues, 0 high/critical findings.
