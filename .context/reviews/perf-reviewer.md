# Performance Review — perf-reviewer — Cycle 1

Repo: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-04-29  
Scope: full repository performance/concurrency/CPU/memory/UI responsiveness/DB and query efficiency/image pipeline throughput/caching/race hazards.  
Write scope honored: this report only.

## Inventory first

Tracked runtime app is concentrated under `apps/web`:

- Next.js routes/actions/config: `apps/web/src/app/**`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`.
- DB/query layer: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/data.ts`, rate-limit/audit/session helpers.
- Image pipeline: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, upload path/storage helpers, upload serving route.
- Public UI hot paths: `home-client.tsx`, `load-more.tsx`, `search.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `histogram.tsx`.
- Admin hot paths: dashboard, image manager, upload dropzone, backup/restore actions.
- Review/planning artifacts dominate `.context/**` and `plan/**`; generated/dependency artifacts (`node_modules`, `.next`) were not treated as source.

## Findings

### HIGH — Public first-page listing forces a full grouped count on every dynamic page render

- Evidence:
  - Public home/topic pages are explicitly dynamic: `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`.
  - Both initial pages call `getImagesLitePage(..., PAGE_SIZE, 0)`: `apps/web/src/app/[locale]/(public)/page.tsx:138-140`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:164-166`.
  - `getImagesLitePage` joins tags, groups every image, computes `COUNT(*) OVER()`, orders, then applies `LIMIT/OFFSET`: `apps/web/src/lib/data.ts:547-562`.
- Confidence: High.
- Failure scenario: with 30K-50K processed photos and tags, every cache-miss/public request needs a grouped join + window count across all matching rows just to render 30 images and a total. This can inflate TTFB, create temp tables/filesort pressure, and compete with upload/search DB traffic.
- Suggested fix: split the first page into (1) an index-friendly page-ID query and (2) a batched tag-name aggregation for only those IDs. Make total count optional, cached, approximate, or separately maintained per topic/tag; avoid `COUNT(*) OVER()` on the listing query. If exact totals are required, compute them via a lighter count query and cache/invalidate on upload/delete/tag mutations.

### MEDIUM — Tag count/list data is recomputed per dynamic page request with only per-request React cache

- Evidence:
  - `_getTags` scans `tags -> image_tags -> images`, filters processed rows, groups, and orders by count/name: `apps/web/src/lib/data.ts:272-289`.
  - Public home fetches all tags during render: `apps/web/src/app/[locale]/(public)/page.tsx:125-130`; topic pages similarly import/use tag data.
  - The cache wrapper is React `cache()`, which dedupes within a single render/request, not across requests: `apps/web/src/lib/data.ts:1031-1035`.
- Confidence: High.
- Failure scenario: the home page performs the expensive listing query above plus a full tag aggregation on every request. Crawlers or homepage traffic can repeatedly recompute mostly-static tag counts while uploads/deletes are comparatively rare.
- Suggested fix: persistently cache tag/topic aggregates with Next data cache tags or a small materialized table, and invalidate from upload/delete/tag mutation paths. Consider storing tag counts denormalized if counts are required on all public pages.

### MEDIUM — Public search uses leading-wildcard LIKE scans across images, tags, and aliases

- Evidence:
  - Search term is constructed as `%${escaped}%`: `apps/web/src/lib/data.ts:915-916`.
  - Main search scans multiple image/topic columns with `LIKE`: `apps/web/src/lib/data.ts:927-941`.
  - If the limit is not filled, tag and alias searches run additional grouped joins with the same leading wildcard: `apps/web/src/lib/data.ts:959-1004`.
  - Public action calls this path after rate limiting: `apps/web/src/app/actions/public.ts:160-164`.
- Confidence: High.
- Failure scenario: a legitimate user typing several distinct queries, or multiple users behind one IP, can trigger repeated table scans. The in-memory/DB rate limit controls abuse, but it does not make each accepted search index-efficient.
- Suggested fix: add a dedicated search index strategy: MySQL `FULLTEXT` for title/description/camera/topic/label plus separate tag alias indexing, or an external/local search index. For substring search, consider trigram/ngram tokenization rather than `%term%` predicates. Keep the current rate limit as defense-in-depth.

### MEDIUM — One upload holds a global MySQL advisory lock through slow file, EXIF, blur, DB, and tag work

- Evidence:
  - `uploadImages` acquires the upload-processing contract lock before reading config/disk checks: `apps/web/src/app/actions/images.ts:171-179`.
  - The lock remains held while each file is streamed and Sharp reads metadata/creates blur data: `apps/web/src/app/actions/images.ts:251-263`, `apps/web/src/lib/process-image.ts:251-315`.
  - It is also held while DB inserts/tags/enqueue run, and is released only in the final `finally`: `apps/web/src/app/actions/images.ts:316-388`, `apps/web/src/app/actions/images.ts:429-430`.
  - The client intentionally sends selected files sequentially because the server has this single lock: `apps/web/src/components/upload-dropzone.tsx:239-246`.
- Confidence: Medium-high.
- Failure scenario: one admin uploads many large files; the action holds an advisory lock and a DB connection for the whole upload loop. Other uploads/settings changes wait up to 5 seconds and fail with “settings locked,” and DB pool capacity is reduced while CPU/disk work proceeds outside the DB.
- Suggested fix: narrow the lock to the actual settings/contract snapshot, or replace it with a versioned/read-write contract: set the upload tracker claim before async file work, read config under a short lock, then release before streaming/Sharp/tag processing. Settings changes can check active claims/version instead of blocking all upload work on one session lock.

### MEDIUM — Single image-processing job runs three Sharp format pipelines in parallel, multiplying CPU and memory pressure

- Evidence:
  - Sharp global concurrency is set near CPU count: `apps/web/src/lib/process-image.ts:17-26`.
  - Queue default is one job per web process, acknowledging each job is already heavy: `apps/web/src/lib/image-queue.ts:127-132`.
  - Each job clones the input image and generates all sizes per format, then runs WebP, AVIF, and JPEG format generators concurrently: `apps/web/src/lib/process-image.ts:408-478`.
- Confidence: Medium-high.
- Failure scenario: a 200 MB/high-megapixel upload causes three concurrent decode/resize/encode pipelines, with AVIF especially CPU-heavy. On a small container this can starve Next request handling or exceed memory even though queue concurrency is 1.
- Suggested fix: make per-format concurrency configurable and default to 1 or 2; process AVIF separately/last; add memory/CPU telemetry around queue jobs; consider generating the grid-critical JPEG/WebP first and AVIF asynchronously if throughput matters.

### MEDIUM — Bulk delete can perform hundreds of full upload-directory scans

- Evidence:
  - Batch delete allows up to 100 IDs: `apps/web/src/app/actions/images.ts:539-541`.
  - For each image, it calls `deleteImageVariants(..., [])` for WebP/AVIF/JPEG: `apps/web/src/app/actions/images.ts:612-626`.
  - Passing empty sizes triggers a full directory scan inside `deleteImageVariants`: `apps/web/src/lib/process-image.ts:181-203`.
- Confidence: High.
- Failure scenario: deleting 100 images with 50K files per derivative directory performs up to 300 directory scans. Admin UI remains waiting while Node does repeated filesystem enumeration, and slow disks can make the action time out.
- Suggested fix: for batch delete, scan each derivative directory once, match all selected base prefixes in memory, and unlink matches. Alternatively persist historical generated size variants per image, or enqueue cleanup to a bounded background worker and return after DB deletion.

### MEDIUM — CSV export materializes up to 50K rows plus the full CSV in memory

- Evidence:
  - The action notes the current memory profile and future streaming route need: `apps/web/src/app/[locale]/admin/db-actions.ts:54-59`.
  - It queries up to 50K grouped rows: `apps/web/src/app/[locale]/admin/db-actions.ts:77-92`.
  - It builds `csvLines`, releases the DB array reference, then joins into one full string: `apps/web/src/app/[locale]/admin/db-actions.ts:96-118`.
- Confidence: High.
- Failure scenario: at the row cap, heap holds large grouped result objects, many CSV line strings, and the final CSV string during a server action response. This can cause GC pauses or OOM on small containers and blocks the event loop during string construction.
- Suggested fix: move CSV export to an authenticated route that streams rows/chunks (`ReadableStream`), or use a DB cursor/mysql streaming query. Write rows directly to the response and avoid holding all lines/string in memory.

### LOW — Node upload-serving fallback does multiple filesystem resolution syscalls per image request

- Evidence:
  - Upload routes delegate to `serveUploadFile`: `apps/web/src/app/uploads/[...path]/route.ts:4-9`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:4-9`.
  - Each request resolves root, lstat's the file, then realpath's the file before streaming: `apps/web/src/lib/serve-upload.ts:69-95`.
  - Production nginx is configured to serve uploads directly and bypass Node: `apps/web/nginx/default.conf:96-113`.
- Confidence: Medium.
- Failure scenario: in deployments that skip/misconfigure nginx (or during dev), image grids route all thumbnail requests through Node and pay several fs syscalls per image before streaming, reducing UI responsiveness under concurrent gallery loads.
- Suggested fix: cache `realpath(UPLOAD_ROOT)` at module level with invalidation on ENOENT/setup; document nginx/static serving as required for production; consider X-Accel-Redirect or direct static mount for local/non-nginx deployments.

### LOW — Back-to-top scroll listener runs JavaScript on every scroll event

- Evidence:
  - `HomeClient` installs a passive `scroll` listener and checks `window.scrollY` on every event: `apps/web/src/components/home-client.tsx:121-129`.
- Confidence: Medium.
- Failure scenario: on low-end mobile devices browsing a long masonry grid, this small handler competes with image decode/layout and can contribute to scroll jank, especially as loaded images accumulate.
- Suggested fix: replace with an `IntersectionObserver` sentinel near the top/bottom threshold, or throttle via `requestAnimationFrame` as already done for resize in `useColumnCount` (`apps/web/src/components/home-client.tsx:37-49`).

## Positive notes

- Load-more uses cursor pagination after the first page and guards stale responses: `apps/web/src/components/load-more.tsx:32-72`, with cursor support in `getImagesLite`: `apps/web/src/lib/data.ts:497-509`.
- View-count flushing is buffered, chunked, and backs off on DB outages: `apps/web/src/lib/data.ts:57-119`.
- Uploads stream original files to disk instead of buffering entire files in JS heap: `apps/web/src/lib/process-image.ts:251-257`.
- Image queue claim locking and bootstrap batching avoid duplicate multi-process processing and unbounded bootstrap backlog: `apps/web/src/lib/image-queue.ts:157-184`, `apps/web/src/lib/image-queue.ts:404-443`.
- Nginx has a direct static image location for production, which is the right throughput path when deployed as configured: `apps/web/nginx/default.conf:96-113`.

## Final missed-issue sweep

Reviewed repo inventory and focused inspection across DB schema/indexes, data query functions, public actions/search/load-more, public home/topic/photo/share pages, upload/dropzone/admin dashboard/image manager, image queue and Sharp pipeline, upload-serving routes/nginx, rate-limit maps, OG route, health/live routes, backup/restore, and storage abstraction. I did not run DB `EXPLAIN` or synthetic benchmarks, so query severity is based on code shape and MySQL/Next.js behavior rather than measured production latency. No source files were changed.
