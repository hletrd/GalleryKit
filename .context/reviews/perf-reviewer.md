# Cycle 29 Performance Reviewer Report

Review target: `/Users/hletrd/flash-shared/gallery`
Review role: `cycle-29 perf-reviewer`
HEAD reviewed: `b4fa1f64`
Mode: review-only. Product code was not changed; this report is the only intended edit.

## Inventory

Required context read first:

- `AGENTS.md`
- `CLAUDE.md`

Repository inventory evidence:

- `rg --files apps/web/src apps/web/scripts apps/web/drizzle apps/web/public apps/web/e2e | wc -l` => 765 review-relevant source/script/schema/public/e2e files.
- Broad content inventory used `rg` over `sharp`, `processImage`, `PQueue`, `queue`, `concurrency`, `cache(`, `revalidate`, `fetch(`, `Promise.all`, timers, `Map`, rate limiting, SQL/Drizzle/MySQL, service worker, observers, React memoization, masonry, analytics views, semantic embeddings, CLIP, backfill, cleanup, retention, pool, and transaction patterns.

Relevant surfaces examined:

- Image processing, upload, queues, storage, cleanup, and backfills: `apps/web/src/lib/process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, `process-topic-image.ts`, `upload-paths.ts`, `upload-tracker*.ts`, `storage/*`, `scripts/backfill-color-pipeline.ts`, `scripts/backfill-clip-embeddings.ts`.
- DB/data/query/cache surfaces: `apps/web/src/db/index.ts`, `db/schema.ts`, `lib/data.ts`, `data-timeline.ts`, `analytics-data.ts`, `analytics.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `view-retention.ts`, `gallery-config*.ts`, `settings-hash.ts`, `smart-collections.ts`, `serve-upload.ts`.
- Public/admin routes and actions: public pages under `apps/web/src/app/[locale]/(public)`, API routes under `apps/web/src/app/api`, actions under `apps/web/src/app/actions`, admin DB/analytics/settings/dashboard pages.
- Client/UI responsiveness surfaces: `home-client.tsx`, `load-more.tsx`, `search.tsx`, `similar-photos.tsx`, `map/*`, `histogram.tsx`, `lightbox.tsx`, `photo-viewer.tsx`, `image-zoom.tsx`, `upload-dropzone.tsx`, `image-manager.tsx`.
- Static worker/cache/runtime/deploy config: `apps/web/public/sw.template.js`, `sw.js`, `histogram-worker.js`, `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `nginx/default.conf`, `deploy.sh`.
- Existing tests relevant to this review: queue/backfill/view-retention/rate-limit/search/semantic/map/service-worker/touch-target/source-contract tests under `apps/web/src/__tests__/`.

## Findings Summary

Total findings: 9.

- Confirmed issues: 5
- Likely risks: 3
- Manual-validation risk: 1
- Highest severity: Medium

## Findings

### PERF-29-01 - Semantic and similar search do synchronous O(N * 512) scoring on the Node request thread

Status: Confirmed
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/app/api/search/semantic/route.ts:263-311` fetches up to `SEMANTIC_SCAN_LIMIT` embeddings, decodes every row, computes similarity in `.map(...)`, then sorts via `topK`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:164-201` repeats the same full-scan/dot-product path for image similarity.
- `apps/web/src/lib/clip-embeddings.ts:36-44` allows `SEMANTIC_SCAN_LIMIT` up to 25,000 rows.
- `apps/web/src/lib/clip-embeddings.ts:141-152` decodes every embedding row into a fresh `Float32Array` before scoring.

Failure scenario:

Production semantic search is enabled and the scan limit is raised for recall. A few concurrent semantic/similar requests return from MySQL, then each request decodes thousands of 2048-byte vectors and runs millions of multiply/add operations plus sorting on the main Node event loop. During those loops, the single web process delays SSR, server actions, queue callbacks, and admin work even though CLIP inference itself is separately queued.

Fix:

Move scan/scoring off the request event loop or avoid brute-force scoring there. Short term: add a process-global semaphore for semantic scan/scoring and chunk/yield with `setImmediate` between batches. Better: use worker threads or a sidecar for decode/scoring. Long term: use a vector index/ANN service or DB-side vector capability so public requests fetch only candidate IDs. Keep `SEMANTIC_SCAN_LIMIT` low until this is addressed.

### PERF-29-02 - Public map can still serialize and mount up to 10,000 markers plus 10,000 list rows

Status: Confirmed
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/lib/data.ts:1649-1685` hard-caps map rows at `MAP_MAX_MARKERS = 10000`.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:38-56` fetches all map images server-side and maps them into client props.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:74-95` renders the map plus a full fallback `<ul>` item for every marker.
- `apps/web/src/components/map/map-client.tsx:86-90` allocates latitude/longitude arrays and spreads them into `Math.min` / `Math.max`.
- `apps/web/src/components/map/map-client.tsx:119-140` renders one React Leaflet `<Marker>` and `<Popup>` per marker.

Failure scenario:

An admin enables map visibility for a large travel/archive topic. A visitor opens `/map`; the server serializes thousands of marker props, the client hydrates Leaflet, creates thousands of marker/popup components, and also renders the accessible list. Mid-range mobile browsers can freeze or become unresponsive despite the DB result being technically bounded.

Fix:

Make `/map` viewport/cluster based. Lower the initial cap to a UI-safe number, load markers by bbox/zoom, use marker clustering or a canvas/vector layer, paginate or limit the fallback list, and replace the spread-based bounds calculation with a single loop.

### PERF-29-03 - Rate-limit bucket GC deletes by an unindexed suffix and is unchunked

Status: Confirmed
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/db/schema.ts:212-219` defines `rate_limit_buckets` with primary key `(ip, bucket_type, bucket_start)` and no index leading with `bucket_start`.
- `apps/web/src/lib/rate-limit.ts:515-517` purges expired rows with one `DELETE ... WHERE bucket_start < cutoff`.
- `apps/web/src/lib/image-queue.ts:1019-1045` runs this purge at startup and hourly from the queue GC timer.
- In contrast, `apps/web/src/lib/view-retention.ts:64-90` uses indexed, chunked deletion for view-event retention.

Failure scenario:

A rotating-IP bot creates many rate-limit buckets across public search/load-more/view-record endpoints. The hourly purge must scan the table to find expired rows because `bucket_start` is the third PK column, then deletes all matches in one statement. On the shared MySQL writer this can produce lock/CPU spikes and connection-pool queueing for live requests.

Fix:

Add a migration with an index leading on `bucket_start`, for example `(bucket_start, ip, bucket_type)`, then make `purgeOldBuckets` batch with a delete limit and bounded loop like `view-retention.ts`.

### PERF-29-04 - Public keyword search uses leading-wildcard LIKE scans across images, tags, and aliases

Status: Confirmed
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/app/actions/public.ts:236-306` exposes public keyword search with rate limiting.
- `apps/web/src/lib/data.ts:1545-1563` searches title, description, camera model, lens model, topic slug, and topic label with `containsLike`.
- `apps/web/src/lib/data.ts:1590-1621` then runs tag and topic-alias joined branches, also with `containsLike`, when the first branch does not fill the result limit.
- The schema indexes at `apps/web/src/db/schema.ts:116-120` support gallery chronology/topic/user-filename patterns, not leading-wildcard contains search.

Failure scenario:

On a larger gallery, common short queries force scans over processed images and, if the first branch returns fewer than 20 rows, additional joined scans over tags and aliases. A few concurrent users or scripted searches drive DB CPU/filesort pressure despite per-IP rate limiting.

Fix:

Introduce a purpose-built search index: MySQL FULLTEXT where acceptable, or an ngram/search table for Korean/partial matching. Raise the minimum keyword length for contains search, make tag/alias lookup exact or prefix where possible, and consider short TTL caching for frequent public queries.

### PERF-29-05 - Timeline, year, and On This Day queries apply non-sargable date functions to `capture_date`

Status: Likely risk
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/lib/data-timeline.ts:97-116` uses `MONTH(capture_date)` and `DAY(capture_date)` for On This Day.
- `apps/web/src/lib/data-timeline.ts:129-141` uses `YEAR(capture_date)` for the year index.
- `apps/web/src/lib/data-timeline.ts:186-207` uses `YEAR(capture_date)` and optional `MONTH(capture_date)` for timeline/year pages.
- `apps/web/src/db/schema.ts:116-118` has `(processed, capture_date, created_at)` and topic/capture-date indexes, but function-wrapped `capture_date` prevents range use beyond the `processed` prefix.

Failure scenario:

As the gallery grows, public `/timeline`, `/year/[year]`, and homepage On This Day calls scan the processed image slice and evaluate date functions row-by-row before returning capped results. The code comments already acknowledge the issue; the risk becomes material when image count grows past personal-gallery scale or crawler traffic hits these dynamic routes repeatedly.

Fix:

Use range predicates for year/month pages: `capture_date >= 'YYYY-01-01' AND capture_date < 'YYYY+1-01-01'`, and month ranges inside the selected year. For On This Day, add generated/indexed month/day columns or maintain a small calendar lookup table indexed as `(processed, capture_month, capture_day, capture_date, created_at, id)`.

### PERF-29-06 - Feed and sitemap freshness ordering lacks a supporting image index

Status: Likely risk
Severity: Low
Confidence: High

Evidence:

- `apps/web/src/lib/data.ts:828-853` orders feeds by `updated_at DESC, created_at DESC, id DESC`.
- `apps/web/src/lib/data.ts:1635-1646` orders sitemap image IDs the same way, with a limit up to 50,000.
- `apps/web/src/db/schema.ts:116-120` has processed/capture-date, processed/created-at, topic/capture-date, user-filename, and uploaded-by indexes, but no `(processed, updated_at, created_at, id)` index.
- `apps/web/src/app/feed.xml/route.ts:29-40` and `apps/web/src/app/sitemap.ts:40-49` call these helpers.

Failure scenario:

Crawlers/feed readers request feed and sitemap around upload/edit periods. The route frequency is mitigated by conditional/feed logic and sitemap ISR, but each run still sorts processed rows by `updated_at` without an index aligned to the ordering. Sitemap can request many IDs.

Fix:

Add `(processed, updated_at, created_at, id)`. If topic feeds are important, add `(topic, processed, updated_at, created_at, id)` or first fetch ordered IDs from the freshness index and then aggregate tags only for those IDs.

### PERF-29-07 - First-page gallery and smart-collection loads compute exact total count via `COUNT(*) OVER()` on grouped listing queries

Status: Likely risk
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/lib/data.ts:878-907` adds `COUNT(*) OVER()` to the public listing query with `LEFT JOIN imageTags`, `LEFT JOIN tags`, `GROUP BY images.id`, chronological ordering, and `LIMIT pageSize + 1`.
- `apps/web/src/lib/data.ts:856-875` reads `total_count` only to return `totalCount`; `hasMore` is already derivable from `limit + 1`.
- `apps/web/src/app/[locale]/(public)/page.tsx:171-173` calls this for the public homepage.
- `apps/web/src/lib/data.ts:1325-1364` applies the same pattern to initial smart-collection pages, called by `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:106-107`.

Failure scenario:

The root gallery or a public smart collection receives regular traffic with thousands of tagged images. Each initial page returns about 30 visible rows but asks MySQL to compute the exact grouped total. That turns a bounded listing into an all-matching-row count/sort cost on hot public pages.

Fix:

Remove exact counts from the hot path. Show loaded count plus "more", use a cached/materialized count maintained on image/tag mutations, or fetch counts separately behind a TTL. Keep `LIMIT pageSize + 1` for pagination.

### PERF-29-08 - Upload and bulk tag paths resolve tags serially with multiple DB round trips per tag

Status: Confirmed
Severity: Low
Confidence: High

Evidence:

- `apps/web/src/app/actions/images.ts:301-329` loops over every unique upload tag and awaits `ensureTagRecord` serially.
- `apps/web/src/lib/tag-records.ts:66-68` implements `ensureTagRecord` as `insert ignore` followed by `selectTagByNameOrSlug`.
- `apps/web/src/lib/tag-records.ts:29-44` can run two SELECTs per tag after the insert.
- `apps/web/src/app/actions/images.ts:1132-1156` repeats serial tag addition/removal resolution inside the bulk-update transaction.

Failure scenario:

An admin uploads a batch with many comma-separated tags or bulk-adds/removes several tags over many images. The request performs many serialized DB round trips while holding the upload quota/processing contract branch, and the bulk path holds a transaction while resolving tag metadata. Admin responsiveness degrades and locks live longer than necessary.

Fix:

Batch tag resolution: normalize names/slugs, fetch existing rows with `WHERE name IN (...) OR slug IN (...)`, insert missing rows in one `INSERT IGNORE ... VALUES (...)`, then re-select once. In the bulk path, resolve tag records outside the image mutation transaction where possible; keep only image/tag row mutations inside the transaction.

### PERF-29-09 - Service worker waits on per-image HEAD probes before serving cached derivatives

Status: Manual-validation risk
Severity: Low
Confidence: Medium

Evidence:

- `apps/web/public/sw.template.js:34-38` sets `HEAD_REVALIDATE_TIMEOUT_MS = 300`.
- `apps/web/public/sw.template.js:184-287` serves cached derivatives only after a HEAD revalidation when the cached response has an ETag.
- `apps/web/public/sw.template.js:253-257` awaits the HEAD request on the display path before returning the cached response.
- `apps/web/src/lib/serve-upload.ts:18-82` optimizes server-side settings-hash/ETag work, but the browser still pays request scheduling and one round trip per cached tile.

Failure scenario:

A returning mobile visitor opens a cached gallery over slow, lossy, or captive-network conditions. The service worker has cached image bytes, but each cached derivative with an ETag can wait up to 300 ms for HEAD before painting. Many tiles can issue many HEADs concurrently, delaying a page that should feel instant from local cache.

Fix:

Validate with a throttled browser trace. If confirmed, serve cached bytes immediately and revalidate in the background. Preserve color-setting freshness with a route-level/settings manifest fetched once per page, a SW version/settings-hash broadcast, or a bounded global revalidation gate rather than one synchronous HEAD per cached image.

## Positive Controls Observed

- DB pool is bounded at 10 connections with queue limit 20 (`apps/web/src/db/index.ts:23-33`).
- Sharp/libvips concurrency and cache are bounded (`apps/web/src/lib/process-image.ts:35-57`).
- Image queue concurrency is capped against DB pool headroom (`apps/web/src/lib/image-queue.ts:88-108`).
- Queue GC, shutdown, restore quiesce, retry maps, and bootstrap continuation are explicitly guarded (`apps/web/src/lib/image-queue.ts:1008-1050` plus surrounding queue code).
- Image derivative writes use atomic temp/final handling and backup restore on failure (`apps/web/src/lib/process-image.ts:1200-1228` and following generation code).
- View-event retention cleanup is indexed and chunked (`apps/web/src/lib/view-retention.ts:64-90`).
- Upload serving avoids importing Sharp and caches/refreshes settings hash with a short TTL and inflight dedupe (`apps/web/src/lib/serve-upload.ts:1-82`).
- Public load-more uses cursor/keyset pagination after the first page and guards stale client responses (`apps/web/src/app/actions/public.ts`, `apps/web/src/components/load-more.tsx`).
- Search UI debounces requests, aborts semantic fetches, and guards stale responses (`apps/web/src/components/search.tsx`).
- Histogram pixel binning is worker-based; the main thread downsizes via canvas before transferring the buffer (`apps/web/src/components/histogram.tsx`, `apps/web/public/histogram-worker.js`).

## Final Missed-Issues Sweep

Final sweep re-ran repository-wide `rg` over unbounded results, date functions, `COUNT(*) OVER`, `LIKE`/`containsLike`, semantic scan limits, `Promise.all`, timers, maps, queue/background patterns, and service-worker cache paths. The active findings above cover the material performance/concurrency/UI-responsiveness issues found in this pass.

Files intentionally not line-reviewed: binary fixtures, screenshots, fonts/icons, generated upload assets, and archived review screenshots. They were inventoried where present but excluded unless they participate in runtime behavior.

No tests were run because the task is Prompt 1 review-only and requested no implementation. Evidence is static source inspection with exact file/line citations.
