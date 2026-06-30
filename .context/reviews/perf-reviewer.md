# Cycle 28 Performance Reviewer Report

Review target: `/Users/hletrd/flash-shared/gallery`
Review role: `cycle-28 perf-reviewer`
HEAD reviewed: `395de19b`
Mode: review-only. Source code was not changed; this report is the only intended edit.

## Inventory

Required context read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`
- Prior `.context/reviews/perf-reviewer.md`
- Prior performance/review history located with `find .context/reviews -name perf-reviewer.md`
- Deferred/performance history located with repository-wide `.context` grep for performance and deferred markers

Repository-wide inventory evidence before finding review:

- `git ls-files` excluding runtime/build/vendor scratch: 2,597 tracked files.
- Review-relevant executable/config/schema text inventory: 579 files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, and `apps/web/public` with TS/TSX/JS/MJS/SQL/JSON/CSS/HTML extensions.
- Drizzle migration inventory: 31 migration/meta files under `apps/web/drizzle`.
- Route/page inventory explicitly enumerated every `route.ts`, `route.tsx`, `page.tsx`, `layout.tsx`, and `sitemap.ts` under `apps/web/src/app`.
- Binary/generated assets in `apps/web/public/uploads`, icon/font files, screenshots, and archived review artifacts were inventoried as repository files; they were not line-reviewed unless they participate in runtime behavior. `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, and `apps/web/public/histogram-worker.js` were included.

Review-relevant files and documentation examined:

- Root/project docs and configs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`.
- Schema/data access/cache/query surfaces: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/sql-like.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/view-retention.ts`, `apps/web/src/lib/analytics.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/tag-records.ts`, `apps/web/src/lib/tag-slugs.ts`.
- Image processing, upload, queues, backfills, storage: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/color-detection.ts`, `apps/web/src/lib/gain-map-detection.ts`, `apps/web/src/lib/icc-extractor.ts`, `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/storage/types.ts`.
- CLIP/semantic CPU paths: `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-inference.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-model-id.ts`, `apps/web/src/lib/clip-paths.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/download-clip-models.ts`.
- Server actions and admin/public routes: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/admin-backfill.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/collections.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`.
- Public pages/route consumers: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `[topic]/feed.xml/route.ts`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `c/[slug]/page.tsx`, `map/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `uploads/[...path]/route.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/sitemap.ts`.
- Client/UI responsiveness surfaces: `apps/web/src/components/home-client.tsx`, `load-more.tsx`, `search.tsx`, `similar-photos.tsx`, `map/map-client.tsx`, `map/map-loader.tsx`, `histogram.tsx`, `image-zoom.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `bulk-edit-dialog.tsx`, `image-manager.tsx`, `upload-dropzone.tsx`, `register-service-worker.tsx`, `grid-picture.tsx`, `optimistic-image.tsx`, `nav.tsx`, `nav-client.tsx`, `on-this-day-widget.tsx`.
- Static worker/cache/serving paths: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/public/histogram-worker.js`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/sw-cache.ts`.
- Operational scripts reviewed for performance/concurrency impact: `apps/web/scripts/migrate.js`, `backfill-color-pipeline.ts`, `backfill-cicp-recheck.ts`, `backfill-alt-text.ts`, `build-sw.ts`, `restore-maintenance-recovery.ts`, `restore-maintenance-recovery.mjs`, `run-e2e-server.mjs`, `mysql-connection-options.js`, `entrypoint.sh`.

## Findings Summary

Total findings: 9.

- Confirmed: 4
- Likely: 4
- Risk needing manual validation: 1
- Highest severity: Medium

## Findings

### PERF-28-01 - Semantic and similar search do synchronous O(N * 512) scoring on the Node request thread

Status: Confirmed
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/app/api/search/semantic/route.ts:263-311` fetches up to `SEMANTIC_SCAN_LIMIT` embedding rows, decodes each row, computes similarity in `.map(...)`, then sorts via `topK`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:164-201` performs the same full scan/dot-product path for "similar photos".
- `apps/web/src/lib/clip-embeddings.ts:36-44` allows `SEMANTIC_SCAN_LIMIT` to be configured up to 25,000 rows.
- `apps/web/src/lib/clip-model.ts:53-160` bounds CLIP model inference, but that queue does not cover the post-query vector decode and dot-product loop.

Problem:

The expensive model call is queued, but the per-request vector scan is synchronous application CPU after the DB returns. At the default 2,000 rows this is tolerable; at the documented maximum 25,000 rows, each request decodes up to roughly 50 MB of embedding blobs and performs about 12.8 million multiply/add operations plus sorting/filtering on the main Node event loop.

Concrete failure scenario:

Production semantic search is enabled and `SEMANTIC_SCAN_LIMIT` is raised for recall. A few users, crawlers, or browser retries hit semantic/similar search concurrently. The database work completes, then multiple request handlers run large dot-product loops in-process. During those loops the single Next.js server process delays SSR, Server Actions, upload queue callbacks, and rate-limit DB cleanup, even though the CLIP inference queue itself appears healthy.

Suggested fix:

Move vector scoring off the request event loop or avoid brute-force scoring there. Practical options:

- Add a process-global semaphore for semantic scan/scoring, separate from model inference.
- Chunk the scan and yield with `setImmediate` between chunks as a short-term event-loop protection.
- Move decode/scoring into a worker thread or sidecar process.
- Longer term, use a vector index/ANN table or database-side vector extension so public requests fetch only candidate IDs.
- Keep `SEMANTIC_SCAN_LIMIT` low until one of those protections exists.

### PERF-28-02 - The public map still serializes and mounts up to 10,000 markers and list rows

Status: Confirmed
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/lib/data.ts:1649-1685` hard-caps `/map` at `MAP_MAX_MARKERS = 10000` and returns latitude/longitude rows in one query.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89` fetches all markers in the server component, maps them into props, and renders a full fallback `<ul>` entry for every marker.
- `apps/web/src/components/map/map-client.tsx:76-93` computes bounds with two full arrays and `Math.min(...lats)` / `Math.max(...lngs)`.
- `apps/web/src/components/map/map-client.tsx:119-140` renders one React Leaflet `<Marker>` and `<Popup>` per marker.

Problem:

The server-side cap prevents an unbounded DB result, but 10,000 is still too high for a single React/Leaflet render and a single RSC payload. React Leaflet markers are DOM-heavy, and the accessibility fallback list doubles the rendered item count. The bounds calculation also allocates latitude/longitude arrays and spreads them into function calls.

Concrete failure scenario:

An admin opts a travel/year topic into map visibility after importing several thousand GPS-tagged photos. A visitor opens `/map`. The server serializes thousands of marker props, the client hydrates Leaflet and creates thousands of marker/popup components, and the browser main thread freezes or becomes unresponsive on mid-range mobile hardware. The issue is visible even though the query is technically bounded.

Suggested fix:

Treat `/map` as a viewport/clustered surface instead of a full-export surface:

- Lower the initial cap to a UI-safe number and show a "zoom/filter to load more" state.
- Use marker clustering or a canvas/vector layer rather than one DOM marker per photo.
- Add a bbox/zoom API endpoint and load markers for the current viewport.
- Replace `Math.min(...lats)` / `Math.max(...lngs)` with a single loop to avoid large spread calls.
- Keep the fallback list paginated or limited consistently with marker rendering.

### PERF-28-03 - Rate-limit bucket GC deletes by an unindexed suffix and is unbounded

Status: Confirmed
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/db/schema.ts:212-219` defines `rate_limit_buckets` with primary key `(ip, bucket_type, bucket_start)` and no index beginning with `bucket_start`.
- `apps/web/src/lib/rate-limit.ts:515-517` purges old rows with `DELETE ... WHERE bucket_start < cutoff`.
- `apps/web/src/lib/image-queue.ts:1019-1047` runs `purgeOldBuckets()` at startup and hourly from the image queue GC timer.

Problem:

The purge predicate cannot use the primary key prefix efficiently because `bucket_start` is the third column. Under high IP cardinality, MySQL must scan the table to find expired buckets, then delete all matches in one statement. That can hold locks and consume DB CPU exactly on the shared live database used by public routes and admin actions.

Concrete failure scenario:

A rotating-IP bot hits public search/share/semantic endpoints for a day. The table grows with many `(ip, type, bucket_start)` rows. The hourly image-queue GC runs a full-scan delete while uploads and SSR queries are active, causing connection pool waits or request latency spikes. Because the purge is fire-and-forget, the app logs only a debug failure if it times out.

Suggested fix:

Add a migration with an index leading on `bucket_start`, for example `idx_rate_limit_buckets_bucket_start` on `(bucket_start, ip, bucket_type)`. Then make `purgeOldBuckets` chunked, similar to `view-retention.ts`, so each pass deletes a bounded batch and yields between batches.

### PERF-28-04 - Public keyword search uses leading-wildcard LIKE scans across multiple fields and joined tag/alias branches

Status: Confirmed
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/lib/sql-like.ts:9-10` implements `containsLike` as `%term%`.
- `apps/web/src/lib/data.ts:1545-1563` searches title, description, camera model, lens model, topic slug, and topic label with leading-wildcard LIKE and orders by gallery chronology.
- `apps/web/src/lib/data.ts:1601-1621` adds parallel tag and topic-alias JOIN branches, also using leading-wildcard LIKE and GROUP BY.
- `apps/web/src/app/actions/public.ts:235-317` exposes this as a public server action with a per-IP limit, but the query shape remains expensive.
- `apps/web/src/db/schema.ts:116-121` has chronology/topic indexes, but no full-text/search index for these LIKE predicates. `tags.name` / `tags.slug` uniqueness also does not help for leading-wildcard contains matching.

Problem:

Leading-wildcard LIKE predicates are not sargable on normal B-tree indexes. The route can execute one main scan plus two joined scans for a single user query. The two-character minimum is also low for languages/strings where common substrings match many rows.

Concrete failure scenario:

On a large gallery, a user types a query into the search modal. The client debounce prevents per-keystroke floods, but each accepted query can still force scans over `images`, joined `tags`, and joined `topic_aliases`. A few concurrent users or repeated common two-character searches drive DB CPU and filesort pressure.

Suggested fix:

Introduce a purpose-built search index:

- Use MySQL FULLTEXT where language/tokenization is acceptable, or a generated ngram/search table for Korean/partial matching.
- Raise the minimum keyword length or require explicit tag filters for two-character queries.
- Cache frequent public search results briefly.
- Keep tag/alias lookup prefix/exact where possible and reserve contains search for a secondary path.

### PERF-28-05 - Timeline, year, and On This Day queries apply non-sargable date functions to `capture_date`

Status: Likely
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/lib/data-timeline.ts:88-116` uses `MONTH(capture_date)` and `DAY(capture_date)` for On This Day.
- `apps/web/src/lib/data-timeline.ts:129-142` uses `YEAR(capture_date)` for the timeline year list.
- `apps/web/src/lib/data-timeline.ts:178-207` documents and implements `YEAR(capture_date)` and optional `MONTH(capture_date)` filters for timeline/year pages.
- `apps/web/src/db/schema.ts:116-118` has `(processed, capture_date, created_at)` and topic/capture-date indexes, but function-wrapped `capture_date` prevents range use beyond the `processed` prefix.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:62-84` calls `getTimelineYears()` and then `getTimelineImages()`.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:80-86` calls `getYearInReviewImages()`, which delegates to `getTimelineImages()`.

Problem:

The code already notes the sargability issue. On public dynamic pages (`revalidate = 0`), these functions require MySQL to evaluate date functions over the processed image slice before returning the capped page results.

Concrete failure scenario:

A gallery grows to tens of thousands of processed photos. `/timeline`, `/year/2025`, and the homepage On This Day widget are hit by visitors or crawlers. The result limit keeps the response payload bounded, but the DB still scans many processed rows to find matching dates and years, increasing latency on public navigation.

Suggested fix:

Use range predicates for year/month pages:

- Year: `capture_date >= 'YYYY-01-01' AND capture_date < 'YYYY+1-01-01'`.
- Month: use a range inside the selected year.
- On This Day: add generated `capture_month` and `capture_day` columns, indexed as `(processed, capture_month, capture_day, capture_date, created_at, id)`, or maintain a small calendar lookup table.

### PERF-28-06 - Feed and sitemap freshness queries order by `updated_at` without a supporting image index

Status: Likely
Severity: Low
Confidence: High

Evidence:

- `apps/web/src/lib/data.ts:828-853` feeds select processed images with tag aggregation and order by `updated_at DESC, created_at DESC, id DESC`.
- `apps/web/src/lib/data.ts:1635-1647` sitemap image IDs use the same `updated_at` ordering with a limit up to 50,000.
- `apps/web/src/db/schema.ts:116-121` defines processed/capture-date, processed/created-at, topic/capture-date, user filename, and uploaded-by indexes; there is no `(processed, updated_at, created_at, id)` index.
- `apps/web/src/app/feed.xml/route.ts:29-40` calls `getImagesForFeed(FEED_LIMIT)`.
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:50-64` calls `getImagesForFeed(FEED_LIMIT, topic)`.
- `apps/web/src/app/sitemap.ts:39-50` calls `getImageIdsForSitemap(imageBudget)` after topic/homepage lookups.

Problem:

Freshness ordering is correct for feeds and sitemap `lastmod`, but the schema does not support it directly. The feed has a small limit and conditional headers; sitemap has hourly ISR. Those mitigations reduce frequency, not per-run query cost.

Concrete failure scenario:

On a large gallery, crawlers and feed readers request `/feed.xml`, topic feeds, and `/sitemap.xml` around upload/edit periods. The DB must sort processed rows by `updated_at` despite returning only 50 feed rows or capped sitemap IDs. The sitemap path can request tens of thousands of IDs.

Suggested fix:

Add a composite index for freshness surfaces, for example `(processed, updated_at, created_at, id)`. For topic feeds, consider `(topic, processed, updated_at, created_at, id)` if topic feed traffic matters. If tag aggregation prevents index-friendly feed ordering, first fetch ordered IDs from the index, then join/aggregate tags for only those IDs.

### PERF-28-07 - First-page gallery loads compute an exact total count with `COUNT(*) OVER()` on the grouped listing query

Status: Likely
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/lib/data.ts:878-907` adds `COUNT(*) OVER()` to the public listing query, with `LEFT JOIN imageTags`, `LEFT JOIN tags`, `GROUP BY images.id`, chronological ordering, `LIMIT pageSize + 1`, and offset.
- `apps/web/src/app/[locale]/(public)/page.tsx:149-168` calls `getImagesLitePage(..., PAGE_SIZE, 0)` on the dynamic homepage.
- `apps/web/src/components/home-client.tsx:267-269` uses `totalCount` only for the visible meta count display.

Problem:

The first page fetch returns 30 visible images, but exact total count forces the database to evaluate the grouped result set enough to compute the window count. That makes a public dynamic page pay an all-matching-row cost for a display count that is not required for pagination, because `hasMore` can be derived from `LIMIT pageSize + 1`.

Concrete failure scenario:

The root gallery or a popular tag page receives regular traffic with thousands of images and tags. Each request recomputes the grouped total count even though the UI only needs the first page and a human-readable total. The count path becomes a hidden DB tax on the highest-traffic page.

Suggested fix:

Remove the exact count from the hot listing query. Options:

- Show the current loaded count plus "more" rather than exact total.
- Fetch exact counts from a separate cached/count table refreshed on image/tag mutations.
- Use a cheap approximate count for unfiltered pages and omit exact counts for filtered tag pages.
- Keep `LIMIT pageSize + 1` for `hasMore`.

### PERF-28-08 - Upload and bulk tag paths resolve tag records serially with multiple DB round trips per tag

Status: Likely
Severity: Low
Confidence: High

Evidence:

- `apps/web/src/app/actions/images.ts:301-329` loops over every unique upload tag and awaits `ensureTagRecord` serially before file processing.
- `apps/web/src/lib/tag-records.ts:66-68` implements `ensureTagRecord` as `insert ignore`, then `selectTagByNameOrSlug`.
- `apps/web/src/lib/tag-records.ts:29-45` performs up to two SELECTs for name/slug resolution.
- `apps/web/src/app/actions/images.ts:1131-1144` repeats serial tag resolution for bulk tag additions inside the bulk update transaction.

Problem:

Each tag can cost one INSERT IGNORE plus one or two SELECTs, and the upload action does this serially. In the browser upload path, this work happens after the upload quota/settings lock has been claimed and before the per-file save/insert/enqueue loop starts. The bulk edit path does similar serial work inside a transaction.

Concrete failure scenario:

An admin uploads a batch with many comma-separated tags, or bulk-adds several tags to many images. The request performs dozens of serialized DB round trips while holding the upload-processing contract lock or a bulk transaction. Other upload/settings operations wait longer than necessary, and the user sees slow admin responsiveness.

Suggested fix:

Batch tag resolution:

- Normalize all tag names/slugs first.
- Fetch existing tags with `WHERE name IN (...) OR slug IN (...)`.
- Insert missing non-conflicting tags in one `INSERT IGNORE ... VALUES (...)`.
- Re-select inserted/existing rows once.
- For bulk edit, do tag resolution outside the image update transaction where possible, then perform image/tag mutations in the transaction.

### PERF-28-09 - The service worker waits on a per-image HEAD probe before serving cached image derivatives

Status: Risk needing manual validation
Severity: Low
Confidence: Medium

Evidence:

- `apps/web/public/sw.template.js:31-38` sets a 300 ms timeout for the synchronous cached-image HEAD revalidation.
- `apps/web/public/sw.template.js:184-286` serves cached derivatives only after a HEAD probe when the cached response has an ETag; on failure/timeout it falls through to stale-serve.
- `apps/web/src/lib/serve-upload.ts:245-260` optimizes HEAD on the server side, but the browser still pays the request scheduling and round trip per cached tile.

Problem:

The freshness intent is documented and bounded, but this is still on the image display path. A cached masonry page with many derivatives can issue many concurrent HEAD requests and delay each cached image by up to 300 ms on weak networks before serving stale bytes.

Concrete failure scenario:

A returning mobile visitor opens a cached gallery over a slow or captive network. The service worker has cached images, but each tile waits for its HEAD probe timeout before appearing. The page feels blank/janky despite having a warm local image cache, and the network is flooded with low-value HEAD requests.

Suggested fix:

Validate with browser traces on a throttled network. If confirmed, change the default cached-image path to serve cached bytes immediately and revalidate in the background. Preserve color-setting freshness with a lighter invalidation mechanism, such as a service-worker version/settings hash broadcast or a route-level manifest fetched once per page, instead of one synchronous HEAD per image.

## Positive Controls Observed

These areas were reviewed and did not produce a new finding:

- Sharp/libvips concurrency and cache are explicitly bounded in `apps/web/src/lib/process-image.ts:36-57`.
- Original upload save streams to disk before metadata extraction in `apps/web/src/lib/process-image.ts:905-923`.
- Image derivatives are written atomically and restored/cleaned on failure in `apps/web/src/lib/process-image.ts:1182-1218` and `apps/web/src/lib/process-image.ts:1424-1474`.
- The image processing queue has bounded concurrency, retry maps, permanent-failure caps, claim retries, and shutdown/restore drains in `apps/web/src/lib/image-queue.ts`.
- Admin backfill computes a concurrency cap from the shared DB pool and reserved live connections in `apps/web/src/lib/admin-backfill-runner.ts`.
- View-count buffering has caps, chunking, and backoff in `apps/web/src/lib/data.ts:13-249`.
- View-retention cleanup is chunked and indexed in `apps/web/src/lib/view-retention.ts:64-90` and `apps/web/src/db/schema.ts:225-264`.
- Upload serving avoids importing Sharp and has a short TTL/inflight cache for color settings hash in `apps/web/src/lib/serve-upload.ts:1-82`.
- Public load-more paths use keyset/cursor pagination after the initial page in `apps/web/src/app/actions/public.ts:120-233` and `apps/web/src/components/load-more.tsx:23-161`.
- Histogram computation moves the pixel binning loop to `apps/web/public/histogram-worker.js`; the main component downsizes the canvas before transfer in `apps/web/src/components/histogram.tsx`.
- Deployment scripts include bounded health checks and post-deploy Docker cleanup in `apps/web/deploy.sh`; remote deployment sources credentials from env config in `scripts/deploy-remote.sh`.

## Final Missed-Issues Sweep

Final sweep covered the entire tracked repository inventory, then line-reviewed every performance-relevant code path identified by file type, routing, imports, and hot-pattern grep:

- Image processing, Sharp, EXIF/GPS/color detection, topic image processing, CLIP image/text embedding, queues, backfills, restore maintenance, upload/delete cleanup, and static image serving.
- DB schema/indexes, MySQL pool behavior, Drizzle query helpers, public listing/search/timeline/map/feed/sitemap queries, analytics/view buffers, rate-limit tables and purges, smart collection SQL generation, and cache wrappers.
- Server routes/actions, including public search/load-more/view records, admin mutations, browser upload, Lightroom upload, OG generation, feed/sitemap, health/live, upload file serving, and route/page consumers.
- Client UI responsiveness paths, including masonry rendering/infinite scroll, map rendering, search modal/semantic results, service worker caching, histogram worker, lightbox/photo viewer/zoom/navigation, modal isolation, and admin bulk/image managers.
- Deployment and operational scripts, including Dockerfile, compose, nginx, deploy scripts, migration scripts, restore recovery, backfill scripts, and service worker build.

No review-relevant source/config/script file was intentionally skipped. Binary fixtures, generated uploads, screenshots, fonts, and icons were inventoried but excluded from line review unless they had executable/runtime behavior. No tests were run because this was a static review artifact request; evidence is source inspection and exact file/line citations above.
