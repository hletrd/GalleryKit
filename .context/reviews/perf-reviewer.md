# Cycle 21 Performance / Concurrency / Responsiveness Review

Role lane: perf-reviewer
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `45b32d1db373e03d82a29511f53832051c770880`
Write scope: `.context/reviews/perf-reviewer.md`

## Method

Read first, per instruction: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`.

Built a repository-wide performance inventory from tracked files and then reviewed the relevant cross-file behavior. Generated build output and binary fixtures/public uploaded derivatives were excluded as non-source artifacts. This is a static review; I did not run production profiling, DB `EXPLAIN ANALYZE`, or browser traces.

## Performance-Relevant Inventory

- Image processing: `apps/web/src/lib/process-image.ts`, `process-topic-image.ts`, `color-detection.ts`, `gain-map-detection.ts`, `gps-exif-strip.ts`, `icc-*`, `blur-data-url.ts`, `upload-paths.ts`, `serve-upload.ts`, image/color backfill scripts.
- Queues and concurrency: `image-queue.ts`, `admin-backfill-runner.ts`, `queue-shutdown.ts`, `background-db-writes.ts`, `maintenance-scheduler.ts`, `admin-mutation-barrier.ts`, restore/advisory-lock helpers, `instrumentation.ts`.
- DB queries and schema: `src/db/index.ts`, `src/db/schema.ts`, `lib/data.ts`, `data-timeline.ts`, `analytics-data.ts`, `rate-limit.ts`, `smart-collections.ts`, `sql-like.ts`, `clip-embeddings.ts`.
- Routes: public pages under `app/[locale]/(public)/**`, admin pages under `app/[locale]/admin/**`, API routes under `app/api/**`, upload serving routes, sitemap/feed/robots/manifest/icon handlers.
- Server actions: `app/actions/*.ts`, `app/[locale]/admin/db-actions.ts`, auth/admin/share/settings/image/topic/tag/collection/public actions.
- React components: gallery grid, search, map, lightbox, photo viewer, histogram, upload dropzone, load-more, admin dashboard/settings/tag/topic/user/token components, UI primitives touched by interaction latency.
- Service worker/cache: `public/sw.template.js`, generated `public/sw.js`, `lib/sw-cache.ts`, `scripts/build-sw.ts`, derivative cache headers in `next.config.ts`, upload serving route.
- Tests and source contracts: perf/concurrency-relevant Vitest and E2E surfaces including queue/backfill cap tests, semantic scan tests, upload limit tests, SW contract tests, map tests, timeline tests, touch-target and client lifecycle tests.
- Deploy/runtime/migrations: `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `next.config.ts`, `scripts/migrate.js`, Drizzle SQL migrations and journal metadata.

## Findings

### C21-PERF-01 - Independent image queue and admin backfill budgets can still oversubscribe the shared DB/CPU pool

Severity: High
Confidence: High

File/region: `apps/web/src/db/index.ts:21-41`; `apps/web/src/lib/image-queue.ts:121-153`, `746-883`; `apps/web/src/lib/admin-backfill-runner.ts:130-143`, `520-565`, `716-727`, `749-820`; `apps/web/src/lib/process-image.ts:36-57`, `1205-1418`.

The image queue and in-app admin backfill each compute a safe concurrency cap against the same `POOL_CONNECTION_LIMIT=10`, but the caps are independent. At the default pool, the image queue can run two workers and the admin backfill can run two workers at the same time. Backfill also holds a whole-run advisory-lock connection; each worker can hold a per-image advisory lock plus transient DB work; every image encode then fans out WebP, AVIF, and JPEG generation in parallel through Sharp.

Concrete failure scenario: uploads are being processed while an admin starts a color/format backfill. The two lanes together can pin most of the 10-connection pool and oversubscribe native encoding work. Dynamic public pages, search, analytics writes, semantic routes, and admin actions then queue behind background maintenance, producing request latency spikes or pool timeouts even though each lane looks locally bounded.

Suggested fix: introduce one process-wide background resource budget shared by foreground image processing, admin backfill, embedding bootstrap, and side effects. Acquire tokens before advisory locks and Sharp encoding. Alternatively, make admin backfill observe/pause/refuse while the image queue is active, or reduce its cap by active queue workers. Add a test that combined queue plus backfill concurrency cannot exceed the shared DB/CPU budget.

### C21-PERF-02 - Browser upload Server Actions can materialize large multipart bodies before app-level backpressure exists

Severity: Medium
Confidence: High

File/region: `apps/web/src/lib/upload-limits.ts:1-6`, `19-35`; `apps/web/next.config.ts:111-119`; `apps/web/src/app/actions/images.ts:140-148`, `239-263`, `367-379`; `apps/web/src/lib/process-image.ts:864-888`; contrast with the Lightroom route parse gate at `apps/web/src/app/api/admin/lr/upload/route.ts:60-74`, `152-187`.

The browser upload path is a Server Action. By the time `uploadImages()` runs and calls `formData.getAll('files')`, the framework has already parsed and materialized the multipart body as `File` objects. The application then streams each `File` to disk without an extra full-size heap copy, but only after the framework parse. Limits allow a 200 MiB file and a Server Action body cap of roughly 266 MiB by default. The client uploads files sequentially, which helps one browser session, but there is no equivalent process-wide parse slot for browser uploads. The Lightroom API route has such a slot before `request.formData()`, so this gap is specific to the browser Server Action path.

Concrete failure scenario: two or more admins, tabs, or retries submit near-200 MiB browser uploads concurrently. The Node process can hold multiple parsed multipart bodies in memory before app code reaches quota checks, disk checks, or the upload-processing contract lock. On a small deploy host, that can cause high RSS, GC stalls, or OOM before the safer disk-streaming path begins.

Suggested fix: move browser uploads to a route handler with streaming multipart parsing and a process-wide byte/parse semaphore, similar to the Lightroom route but with true disk spooling. Short-term, lower `NEXT_UPLOAD_BODY_MAX_BYTES`, add an app-level one-in-flight browser upload admission endpoint before selecting/sending files, or document and enforce a reverse-proxy/client-body concurrency cap.

### C21-PERF-03 - Public map can ship and hydrate 10,000 markers plus 10,000 fallback list links

Severity: Medium
Confidence: High

File/region: `apps/web/src/lib/data.ts:1766-1817`; `apps/web/src/db/schema.ts:49-50`, `123-131`; `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `89-110`; `apps/web/src/components/map/map-client.tsx:77-94`, `108-140`.

`getMapImages()` caps the query at `MAP_MAX_MARKERS + 1`, where `MAP_MAX_MARKERS` is 10,000. The page serializes all returned markers to the client, renders all of them into `MapLoader`, and also SSR-renders an accessible `<ul>` entry for every marker. The client then computes bounds with arrays/spreads over all markers and renders one Leaflet `<Marker>` per item. The schema has no latitude/longitude or `map_visible`-specific image index; the current image indexes are general listing indexes.

Concrete failure scenario: a map-visible topic grows to thousands of GPS-tagged photos. A public `/map` request performs a large dynamic DB query, returns a large RSC/HTML payload, creates thousands of DOM fallback links, hydrates thousands of marker objects, and blocks the browser main thread during Leaflet marker creation and bounds fitting. Mobile devices will show slow first interaction and map jank before the truncation notice helps.

Suggested fix: lower the initial marker cap substantially and serve map data by viewport/bbox or tile endpoint. Add clustering/supercluster or server-side aggregation, and virtualize or paginate the accessible photo list. Add an index that matches the public map filter/order if the full-map endpoint remains, then verify with `EXPLAIN ANALYZE`.

### C21-PERF-04 - Home page on-this-day widget runs a non-sargable date scan on every dynamic home render

Severity: Medium
Confidence: High

File/region: `apps/web/src/components/on-this-day-widget.tsx:10-22`; `apps/web/src/app/[locale]/(public)/page.tsx:232-235`; `apps/web/src/lib/data-timeline.ts:102-130`; `apps/web/src/db/schema.ts:123-131`.

The home page renders `OnThisDayWidget`, which calls `getOnThisDayImages()`. That query filters with `MONTH(images.capture_date)` and `DAY(images.capture_date)`. The source comment correctly notes this is not sargable; the existing `processed, capture_date, created_at` index cannot be used to seek a specific month/day. Because the public home page is dynamic, this scan is paid on every home render.

Concrete failure scenario: the gallery grows to tens of thousands of dated photos and the home page receives crawler or normal visitor traffic. Each request scans processed dated rows, joins tags for aggregation, groups, orders, and then returns only six photos. The small result limit does not avoid the scan cost.

Suggested fix: add generated/stored `capture_month` and `capture_day` columns plus an index such as `(processed, capture_month, capture_day, capture_date, created_at, id)`, then migrate/backfill. An alternative is a daily cache/materialized table invalidated by image metadata changes. Keep the current query only as a fallback for old schemas.

### C21-PERF-05 - Public keyword search is bounded and rate-limited, but still uses leading-wildcard scans

Severity: Medium
Confidence: High

File/region: `apps/web/src/app/actions/public.ts:248-317`; `apps/web/src/lib/data.ts:1574-1655`, `1693-1737`; `apps/web/src/lib/smart-collections.ts:221-223`, `261-267`.

`searchImagesAction()` rate-limits and validates input, then `searchImages()` runs `%term%` predicates across title, description, camera/lens fields, topic slug/label, tags, and topic aliases. Return counts are capped, and tag/alias branches are skipped when the main branch fills the limit, but leading-wildcard predicates remain non-sargable. Smart collection `contains` predicates use the same helper and can create similar scans for public collections.

Concrete failure scenario: broad two-character terms or common substrings are searched repeatedly from one or more IPs. Accepted requests can scan large portions of `images`, `topics`, `tags`, and `image_tags`, then group/order/limit rows. That DB work competes with dynamic SSR and background processing on the single web instance.

Suggested fix: move public text search to an indexed search surface: MySQL FULLTEXT/ngram where appropriate, a materialized token table, or a separate search index. Short-term, raise minimum keyword length for keyword mode, add a short TTL cache for hot queries, and use MySQL statement timeouts or `MAX_EXECUTION_TIME` on search branches. For public smart collections, reject or warn on expensive `contains` predicates at save time unless membership is materialized.

### C21-PERF-06 - Semantic and similar-photo routes score embedding scans synchronously in the Node request path

Severity: Low
Confidence: High

File/region: `apps/web/src/lib/clip-embeddings.ts:36-48`, `80-87`, `188-205`, `217-235`; `apps/web/src/db/schema.ts:292-304`; `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:178-214`.

The CLIP routes are deliberately bounded by `SEMANTIC_SCAN_LIMIT` and indexed by `model_version, updated_at`, so this is not unbounded. The remaining design is a per-request brute-force scan: load up to the configured cap of embedding blobs from MySQL, decode them in JS, compute dot products synchronously, then run local top-k selection. The hard cap is 25,000 vectors; even the default 2,000 vectors is CPU and heap work inside the same Node process that serves SSR and runs Sharp.

Concrete failure scenario: production semantic search is enabled while users open search/similar panels during upload or backfill activity. Multiple accepted requests can consume DB bandwidth, heap for decoded vectors, and event-loop CPU for scoring, delaying unrelated route handlers and timers.

Suggested fix: add a process-wide semantic scoring semaphore and record scan-count/latency telemetry. For larger galleries, replace request-local scoring with a vector index, an ANN library/service, or a process-owned preloaded matrix with explicit refresh invalidation. If the brute-force path remains, chunk scoring with periodic yielding or move it to a worker thread.

## Mitigated Areas Reviewed

- Service worker and derivative serving: `sw.template.js`, `sw.js`, `sw-cache.ts`, and `serve-upload.ts` include image cache byte caps, HTML entry caps, ETag/HEAD handling, abort cleanup, and versioned cache names. I did not find a new cache invalidation issue there.
- Image encode internals: Sharp global concurrency and cache disabling are present; processing uses path-based Sharp reads, input-pixel caps, atomic writes, temp cleanup, and deleted-mid-reencode cleanup. The unresolved risk is combined cross-lane budgeting, not missing per-image safeguards.
- Client cleanup: search aborts stale semantic fetches; load-more guards stale/unmounted state; histogram uses a worker and terminates it; upload previews revoke object URLs; lightbox/viewer listeners and timers clean up.
- Restore/backup lifecycle: restore drains queue/background writes, uses advisory locks, streams backups/restores, scans SQL chunks, and has watchdogs. No new performance/concurrency finding beyond shared background budget pressure.
- Public expensive routes: OG routes, semantic routes, search/load-more, feed/share, and upload serving have either rate limits, no-store/cache controls, or explicit exemptions with bounded behavior.

## Final Sweep

Relevant source categories requested by the task were inspected: image processing, queues, DB queries, routes, server actions, React components, service worker, tests/source contracts, deploy scripts, and migrations.

Not inspected as source: binary image/font fixtures, tracked generated uploaded derivatives, and runtime production state. I did not execute profiling, tests, browser traces, or DB query plans; those are the main remaining validation gaps.

Findings: 6 total.
