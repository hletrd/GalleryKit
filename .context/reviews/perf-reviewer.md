# Performance Review — perf-reviewer Cycle 1 (2026-04-24)

## Scope and review inventory

I reviewed the repository under `/Users/hletrd/flash-shared/gallery` for performance, concurrency, CPU/memory pressure, database access patterns, image processing, cache/ISR behavior, UI responsiveness, N+1 risks, bundle/perceived performance, and resource exhaustion. This is a review-only artifact; no runtime files were modified.

### Review-relevant inventory examined

- **Application source:** all 203 files under `apps/web/src/**`, including public/admin route handlers and pages, server actions, components, DB/schema modules, image-processing modules, upload/storage helpers, queue/shutdown helpers, i18n/proxy/instrumentation, and unit tests that encode intended behavior.
- **Runtime/config/deploy:** `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/drizzle.config.ts`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/tailwind.config.ts`, and scripts under `apps/web/scripts/**`.
- **DB/migrations/tests:** `apps/web/drizzle/**`, `apps/web/e2e/**`, and root Playwright specs used to confirm route behavior, upload assumptions, and guardrails.
- **Excluded as non-review-relevant:** generated build output (`.next`), dependencies (`node_modules`), Playwright artifacts (`test-results`), binary fixture/image contents, and historical `.context/reviews/**` files other than this destination report.

Final missed-issues sweep covered ISR/dynamic exports, revalidation calls, query patterns (`COUNT`, `GROUP_CONCAT`, `LIKE`, pagination, grouping), concurrency primitives (`Promise.all`, `PQueue`, timers), Sharp/image-processing calls, upload body limits, filesystem scans, and streaming paths.

## Findings summary

| ID | Type | Severity | Confidence | Area |
| --- | --- | --- | --- | --- |
| PERF-C1-01 | Confirmed issue | High | High | Image processing CPU/memory concurrency |
| PERF-C1-02 | Confirmed issue | Medium | High | Startup queue memory/resource exhaustion |
| PERF-C1-03 | Confirmed issue | Medium | High | Dynamic sitemap / cache behavior |
| PERF-C1-04 | Confirmed issue | Medium | High | Public gallery exact counts |
| PERF-C1-05 | Confirmed issue | Medium | High | Bulk delete directory scans |
| PERF-C1-06 | Confirmed issue | Medium | High | CSV export memory/RSC payload |
| PERF-C1-07 | Likely risk | Medium | Medium | Search query scans |
| PERF-C1-08 | Likely risk | Medium | Medium | Rate-limit cleanup indexing |
| PERF-C1-09 | Likely risk | Low | Medium | Broad/redundant revalidation |
| PERF-C1-10 | Likely risk | Low | Medium | Photo viewer bundle/perceived performance |
| PERF-C1-11 | Likely risk | Low | Medium | Mobile swipe responsiveness |

## Confirmed issues

### PERF-C1-01 — Image-processing work can multiply CPU and memory concurrency per queue slot

- **Severity:** High
- **Confidence:** High
- **Evidence:**
  - `apps/web/src/lib/image-queue.ts:110-113` creates the processing queue with default `concurrency: 2`.
  - `apps/web/src/lib/process-image.ts:16-23` sets Sharp/libvips concurrency to `cpuCount - 1` by default.
  - `apps/web/src/lib/process-image.ts:390-408` renders every configured size for a format.
  - `apps/web/src/lib/process-image.ts:439-444` runs WebP, AVIF, and JPEG generation for the same original in parallel.
  - `apps/web/src/components/upload-dropzone.tsx:129-187` lets the admin client submit three upload server actions concurrently; `apps/web/src/app/actions/images.ts:298-306` enqueues each uploaded image.
- **Why this matters:** A single queue slot is not a single encoder. With the defaults, two queue jobs can each run three format pipelines, while each Sharp pipeline may use multiple native worker threads. AVIF is particularly CPU-heavy, and each clone may retain decoded image state or native buffers.
- **Concrete failure scenario:** An admin drops many 150-200 MB HEIC/RAW images. The browser sends three uploads concurrently, the server quickly enqueues several rows, and the queue runs two jobs. Each job launches WebP, AVIF, and JPEG generation in parallel across all configured sizes. On a 4-vCPU container this can oversubscribe native encoder threads, spike RSS, starve the Node event loop, and cause upload/health-check timeouts or OOM kills.
- **Fix:** Treat one image job as the CPU isolation unit. Lower the default `QUEUE_CONCURRENCY` to 1 for small containers, and add an explicit per-job format concurrency cap (often 1, at most 2) instead of unconditional `Promise.all` over all formats. Document/enforce a budget such as `queueConcurrency * formatConcurrency * sharpConcurrency <= available cores`. Consider processing AVIF last/optionally, moving heavy conversion to a worker process, and exposing memory-aware defaults for production.

### PERF-C1-02 — Queue bootstrap loads and enqueues every pending image at once

- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `apps/web/src/lib/image-queue.ts:330-343` selects all rows with `processed = false` and no `LIMIT`; `apps/web/src/lib/image-queue.ts:344-354` immediately calls `enqueueImageProcessing` for each row.
- **Why this matters:** The queue is bounded for active work, but the bootstrap path is not bounded for pending work. Startup memory and boot latency scale with the total backlog, not with worker concurrency.
- **Concrete failure scenario:** After a DB restore, interrupted migration, or large upload/import, 50k unprocessed rows exist. On process start, the app allocates the full selected row array plus tens of thousands of queued closures/IDs before the first conversion finishes. The container can boot slowly, exceed memory limits, and make the site unavailable even though only one or two images are actively processing.
- **Fix:** Batch bootstrap claims, for example `ORDER BY id LIMIT 500`, enqueue only the batch, then fetch the next batch when queue size falls below a threshold or on idle. Alternatively add a durable queue table with claimed/leased states. Log backlog size and cap in-memory queued IDs.

### PERF-C1-03 — Sitemap is `force-dynamic` while building up to ~48k URL entries per request

- **Severity:** Medium
- **Confidence:** High
- **Evidence:**
  - `apps/web/src/app/sitemap.ts:4-6` exports both `dynamic = 'force-dynamic'` and `revalidate = 86400`; the dynamic flag prevents normal static/ISR reuse for this route.
  - `apps/web/src/app/sitemap.ts:19-23` queries images and topics on request.
  - `apps/web/src/app/sitemap.ts:14-17` allows 24,000 image rows; `apps/web/src/app/sitemap.ts:41-55` expands those rows across locales into roughly 48,000 sitemap entries.
  - `apps/web/src/lib/data.ts:834-844` confirms the sitemap image query can return up to the requested cap.
- **Why this matters:** Sitemap fetches are crawler-driven and can be repeated by Google, Bing, uptime monitors, and cache misses. Each request allocates a large JS array and serializes a large XML response while also consuming DB pool capacity.
- **Concrete failure scenario:** During a crawler burst, repeated `/sitemap.xml` requests each query up to 24k images and allocate/serialize ~48k entries. This competes with public pages for the 10-connection DB pool and increases CPU/heap pressure despite the intended daily revalidation.
- **Fix:** Remove `force-dynamic` if build/runtime constraints now allow ISR. If DB is unavailable at build time, implement sitemap as a route handler with explicit `Cache-Control`/CDN caching and an application-level cached query, or split into a sitemap index plus paged sitemap files. Avoid constructing all locale-expanded entries on every request; stream XML or cache the generated payload.

### PERF-C1-04 — Public gallery first pages compute an exact total count on the hot path

- **Severity:** Medium
- **Confidence:** High
- **Evidence:**
  - `apps/web/src/lib/data.ts:371-384` adds `COUNT(*) OVER()` to `getImagesLitePage` and then applies `LIMIT/OFFSET`.
  - `apps/web/src/app/[locale]/(public)/page.tsx:118-120` calls `getImagesLitePage` for the homepage initial render.
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:130-132` calls the same exact-count query for topic pages.
- **Why this matters:** The page only needs the first 30 images and a `hasMore` flag, but the window count requires MySQL to count the full matching set. Tag filters and topics reduce or change the matching set, so the exact count is repeatedly recomputed per rendered variant.
- **Concrete failure scenario:** A gallery grows to tens of thousands of processed images. Every uncached homepage/topic/tag-filter render scans/counts all matching rows before the page can finish, even when the user only needs the initial masonry grid. During cache invalidation or crawler traffic, DB CPU and tail latency climb.
- **Fix:** Split exact counts from the hot path. Fetch `pageSize + 1` rows for `hasMore`, and either remove exact totals from initial SSR, cache counts separately with a TTL, or maintain denormalized counters updated on upload/delete/tag/topic changes. If exact counts remain visible, compute them asynchronously or behind a cheaper cached endpoint.

### PERF-C1-05 — Single and bulk image deletes can rescan derivative directories once per image and format

- **Severity:** Medium
- **Confidence:** High
- **Evidence:**
  - `apps/web/src/lib/process-image.ts:170-184` only scans a derivative directory when `sizes` is empty.
  - `apps/web/src/app/actions/images.ts:411-419` intentionally passes `[]` for WebP, AVIF, and JPEG on single delete.
  - `apps/web/src/app/actions/images.ts:517-535` does the same inside `Promise.all(imageRecords.map(...))` for batch deletes of up to 100 images (`apps/web/src/app/actions/images.ts:450-452`).
- **Why this matters:** The fallback scan is appropriate for rare legacy cleanup, but the current delete paths use it for every normal delete. Batch delete makes the cost multiplicative: images × formats × full directory scan.
- **Concrete failure scenario:** An admin bulk-deletes 100 images from a gallery with thousands of derivatives in each format directory. The server action can perform up to 300 directory walks concurrently, causing disk I/O spikes, long request duration, and slower image serving or processing on the same volume.
- **Fix:** For normal deletes, pass the currently configured image sizes and delete deterministic filenames without scanning. If legacy variants must also be removed, scan each format directory once per request and match all target basenames, or enqueue legacy cleanup to a background maintenance job. Cap cleanup concurrency for bulk deletes.

### PERF-C1-06 — Admin CSV export materializes a large DB result and a large CSV payload through a server action

- **Severity:** Medium
- **Confidence:** High
- **Evidence:**
  - `apps/web/src/app/[locale]/admin/db-actions.ts:50-65` loads up to 50,000 grouped image rows in one query.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:72-91` builds an in-memory `csvLines` array and joins it into one large string.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:95-98` returns that string from a server action.
  - `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-107` receives the string in the browser and creates a `Blob`, duplicating the payload client-side.
- **Why this matters:** The implementation avoids some overlap by releasing `results`, but the route still materializes the result set, line array, final string, RSC/server-action payload, browser string, and Blob at different points. CSV export size is controlled by row count, not by bytes.
- **Concrete failure scenario:** 50k images with long filenames/titles and many tags produce a tens-of-MB CSV. The server action consumes significant heap and serialization time, then the admin tab duplicates the same data into a Blob. On smaller containers or mobile admin devices, this can time out or freeze.
- **Fix:** Move CSV export to an authenticated route handler that streams `text/csv` directly to the response using DB pagination/cursors. Alternatively write the CSV to a temporary file and return a short-lived download URL. Lower the row cap or enforce a byte cap until streaming is available.

## Likely risks

### PERF-C1-07 — Public search uses leading-wildcard `LIKE` over multiple fields and joins

- **Severity:** Medium
- **Confidence:** Medium
- **Evidence:**
  - `apps/web/src/app/actions/public.ts:43-50` allows searches with only two characters.
  - `apps/web/src/lib/data.ts:731-755` builds `%query%` and applies `LIKE` to title, description, camera model, topic slug, and topic label.
  - `apps/web/src/lib/data.ts:775-820` falls back to tag and topic-alias joins with the same leading-wildcard pattern.
  - `apps/web/src/db/schema.ts:61-66` shows image indexes for processed/date/topic/filename but no full-text/search index that can accelerate leading-wildcard text scans.
- **Why this is likely, not fully confirmed:** The code confirms scan-shaped queries, but actual impact depends on row counts, MySQL version/collation, data distribution, and cache warmth.
- **Concrete failure scenario:** A public user or bot sends many two-character searches. Even with per-IP rate limiting, each request can scan text fields and then perform tag/alias join searches when the first query does not fill the limit. DB CPU rises and the shared connection pool backs up.
- **Fix:** Raise minimum query length to at least three characters, add a proper search index (`FULLTEXT`, generated normalized search table, ngram index, or external search), and make tag/alias search prefix/exact where possible. Add query-timeout protection and cache popular sanitized queries briefly.

### PERF-C1-08 — Rate-limit purge deletes by `bucket_start` without a supporting leftmost index

- **Severity:** Medium
- **Confidence:** Medium
- **Evidence:**
  - `apps/web/src/db/schema.ts:136-143` defines `rate_limit_buckets` with primary key `(ip, bucket_type, bucket_start)` only.
  - `apps/web/src/lib/rate-limit.ts:272-274` purges old buckets with `WHERE bucket_start < cutoff`.
- **Why this is likely, not fully confirmed:** MySQL cannot efficiently use the third column of this composite primary key for a range predicate unless preceding columns are constrained. Actual cost depends on table size.
- **Concrete failure scenario:** Sustained search/share/login traffic from many IPs creates many bucket rows. The hourly purge scans the full bucket table and deletes a large range in one statement, causing I/O spikes and lock contention that affects concurrent rate-limit checks.
- **Fix:** Add a secondary index on `bucket_start` or `(bucket_type, bucket_start)`. Purge in chunks, e.g. `ORDER BY bucket_start LIMIT 1000` in a loop, to avoid long delete transactions.

### PERF-C1-09 — Some mutations perform both narrow path revalidation and broad layout revalidation

- **Severity:** Low
- **Confidence:** Medium
- **Evidence:**
  - `apps/web/src/lib/revalidation.ts:30-40` revalidates localized path variants; `apps/web/src/lib/revalidation.ts:55-57` invalidates the root layout.
  - Tag updates call both in several paths, for example `apps/web/src/app/actions/tags.ts:88-89`, `apps/web/src/app/actions/tags.ts:190-191`, and `apps/web/src/app/actions/tags.ts:431-432`.
  - Topic mutations also call both, for example `apps/web/src/app/actions/topics.ts:124-125`, `apps/web/src/app/actions/topics.ts:265-266`, and `apps/web/src/app/actions/topics.ts:465-466`.
  - SEO settings call broad layout invalidation plus admin path revalidation at `apps/web/src/app/actions/seo.ts:126-130`.
- **Why this is likely, not fully confirmed:** Correct invalidation depends on app-router cache semantics and which pages consume each data set. The risk is cache churn rather than a deterministic functional bug.
- **Concrete failure scenario:** An admin edits several tags/topics in succession. Each mutation invalidates specific paths and then invalidates the whole layout, causing cached public pages to rebuild repeatedly. The rebuilds re-enter exact-count gallery queries and metadata queries, amplifying DB load.
- **Fix:** Define a single invalidation policy per mutation type. Use narrow localized paths for image/tag/topic changes, reserve `revalidateAllAppData()` for truly global settings, restore, or large batch operations, and avoid calling both unless a comment explains the distinct cache scopes. Add tests asserting the intended revalidation calls.

### PERF-C1-10 — Photo viewer loads optional heavy UI into the initial viewer chunk

- **Severity:** Low
- **Confidence:** Medium
- **Evidence:**
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:16-18` dynamically imports the whole `PhotoViewer` client component.
  - Inside that chunk, `apps/web/src/components/photo-viewer.tsx:3-20` statically imports `framer-motion`, `Lightbox`, `InfoBottomSheet`, and `Histogram`.
  - Histogram is only rendered inside the info panel at `apps/web/src/components/photo-viewer.tsx:524-530`; Lightbox is only rendered after `showLightbox` at `apps/web/src/components/photo-viewer.tsx:566-574`.
  - `apps/web/src/components/histogram.tsx:226-265` creates a worker and loads an image only when rendered, so the remaining issue is mostly JS parse/transfer for optional features.
- **Why this is likely, not fully confirmed:** I did not run bundle analyzer in this review-only lane, so exact kB impact is unknown. The static import graph nevertheless makes optional controls part of the first viewer chunk.
- **Concrete failure scenario:** A mobile visitor opens a photo from search or social. Before interacting with metadata, histogram, bottom sheet, or full-screen lightbox, the device downloads/parses the code for all of those controls plus animation support, delaying interactivity on slower CPUs.
- **Fix:** Split optional controls with `next/dynamic`/`React.lazy`: load `Lightbox` when opened, `Histogram` when the info panel becomes visible, and `InfoBottomSheet` only on mobile. Run `next build` with bundle analysis to verify the chunk reduction.

### PERF-C1-11 — Mobile photo swipe updates React state on every `touchmove`

- **Severity:** Low
- **Confidence:** Medium
- **Evidence:**
  - `apps/web/src/components/photo-navigation.tsx:80-92` computes swipe offset and calls `setSwipeOffset` for each move.
  - `apps/web/src/components/photo-navigation.tsx:130-132` attaches a window-level `touchmove` listener with `{ passive: false }`.
  - `apps/web/src/components/photo-navigation.tsx:141-205` derives indicator styles from that state.
- **Why this is likely, not fully confirmed:** It requires device/browser profiling to quantify jank. The code path is still a classic high-frequency input-to-React-render loop.
- **Concrete failure scenario:** On lower-end phones, swiping between photos triggers React renders for every touchmove while the photo page also contains large images and controls. Frames can drop and scroll/swipe can feel sticky, especially when the browser must honor a non-passive touchmove listener.
- **Fix:** Use a ref plus `requestAnimationFrame` to update the indicator transform/opacity imperatively at most once per frame, or throttle state updates. Scope the listener to the viewer surface instead of `window` and only call `preventDefault` after horizontal-swipe intent is established.

## Additional observations and non-findings

- **No confirmed app-level N+1 query bug found.** The shared group path fetches tags in one batched query (`apps/web/src/lib/data.ts:632-655`), and single-photo detail fetches tags/prev/next in parallel (`apps/web/src/lib/data.ts:465-535`). Paginated gallery cards use scalar tag aggregation per displayed row (`apps/web/src/lib/data.ts:371-375`), which is bounded by page size but should still be watched if page size increases.
- **Image serving is mostly offloaded correctly in production.** Nginx serves derivative uploads directly with immutable caching (`apps/web/nginx/default.conf:89-105`), while the Next upload route streams files with cache headers (`apps/web/src/lib/serve-upload.ts:91-101`) for environments without nginx.
- **Several resource guards are already present.** Uploads enforce admin/auth/origin checks (`apps/web/src/app/actions/images.ts:83-90`), per-file image size is capped at 200 MB (`apps/web/src/lib/process-image.ts:224-227`), upload bodies are capped by configuration (`apps/web/src/lib/upload-limits.ts:1-22`), view-count buffering has capacity/backoff (`apps/web/src/lib/data.ts:11-96`), and bulk delete caps request size at 100 IDs (`apps/web/src/app/actions/images.ts:450-452`).
- **DB restore/dump paths mostly stream large files.** Restore uploads are piped to disk and then to mysql (`apps/web/src/app/[locale]/admin/db-actions.ts:328-337`, `apps/web/src/app/[locale]/admin/db-actions.ts:413-470`), avoiding the CSV export's string-materialization issue.

## Final missed-issues sweep result

After the inventory pass and targeted review, I re-swept for dynamic/cache directives, revalidation, expensive query shapes, unbounded `Promise.all`, queue/concurrency settings, Sharp calls, large upload limits, filesystem scans, and streaming behavior. No additional high-confidence performance issues surfaced beyond the findings above.
