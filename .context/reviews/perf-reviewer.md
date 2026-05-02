# Performance Deep Review — Cycle 1

Reviewer: perf-reviewer  
Date: 2026-05-02  
Scope: `/Users/hletrd/flash-shared/gallery`  
Constraint honored: no application code was edited; this report is the only intended change.

## 1) Inventory of review-relevant files

Inventory was built first with `omx explore` plus `git ls-files` over runtime source, DB, image-processing, queue, route, component, and deployment/config surfaces. I examined each file below either line-by-line for hot paths or by targeted performance/concurrency/I/O/DB-pattern sweeps.

### Public/admin routes and server actions
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/error.tsx`
- `apps/web/src/app/[locale]/loading.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/app/icon.tsx`
- `apps/web/src/app/apple-icon.tsx`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`

### Client/UI components
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/photo-viewer-loading.tsx`
- `apps/web/src/components/optimistic-image.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/lazy-focus-trap.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/i18n-provider.tsx`
- `apps/web/src/components/theme-provider.tsx`
- `apps/web/src/components/ui/alert-dialog.tsx`
- `apps/web/src/components/ui/alert.tsx`
- `apps/web/src/components/ui/aspect-ratio.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/dropdown-menu.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/label.tsx`
- `apps/web/src/components/ui/progress.tsx`
- `apps/web/src/components/ui/scroll-area.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/separator.tsx`
- `apps/web/src/components/ui/sheet.tsx`
- `apps/web/src/components/ui/skeleton.tsx`
- `apps/web/src/components/ui/sonner.tsx`
- `apps/web/src/components/ui/switch.tsx`
- `apps/web/src/components/ui/table.tsx`
- `apps/web/src/components/ui/textarea.tsx`

### Data, DB, caching, queue, image processing, I/O helpers
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/seed.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/bounded-map.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/advisory-locks.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/tag-records.ts`
- `apps/web/src/lib/tag-slugs.ts`
- `apps/web/src/lib/image-types.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/photo-title.ts`
- `apps/web/src/lib/blur-data-url.ts`
- `apps/web/src/lib/csv-escape.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/action-result.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/base56.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/clipboard.ts`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/csp-nonce.ts`
- `apps/web/src/lib/error-shell.ts`
- `apps/web/src/lib/exif-datetime.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/utils.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/proxy.ts`

### Runtime/deployment/schema config
- `apps/web/next.config.ts`
- `apps/web/nginx/default.conf`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/drizzle.config.ts`
- `apps/web/drizzle/0000_nappy_madelyne_pryor.sql`
- `apps/web/drizzle/0001_sync_current_schema.sql`
- `apps/web/drizzle/0002_fix_processed_default.sql`
- `apps/web/drizzle/0003_audit_created_at_index.sql`
- `apps/web/package.json`
- root package/workspace manifests and app test configs were checked only as supporting context.

## 2) Findings

### HIGH-01 — Image queue can saturate the same CPU/memory pool used by SSR/API

- Label: confirmed
- Confidence: High
- Evidence:
  - `apps/web/src/instrumentation.ts:1-6` starts `bootstrapImageProcessingQueue()` inside the Next Node runtime.
  - `apps/web/Dockerfile:93-94` starts a single `node apps/web/server.js` process after migration.
  - `apps/web/src/lib/image-queue.ts:138-145` defaults queue concurrency to `Number(process.env.QUEUE_CONCURRENCY) || 1` and notes one job already encodes AVIF/WebP/JPEG with libvips workers.
  - `apps/web/src/lib/process-image.ts:17-26` sets Sharp/libvips concurrency to `availableParallelism() - 1` unless capped by `SHARP_CONCURRENCY`.
  - `apps/web/src/lib/process-image.ts:537-542` generates WebP, AVIF, and JPEG in parallel for every queued image.
- Failure scenario: On a 4-vCPU host, one upload of several large RAW/high-MP JPEGs starts background conversion in the same Node server that handles SSR, server actions, auth, and admin UI. One queue job can run three format pipelines concurrently, each able to use libvips worker threads. AVIF encoding is especially CPU-heavy. Under upload bursts, public page TTFB, admin actions, search, health-with-DB, and queue bookkeeping can all compete for CPU and memory in the same process. If an operator raises `QUEUE_CONCURRENCY`, the multiplication becomes `jobs × formats × sharpConcurrency`, which can stall the web tier.
- Suggested fix: Split image processing into a separate worker process/container that shares DB/storage but not the web server event loop/CPU budget. If keeping in-process, make format generation sequential or bounded by a separate `IMAGE_FORMAT_CONCURRENCY`, default `SHARP_CONCURRENCY=1` or a conservative value in production, and document safe `QUEUE_CONCURRENCY × SHARP_CONCURRENCY` sizing. Add metrics for queue job duration, RSS, CPU, and event-loop lag so the default can be tuned from data.

### HIGH-02 — Uncached public listing pages run a join/group/window-count query on every request

- Label: likely
- Confidence: High
- Evidence:
  - `apps/web/src/app/[locale]/(public)/page.tsx:14-16` disables ISR (`revalidate = 0`).
  - `apps/web/src/app/[locale]/(public)/page.tsx:138-140` calls `getImagesLitePage(..., PAGE_SIZE, 0)` for the home page.
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17` disables ISR for topic pages.
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:164-166` calls the same paginated query for topics.
  - `apps/web/src/lib/data.ts:653-668` selects public image fields plus `GROUP_CONCAT`, left-joins `image_tags`/`tags`, groups by `images.id`, orders by date/id, computes `COUNT(*) OVER()`, then applies `limit`/`offset`.
  - `apps/web/src/db/schema.ts:61-65` has helpful image sort/filter indexes, but `apps/web/src/db/schema.ts:74-80` only indexes `image_tags` by `(image_id, tag_id)` unique and `tag_id`; it does not remove the need to aggregate joined tag rows and compute the window count for all matches.
- Failure scenario: A public home or topic request on a 50k-photo gallery with multiple tags per image must build/aggregate the joined rowset and compute the full window count before it can return the first 31 records. Because the pages are intentionally fresh (`revalidate = 0`), crawler traffic or a homepage spike turns this into repeated DB CPU/temp-table/filesort work on the hottest route.
- Suggested fix: Split listing into two phases: first select only page image IDs from `images` using the existing covering sort/filter indexes and `LIMIT pageSize + 1`; then fetch tags for those IDs in a second bounded query. Avoid `COUNT(*) OVER()` on first paint; use `pageSize + 1` for `hasMore`, cache/materialize counts per topic/tag set, or fetch exact totals asynchronously for UI only when needed. Validate with `EXPLAIN ANALYZE` on representative image/tag cardinalities.

### MEDIUM-01 — Search is built on leading-wildcard LIKE scans across multiple tables

- Label: likely
- Confidence: High
- Evidence:
  - `apps/web/src/lib/data.ts:1094-1095` constructs `%${escaped}%`, guaranteeing a leading wildcard.
  - `apps/web/src/lib/data.ts:1127-1144` applies `LIKE` to title, description, camera model, topic slug, and topic label, then orders by gallery sort columns.
  - `apps/web/src/lib/data.ts:1182-1201` optionally runs tag and alias queries in parallel, joining `image_tags`/`tags` and `topic_aliases`, grouping by all selected image columns.
  - `apps/web/src/components/search.tsx:89-100` debounces by 300 ms, but stale client requests are not aborted (`apps/web/src/components/search.tsx:63-86` only ignores late responses).
  - `apps/web/src/app/actions/public.ts:160-209` acknowledges expensive LIKE queries and rate-limits before calling `searchImages(...)`.
  - `apps/web/src/db/schema.ts:16-80` defines normal btree/unique indexes, not full-text or n-gram/trigram search indexes for these text fields.
- Failure scenario: On a large gallery, every distinct 2+ character search term can scan many processed image rows and, if the main branch does not fill the limit, also scan joined tag and alias paths. A single user typing quickly still produces server work for stale requests; multiple users can keep DB CPU high even within the rate limit.
- Suggested fix: Add a dedicated search strategy: MySQL `FULLTEXT` indexes/search table for title/description/tags/topics, an external search index, or at least prefix-only indexed search for constrained fields. Add short-lived result caching by normalized query and locale/topic where possible. Consider abortable client requests for route-handler search, or coalesce server-action searches by query key.

### MEDIUM-02 — Upload tag persistence performs repeated per-file/per-tag DB lookups

- Label: confirmed
- Confidence: High
- Evidence:
  - `apps/web/src/app/actions/images.ts:265-276` processes uploaded files sequentially.
  - `apps/web/src/app/actions/images.ts:352-385` recomputes unique tags for each file and awaits `ensureTagRecord(...)` inside a per-tag loop before inserting `image_tags` for that one image.
  - `apps/web/src/lib/tag-records.ts:66-68` implements `ensureTagRecord` as `insert ignore` plus `selectTagByNameOrSlug(...)`.
  - `apps/web/src/lib/tag-records.ts:29-45` may perform a select by name and then a select by slug for each tag.
- Failure scenario: Uploading 100 files with the same 20 tags can issue thousands of sequential DB operations for identical tag names while the upload action is still open. Even if all tags already exist, every image repeats the same lookup chain, increasing upload latency, tying up DB connections, and delaying queue enqueue for later files.
- Suggested fix: Normalize/validate the request's tag list once before the file loop, resolve all unique tag records once, and reuse the resolved IDs for every image in the batch. If per-file tags are introduced later, collect unique tags across the entire upload request and batch resolve. Insert `image_tags` in chunks after image inserts or use a transaction/bulk insert where practical.

### MEDIUM-03 — A single upload/settings contract lock is held across disk I/O, metadata extraction, DB writes, tag writes, and queue enqueue

- Label: risk
- Confidence: Medium
- Evidence:
  - `apps/web/src/app/actions/images.ts:172-180` acquires `acquireUploadProcessingContractLock()` before reading config and headers.
  - The lock remains held while every file is saved and inspected (`apps/web/src/app/actions/images.ts:265-284`), tags are persisted (`apps/web/src/app/actions/images.ts:352-385`), and queue jobs are enqueued (`apps/web/src/app/actions/images.ts:397-412`).
  - `apps/web/src/app/actions/images.ts:453-455` releases the lock only in the final `finally` block.
  - `apps/web/src/lib/process-image.ts:347-391` streams the uploaded original to disk, runs Sharp metadata extraction, and builds a blur placeholder during the request path.
  - `apps/web/src/components/upload-dropzone.tsx:239-245` documents that the client sends sibling files sequentially because the server lock would make parallel uploads compete with themselves.
- Failure scenario: One admin uploads 100 large photos or a slow network client uploads a max-size file. The named lock is held for the whole upload processing path, so other uploads and any settings/output-size operation using the same contract are blocked for minutes. The lock protects consistency, but its current critical section includes expensive and failure-prone I/O and CPU work that does not all need mutual exclusion.
- Suggested fix: Narrow the lock to the minimum section that reads or mutates the image-size/settings contract. Use a versioned config snapshot for upload requests, or change to reader/writer semantics so uploads can proceed concurrently while settings changes wait. Move blur generation into the background image job or make it separately bounded. Add timeout/telemetry around lock wait and hold duration.

### MEDIUM-04 — Batch delete scans derivative directories once per image per format

- Label: confirmed
- Confidence: High
- Evidence:
  - `apps/web/src/app/actions/images.ts:650-670` deletes each selected image in chunks and calls `deleteImageVariants(..., [])` for WebP, AVIF, and JPEG.
  - `apps/web/src/lib/process-image.ts:181-203` says the empty-size path scans the whole directory to find all historical variants for the one filename base.
  - `apps/web/src/lib/process-image.ts:211-213` then unlinks matched files after each scan.
- Failure scenario: Deleting 500 images from a large gallery with tens of thousands of derivative files triggers roughly `500 × 3` directory scans, bounded to five images at a time but still O(selectedImages × directorySize). On NAS or slow disks, admin bulk delete can take a long time and saturate I/O, affecting image serving and queue writes.
- Suggested fix: For batch delete, scan each derivative directory once, match all selected filename bases in memory, then unlink the union. For single-image delete, prefer deterministic current-size deletion and schedule a lower-priority orphan sweeper for historical variants. If keeping scans, cache a per-directory listing for the lifetime of the batch.

### MEDIUM-05 — Infinite scroll keeps all loaded cards in React state and DOM

- Label: likely
- Confidence: High
- Evidence:
  - `apps/web/src/components/home-client.tsx:105-110` stores loaded images in `allImages` and appends every load-more response.
  - `apps/web/src/components/home-client.tsx:179-180` maps every `orderedImages` item into the masonry grid.
  - `apps/web/src/components/home-client.tsx:274-282` keeps loading additional pages as long as `hasMore` is true.
  - `apps/web/src/components/load-more.tsx:97-107` uses an `IntersectionObserver` with `rootMargin: '200px'`, so additional pages are fetched automatically as the sentinel approaches.
- Failure scenario: A visitor scrolling through hundreds or thousands of images accumulates every card, `<picture>`, `<source>`, `<img>`, link, overlay, and associated React object in memory. Layout and style recalculation cost grows with each page, leading to mobile jank, rising memory, and eventual tab eviction on large galleries.
- Suggested fix: Introduce virtualization/windowing or chunked page retention for the masonry grid. If masonry virtualization is too complex, cap retained pages with a “jump back/load previous” model, paginate explicitly after N pages, or render lightweight placeholders for far-offscreen cards. Track client memory and long tasks during a 1k-image scroll test.

### MEDIUM-06 — Admin CSV export materializes a large DB result, CSV line array, final string, server-action payload, and browser Blob

- Label: confirmed
- Confidence: High
- Evidence:
  - `apps/web/src/app/[locale]/admin/db-actions.ts:36-41` comments that the export materializes up to 50k rows and recommends streaming for large galleries.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:59-74` selects joined/grouped image/tag rows with `.limit(50000)`.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:81-109` builds `csvLines`, clears `results`, then joins into one `csvContent` string.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:116` returns the entire CSV string from the server action.
  - `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-107` receives that string on the client and creates a `Blob` for download.
- Failure scenario: Near the 50k-row cap, large filenames/titles/tags can produce tens of MB of string data. The server holds at least the rows/line array/final string across GC windows, the server action transports the payload through the app protocol, and the browser allocates another copy for the Blob. This can pause the server, exceed body/proxy limits in some deployments, or freeze the admin tab.
- Suggested fix: Replace the server action with a streaming authenticated route that writes CSV rows directly to the response using a DB cursor/stream or chunked pagination. Keep audit logging out-of-band after stream completion. Preserve the 50k warning via response headers or a small metadata endpoint.

### LOW-01 — Home metadata may run an extra listing query for the OG image on every uncached home request

- Label: likely
- Confidence: Medium
- Evidence:
  - `apps/web/src/app/[locale]/(public)/page.tsx:14-16` disables ISR for the public home page.
  - `apps/web/src/app/[locale]/(public)/page.tsx:78-80` calls `getImagesLite(..., 1, 0)` in `generateMetadata` when no explicit OG image is configured.
  - `apps/web/src/app/[locale]/(public)/page.tsx:138-140` later calls `getImagesLitePage(..., PAGE_SIZE, 0)` for the page body.
  - `apps/web/src/lib/data.ts:589-615` shows `getImagesLite` uses the same left-join/group/order listing shape, just without the window count.
- Failure scenario: In the default/no-custom-OG configuration, a home request can pay for one listing-shaped query to choose an OG image and another listing/window-count query for the body. Since the route is fresh per request, this doubles part of the DB work on the most visible route.
- Suggested fix: Use a cheap `getLatestPublicImageForOg()` query that reads only the latest image filenames/dimensions from the `images` index without tag aggregation, or configure/cache a stable OG image URL. If exact freshness is not required for OG, wrap this lookup in a short TTL cache.

## 3) Files examined with no separate finding

- Share/photo pages (`p/[id]`, `s/[key]`, `g/[key]`) use fresh rendering and multiple DB reads, but current lookups are bounded by primary/share-key/group limits; no additional high-confidence performance finding beyond the shared queue/SSR resource contention.
- `apps/web/src/app/api/og/route.tsx` has cache headers, ETag handling, and rate limiting. It performs dynamic OG rendering, but the endpoint is cacheable and was not worse than expected.
- Upload serving routes and `apps/web/src/lib/serve-upload.ts` stream files and `apps/web/nginx/default.conf` directly serves `/uploads/` in production; no app-level buffering finding.
- `apps/web/src/lib/rate-limit.ts`, `auth-rate-limit.ts`, and action guards add DB/in-memory checks, but their query shapes are bounded by primary keys/buckets and mostly protect expensive paths.
- `apps/web/src/lib/process-topic-image.ts` performs bounded 512px topic image work with lower input-pixel limits; no separate finding.
- `apps/web/src/components/histogram.tsx` uses a browser worker and is fed a reduced-size derivative from the photo viewer; no separate finding.
- Admin dashboard pagination is capped (`PAGE_SIZE = 50`) and the page count query is separate; no new finding beyond the listing query shape already covered for public routes.
- UI primitive components and navigation/footer/layout files were checked for large synchronous work, unbounded loops, and image/list rendering; no separate findings.

## 4) Final missed-issues sweep

I ran a final targeted sweep for performance-sensitive constructs: `Promise.all`, `COUNT(*)`, `GROUP_CONCAT`, `LIKE`, `arrayBuffer`, `toBuffer`, `readFile`/`writeFile`, directory scans, `IntersectionObserver`, workers, Sharp, `limit`/`offset`, `revalidate = 0`, `force-dynamic`, React `cache`, `GET_LOCK`, `PQueue`, queue/pool concurrency, and DB pool limits. The sweep confirmed the findings above and did not reveal additional high-confidence performance issues outside those listed.

Skipped files confirmed:
- Test files under `apps/web/src/__tests__`, Playwright specs, and visual fixtures were skipped as non-runtime sources, except where they documented existing contracts.
- Static assets, screenshots, fonts, `node_modules`, build outputs, prior `.context` review artifacts, and lockfiles were skipped as not application runtime performance surfaces.
- Generated migration SQL was checked only for index/schema parity; no migration performance finding beyond schema/index observations above.

## 5) Finding counts by severity

- Critical: 0
- High: 2
- Medium: 6
- Low: 1
- Total: 9
