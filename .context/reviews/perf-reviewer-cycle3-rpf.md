# Performance Review — Cycle 3 / Prompt 1

Reviewer: `perf-reviewer`  
Repository: `/Users/hletrd/flash-shared/gallery`  
Baseline reviewed: `e44996c`  
Scope: performance, concurrency, CPU/memory/I/O/UI responsiveness, caching, DB query shape, async queues, and scalability.  
Implementation edits: none; this file is the only intended change.

## Inventory and coverage

I first inventoried the repo with `git ls-files` and then did a final performance-pattern sweep across runtime/config/script/test files. The runtime/config/test/script inventory covered 275 tracked files, and the final grep sweep found 79 files with performance-relevant patterns (`GET_LOCK`, queueing, `Promise.all`, filesystem calls, `sharp`, cache/revalidate calls, DB grouping/offset/order/LIKE, touch/observer handlers, timers). I examined every relevant file and cross-file flow surfaced by that inventory; no relevant runtime file was skipped.

Relevant files/flows reviewed:

- **Workspace/build/deploy/config**: `package.json`, `pnpm-lock.yaml`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/drizzle.config.ts`, Playwright/ESLint/PostCSS/components config, and web scripts under `apps/web/scripts/*`.
- **Database schema/migrations/connection**: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, and DB migration/seed scripts.
- **Server data/query layer**: `apps/web/src/lib/data.ts`, `gallery-config.ts`, `rate-limit.ts`, `session.ts`, `audit.ts`, `revalidation.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `serve-upload.ts`, `storage/*`, `upload-*`, and validation/sanitize/origin helpers.
- **Image/queue/storage pipeline**: `image-queue.ts`, `process-image.ts`, `process-topic-image.ts`, `queue-shutdown.ts`, upload routes, nginx upload serving, topic-image resources, and the histogram worker.
- **Server actions/API/routes/pages**: all files under `apps/web/src/app/actions*`, `apps/web/src/app/api/**`, public pages under `(public)`, admin pages under `admin`, upload routes, sitemap/robots/manifest/icon routes, and admin DB actions.
- **Client/UI responsiveness**: all `apps/web/src/components/**`, including gallery masonry/listing, load-more, search, upload dropzone, image manager, photo viewer/navigation/lightbox, histogram, bottom sheet, nav, tag inputs, and UI primitives.
- **Tests/e2e contracts**: performance-relevant tests under `apps/web/src/__tests__/**` and `apps/web/e2e/**` were checked for locked behavior around pagination, queueing, image processing, deletion cleanup, rate limits, DB pool handling, and UI/touch contracts.

Positive coverage notes:

- Public upload derivatives are served directly by nginx in production (`apps/web/nginx/default.conf:96-113`), avoiding Node stream overhead for normal image traffic.
- Infinite scroll is cursor-capable and guarded against concurrent loads via `loadingRef` (`apps/web/src/components/load-more.tsx:74-106`).
- View-count writes are buffered/chunked in `apps/web/src/lib/data.ts:11-121`, avoiding one DB write per shared-page view.
- The queue defaults to one processing job per process (`apps/web/src/lib/image-queue.ts:126-132`), which is conservative for CPU-heavy Sharp work.

## Findings

### PERF-01 — Public search uses leading-wildcard LIKE scans across images, tags, and aliases

- **Severity**: High
- **Confidence**: High
- **Evidence**:
  - Search constructs `%${query}%` at `apps/web/src/lib/data.ts:915-917`.
  - The main search query applies leading-wildcard `LIKE` to title, description, camera model, topic slug, and topic label, then sorts by creation time (`apps/web/src/lib/data.ts:927-941`).
  - If that does not fill the result set, it runs a tag join with `LIKE(tags.name, searchTerm)`, `GROUP BY`, and sort (`apps/web/src/lib/data.ts:950-978`), then an alias join with `LIKE(topicAliases.alias, searchTerm)`, `GROUP BY`, and sort (`apps/web/src/lib/data.ts:980-1004`).
  - The schema has b-tree indexes for listing/filtering (`processed`, `capture_date`, `created_at`, `topic`, `user_filename`) but no full-text/search index for `title`, `description`, `camera_model`, tag names, or aliases (`apps/web/src/db/schema.ts:16-80`).
  - The UI debounces by only 300 ms (`apps/web/src/components/search.tsx:89-104`), and the server action then performs DB-backed rate-limit writes/checks before search (`apps/web/src/app/actions/public.ts:116-164`).
- **Failure scenario**: With 50k+ images and thousands of tags/aliases, a single user typing a 5-character search can issue multiple debounced server actions. Each accepted search can perform up to three non-sargable scans plus grouping/sorting. A few concurrent users can drive MySQL CPU high enough that unrelated gallery/listing/session queries queue behind the scans.
- **Fix**: Add a real search path instead of `%term%` scans: a MySQL `FULLTEXT` index/search table over normalized image/topic/tag/alias text with `MATCH ... AGAINST`, or a dedicated denormalized `image_search_documents` table updated on image/tag/topic mutation. Keep tag/alias exact or prefix lookups indexed before fallback, raise the minimum query length to 3 if product-acceptable, and cache popular normalized queries briefly.

### PERF-02 — Initial public pages compute exact total counts with a grouped window query

- **Severity**: Medium
- **Confidence**: High
- **Evidence**:
  - `getImagesLitePage` selects `COUNT(*) OVER()` alongside `GROUP_CONCAT(DISTINCT tags.name)`, left joins tags, groups by image id, orders, and then applies `LIMIT/OFFSET` (`apps/web/src/lib/data.ts:534-563`).
  - Home uses this exact-count path for the first page (`apps/web/src/app/[locale]/(public)/page.tsx:123-140`).
  - Topic pages do the same for each topic/tag-filtered first page (`apps/web/src/app/[locale]/(public)/[topic]/page.tsx:156-166`).
  - The client uses the exact count only for the heading copy (`apps/web/src/components/home-client.tsx:161-164`).
  - Tag filtering can add a grouped `IN (...) HAVING COUNT(DISTINCT ...)` subquery (`apps/web/src/lib/data.ts:322-336`), making the count path heavier on filtered pages.
- **Failure scenario**: On a 100k-image gallery, every cold home/topic/tag page request has to materialize/count the full filtered grouped result set to return the first 30 rows and a display count. During traffic spikes or crawler visits across topics/tag combinations, this increases TTFB and contends with interactive admin/upload queries.
- **Fix**: Avoid exact counts in the public first-page hot path. Use the same `LIMIT + 1` cursor query as load-more for `hasMore`, show approximate/omitted counts, or fetch counts from a cached summary table maintained on image/tag/topic mutations. If exact counts remain required, split them into an independently cached count query keyed by topic/tag filter and invalidate via existing revalidation hooks.

### PERF-03 — Uploads hold a global MySQL advisory-lock connection through file I/O and metadata extraction

- **Severity**: Medium
- **Confidence**: High
- **Evidence**:
  - `uploadImages` acquires `acquireUploadProcessingContractLock()` before config lookup, disk checks, validation, file writes, Sharp metadata/blur extraction, DB inserts, tag persistence, and queue enqueueing (`apps/web/src/app/actions/images.ts:171-430`).
  - The lock helper obtains a pool connection and keeps it until `release()` runs (`apps/web/src/lib/upload-processing-contract-lock.ts:17-56`).
  - The DB pool is fixed at 10 connections with queue limit 20 (`apps/web/src/db/index.ts:13-21`).
  - The upload loop is sequential per action (`apps/web/src/app/actions/images.ts:251-402`), and the client intentionally uploads files sequentially because of the server-side lock (`apps/web/src/components/upload-dropzone.tsx:239-246`).
- **Failure scenario**: An admin uploads many large files or a slow storage volume makes `saveOriginalAndGetMetadata` expensive. The global lock and one DB connection stay held for the whole upload batch. A second admin/tab gets `uploadSettingsLocked` after the 5-second lock timeout, and the shared pool has one fewer connection for unrelated public/admin requests for the duration. If queue/settings/restore locks are also active, the 10-connection pool can queue or reject foreground work.
- **Fix**: Narrow the lock scope to only the critical section that needs a stable upload-processing contract: read a settings/version snapshot and register the upload claim, then release before expensive file I/O and Sharp metadata work. Persist the snapshot/version with the upload batch/job. If an advisory lock is still needed, use a dedicated small lock pool rather than the main web query pool and expose an explicit queued upload state instead of failing after 5 seconds.

### PERF-04 — Image-processing jobs pin DB-pool connections while doing CPU/I/O-heavy Sharp work

- **Severity**: Medium
- **Confidence**: High
- **Evidence**:
  - Each queue job acquires `GET_LOCK` through `connection.getConnection()` and returns the locked pool connection (`apps/web/src/lib/image-queue.ts:157-184`).
  - The same locked connection is held while checking the DB row, resolving/accessing files, possibly reading config, running `processImageFormats`, verifying files, and updating the DB (`apps/web/src/lib/image-queue.ts:211-335`).
  - `processImageFormats` generates WebP, AVIF, and JPEG variants concurrently (`apps/web/src/lib/process-image.ts:473-478`), so one queue job can already consume substantial CPU and memory.
  - Operators can raise `QUEUE_CONCURRENCY` (`apps/web/src/lib/image-queue.ts:126-132`), while the shared DB pool remains 10 connections (`apps/web/src/db/index.ts:13-21`).
- **Failure scenario**: To clear a backlog, an operator sets `QUEUE_CONCURRENCY=8`. Eight of ten DB connections can be pinned by jobs that are mostly doing filesystem and Sharp encoding work, leaving only two connections for public pages, sessions, rate limits, and admin actions. Latency spikes or pool queue-limit errors can occur even though the queue jobs are not actively querying most of the time.
- **Fix**: Replace long-lived connection-scoped advisory locks with a short DB row claim (`processing_owner`, `claim_expires_at`, compare-and-set) or release the advisory lock immediately after a durable claim is written. Alternatively isolate advisory locks in a separate pool. Document/enforce `QUEUE_CONCURRENCY <= DB_POOL_SIZE - foreground headroom`, and consider making format generation sequential/configurable when concurrency is raised.

### PERF-05 — Batch deletion repeats full upload-directory scans for historical variants

- **Severity**: Medium
- **Confidence**: High
- **Evidence**:
  - `deleteImageVariants` scans an entire format directory whenever `sizes` is empty or unknown (`apps/web/src/lib/process-image.ts:181-209`) and then unlinks every matching candidate in parallel (`apps/web/src/lib/process-image.ts:211-213`).
  - Single delete passes `[]` for WebP, AVIF, and JPEG, forcing three scans (`apps/web/src/app/actions/images.ts:498-508`).
  - Batch delete processes up to 100 images and, for each image, again passes `[]` for all three derivative formats (`apps/web/src/app/actions/images.ts:612-636`). The code comments acknowledge each cleanup may scan a whole upload directory (`apps/web/src/app/actions/images.ts:612-616`).
- **Failure scenario**: A gallery with 30k originals and four historical sizes has 100k+ files per format directory. Deleting a 100-image batch performs up to 300 full directory iterations, producing tens of millions of directory-entry checks and many metadata operations before the admin action completes. This can saturate disk I/O and block the dashboard interaction that initiated the delete.
- **Fix**: For batch delete, scan each derivative directory at most once and match all selected base names in memory, or store generated variant filenames/sizes per image so cleanup is deterministic. For single delete, prefer configured deterministic filenames and move historical-orphan cleanup to a bounded background maintenance job. Bound unlink concurrency when deleting large candidate sets.

### PERF-06 — Mobile drag interactions re-render React state on every touchmove

- **Severity**: Low
- **Confidence**: Medium
- **Evidence**:
  - Photo navigation registers a non-passive `touchmove` listener and calls `setSwipeOffset` for every horizontal move event (`apps/web/src/components/photo-navigation.tsx:53-93`, listener at `apps/web/src/components/photo-navigation.tsx:130-132`).
  - The bottom info sheet calls `setLiveTranslateY` on every touch move and derives the sheet transform from React state (`apps/web/src/components/info-bottom-sheet.tsx:61-66`, style at `apps/web/src/components/info-bottom-sheet.tsx:162-178`).
- **Failure scenario**: On 60/120 Hz touch devices, dragging a photo or bottom sheet can trigger dozens of React updates per second while the photo viewer, image, histogram/info controls, and focus trap are mounted. Low-end mobile devices can drop frames or feel sticky during swipes, especially when images are still decoding.
- **Fix**: Store live drag deltas in refs and apply transforms in a single `requestAnimationFrame` loop directly to the moving element style; only commit React state on touch end/snap. Prefer pointer events with `touch-action` CSS and passive listeners except where `preventDefault` is strictly needed.

### PERF-07 — Startup temp-file cleanup can fan out unbounded unlink promises after a crash

- **Severity**: Low
- **Confidence**: High
- **Evidence**:
  - Image tmp cleanup scans the three derivative directories in parallel and then creates one unlink promise per `.tmp` file via `Promise.allSettled(tmpFiles.map(...))` (`apps/web/src/lib/image-queue.ts:24-45`).
  - Topic tmp cleanup similarly unlinks every `tmp-*` file with one unbounded `Promise.all` (`apps/web/src/lib/process-topic-image.ts:95-102`).
  - These cleanups are kicked from queue bootstrap (`apps/web/src/lib/image-queue.ts:446-450`).
- **Failure scenario**: If a process crashes repeatedly during high-volume imports or on a slow/remote filesystem, thousands of tmp files may accumulate. The next boot issues thousands of concurrent unlink operations, causing file-descriptor pressure and an I/O burst exactly when the app is trying to become healthy.
- **Fix**: Use a small bounded worker loop for tmp cleanup (for example 16-32 concurrent unlinks), log progress in batches, and leave the bootstrap non-blocking. Reuse a local bounded-map helper or implement a simple no-dependency concurrency limiter.

## Final sweep confirmation

- I reviewed the full source/config inventory instead of sampling, then re-ran a performance-pattern sweep over `apps/web/src`, `apps/web/scripts`, config, nginx, Docker, package manifests, and relevant tests.
- No implementation files were modified.
- No relevant performance/concurrency/cache/DB/UI/queue file was skipped.
- Static review only: I did not run load tests or production query plans, so severity is based on code path shape and concrete scaling scenarios rather than benchmark measurements.
