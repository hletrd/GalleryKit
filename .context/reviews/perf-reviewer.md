# Cycle 33 Performance Review

Scope: current workspace in `/Users/hletrd/flash-shared/gallery`. Product code was not edited.

## Inventory

- Project guidance read first: `AGENTS.md`, `CLAUDE.md`.
- Runtime, queueing, and concurrency paths: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/instrumentation.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/backfill-color-pipeline.ts`.
- Image and upload pipeline: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Public rendering and cache behavior: public pages under `apps/web/src/app/[locale]/(public)/`, API routes under `apps/web/src/app/api/`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/public/sw.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/src/lib/og-photo-fetch.ts`.
- Database query surfaces: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/tag-records.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/**`.
- UI responsiveness surfaces: `apps/web/src/components/home-client.tsx`, `apps/web/src/components/grid-picture.tsx`, `apps/web/src/components/grid-picture-fallback-boundary.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/image-zoom.tsx`, `apps/web/src/components/histogram.tsx`, `apps/web/src/components/map/*`, `apps/web/src/components/similar-photos.tsx`.
- Deployment/resource surfaces: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/entrypoint.sh`, `apps/web/nginx/default.conf`.
- Tests and contracts inspected where relevant: queue/backfill concurrency tests, upload contract tests, semantic route/rate-limit tests, `clip-model-contract.test.ts`, timeline truncation tests, smart-collection pagination tests, service-worker cache tests, touch-target audit.

## Findings

### HIGH - PAT upload route materializes full multipart bodies before serialization or disk streaming

- Location: `apps/web/src/app/api/admin/lr/upload/route.ts:153-167`, `apps/web/src/app/api/admin/lr/upload/route.ts:252-259`, `apps/web/src/app/api/admin/lr/upload/route.ts:307-310`.
- Shared helper only streams after the `File` object already exists: `apps/web/src/lib/process-image.ts:905-914`.
- Edge/container envelope: `apps/web/nginx/default.conf:124-145`, `apps/web/docker-compose.yml:12-28`.
- Severity: High.
- Confidence: High.

The Lightroom/PAT upload route calls `await request.formData()` before it validates the parsed file size, before it acquires the upload-processing contract lock, and before it reaches the streaming `saveOriginalAndGetMetadata()` helper. That means the route can materialize a complete multipart body in the Next.js process for every concurrent request. The edge explicitly permits this route to receive 216 MiB bodies and allows an admin burst of 10 (`nginx/default.conf:133-136`), while the compose file does not set a container memory limit (`docker-compose.yml:12-28`).

Concrete production scenario: a legitimate LR client retries several 200 MiB exports, or a compromised PAT sends parallel near-limit uploads. Ten admitted requests can pin roughly 2 GiB of multipart body/file data before application-level serialization starts. The advisory upload contract lock at `route.ts:252-259` then serializes only the save/insert/enqueue window; it does not protect the process from pre-lock body buffering. On the disk-constrained single-host deployment this can drive GC stalls or an OOM restart, interrupt background image/embedding work, and temporarily take down the public gallery.

Suggested fixes:

- Replace `request.formData()` with a streaming multipart parser that validates fields and streams the file directly to a temp/original path under the existing byte caps.
- Acquire a lightweight upload body semaphore, or the same upload-processing contract if acceptable, before any large body parse so excess LR uploads fail or wait before memory allocation.
- Tighten route-specific `limit_req`/connection limits for `/api/admin/lr/upload` if streaming cannot land immediately, and consider a container memory limit so failure is bounded and observable.

### MEDIUM - Initial public listing renders still pay a full grouped window count

- Query shape: `apps/web/src/lib/data.ts:898-927`, `apps/web/src/lib/data.ts:1466-1481`.
- Dynamic callers: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/page.tsx:175-178`; `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:20`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:185-188`; `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:110-112`.
- UI use of the exact count: `apps/web/src/app/[locale]/(public)/page.tsx:232-234`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:225`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:152-159`.
- Severity: Medium.
- Confidence: High.

The home, topic, and smart-collection first pages are all dynamic (`revalidate = 0`). Their initial card queries left-join tags, group by image, sort, and add `COUNT(*) OVER()` before applying `LIMIT pageSize + 1`. In MySQL, that window count is evaluated over the grouped result, so a request that displays 30 cards still counts and aggregates the full matching gallery. The cursor path for smart collections avoids this cost after the first page (`data.ts:1447-1464`), but the public landing path still pays it.

Concrete production scenario: after the gallery grows to tens of thousands of processed photos and tags, every anonymous home hit runs a grouped full-gallery count even when the browser only needs 31 rows for `hasMore`. Topic and collection pages multiply the same shape. Smart collections are riskier because their compiled predicates can include `%LIKE%` text conditions on EXIF/text fields, so the count can become the dominant DB cost under crawler traffic or a cold CDN.

Suggested fixes:

- Make first-page listing queries match the cursor path: fetch `pageSize + 1`, derive `hasMore`, and omit exact `totalCount` from the critical SSR query.
- If the UI still needs totals, compute them in a separate cached path with invalidation on upload/delete/tag changes, or use a narrow count that avoids tag joins when no tag predicate requires them.
- For smart collections, avoid exact public counts for dynamic predicates unless the collection is materialized or the predicate is known index-friendly.

### LOW - Timeline and On This Day queries remain non-sargable on dynamic pages

- Query shape: `apps/web/src/lib/data-timeline.ts:97-117`, `apps/web/src/lib/data-timeline.ts:129-145`, `apps/web/src/lib/data-timeline.ts:186-207`.
- Dynamic callers: `apps/web/src/app/[locale]/(public)/page.tsx:232-234`, `apps/web/src/components/on-this-day-widget.tsx:15-22`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-94`.
- Related index envelope: `apps/web/src/db/schema.ts:115-121`.
- Severity: Low.
- Confidence: High.

The code comments correctly call out the scale tradeoff, but this remains a real DB CPU limit. `getOnThisDayImages()` filters with `MONTH(capture_date)` and `DAY(capture_date)`, while `getTimelineYears()` and `getTimelineImages()` use `YEAR(capture_date)` and optional `MONTH(capture_date)`. These functions prevent the existing processed/capture-date index from narrowing by date range. The home page includes On This Day in the same dynamic render pass, and `/timeline` does the year list plus selected-year image query on every request.

Concrete production scenario: once the processed image table grows much larger than the current personal-gallery envelope, each home render scans the processed image prefix to find at most six On This Day rows. Timeline requests scan that prefix to derive years and again to fetch the selected year. This will become DB CPU work before the keyset listing paths do.

Suggested fixes:

- Add generated/stored `capture_year`, `capture_month`, and `capture_day` columns with composite indexes that include `processed`.
- Rewrite year pages to date ranges, for example `capture_date >= '2024-01-01' AND capture_date < '2025-01-01'`.
- Keep the current comments, but promote the generated-column migration into the scale plan before larger public imports.

### LOW - GPS stripping reads the full original into memory after upload

- Location: `apps/web/src/lib/process-image.ts:1737-1816`.
- Browser caller: `apps/web/src/app/actions/images.ts:402-416`.
- PAT caller: `apps/web/src/app/api/admin/lr/upload/route.ts:367-385`.
- Streaming save path it follows: `apps/web/src/lib/process-image.ts:905-914`.
- Severity: Low.
- Confidence: High.

The upload path streams the original file to disk, but if `strip_gps_on_upload` is enabled, `stripGpsFromOriginal()` immediately reads the entire saved file with `fs.readFile(filePath)`. For lossless scrubs it may then hold a second output buffer before writing the temp file. This is sequential on the browser path and one file per PAT request, so it is not as dangerous as the multipart buffering issue, but it defeats the memory advantage of the streaming save for the privacy-enabled branch.

Concrete production scenario: an admin enables GPS stripping and uploads near-limit 200 MiB JPEG/HEIC exports while background Sharp/CLIP work is active. Each upload can add a large JS buffer, plus any scrubbed output buffer and native Sharp memory for fallback re-encode, increasing RSS spikes and GC pressure on the single web container.

Suggested fixes:

- Move lossless GPS stripping to a streaming or file-descriptor/range-based implementation where possible, writing to a temp file without retaining the whole original.
- For formats that still require whole-buffer parsing, enforce a smaller privacy-mode upload cap or explicit single-flight semaphore around GPS stripping.
- Treat malformed HEIC/unsupported fallback cases as early validation failures before expensive work when possible.

### LOW - Grid JPEG fallback can download the base JPEG instead of a sized derivative

- Component: `apps/web/src/components/grid-picture.tsx:30-50`.
- Home caller: `apps/web/src/components/home-client.tsx:334-361`.
- Timeline caller: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:253-274`.
- Error fallback: `apps/web/src/components/grid-picture-fallback-boundary.tsx:14-26`.
- Severity: Low.
- Confidence: Medium.

The masonry grid emits AVIF and WebP `srcSet`s for the two smallest configured sizes, but the `<img src>` fallback is the base JPEG. The error boundary also removes failed `<source>` elements and leaves that same fallback. If a browser skips the typed sources or a row has missing AVIF/WebP derivatives during a backfill edge case, an above-the-fold tile can eagerly fetch the large base JPEG.

Concrete production scenario: a legacy or constrained browser lands on the home or timeline page. The first grid items use eager loading and high fetch priority, but the fallback path points to `/uploads/jpeg/${filename_jpeg}` rather than a small/medium JPEG derivative. A multi-megabyte JPEG can become LCP-critical for what should be a masonry thumbnail.

Suggested fixes:

- Add a JPEG `srcSet` using the same small and medium configured sizes.
- Set the fallback `src` to the nearest small JPEG derivative for processed rows, keeping the base JPEG only as the final error fallback.
- Keep the current AVIF/WebP ordering, but make the last-resort path thumbnail-sized for normal processed images.

## Final Sweep

- Rechecked the previous CLIP slot-leak finding. The current `apps/web/src/lib/clip-model.ts:156-172` moves ownership into a `try/finally` path after acquisition, so I did not carry that issue forward.
- Image queue, admin backfill, restore, and shutdown paths have bounded PQueue admission, DB pool-budget caps, advisory locks, bootstrap/retry maps, side-effect tracking, and cleanup on delete-mid-processing. No additional high-confidence queueing defect met the reporting bar.
- Semantic and similar-photo search have request body caps, same-origin/rate-limit checks, production model gates, scan caps, abort handling, and bounded enrichment. The remaining cost is explicit through `SEMANTIC_SCAN_LIMIT`, not an unbounded path.
- Upload serving, service-worker caching, Next headers, and nginx upload cache paths were checked. The main deployment resource issue is the LR route's pre-streaming body materialization under a large route body cap.
- Client search, load-more, masonry, lightbox/zoom, histogram, map, and similar-photo UI paths were checked for runaway effects, unbounded timers, expensive synchronous work, and layout responsiveness. The only UI/network issue reported is the grid JPEG fallback path.
