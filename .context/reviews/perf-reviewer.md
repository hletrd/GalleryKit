# Performance Review - Cycle 5

Reviewer: perf-reviewer  
Scope: current HEAD `79c698eb877e563cd46331c8cd92fc29ed970874`  
Mode: static performance/concurrency review; application source left untouched.

## Review Inventory

Read first:
- `AGENTS.md` instructions supplied in the task
- `CLAUDE.md`

Stale-duplicate check:
- `.context/reviews/perf-reviewer.md` previous cycle before replacement
- `.context/reviews/run9-cycle8/perf-reviewer.md`
- Recent review history under `.context/reviews/`

Performance/concurrency surfaces inventoried and reviewed:
- DB/schema/pool: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/drizzle/*.sql`, Drizzle metadata
- Data access: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/smart-collections.ts`
- Public pages/routes: home/topic/smart-collection/photo/shared/timeline/year/map pages, `api/search/semantic`, `api/search/similar`, OG routes, health/live routes
- Server actions: `apps/web/src/app/actions/public.ts`, `images.ts`, `embeddings.ts`, settings/backfill/admin mutation surfaces
- Image pipeline and queues: `apps/web/src/lib/image-queue.ts`, `process-image.ts`, `admin-backfill-runner.ts`, `process-topic-image.ts`, `gps-exif-strip.ts`
- CLIP/search: `clip-model.ts`, `clip-embeddings.ts`, `clip-inference.ts`, semantic/similar routes, embedding backfill action/script
- Client/UI hot paths: `home-client.tsx`, `search.tsx`, `similar-photos.tsx`, `lightbox.tsx`, `photo-viewer.tsx`, `image-manager.tsx`, `map/map-client.tsx`, upload/dropzone components
- Cache/PWA/serving: `next.config.ts`, `serve-upload.ts`, `sw-cache.ts`, `public/sw.js`, `public/sw.template.js`, service-worker registration
- Admin pages: dashboard, analytics, settings, DB backup/restore, tags/categories/tokens/users pages

## Findings

### PERF-C5-01 - Timeline and On-This-Day still use non-sargable date functions on dynamic public renders

Severity: Medium  
Confidence: High  
Status: confirmed

Code regions:
- `apps/web/src/lib/data-timeline.ts:97-116`
- `apps/web/src/lib/data-timeline.ts:129-141`
- `apps/web/src/lib/data-timeline.ts:186-207`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:14-82`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:15-82`
- `apps/web/src/components/on-this-day-widget.tsx:14-23`
- `apps/web/src/db/schema.ts:111-117`

Problem:
`getOnThisDayImages` filters with `MONTH(capture_date)` and `DAY(capture_date)`, `getTimelineYears` selects/orders `YEAR(capture_date)`, and `getTimelineImages` filters with `YEAR(capture_date)` plus optional `MONTH(capture_date)`. These expressions prevent tight range use of the existing `(processed, capture_date, created_at)` index beyond the `processed=true` prefix. The pages are `revalidate = 0`, and the home page renders `OnThisDayWidget`, so the scan cost is paid during live public requests.

Failure scenario:
On a larger gallery, crawler or visitor traffic to `/timeline`, `/year/:year`, and the home page repeatedly scans the processed image set and applies date functions row-by-row before grouping, sorting, or limiting. DB CPU and buffer-pool pressure grow with total processed photos, not the visible page size.

Concrete fix:
Rewrite year/month filtering to sargable ranges where possible: `capture_date >= 'YYYY-01-01' AND capture_date < 'YYYY+1-01-01'`, and similarly for month ranges inside a selected year. For anniversary lookup and distinct-year navigation, add generated columns such as `capture_year`, `capture_month`, `capture_day` with matching indexes, or maintain a small derived timeline table. Update tests/comments that currently preserve the function-predicate shape.

### PERF-C5-02 - Public map fetches and renders up to 10,000 markers with no map/GPS-specific access path or clustering

Severity: Medium  
Confidence: High  
Status: confirmed

Code regions:
- `apps/web/src/lib/data.ts:1642-1678`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:8-60`
- `apps/web/src/components/map/map-client.tsx:76-143`
- `apps/web/src/db/schema.ts:4-12`
- `apps/web/src/db/schema.ts:111-117`
- `apps/web/drizzle/0005_topics_map_visible.sql:2-8`

Problem:
`getMapImages` joins `images` to `topics`, filters `processed=true`, `topics.map_visible=true`, and non-null latitude/longitude, then orders by capture/created/id and returns `MAP_MAX_MARKERS = 10000`. The schema has listing/topic indexes, but no index on `topics.map_visible` and no image access path for GPS-present public map rows. The page is dynamic, serializes all returned marker data into the initial payload, then the client computes lat/lng arrays and renders one Leaflet `<Marker>` per row.

Failure scenario:
If many public photos are geotagged, each `/map` request performs a broad DB scan/sort and ships a large marker payload. On phones or older laptops, parsing thousands of markers, computing bounds, and mounting thousands of Leaflet markers can stall the main thread. The DB pays this cost on every request because the route has `revalidate = 0`.

Concrete fix:
Add a map-specific DB access path and reduce client cardinality. Options include indexing `topics.map_visible`, adding a generated/denormalized `has_gps` or public-map eligibility field on `images`, and indexing `(processed, has_gps, capture_date, created_at)` or a denormalized `(map_visible, processed, capture_date, created_at)` path if topic visibility remains part of the hot predicate. On the UI side, switch to bounds/tile-based fetching or marker clustering with a hard per-viewport cap instead of initial all-marker render.

### PERF-C5-03 - Production CLIP embedding runs outside the image queue's backpressure and shutdown accounting

Severity: Medium  
Confidence: High  
Status: confirmed

Code regions:
- `apps/web/src/lib/image-queue.ts:204-212`
- `apps/web/src/lib/image-queue.ts:470-488`
- `apps/web/src/lib/image-queue.ts:490-567`
- `apps/web/src/lib/clip-model.ts:151-199`

Problem:
The image processing queue is explicitly bounded by `PQueue({ concurrency: Number(process.env.QUEUE_CONCURRENCY) || 1 })`. After derivatives are written and the row is marked processed, both caption and embedding hooks are launched via detached `void (async () => ...)()` IIFEs. In production semantic mode, the embedding hook calls `embedImageReal`, which performs a Sharp decode/resize/raw buffer extraction, allocates a `Float32Array` for CHW pixels, and runs ONNX inference. Because this work is detached, a completed queue job immediately frees the queue slot while CPU/memory-heavy embedding continues unbounded relative to queue concurrency and is not drained by queue shutdown.

Failure scenario:
During a batch upload with production semantic search enabled, the queue processes images one at a time, but each completed image can leave a real embedding task running in the background. Multiple Sharp 512x512 raw conversions and model invocations can overlap with later derivative jobs and public requests in the same Node process, causing CPU saturation, heap pressure, and slower user-facing responses. On shutdown or restore quiesce, detached embeddings can also be abandoned after image processing is considered complete.

Concrete fix:
Move embeddings into a bounded execution path. A dedicated `PQueue` with explicit `EMBEDDING_CONCURRENCY`, metrics, and shutdown drain is the least invasive fix. A more durable fix is a DB-backed embedding job table processed by the sidecar/backfill worker. If embeddings must stay coupled to uploads, await them inside the existing processing queue after derivative generation so `QUEUE_CONCURRENCY` remains the true upper bound.

### PERF-C5-04 - Semantic and similar search can decode/rank up to 1,000,000 vectors synchronously in public API handlers

Severity: Medium  
Confidence: High  
Status: confirmed

Code regions:
- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/lib/clip-embeddings.ts:104-152`
- `apps/web/src/lib/clip-embeddings.ts:164-166`
- `apps/web/src/__tests__/clip-semantic-limits-env.test.ts:75-85`
- `apps/web/src/app/api/search/semantic/route.ts:240-281`
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`
- `apps/web/src/db/schema.ts:271-285`

Problem:
`SEMANTIC_SCAN_LIMIT` defaults to 2,000, but the env parser clamps it as high as `1_000_000`, and tests explicitly pin that ceiling. Both public routes select up to that many MEDIUMBLOB embeddings, decode every vector into a new `Float32Array`, score each row, then call `topK`. The helper name suggests bounded work, but it filters and sorts the full match set before slicing. The `(model_version, updated_at)` index bounds recency selection; it does not reduce request-path vector decode/scoring/ranking CPU.

Failure scenario:
An operator increases `SEMANTIC_SCAN_LIMIT` to improve recall on a larger library. Each semantic or similar request can pull hundreds of MB to GB of vector data, allocate one `Float32Array` per decoded embedding, run up to 512 multiplications per vector, and sort all above-threshold matches in the Next.js API process. Concurrent requests can exhaust CPU and heap on the same single web instance that serves public pages.

Concrete fix:
Keep the default modest but lower the hard ceiling for the in-process route, or require an explicit unsafe override with warnings. Replace full-array sorting with a bounded min-heap top-K implementation. Add latency/scanned-row metrics and reject or degrade when a scan exceeds a budget. For larger galleries, move similarity to an ANN/vector index or a precomputed candidate table instead of brute-force scans in the public API handler.

### PERF-C5-05 - Admin dashboard loads every permanently failed image without a limit or matching index

Severity: Low  
Confidence: High  
Status: confirmed

Code regions:
- `apps/web/src/lib/data.ts:993-1008`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:71-100`
- `apps/web/src/db/schema.ts:108-117`

Problem:
`getFailedImages` selects all rows where `processed=false` and `processing_error IS NOT NULL`, orders by `failed_at DESC`, and applies no limit. The dashboard calls it in parallel with normal paginated image data and passes the entire array to the client, which maps every failed row. The schema has listing indexes on `processed/capture_date`, `processed/created_at`, and topic/uploader fields, but no index matching `(processed, processing_error, failed_at)` or even `(processed, failed_at)` for this admin error panel.

Failure scenario:
A corrupt import, misconfigured original store, or bad batch upload leaves hundreds or thousands of failed rows. Every admin dashboard load scans/sorts the failed subset and hydrates the whole failure list into the client, making the page slow exactly when the admin needs recovery controls.

Concrete fix:
Paginate or cap failed rows, for example latest 50 with a "view all failures" page. Add an index such as `(processed, failed_at)` or a generated boolean `has_processing_error` with `(processed, has_processing_error, failed_at)` if this panel remains on the dashboard. Keep the retry action row-scoped.

## Missed-Issues Sweep

After drafting findings, I re-swept:
- DB indexes and migrations for map, timeline, failed-image, embedding, analytics, and backfill access paths.
- Public dynamic pages and API routes for cache settings, unbounded result sets, and request-path CPU.
- Image processing: Sharp concurrency is globally bounded, cache is disabled, `limitInputPixels` is passed, wide-gamut sources have a pixel cap, and queue bootstrap is batched.
- CLIP paths: sidecar and admin embedding backfills use bounded concurrency; the live upload hook and public scan/rank routes are the remaining risks.
- Service worker and upload serving: image cache is capped, HTML cache is capped, HEAD revalidation has a 300 ms timeout, and no new service-worker finding was found.
- Sync filesystem I/O under `apps/web/src` excluding tests: no request-path `readFileSync`/`writeFileSync`/`statSync`/similar hits.
- Prior stale items: smart-collection cursor load-more no longer computes `COUNT(*) OVER()` in current HEAD, so I did not refile it.

## Skipped Files Statement

No performance-relevant application, route, queue, image-processing, CLIP/search, service-worker, schema/migration, admin dashboard, or performance-contract test surface identified by the inventory was intentionally skipped. I did not inspect binary/image assets because they do not affect executable performance behavior in current HEAD.

## Validation

This was a static review. I did not run lint, typecheck, tests, build, or deploy because the task requested a HEAD review and no source-code changes. Validation evidence is direct source inspection with exact file/line regions above, plus targeted repository searches for indexes, cache settings, sync I/O, queues, Sharp usage, and vector scan limits.
