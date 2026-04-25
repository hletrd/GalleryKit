# Perf Reviewer — PROMPT 1 / Cycle 5 Deep Repository Review

Scope: performance, concurrency, CPU/memory, DB query count, image processing, caching, SSR/rendering, upload/export streaming, queue behavior, frontend responsiveness, and operational bottlenecks.

Constraints honored: review only; no implementation; no commit.

## Performance-relevant inventory

- **Public SSR/rendering:** `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `layout.tsx`; `apps/web/src/components/nav.tsx`, `nav-client.tsx`, `home-client.tsx`, `load-more.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `histogram.tsx`, `search.tsx`, `tag-filter.tsx`, `optimistic-image.tsx`.
- **Data/query layer:** `apps/web/src/lib/data.ts`, `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/revalidation.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/rate-limit.ts`.
- **Image/upload/queue/storage:** `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, `process-topic-image.ts`, `image-queue.ts`, `queue-shutdown.ts`, `upload-limits.ts`, `upload-tracker*.ts`, `serve-upload.ts`, `upload-paths.ts`, `storage/*`, upload route handlers.
- **Export/backup/restore:** `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/db-restore.ts`, `sql-restore-scan.ts`, `mysql-cli-ssl.ts`.
- **Config/ops/docs:** `apps/web/next.config.ts`, `Dockerfile`, `docker-compose.yml`, `nginx/default.conf`, root `README.md`, `apps/web/README.md`, `CLAUDE.md`, package scripts/configs.
- **Tests inspected for perf-relevant coverage:** queue, public actions, image actions, upload limits/tracker/dropzone, data pagination, db-pool, backup/restore/download, serve-upload, histogram, search/rate-limit tests under `apps/web/src/__tests__` plus e2e specs under `apps/web/e2e`.

## Findings

### PERF-01 — Public gallery/photo pages intentionally disable ISR, so every hot public hit re-runs SSR and DB work

- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Home exports `revalidate = 0`: `apps/web/src/app/[locale]/(public)/page.tsx:14-17`.
  - Topic exports `revalidate = 0`: `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:16-18`.
  - Photo exports `revalidate = 0`: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:29-31`.
  - Home request path performs SEO/config/tags/topics and image page queries: `apps/web/src/app/[locale]/(public)/page.tsx:113-131`.
  - Public layout renders `Nav`, and `Nav` queries topics, SEO, and gallery config per request: `apps/web/src/app/[locale]/(public)/layout.tsx:5-17`, `apps/web/src/components/nav.tsx:6-12`.
  - Queue marks images processed but does not revalidate public paths after success: `apps/web/src/lib/image-queue.ts:285-301`.
- **Concrete failure scenario:** A crawler or popular linked photo page causes all home/topic/photo hits to execute fresh React SSR and multiple DB reads. With the pool capped at 10 connections and queue limit 20 (`apps/web/src/db/index.ts:13-22`), hot public traffic can starve admin uploads/search and raise TTFB even though most gallery content is cacheable between mutations.
- **Suggested fix:** Restore ISR or tag/path caching for public pages, then revalidate precisely when queue processing completes and when metadata/tags/topics mutate. For uploads, after `processed=true`, revalidate `/`, `/${topic}`, `/p/${id}`, sitemap/OG as needed. Keep `revalidate=0` only for admin and truly volatile share-view counts.

### PERF-02 — Listing pagination uses OFFSET plus `COUNT(*) OVER()`, forcing large scans/sorts as the gallery grows

- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Initial public page query selects `COUNT(*) OVER()` and uses `LIMIT/OFFSET`: `apps/web/src/lib/data.ts:371-385`.
  - Load-more path is offset-based and caps only at offset 10,000: `apps/web/src/app/actions/public.ts:23-40`.
  - Client keeps increasing `offset` as it appends pages: `apps/web/src/components/load-more.tsx:21-42`.
  - Home renders all accumulated images in one masonry DOM: `apps/web/src/components/home-client.tsx:83-90`, `apps/web/src/components/home-client.tsx:149-247`.
- **Concrete failure scenario:** On a 50k-image gallery, the first page needs a windowed total over the filtered result set; later load-more requests at offset 9,000 still require the DB to walk and discard thousands of rows. The browser also keeps all previously loaded cards mounted, so long sessions accumulate DOM, images, and React state.
- **Suggested fix:** Use keyset/cursor pagination on `(capture_date, created_at, id)` instead of offset. Fetch `limit + 1` for `hasMore` and make total counts cached/async/approximate rather than part of the critical image query. Consider virtualized masonry or a hard client-side window for very long sessions.

### PERF-03 — Public search is leading-wildcard SQL over multiple columns plus tag/alias fallbacks, not indexed full-text search

- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Search builds `%${escaped}%`: `apps/web/src/lib/data.ts:731-733`.
  - Main query applies `LIKE` across title, description, camera model, topic slug, and topic label: `apps/web/src/lib/data.ts:743-757`.
  - If not full, it runs tag and alias JOIN/GROUP BY queries with more leading-wildcard `LIKE`: `apps/web/src/lib/data.ts:766-820`.
  - Schema indexes cover sort/topic/tag joins, but no FULLTEXT/search index exists: `apps/web/src/db/schema.ts:61-80`.
- **Concrete failure scenario:** A legitimate user typing in search can trigger up to three table/JOIN scans per debounced query. Rate limiting reduces abuse but does not help expensive legitimate searches on large galleries.
- **Suggested fix:** Add MySQL FULLTEXT indexes for searchable text fields and a normalized search table/materialized index for tags/topics, or move search to a dedicated engine. Return ranked IDs first, then hydrate small image rows by PK.

### PERF-04 — Public photo prev/next navigation queries can filesort/range-scan because the composite index omits `id`

- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Likely
- **Evidence:**
  - Prev/next use OR range predicates over `capture_date`, `created_at`, and `id`, then order by all three: `apps/web/src/lib/data.ts:465-535`.
  - The relevant indexes are `(processed, capture_date, created_at)` and `(processed, created_at)`, but neither includes `id` as the final ordering key: `apps/web/src/db/schema.ts:61-66`.
- **Concrete failure scenario:** On popular photo pages, each request does the base image lookup plus tag query plus two adjacent-image queries. At high cardinality or many equal/null capture dates, MySQL may filesort or scan wider ranges to satisfy `ORDER BY ... id`.
- **Suggested fix:** Add composite indexes that match the actual order, e.g. `(processed, capture_date, created_at, id)` and topic variant if needed. Consider storing a sortable key or using UNION/keyset branches that are easier for MySQL to optimize than broad OR predicates.

### PERF-05 — Batch delete can launch hundreds of full directory scans concurrently

- **Severity:** High
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - `deleteImageVariants(..., sizes = [])` scans the entire derivative directory when sizes are empty: `apps/web/src/lib/process-image.ts:170-205`.
  - Single delete intentionally passes `[]` for all three derivative dirs: `apps/web/src/app/actions/images.ts:420-428`.
  - Batch delete runs `Promise.all(imageRecords.map(...))` and each image scans webp/avif/jpeg dirs with `[]`: `apps/web/src/app/actions/images.ts:532-550`.
  - Batch size allows up to 100 images: `apps/web/src/app/actions/images.ts:459-462`.
- **Concrete failure scenario:** Deleting 100 images from a gallery with 100k derivative files can schedule ~300 directory scans/unlink waves at once. That can saturate disk I/O, block upload processing, and make the admin request time out.
- **Suggested fix:** Build filenames deterministically from known/default/current sizes first, and do one directory scan per format per batch to discover legacy variants for all bases. Add a concurrency limiter for filesystem cleanup and return early after DB delete with background cleanup if necessary.

### PERF-06 — Image processing can oversubscribe CPU and memory under default queue settings

- **Severity:** High
- **Confidence:** Medium
- **Status:** Likely
- **Evidence:**
  - Queue default concurrency is `2`: `apps/web/src/lib/image-queue.ts:118-121`.
  - Sharp global concurrency defaults to `cpuCount - 1` unless capped: `apps/web/src/lib/process-image.ts:16-23`.
  - One job generates WebP, AVIF, and JPEG in parallel: `apps/web/src/lib/process-image.ts:439-444`.
  - Each format loops through every configured size, up to the admin max of 8 sizes: `apps/web/src/lib/process-image.ts:371-418`, `apps/web/src/lib/gallery-config-shared.ts:48-57`.
  - Docs acknowledge the sharp-heavy path: `CLAUDE.md:172-180`.
- **Concrete failure scenario:** Two large 45MP uploads in the queue can run six active conversion pipelines while libvips uses most CPU cores. AVIF encodes are CPU/memory intensive; concurrent jobs can make the web process unresponsive or trigger container memory pressure.
- **Suggested fix:** Introduce a process-wide image-conversion semaphore (not just queue concurrency), generate formats sequentially or with per-format weights, lower default AVIF effort/quality if available, and document memory-based concurrency guidance. Consider moving conversion to a separate worker process/container.

### PERF-07 — Upload transport relies on Server Actions with a 2 GiB body budget and concurrent per-file requests

- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Risk
- **Evidence:**
  - App default upload body limit is 2 GiB: `apps/web/src/lib/upload-limits.ts:1-24`.
  - Next server actions and proxy body limits are set from that cap: `apps/web/next.config.ts:52-58`.
  - nginx permits general bodies up to 2 GiB: `apps/web/nginx/default.conf:20-23`.
  - Client uploads individual files with concurrency `3`: `apps/web/src/components/upload-dropzone.tsx:177-243`.
  - Server action then streams the `File` to disk only after framework parsing has produced the `File`: `apps/web/src/app/actions/images.ts:82-200`, `apps/web/src/lib/process-image.ts:224-253`.
- **Concrete failure scenario:** Three concurrent 200 MB files can keep multiple long-running Server Action requests open. Depending on framework/runtime multipart buffering, this can consume large temp/memory resources before the app-level stream-to-disk code runs.
- **Suggested fix:** Move uploads to a route handler that streams multipart parts directly to disk/object storage with backpressure and per-file limits. Keep Server Actions for metadata commits only. Add explicit upload concurrency/backpressure config tied to CPU/disk capacity.

### PERF-08 — Upload selection UI can decode/render too many raw previews and TagInput instances

- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Up to 100 files can be selected by default: `apps/web/src/lib/upload-limits.ts:1-12`.
  - The UI creates object URLs for every selected file: `apps/web/src/components/upload-dropzone.tsx:75-103`.
  - It renders every selected file in a grid with an `<img src={previewUrl}>`: `apps/web/src/components/upload-dropzone.tsx:380-405`.
  - It renders a `TagInput` for every file, each filtering all `availableTags`: `apps/web/src/components/upload-dropzone.tsx:436-449`, `apps/web/src/components/tag-input.tsx:54-59`.
- **Concrete failure scenario:** Selecting 100 high-resolution images/RAW-like files can make the browser decode many full previews and instantiate 100 autocomplete widgets, each scanning the full tag list on input. Admin UI jank/OOM happens before upload starts.
- **Suggested fix:** Virtualize/limit the preview grid, generate small client-side thumbnails lazily, render per-file `TagInput` only when expanding a file row, and cap visible previews independent of server upload limits.

### PERF-09 — CSV export is not streamed; it materializes DB rows, CSV lines, final CSV string, and client Blob

- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed
- **Evidence:**
  - Export query loads up to 50k grouped rows into `results`: `apps/web/src/app/[locale]/admin/db-actions.ts:33-67`.
  - It builds `csvLines`, then joins into one `csvContent` string returned from a Server Action: `apps/web/src/app/[locale]/admin/db-actions.ts:68-99`.
  - Client wraps returned data in a `Blob` before download: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-124`.
- **Concrete failure scenario:** A 50k-row export with long filenames/tags can transiently hold the result array, line array, final string, Server Action payload, and browser Blob. This can spike memory and time out on slower networks.
- **Suggested fix:** Implement an authenticated route handler that streams CSV rows with a DB cursor/query stream and `ReadableStream`, writing directly to the response. Keep the 50k cap or paginate/chunk exports with progress.

### PERF-10 — Some pre-generated upload derivatives still go through Next Image optimization

- **Severity:** Medium
- **Confidence:** Medium
- **Status:** Confirmed risk
- **Evidence:**
  - Next Image optimization is enabled for all local patterns and AVIF/WebP output: `apps/web/next.config.ts:59-70`.
  - Shared-group grid uses `next/image` for an already-sized WebP derivative: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:177-184`.
  - Search thumbnails use `next/image` for already-sized JPEG derivatives: `apps/web/src/components/search.tsx:249-257`.
  - Admin previews wrap `next/image` via `OptimisticImage`: `apps/web/src/components/optimistic-image.tsx:56-69`, called from `apps/web/src/components/image-manager.tsx:377-385`.
  - nginx is already configured to serve upload derivatives directly with immutable caching: `apps/web/nginx/default.conf:93-110`.
- **Concrete failure scenario:** Browsers request `/_next/image?.../uploads/...` for derivatives the app already generated, causing Node/Sharp optimizer work and `.next/cache` growth instead of direct nginx/sendfile delivery.
- **Suggested fix:** Use raw `<picture>/<img>` or set `unoptimized` for pre-generated derivative URLs. Reserve Next Image optimization for remote/unprocessed assets that actually need runtime resizing.

### PERF-11 — Single-instance/process-local coordination is an explicit operational scaling bottleneck

- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed risk
- **Evidence:**
  - README states the deployment is single web-instance/single-writer and process-local for restore maintenance, upload quotas, and image queue state: `README.md:142-145`.
  - CLAUDE repeats the same topology warning: `CLAUDE.md:157-158`.
  - Process-local state appears in queue singleton: `apps/web/src/lib/image-queue.ts:67-131`; upload tracker singleton: `apps/web/src/lib/upload-tracker-state.ts:7-20`; restore maintenance singleton: `apps/web/src/lib/restore-maintenance.ts:1-22`; view-count buffer: `apps/web/src/lib/data.ts:11-21`.
- **Concrete failure scenario:** Scaling to two web containers to handle more public traffic splits upload quotas/view-count buffers and creates independent in-memory queues. MySQL advisory locks prevent duplicate conversion per job, but process-local admission/maintenance state still diverges, so throughput and correctness become topology-dependent.
- **Suggested fix:** Before horizontal scaling, move queue/admission/maintenance/view-count state to shared storage (DB/Redis/queue service), or split public read-only serving from a single writer/worker deployment.

## Final missed-issues sweep

- Re-scanned for `revalidate`, `dynamic`, `offset`, `COUNT(*) OVER`, `LIKE`, `GROUP_CONCAT`, `Promise.all`, `concurrency`, streams, object URLs, and upload/download paths across `apps/web/src`, config, docs, and tests.
- Checked direct static serving: `serve-upload.ts` streams files and production nginx bypasses Node for upload derivatives; no additional critical issue beyond Next Image optimizer paths above.
- Checked backup/restore: DB dump/download uses process streams; restore streams temp file into `mysql` and gates concurrent restores with a DB advisory lock. The main export gap is CSV, not SQL backup/download.
- Checked histogram: pixel loop is worker-based and canvas input is capped at 256px; no finding beyond extra small image fetch being acceptable.
- Checked rate-limit/session GC: bounded in-memory maps and hourly DB cleanup exist; no unbounded-growth finding found.

## Files reviewed

- Root/config/docs: `AGENTS.md`, `README.md`, `CLAUDE.md`, `package.json`, `apps/web/package.json`, `apps/web/README.md`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/tailwind.config.ts`.
- DB/data: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/0000_nappy_madelyne_pryor.sql`, `0001_sync_current_schema.sql`, `0002_fix_processed_default.sql`, `0003_audit_created_at_index.sql`, `apps/web/src/lib/data.ts`, `gallery-config.ts`, `gallery-config-shared.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `session.ts`, `audit.ts`, `revalidation.ts`.
- Public/admin app routes and actions: all files under `apps/web/src/app/[locale]/(public)`, `apps/web/src/app/[locale]/admin`, `apps/web/src/app/actions*.ts`, `apps/web/src/app/api`, `apps/web/src/app/sitemap.ts`, `manifest.ts`, `robots.ts`, `proxy.ts`, `instrumentation.ts`.
- Components: `home-client.tsx`, `load-more.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `histogram.tsx`, `search.tsx`, `nav*.tsx`, `footer.tsx`, `image-manager.tsx`, `upload-dropzone.tsx`, `tag-input.tsx`, `tag-filter.tsx`, `optimistic-image.tsx`, UI wrappers used on reviewed paths.
- Image/upload/storage/export libs: `process-image.ts`, `process-topic-image.ts`, `image-queue.ts`, `queue-shutdown.ts`, `serve-upload.ts`, `upload-limits.ts`, `upload-paths.ts`, `upload-tracker*.ts`, `storage/*`, `db-restore.ts`, `sql-restore-scan.ts`, `mysql-cli-ssl.ts`, `backup-filename.ts`, `csv-escape.ts`.
- Tests/e2e sampled for relevant coverage: `data-pagination.test.ts`, `public-actions.test.ts`, `image-queue*.test.ts`, `queue-shutdown.test.ts`, `images-actions.test.ts`, `upload-dropzone.test.ts`, `upload-limits.test.ts`, `upload-tracker.test.ts`, `db-pool-connection-handler.test.ts`, `backup-download-route.test.ts`, `db-restore.test.ts`, `serve-upload.test.ts`, `histogram.test.ts`, `rate-limit.test.ts`, plus `apps/web/e2e/*.spec.ts` and helpers.
