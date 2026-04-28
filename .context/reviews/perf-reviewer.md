# Performance Review — perf-reviewer

Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29
Mode: read-only static review; only this report file was written.

## Inventory built before findings

I built the review inventory from tracked repository files, excluding `node_modules`, `.git`, generated build/test artifacts (`.next`, `playwright-report`, `test-results`, coverage), generated upload/cache content, and historical/context artifacts except this requested target report.

Inventory summary:

- Review-relevant tracked files: 297
- Text files opened/read: 294
- Binary assets/fixtures noted: 3
- Read errors: 0
- Main coverage buckets:
  - App/source files (`apps/web/src/app`, components, lib, db, proxy, instrumentation): 158
  - Tests (`apps/web/e2e`, `apps/web/src/__tests__`): 77
  - Config/build/deploy/database metadata: 59
  - Scripts and utilities: included in config/build sweep
- Pre-existing local changes were present before this review in unrelated files; this review intentionally did not modify code.

Reviewed areas included Next.js App Router server/client boundaries, server actions, API routes, MySQL/Drizzle query paths, upload and image processing pipelines, static image serving, Docker/nginx runtime configuration, Playwright/Vitest tests, and UI components that affect responsiveness.

## Findings

### PERF-01 — Public first-page rendering runs grouped exact-count queries on every uncached request

- Category: Confirmed
- Severity: Medium
- Confidence: High
- Locations:
  - `apps/web/src/lib/data.ts:435-464`
  - `apps/web/src/app/[locale]/(public)/page.tsx:14-16`
  - `apps/web/src/app/[locale]/(public)/page.tsx:123-140`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:156-166`

Problem: `getImagesLitePage` uses `COUNT(*) OVER()` on a query that left-joins tags, groups by image fields, orders by capture/created time, and returns the first page. The home and topic pages set `revalidate = 0`, so the query is executed for every request rather than amortized by ISR or a cache.

Concrete failure scenario: On a gallery with many processed images and tags, bot traffic or a burst of page loads repeatedly forces MySQL to group/order a joined result and compute the exact total count just to render the first 30 cards and decide whether more images exist. This can increase homepage TTFB and contend with admin/upload work on the same database pool.

Suggested fix: Avoid exact totals on the hot first-page path. Use the already common `limit + 1` pattern to determine `hasMore`, move exact counts to a separately cached/admin-only path, or maintain denormalized counts per topic. If exact count is still needed publicly, wrap it in a short-lived cache/ISR path with targeted invalidation after upload/delete instead of `revalidate = 0` on every request.

---

### PERF-02 — Search performs leading-wildcard scans across multiple joined tables

- Category: Confirmed
- Severity: Medium-High
- Confidence: High
- Locations:
  - `apps/web/src/lib/data.ts:810-842`
  - `apps/web/src/lib/data.ts:851-879`
  - `apps/web/src/lib/data.ts:881-905`
  - `apps/web/src/components/search.tsx:89-100`

Problem: Public search builds `%term%` predicates against image title, description, camera make/model, topic labels, tag names, and topic aliases. Leading wildcards prevent normal B-tree index use. The server action limits requests, and the client debounces at 300 ms, but each accepted query can still become a broad scan with joins and grouping.

Concrete failure scenario: Multiple users type common substrings such as `a`, `sony`, or partial tag names. Even with per-client debounce and rate limits, the backend performs repeated non-sargable scans, causing high DB CPU and slow interactive search responses.

Suggested fix: Use a dedicated search index: MySQL FULLTEXT where appropriate, a materialized/search-token table, or an external search service if requirements grow. Raise the effective minimum query length for broad fields, cache popular normalized queries briefly, and prefer prefix/token matching over `%term%` substring matching on hot paths.

---

### PERF-03 — Upload preview renders every selected original file as a browser object URL

- Category: Likely
- Severity: High
- Confidence: High
- Locations:
  - `apps/web/src/lib/upload-limits.ts:1-3`
  - `apps/web/src/components/upload-dropzone.tsx:43-47`
  - `apps/web/src/components/upload-dropzone.tsx:86-108`
  - `apps/web/src/components/upload-dropzone.tsx:389-418`

Problem: The upload UI allows up to 100 files by default with a 200 MiB per-file limit, creates object URLs for every selected file, and renders every preview in the DOM using a plain `<img>` backed by the original local file. Large camera originals can require substantial decode memory, layout work, and GPU upload time before any server processing begins.

Concrete failure scenario: An admin drags 50-100 high-resolution photos into the uploader. The browser creates previews for all files, decodes many large originals, and renders a large grid, causing memory pressure, long main-thread stalls, or tab crashes on laptops/mobile browsers.

Suggested fix: Cap the number of live previews, virtualize or paginate the selected-file grid, and generate small client-side thumbnails via `createImageBitmap`/canvas or a worker before rendering. Lazy-load previews outside the viewport and consider showing metadata-only rows for very large files until hovered/expanded.

---

### PERF-04 — Large multipart uploads are handled by a server action while a global upload/settings lock is held through request-path I/O

- Category: Confirmed
- Severity: Medium
- Confidence: High
- Locations:
  - `apps/web/next.config.ts:70-75`
  - `apps/web/src/lib/upload-limits.ts:1-25`
  - `apps/web/src/lib/upload-processing-contract-lock.ts:10-31`
  - `apps/web/src/app/actions/images.ts:171-180`
  - `apps/web/src/app/actions/images.ts:251-263`
  - `apps/web/src/app/actions/images.ts:337-344`
  - `apps/web/src/app/actions/images.ts:429-430`
  - `apps/web/src/components/upload-dropzone.tsx:239-246`

Problem: The server action accepts a request body limit derived from the 2 GiB total upload default. Once invoked, it acquires a MySQL named lock/connection and holds that lock while files are saved, metadata/blur work is performed, tags are resolved, rows are inserted, and jobs are enqueued. The client serializes selected-file uploads, which avoids parallel admin uploads from one tab but does not remove the server-side lock hold time or large body parsing pressure.

Concrete failure scenario: One admin uploads a large batch over a slow connection or from slow storage. A second admin upload waits on `GET_LOCK` and may time out after 5 seconds. During the first upload, one DB connection is pinned for the lock and the Next.js process handles a very large multipart server-action request, increasing latency for unrelated admin actions and risking temp-storage or memory pressure depending on runtime behavior.

Suggested fix: Move uploads to a streaming route or direct-to-object-storage flow with much smaller server-action payloads. Narrow the global lock to only the critical settings snapshot/contract section, then release it before file I/O and per-image/tag work. Move blur generation and metadata-heavy steps into the queue where possible, and batch tag resolution instead of repeatedly ensuring tag records inside the locked request path.

---

### PERF-05 — One image-queue job can still saturate CPU through parallel format generation and libvips worker concurrency

- Category: Likely
- Severity: Medium
- Confidence: High
- Locations:
  - `apps/web/src/lib/process-image.ts:17-26`
  - `apps/web/src/lib/process-image.ts:389-478`
  - `apps/web/src/lib/gallery-config-shared.ts:38-48`
  - `apps/web/src/lib/image-queue.ts:121-132`

Problem: Queue concurrency defaults to one, which is good, but each job generates WebP, AVIF, and JPEG in parallel. Each format loops through all configured sizes, and Sharp/libvips concurrency defaults to roughly CPU count minus one. On the default size set this means one queued image can trigger substantial parallel CPU and memory work inside the same Node/Next runtime that serves public requests.

Concrete failure scenario: An admin uploads several large originals. While the queue processes variants, AVIF/WebP encoding consumes most CPU cores and memory bandwidth. Public page requests, search, and admin UI requests in the same container become sluggish even though the application-level queue has `concurrency: 1`.

Suggested fix: Run image processing in a separate worker process/container or lower Sharp concurrency for the web server. Add an explicit format-level concurrency limit, consider serializing AVIF generation, and document/tune the product of `QUEUE_CONCURRENCY`, format parallelism, output size count, and `SHARP_CONCURRENCY`. For large deployments, separate the web and image-worker resource pools.

---

### PERF-06 — Admin CSV export materializes up to 50k rows into memory and returns the whole file through a server action

- Category: Confirmed
- Severity: Medium
- Confidence: High
- Locations:
  - `apps/web/src/app/[locale]/admin/db-actions.ts:53-58`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:76-91`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:98-117`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:124`
  - `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-114`

Problem: The CSV export query caps at 50,000 rows, but the implementation builds an array of CSV lines, joins it into one large string, returns that string through a server action, and then creates a client-side `Blob`. This duplicates data across DB result memory, server string memory, RSC/action serialization, client JS memory, and Blob memory.

Concrete failure scenario: An admin exports a large gallery on a memory-constrained container. The server and browser both hold multiple copies of a multi-megabyte CSV, causing memory spikes, slow response completion, and possible process/browser instability. The source comment already acknowledges the 15-25 MiB peak for the server-side export path.

Suggested fix: Convert CSV export to a streaming API route that writes rows incrementally from a cursor/batched query and lets the browser download the response directly. Avoid returning the CSV payload through a server action. Reuse the streaming style already used by the database backup download route.

---

### PERF-07 — Shared-group selected-photo pages fetch and hydrate the whole group payload

- Category: Likely
- Severity: Medium-Low
- Confidence: Medium-High
- Locations:
  - `apps/web/src/lib/data.ts:702-715`
  - `apps/web/src/lib/data.ts:717-740`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:29-38`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:99-107`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:146-147`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:170-193`

Problem: `getSharedGroup` loads up to 100 images, includes blur data and tags, and batches tag hydration for the full group. The selected-photo route also uses this full group for metadata/page rendering and passes the group into `PhotoViewer`, even when the user or crawler only needs one selected photo.

Concrete failure scenario: A shared group contains 100 photos and a user opens a direct selected-photo link on mobile. The server queries and serializes the entire group, and the client receives/hydrates the full group context before the single photo experience is useful. Social preview crawlers can also trigger the full load just for metadata.

Suggested fix: Split shared-group data access into smaller shapes: a lightweight group summary/cover path for metadata, a selected-photo detail path, and a paginated/lazy group grid path. Avoid sending `blur_data_url` and tags for every group image unless the grid actually needs them immediately.

---

### PERF-08 — Node upload fallback route lacks conditional and range support, making non-nginx deployments expensive

- Category: Manual-validation
- Severity: Low
- Confidence: Medium
- Locations:
  - `apps/web/src/lib/serve-upload.ts:69-99`
  - `apps/web/nginx/default.conf:96-105`

Problem: Production nginx is configured to serve uploaded images directly with long-lived immutable caching, which is the preferred path. However, the Node fallback route performs `realpath`/`lstat` and streams the full file without ETag/Last-Modified conditional handling or Range support. If the app is deployed without nginx/CDN in front, every image hit goes through Node and full-file streaming.

Concrete failure scenario: A platform deployment bypasses the nginx config and routes `/uploads/*` to Next.js. Browsers revisiting pages cannot cheaply validate cached images through the route, and large original/variant requests cannot use byte ranges. The web process spends CPU/file-descriptor budget on static asset delivery instead of application work.

Suggested fix: Treat nginx/CDN static serving as a hard production requirement in deployment docs/health checks, or enhance the fallback route with ETag/Last-Modified, `If-None-Match`/`If-Modified-Since`, and Range handling. Prefer offloading uploads to object storage/CDN for larger installations.

## Positive controls observed

- Public image cards use generated variants and responsive `srcset`/`sizes` rather than original uploads on gallery pages.
- The home grid uses `content-visibility` and lazy image loading for below-the-fold cards.
- View-count updates are buffered and chunked rather than written synchronously per page view.
- The image queue is bounded at the application level and defaults to one queued job at a time.
- Histogram computation uses a worker for pixel counting, keeping the heavier loop off the main UI thread.
- Production nginx config directly serves `/uploads/*` with immutable caching when that deployment path is used.

## Final sweep / coverage confirmation

- Built inventory first and reviewed every relevant tracked file in the repository, excluding generated/vendor artifacts as described above.
- Read 294 text files and noted 3 binary assets/fixtures; no read errors occurred.
- Cross-file flows reviewed:
  - Next.js public SSR/data/cache paths for home, topic, photo, share, sitemap, metadata, and load-more.
  - Server actions and API routes for upload, search, admin, backup/download, health, CSP, and uploaded-file serving.
  - MySQL/Drizzle schema, migrations, indexes, pool behavior, rate limiting, tags/topics, shared groups, and view-count buffering.
  - Image upload, metadata extraction, blur generation, background queueing, Sharp variant generation, cleanup, and static serving.
  - Client responsiveness paths including gallery cards, search, load-more, photo viewer/lightbox, histogram, and upload previews.
  - Build/runtime/deploy paths including Next config, Dockerfile, nginx, scripts, Playwright/Vitest configuration, and tests relevant to performance behavior.
- No implementation fixes were made. No test suite was run because this was a static review artifact request.
