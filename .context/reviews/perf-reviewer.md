# Review-Plan-Fix Cycle 15 Performance / Concurrency Review

Role: perf-reviewer
Date: 2026-07-07
Repository: `/Users/hletrd/flash-shared/gallery`
Output file: `.context/reviews/perf-reviewer.md`

## Scope And Method

Required local instructions read before reviewing:

- `AGENTS.md`
- `CLAUDE.md`, focused on architecture, runtime topology, image queue/backfill, Color/HDR pipeline, cache/ETag behavior, race-condition protections, testing gates, deploy helper, and disk hygiene
- `.context/reviews/prompts/common_review_scope.md`
- `.context/reviews/prompts/perf-reviewer.md`

Mutation boundary: this review modifies only this file. No commits, pushes, deploys, destructive actions, or edits outside the assigned review artifact were performed.

Inventory was built first from tracked repository files, then narrowed by performance/concurrency relevance. The review covered the source inventory by repo-wide marker scans plus direct reads of every file selected into the specialty surface. Tests and docs were used only as context; behavior was validated from source code.

## Inventory

Tracked source/config inventory used for this review:

- App routes, pages, server actions, API routes: `apps/web/src/app/**` (81 executable files)
- Client/server UI components: `apps/web/src/components/**` (61 executable files)
- Data, queues, image processing, auth, cache, analytics, rate limiting, gallery config, semantic search, upload, and utility libraries: `apps/web/src/lib/**` (114 executable files)
- Database schema and pool setup: `apps/web/src/db/**` (3 executable files)
- Operational scripts and backfills: `apps/web/scripts/**` (28 executable files)
- Migrations and migration journal: `apps/web/drizzle/**` (33 files)
- Runtime/config/deploy/cache surfaces: `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, root and workspace `package*.json`, `apps/web/instrumentation.ts`, `apps/web/proxy.ts`
- Tests: `apps/web/src/__tests__/**`, `apps/web/e2e/**`, and script tests were inventoried for coverage context, not treated as proof of runtime behavior

Primary source files directly examined for hot paths and cross-file behavior:

- Rendering/data paths: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `map/page.tsx`, `timeline/page.tsx`, photo/group/feed/sitemap/OG routes, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/gallery-config.ts`
- Browser responsiveness: `apps/web/src/components/home-client.tsx`, `photo-lightbox.tsx`, `masonry-grid.tsx`, `grid-picture*.tsx`, `components/map/*`, timeline/search/smart-collection client components, service worker files
- Image processing and upload: `apps/web/src/lib/process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, `image-paths.ts`, `image-url.ts`, `serve-upload.ts`, `upload-limits.ts`, `app/actions/images.ts`, `app/api/admin/lr/upload/route.ts`, `scripts/backfill-color-pipeline.ts`
- DB/query/analytics/search: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `lib/analytics-data.ts`, `lib/smart-collections.ts`, `app/actions/public.ts`, `app/api/search/semantic/route.ts`, `app/api/search/similar/[id]/route.ts`, `lib/clip-embeddings.ts`, `lib/clip-model.ts`
- Runtime guards and deployment: migration script, deploy scripts, nginx config, Docker config, Next config, cache headers, queue bootstrap and shutdown paths

Explicit exclusions: `node_modules`, `.next`, build outputs, local env/secrets, binary/static assets without runtime code, generated screenshots, and unrelated untracked review scratch directories. No relevant file in the performance/concurrency specialty inventory was intentionally skipped.

## Summary

Findings:

- Confirmed Issues: 6
- Likely Issues: 3
- Risks Requiring Manual Validation: 3

The highest-risk theme is shared-resource budgeting. The app has made substantial progress in bounding individual queues and avoiding obvious Sharp/DB runaway behavior, but the budgets are independent: queue, in-app backfill, sidecar backfill, analytics, and semantic scans can still combine into pool, CPU, disk, or Node main-process pressure.

## Confirmed Issues

### PERF-C15-01: Image queue and in-app color backfill reserve DB headroom independently, so running both can still starve live requests

Confidence: High
Severity: High

Code regions:

- `apps/web/src/db/index.ts:31-41` fixes the shared MySQL pool at `connectionLimit: 10` and `queueLimit: 20`.
- `apps/web/src/lib/image-queue.ts:121-141` reserves roughly half the pool for live traffic and clamps queue concurrency, but only for the image queue itself.
- `apps/web/src/lib/image-queue.ts:641-672` holds a per-image advisory-lock connection.
- `apps/web/src/lib/image-queue.ts:719-875` processes an image while holding that claim and also performs transient DB reads/updates.
- `apps/web/src/lib/admin-backfill-runner.ts:106-142` performs separate pool-budget arithmetic for backfill.
- `apps/web/src/lib/admin-backfill-runner.ts:324-379` holds a whole-run advisory lock and per-image advisory-lock connections.
- `apps/web/src/lib/admin-backfill-runner.ts:716-727` starts a separate `PQueue` with its own effective concurrency.

Why this is a problem:

The queue and in-app backfill each protect the pool only when considered in isolation. There is no shared in-process budget or DB-backed semaphore that accounts for the other subsystem. At the default pool size, the queue can run at effective concurrency 2 and the in-app backfill can also run at effective concurrency 2. Each worker can hold an advisory-lock connection while needing transient DB work; the backfill also pins a whole-run lock connection. That can consume most of the 10-connection pool before normal page renders, metadata fetches, analytics writes, or admin actions enter the pool queue.

Concrete failure scenario:

An admin uploads new images while also starting an in-app color-pipeline backfill. Two queue workers and two backfill workers run Sharp encodes and hold per-image locks. The backfill global lock remains pinned. Public photo pages and home/topic SSR then enter `getImage`/listing fan-out while only a few pool slots remain. Concurrent requests can hit mysql2's pool queue, and bursts can reach `queueLimit: 20`, producing request failures or long tail latency even though each background subsystem individually obeyed its own cap.

Suggested fix:

Introduce one shared background-work budget for DB-pinning image work inside the web process. The budget should cover queue workers, in-app backfill workers, and any other long-running image/DB maintenance task. A simple local semaphore is enough for single-process deployment; if multi-process deployments become supported, move the budget to a DB-backed lease table or advisory-lock token scheme. At minimum, pause or reduce `QUEUE_CONCURRENCY` while in-app backfill is active.

### PERF-C15-02: The sidecar color backfill bypasses the web pool budget and can compete with production traffic for DB, CPU, and disk

Confidence: High
Severity: High

Code regions:

- `apps/web/scripts/backfill-color-pipeline.ts:378-387` builds the candidate predicate and starts a sidecar `PQueue` using `BACKFILL_CONCURRENCY`, capped at 8.
- `apps/web/scripts/backfill-color-pipeline.ts:409-417` fetches candidate pages from `images`.
- `apps/web/scripts/backfill-color-pipeline.ts:453-516` performs batched DB updates and cleanup after re-encoding.
- `apps/web/scripts/backfill-color-pipeline.ts:523-570` queues concurrent `reprocessRow` tasks and flushes batches.
- `apps/web/src/db/index.ts:31-41` shows the normal imported DB helper creates a 10-connection pool.
- `apps/web/src/lib/process-image.ts:1109-1145` and `apps/web/src/lib/process-image.ts:1227-1440` show each reprocess can run metadata reads, optional wide-gamut downscale, and parallel WebP/AVIF/JPEG generation.

Why this is a problem:

The web app's in-process queue/backfill code clamps itself against the web pool, but the sidecar script imports the same DB module in a separate Node process and therefore owns a separate mysql2 pool. `BACKFILL_CONCURRENCY` can be set up to 8, and each worker runs the same Sharp-heavy derivative pipeline. This can exceed the production host's real DB, CPU, and disk budgets even if the web process appears correctly configured.

Concrete failure scenario:

An operator runs `BACKFILL_CONCURRENCY=8` on the production host during traffic. The sidecar opens its own DB pool, scans stale image rows, runs up to 8 re-encodes, and writes derivatives while the web process continues serving uploads, image queue jobs, public pages, and route handlers. MySQL sees more connections than the web pool arithmetic assumed, libvips/CPU saturates, and derivative directories receive heavy write/delete traffic, causing slow SSR and upload processing or pool wait failures.

Suggested fix:

Make the sidecar participate in the same global maintenance budget. Options: a DB-backed semaphore, a required maintenance-mode lock that pauses live queues, or a hard default/max of 1 unless an explicit `--maintenance-window` flag is present. Also log the effective DB pool and host CPU budget at script startup and refuse high concurrency when the web queue/backfill lock is active.

### PERF-C15-03: Public map rendering still materializes and hydrates up to 10,000 broad marker rows plus a duplicate accessible list

Confidence: High
Severity: High

Code regions:

- `apps/web/src/lib/data.ts:1766-1802` sets `MAP_MAX_MARKERS = 10000` and selects `publicMapSelectFields` for every map-visible GPS image.
- `apps/web/src/lib/data.ts:409-444` defines the public map select from a broad public image field set rather than a minimal marker projection.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66` fetches all map rows on every dynamic render and maps them into client marker props.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:89-110` passes all markers to the client map and also renders a full `<ul>` entry for every marker.
- `apps/web/src/components/map/map-client.tsx:77-94` allocates latitude and longitude arrays and spreads them into `Math.min/Math.max`.
- `apps/web/src/components/map/map-client.tsx:120-139` renders one React Leaflet `Marker` per marker.

Why this is a problem:

The route is bounded, but the bound is high for a browser and for RSC/HTML payload size. A GPS-heavy gallery can serialize thousands of marker objects, hydrate thousands of Leaflet markers, and render thousands of duplicate list links. The bounds calculation also makes extra arrays and uses spread calls over the whole marker set. This is a browser responsiveness problem even when the DB query succeeds.

Concrete failure scenario:

A photographer imports a travel archive with 8,000 GPS-bearing images and enables map visibility. Opening `/map` on a mid-range phone downloads a large server-rendered payload, hydrates thousands of markers, builds thousands of list items, runs fit-bounds over full arrays, and stalls the main thread. The user sees delayed input, slow scrolling, or tab termination despite the query being capped.

Suggested fix:

Use a lean SQL projection for map rows: `id`, coordinates, title/display title inputs, `filename_jpeg`, topic, and topic label only. Lower the first-paint cap substantially and switch to viewport/bounds-based fetching or marker clustering. Virtualize or paginate the accessible list. Compute bounds in a single pass without spread arrays.

### PERF-C15-04: The home page runs a non-sargable On This Day query on every dynamic render

Confidence: High
Severity: Medium

Code regions:

- `apps/web/src/app/[locale]/(public)/page.tsx:155-177` renders the dynamic public home page and loads the first image page.
- `apps/web/src/app/[locale]/(public)/page.tsx:232-234` always includes `OnThisDayWidget`.
- `apps/web/src/components/on-this-day-widget.tsx:15-22` runs `getOnThisDayImages(month, day)` during the home SSR pass.
- `apps/web/src/lib/data-timeline.ts:102-130` filters with `MONTH(images.capture_date)` and `DAY(images.capture_date)`, then joins tags, groups, orders, and limits.
- `apps/web/src/db/schema.ts:123-130` has no generated month/day column or index; the relevant date index is on `(processed, capture_date, created_at)`.

Why this is a problem:

Wrapping `capture_date` in `MONTH()` and `DAY()` prevents use of the `capture_date` key parts for selective lookup. Because the home page is uncached/dynamic, every home request pays this scan/group/order cost even though the result changes only once per local day.

Concrete failure scenario:

With a large archive, repeated home page requests from crawlers or visitors each scan the processed dated image set to find today's month/day, then join and group tags for at most six displayed photos. The homepage latency increases and competes with the main listing query for DB connections.

Suggested fix:

Add generated columns such as `capture_month` and `capture_day` or a single `capture_month_day`, indexed with `processed`. Alternatively maintain a small daily summary/cache keyed by month/day. Keep the tag aggregation as a second phase over the six selected image IDs.

### PERF-C15-05: Color-pipeline backfill candidate scans lack an index for `pipeline_version`

Confidence: High
Severity: Medium

Code regions:

- `apps/web/src/db/schema.ts:82-83` defines `pipeline_version`.
- `apps/web/src/db/schema.ts:123-130` defines image indexes but none include `pipeline_version`.
- `apps/web/src/lib/admin-backfill-runner.ts:393-431` counts and pages candidates with `processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < CURRENT)`.
- `apps/web/scripts/backfill-color-pipeline.ts:378-417` uses the same stale-pipeline predicate in the sidecar.

Why this is a problem:

Backfill candidate discovery must repeatedly find the small stale subset among all processed images, but the schema has no index that starts with `processed` and includes `pipeline_version`. Once most rows are current, the query still has to inspect broad processed ranges to prove they are not candidates. The `OR` on `pipeline_version IS NULL OR pipeline_version < ...` can further reduce index efficiency unless supported by an appropriate composite index or split queries.

Concrete failure scenario:

After a pipeline bump, the first run processes the stale rows. Later admin checks or resumptions still execute the count and page queries against a gallery where almost every row is already current. On a large archive, those "nothing to do" checks remain expensive and can coincide with public traffic.

Suggested fix:

Add and validate an index such as `(processed, pipeline_version, id)` or split the NULL and `< current` cases into index-friendly branches. Capture `EXPLAIN ANALYZE` for fresh, mostly-current, and force-reencode cases before committing the migration.

### PERF-C15-06: Batch deletion performs repeated full derivative-directory scans per image

Confidence: High
Severity: Medium

Code regions:

- `apps/web/src/app/actions/images.ts:860-884` processes batch image cleanup in chunks and calls `deleteImageVariantsStrict(..., [])` for WebP, AVIF, and JPEG for each image.
- `apps/web/src/lib/process-image.ts:575-629` makes `sizes=[]` scan the whole target directory to catch historical variants.
- `apps/web/src/lib/process-image.ts:644-663` exposes tolerant and strict deletion helpers that perform that scan before unlinking.

Why this is a problem:

The delete path intentionally scans when sizes are unknown, but batch delete repeats the scan per image per derivative format. A 100-image delete can trigger up to 300 full directory scans before unlinking variants. The code bounds concurrency, but the asymptotic cost remains `images * formats * directory_size`, which is expensive on NAS-backed storage or large derivative directories.

Concrete failure scenario:

An admin deletes 100 imported mistakes from a gallery with tens of thousands of derivatives. The server performs hundreds of `opendir` iterations over the same three derivative directories, causing slow admin response and I/O pressure that can delay image serving or queue writes.

Suggested fix:

Add a batch cleanup helper that scans each derivative directory once per batch, groups filenames by base prefix, and deletes all matching variants. Keep strict error aggregation, but make the directory scan cost `formats * directory_size + files_to_delete` instead of `images * formats * directory_size`.

## Likely Issues

### PERF-C15-07: Public listing and smart-collection pages still aggregate tags before applying the page limit

Confidence: Medium
Severity: Medium

Code regions:

- `apps/web/src/lib/data.ts:802-829` builds `getImagesLite` with `LEFT JOIN imageTags/tags`, `GROUP BY images.id`, sort, then limit/offset.
- `apps/web/src/lib/data.ts:893-940` uses the same grouped page query in `getImagesLitePage`.
- `apps/web/src/lib/data.ts:1488-1550` uses the same grouped shape for smart collections.
- `apps/web/src/app/[locale]/(public)/page.tsx:175-177` and `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:189-191` call this on dynamic public pages.

Why this is likely a problem:

The exact-count optimization removed a worse window-function shape, but the page query still joins and groups tags before `LIMIT` can return 30 images. For broad home/topic pages or smart collections with many matches, MySQL may need to group/sort many image-tag rows to produce a small page.

Concrete failure scenario:

A large gallery has many tags per image. The homepage requests the first 30 photos, but MySQL reads and groups a broad joined rowset to compute `GROUP_CONCAT(tag.name)` for candidate images before returning the page. Under traffic, this burns DB CPU and memory compared with fetching page IDs first.

Suggested fix:

Use a two-phase query: first select the page of image IDs from `images` with the desired predicates and order using the existing image indexes, then fetch public fields and tag aggregates only for those IDs. Apply the same pattern to smart collections and feed/listing surfaces where tag names are needed.

### PERF-C15-08: Admin analytics fires five aggregation queries concurrently against the shared DB pool

Confidence: Medium
Severity: Medium

Code regions:

- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-36` executes five analytics helpers in one `Promise.all`.
- `apps/web/src/lib/analytics-data.ts:28-46` groups top photo views.
- `apps/web/src/lib/analytics-data.ts:62-79` groups top topic views.
- `apps/web/src/lib/analytics-data.ts:93-127` documents and runs country grouping.
- `apps/web/src/lib/analytics-data.ts:161-180` groups shared-group views.
- `apps/web/src/lib/analytics-data.ts:188-207` groups referrer views.

Why this is likely a problem:

The admin page is dynamic and the five helpers are aggregation-heavy. Running them concurrently lowers single-user latency when the database is idle, but it can claim half the shared pool at once and force MySQL to run multiple group/order workloads simultaneously. The code comments already acknowledge heavier all-window aggregation for country/referrer views.

Concrete failure scenario:

An admin opens analytics with `window=all` while image queue or backfill work is active. Five aggregation queries enter the pool together, competing with public SSR and queue updates. MySQL creates temporary aggregation work for multiple tables while the Node pool has fewer slots for normal requests.

Suggested fix:

Limit analytics query concurrency to 1-2, or precompute daily rollups for photo/topic/country/referrer/share views. Cache the admin analytics result briefly per window, since analytics does not need request-by-request freshness.

### PERF-C15-09: Timeline year discovery uses `YEAR(capture_date)` on every dynamic timeline render

Confidence: Medium
Severity: Low

Code regions:

- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19` makes the route dynamic.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-81` always includes `getTimelineYears()` in the SSR fan-out.
- `apps/web/src/lib/data-timeline.ts:143-159` selects distinct `YEAR(images.capture_date)` and orders by `YEAR(images.capture_date)`.
- `apps/web/src/db/schema.ts:123-130` has no generated year column or `(processed, capture_year)` index.

Why this is likely a problem:

The year list changes rarely, but the query computes a function over `capture_date` for all processed dated rows on every timeline page render. The year-filtered image query below it is sargable; the year-list query is not.

Concrete failure scenario:

On a large archive, every timeline page request scans all processed dated rows to rebuild the year scrubber, even when only one selected year's photos are shown. This adds a fixed DB cost to a route that should otherwise be range-index friendly.

Suggested fix:

Use a generated `capture_year` column with `(processed, capture_year)` index, or maintain a compact year summary table updated on image create/update/delete. Cache the year list briefly if immediate freshness is not required.

## Risks Requiring Manual Validation

### PERF-C15-10: Public text search and smart-collection `contains` predicates are bounded but remain scan-oriented

Confidence: Medium
Severity: Medium

Code regions:

- `apps/web/src/app/actions/public.ts:247-329` exposes public search with length checks and rate limiting before `searchImages`.
- `apps/web/src/lib/data.ts:1574-1750` performs `%LIKE%`-style matching across title, description, camera, lens, topic, topic label, tag name, and aliases, with tag/alias fallback queries.
- `apps/web/src/lib/smart-collections.ts:221-223` compiles field `contains` to `containsLike`.
- `apps/web/src/lib/smart-collections.ts:250-267` compiles tag `contains` through a tag subquery using `containsLike`.
- `apps/web/src/lib/data.ts:1488-1550` runs smart-collection pages through grouped listing queries.

Why this needs validation:

The request rate and result limits are bounded, but `%term%` predicates generally cannot use normal btree indexes. Smart collections are admin-defined, so a broad `contains` rule can turn a public collection page into a repeated scan surface. The real impact depends on data size, tag cardinality, search frequency, and MySQL execution plans.

Concrete failure scenario:

An admin creates a smart collection using `description contains "a"` or users repeatedly search short common terms. Each allowed request scans large text/tag ranges, joins/group-tags for results, and competes with normal browsing.

Suggested fix:

Collect `EXPLAIN ANALYZE` for common and worst-case search/smart-collection predicates. Consider MySQL full-text indexes, an external search index, stricter minimum lengths for public search, and validation warnings or disallow rules for very broad smart-collection `contains` predicates.

### PERF-C15-11: Semantic search brute-forces embedding blobs inside the web process

Confidence: Medium
Severity: Medium

Code regions:

- `apps/web/src/lib/clip-embeddings.ts:36-48` permits `SEMANTIC_SCAN_LIMIT` up to 25,000, with default 2,000.
- `apps/web/src/lib/clip-embeddings.ts:188-205` decodes embedding blobs into `Float32Array`s.
- `apps/web/src/app/api/search/semantic/route.ts:263-311` scans the most recent embeddings and scores every decoded row in-process.
- `apps/web/src/app/api/search/similar/[id]/route.ts:177-214` performs the same scan/score pattern for similar photos.
- `apps/web/src/lib/clip-model.ts:53-64` bounds CLIP inference concurrency and pending count, but this queue does not cover vector scan/scoring work.

Why this needs validation:

The feature is capped and rate-limited, and the default scan limit is conservative. Still, raising the scan limit to the hard max means one public request can read about 25,000 2 KiB vectors before row overhead, decode them, and perform 512-dimension dot products in the Node process. That work is not offloaded to a vector index, worker thread, or shared matrix cache.

Concrete failure scenario:

Semantic search is enabled in production and an operator raises `SEMANTIC_SCAN_LIMIT` for recall. A few concurrent public semantic/similar requests cause large BLOB reads, heap retention during scoring, and CPU work on the web process, delaying ordinary SSR and route handlers.

Suggested fix:

Keep the default cap until production profiling says otherwise. Validate RSS, event-loop delay, and DB read time at 2k, 10k, and 25k scans. For larger galleries, use a vector index/store or a preloaded matrix scored off the main event loop, and make the public limiter durable across processes if scale-out is introduced.

### PERF-C15-12: Large multipart uploads are constrained but still parsed through framework `FormData`

Confidence: Medium
Severity: Medium

Code regions:

- `apps/web/src/lib/upload-limits.ts:1-6` permits individual uploads up to 200 MiB and server-action bodies up to the largest upload/restore body plus multipart overhead.
- `apps/web/next.config.ts:111-119` configures Next server action and proxy client body limits from that value.
- `apps/web/src/app/actions/images.ts:129-149` receives browser uploads as `FormData` and extracts `File` objects.
- `apps/web/src/app/api/admin/lr/upload/route.ts:60-74` limits Lightroom multipart parsing to one in-flight request per process.
- `apps/web/src/app/api/admin/lr/upload/route.ts:101-128` rejects missing/chunked/oversized `Content-Length`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:178-200` calls `request.formData()` and only then checks the parsed `File` size.

Why this needs validation:

The route and action have important bounds, but both rely on framework-level multipart materialization before the app can stream to disk. The Lightroom path serializes parsing to one request, which helps, but one 200 MiB upload can still create a large transient memory spike before image metadata extraction and queueing. The browser server-action path has the same class of framework parsing risk.

Concrete failure scenario:

On a memory-constrained production host, an admin uploads a near-limit RAW/JPEG through Lightroom or the browser while the image queue is encoding prior uploads. The request body is parsed into a `File`, then saved and processed, causing RSS pressure or GC pauses before the queue even starts derivative generation.

Suggested fix:

Profile RSS and event-loop delay for near-limit uploads in production-like Docker memory limits. If the spike is material, replace `request.formData()` for large upload paths with a streaming multipart parser that writes the file directly to a temp path after auth, origin, content-length, and quota checks. Keep the existing single-parse-slot guard as defense in depth.

## Positive Findings / Non-Issues Verified

- `apps/web/src/lib/process-image.ts:36-57` constrains global Sharp/libvips concurrency and disables Sharp cache, reducing CPU thread fan-out and steady RSS.
- `apps/web/src/lib/process-image.ts:1187-1225` writes derivative outputs through temp paths and backup/restore helpers, reducing partial-file races during re-encode.
- `apps/web/src/lib/process-image.ts:1433-1456` waits for all WebP/AVIF/JPEG encoders to settle and verifies non-empty outputs before reporting success.
- `apps/web/src/lib/image-queue.ts:871-895`, `apps/web/src/lib/admin-backfill-runner.ts`, and `apps/web/scripts/backfill-color-pipeline.ts:493-516` all handle delete-during-processing/backfill cleanup instead of blindly marking stale rows.
- Public semantic and text search surfaces have request size, length, and rate-limit controls before expensive work; the remaining concern is per-allowed-request cost, not total absence of guarding.
- Cache headers for `/uploads/{jpeg,webp,avif}` are deliberately not immutable because backfill rewrites derivatives in place; this is a correctness/performance tradeoff rather than a missed long-cache bug.

## Final Sweep

Commonly missed areas checked:

- Rendering hot paths: home, topic, photo, map, timeline, smart collections, feed/sitemap/OG metadata.
- Image processing: upload save, queue bootstrap, queue claims, Sharp pipeline, derivative writes, deletion cleanup, in-app backfill, sidecar backfill.
- DB access: pool limits, indexes, listing/grouping queries, timeline queries, map query, analytics aggregations, search, semantic scan, migrations/journal shape.
- Concurrency/races: advisory locks, queue/backfill overlap, delete-during-processing paths, in-memory rate limits, server-action upload quota claims, restore maintenance fences.
- Browser responsiveness: map hydration/list rendering, masonry/lightbox/image components, service worker image caching, client search/timeline components.
- Runtime/deploy: Next cache headers/body limits, Docker/nginx upload/cache behavior, deploy/disk-hygiene constraints.

No relevant file in the performance/concurrency specialty inventory was intentionally skipped. Remaining uncertainty is limited to items explicitly labeled as requiring manual validation, primarily where `EXPLAIN ANALYZE`, production RSS/event-loop profiling, or realistic dataset size is needed to determine severity.

Validation performed for this artifact: static source review with exact code-region citations. No lint/typecheck/test/build/deploy commands were run because this task was a review-only markdown deliverable and the user restricted modifications to this file.
