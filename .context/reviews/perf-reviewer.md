# Performance Reviewer - Cycle 6

Review date: 2026-07-07
Scope: full repository performance/concurrency/CPU/memory/DB/query/cache/build/runtime/UI responsiveness review.
Mode: review-only. No source code edits.

## Inventory

Repository guidance and historical context:
- `AGENTS.md` / prompt-provided workspace rules: review-only artifact, no source edits, exact citations, final sweep.
- `CLAUDE.md`: architecture, runtime topology, image pipeline, CLIP semantic search, queue/backfill, deploy and quality gates.
- Prior performance reviews inspected for stale/regressed items: `.context/reviews/perf-reviewer.md`, `.context/reviews/run9-cycle8/perf-reviewer.md`, `.context/reviews/run9-cycle7/perf-reviewer.md`, `.context/reviews/run8-cycle2/perf-reviewer.md`.

Performance-relevant implementation surfaces inspected:
- DB schema/migrations/query helpers: `apps/web/src/db/schema.ts`, `apps/web/drizzle/0029_feed_updated_indexes.sql`, `apps/web/src/db/index.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/bounded-map.ts`.
- Public SSR/API/actions: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.
- Image/CPU/background work: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`.
- Caching/static/runtime: `apps/web/public/sw.template.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/revalidation.ts`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`.
- UI responsiveness: `apps/web/src/components/home-client.tsx`, `apps/web/src/components/masonry-card.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/components/on-this-day-widget.tsx`.
- Build/deploy/package surfaces: `package.json`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`.

## Findings

### PERF-C6-01 - Timeline/date archive queries remain non-sargable on every uncached public render

Severity: Low today; Medium if the archive grows substantially or crawler traffic concentrates on `/timeline` and `/year/*`.
Confidence: High.

Evidence:
- The home page is explicitly uncached (`revalidate = 0`) and always renders `OnThisDayWidget` after the masonry payload: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/page.tsx:232-235`.
- `OnThisDayWidget` runs `getOnThisDayImages()` during the home SSR pass: `apps/web/src/components/on-this-day-widget.tsx:15-22`.
- `getOnThisDayImages()` filters with `MONTH(capture_date)` and `DAY(capture_date)`, then joins tags and groups by image id: `apps/web/src/lib/data-timeline.ts:88-116`.
- `/timeline` is also `revalidate = 0`, calls `getTimelineYears()` for every render, then calls `getTimelineImages(selectedYear)`: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19-19`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-94`.
- `getTimelineYears()` uses `YEAR(capture_date)` in `SELECT DISTINCT` and `ORDER BY`: `apps/web/src/lib/data-timeline.ts:125-145`.
- `getTimelineImages()` filters with `YEAR(capture_date)` and optional `MONTH(capture_date)`, then joins tags, groups, sorts, and reads up to 501 rows: `apps/web/src/lib/data-timeline.ts:172-207`.
- `/year/[year]` is also uncached and delegates to `getYearInReviewImages()`, which delegates to `getTimelineImages(year)`: `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:20-20`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:92-103`, `apps/web/src/lib/data-timeline.ts:231-237`.
- The code comments correctly acknowledge that these predicates are non-sargable and only acceptable at personal-gallery scale: `apps/web/src/lib/data-timeline.ts:92-95`, `apps/web/src/lib/data-timeline.ts:178-184`.

Failure scenario:
When `images` grows from a few thousand to tens/hundreds of thousands of processed rows, the existing `(processed, capture_date, created_at)` index can only use the `processed = true` prefix for the `YEAR()`, `MONTH()`, and `DAY()` filters. A normal home-page hit then pays an extra per-row date-function scan for the On This Day widget before returning HTML. Timeline/year routes add the same scan plus tag joins/grouping and a 501-row sort window. Under crawler bursts or shared links, this burns DB CPU and connection time even though each individual query is bounded by `LIMIT`.

Concrete fix:
- For yearly views, replace `YEAR(capture_date) = ?` with range predicates: `capture_date >= '${year}-01-01' AND capture_date < '${year + 1}-01-01'`. For month views, add month range bounds inside the year. That lets `idx_images_processed_capture_date` serve the filter and sort shape.
- For On This Day, add generated/stored columns such as `capture_month` and `capture_day` with an index like `(processed, capture_month, capture_day, capture_date, created_at, id)`, or add a stored `capture_month_day` key and index `(processed, capture_month_day, capture_date, created_at, id)`.
- Add `EXPLAIN ANALYZE` notes or regression tests around the generated SQL for these helpers so future changes keep range/index access.

### PERF-C6-02 - Public text search still uses leading-wildcard LIKE scans across multiple query branches

Severity: Low today; Medium if public search receives sustained traffic or the corpus grows beyond personal-gallery scale.
Confidence: Medium-high.

Evidence:
- The public server action sanitizes and rate-limits search before calling `searchImages(sanitizedQuery, 20)`: `apps/web/src/app/actions/public.ts:248-329`.
- `searchImages()` caps result count and query length, but the main branch applies `containsLike()` to title, description, camera model, lens model, topic slug, and topic label: `apps/web/src/lib/data.ts:1573-1646`.
- If the main branch does not fill the limit, tag and topic-alias branches run in parallel and each uses another `containsLike()` branch with joins/grouping/sort: `apps/web/src/lib/data.ts:1648-1704`.
- The implementation bounds over-fetch to `2 * effectiveLimit` after the main query, but the scanned rows behind each `%term%` predicate are not bounded by that final row cap: `apps/web/src/lib/data.ts:1660-1669`.

Failure scenario:
The rate limit protects against floods, but each allowed query can still require several table/index scans because leading-wildcard LIKE cannot use ordinary b-tree indexes for selectivity. Short terms such as common Korean syllables, camera-brand fragments, or two-character tags are valid after the action-level checks and can fan out into the main query plus two joined fallback queries. On a larger catalog, a few concurrent users can consume DB CPU and sort memory disproportionate to the 20-row response.

Concrete fix:
- Move public text search to a searchable index strategy: MySQL FULLTEXT where language/tokenization is acceptable, an n-gram/generated-token table for Korean/substring search, or the existing CLIP/semantic path for semantic discovery with a small metadata filter.
- If substring search must remain, add a query-shape budget: reject or degrade very short high-cardinality terms, collect slow-query metrics for the three branches, and stop after the main branch when DB latency crosses a threshold.
- Keep the current rate-limit pre-increment; it is the right concurrency guard. The fix is query selectivity, not removing the limiter.

### PERF-C6-03 - Cached image tiles can still put a HEAD revalidation round trip on the paint path

Severity: Low.
Confidence: Medium.

Evidence:
- The service worker's stale-while-revalidate image path performs a conditional `HEAD` when cached metadata has an ETag or Last-Modified value: `apps/web/public/sw.template.js:376-383`.
- The HEAD probe is bounded to 300 ms: `apps/web/public/sw.template.js:39-39`, `apps/web/public/sw.template.js:379-382`.
- A stale cached response only returns immediately after the HEAD path fails, times out, returns 304/same ETag, or completes a changed-resource fetch: `apps/web/public/sw.template.js:384-430`.
- The server-side upload route has been optimized for HEAD/304: no body stream or fd open on the 304/HEAD branches, and the settings hash is behind a 5 s stale-while-revalidate module cache: `apps/web/src/lib/serve-upload.ts:42-106`, `apps/web/src/lib/serve-upload.ts:221-301`.

Failure scenario:
On a warm-cache gallery revisit with many cached tiles, the SW still waits on a per-image HEAD probe before returning the cached body. The timeout keeps the delay bounded, and the server path is cheap, but flaky mobile networks or a transient slow upstream can add up to 300 ms to visible cached tiles. Because the home grid uses many images, the user-visible symptom is delayed first paint of images that were already available locally.

Concrete fix:
- Change the stale path to return cached bytes immediately and move conditional HEAD/fetch revalidation fully into `event.waitUntil()`, or add a short freshness cooldown so a cached tile is not HEAD-probed more than once per N minutes.
- Preserve the existing ETag/Last-Modified logic and the `extendLifetime()` wrapper; the issue is whether the HEAD gate sits before returning the cached response.
- Add a browser-level regression test that simulates slow HEAD responses and asserts cached images paint without waiting for the HEAD timeout.

## Final Sweep

No critical or high-confidence medium performance defects found in this cycle. The current tree already contains concrete mitigations for several historically risky paths:
- Feed/sitemap `updated_at` ordering now has matching indexes in schema and migration: `apps/web/src/db/schema.ts:117-125`, `apps/web/drizzle/0029_feed_updated_indexes.sql:1-3`; feed/sitemap helpers use those orderings: `apps/web/src/lib/data.ts:845-890`, `apps/web/src/lib/data.ts:1718-1729`.
- Analytics/view background writes are bounded by a concurrency-2 queue with a 1000 pending cap: `apps/web/src/lib/background-db-writes.ts:3-10`, `apps/web/src/lib/background-db-writes.ts:34-75`.
- DB connection pool pressure is capped at pool/queue level: `apps/web/src/db/index.ts:23-34`.
- Image processing constrains libvips thread fan-out and disables Sharp cache for steady RSS: `apps/web/src/lib/process-image.ts:36-57`.
- Live upload processing, admin backfill, semantic embedding, and CLIP inference all have explicit concurrency/cap controls: `apps/web/src/lib/image-queue.ts:123-152`, `apps/web/src/lib/admin-backfill-runner.ts:12-40`, `apps/web/src/lib/clip-model.ts:53-72`, `apps/web/src/app/api/search/semantic/route.ts:263-284`.
- Image-serving hot path avoids per-request settings SELECTs and avoids fd/body work for HEAD/304: `apps/web/src/lib/serve-upload.ts:42-106`, `apps/web/src/lib/serve-upload.ts:221-301`.
- Public SSR/image surfaces are protected by nginx request/connection limiters and dedicated Next image optimizer throttling: `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:244-260`, `apps/web/nginx/default.conf:272-309`.
- UI hot paths reserve masonry dimensions, avoid link prefetch fan-out, use passive/guarded scroll/resize listeners, and keep pagination observer churn bounded: `apps/web/src/components/masonry-card.tsx:50-81`, `apps/web/src/components/home-client.tsx:20-79`, `apps/web/src/components/home-client.tsx:217-242`, `apps/web/src/components/load-more.tsx:43-159`.
- Build/runtime packaging uses standalone output, externalizes native packages, and sets deterministic shutdown ownership for buffered analytics flushes: `apps/web/next.config.ts:36-50`, `apps/web/Dockerfile:121-147`, `apps/web/Dockerfile:187-197`.

Validation note: this was a static review pass. I did not run lint/typecheck/tests because the task requested a no-source-edit performance review artifact; the review claims above are grounded in source inspection and exact file/line citations.
