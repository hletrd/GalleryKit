# Cycle 30 Perf Reviewer Report

Review target: current HEAD `666b74f8704024bb1a1fa1faa02a8e34114e678c`
Review role: `perf-reviewer`
Mode: review-only. Product code was not changed.

## Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`

Current source inventory:

- `apps/web/src`: 518 TypeScript/JavaScript source files, 81,758 lines.
- Largest active files inspected: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, semantic search routes, service worker cache code, map UI, rate-limit code, deploy/runtime config.
- Runtime shape from `CLAUDE.md`: one web instance, process-local queues and maps, MySQL pool size 10, image queue default concurrency 1, service worker image cache cap 50 MB, public dynamic gallery pages use `revalidate = 0`.

Review sweeps covered:

- DB query shape: gallery listing, smart collections, keyword search, timeline, map, semantic search, feeds, analytics, rate-limit buckets.
- CPU/memory: Sharp fan-out, CLIP/embedding decode and scoring, service worker metadata, sidecar queues, map hydration, masonry load-more.
- Concurrency and async traces: image queue claims, backfill locks, upload/restore drains, background side effects, service worker read-modify-write paths.
- Bounded-map/rate-limit growth: in-memory maps, DB bucket purge, proxy/IP behavior.

## Confirmed Issues

### PERF30-01 - Service worker LRU metadata updates can lose entries under concurrent image fetches

Severity: Medium
Confidence: High
Status: Confirmed issue

Evidence:

- `apps/web/public/sw.template.js:100-130` implements `recordAndEvict()` as `getMeta() -> mutate Map -> setMeta(entries)`.
- `apps/web/public/sw.template.js:161-175` implements `touchMeta()` with the same whole-document read-modify-write pattern.
- `apps/web/public/sw.template.js:177-181` implements `deleteMeta()` with the same pattern.
- `apps/web/public/sw.template.js:203-217` calls `recordAndEvict()` from revalidating GETs.
- `apps/web/public/sw.template.js:258-262` calls `touchMeta()` asynchronously on the 304 HEAD path.

Failure scenario:

A warm masonry page paints many cached derivatives while several missing or stale images revalidate at the same time. Multiple service worker requests read the same `/__meta__` JSON blob, each mutates its local `Map`, and each writes the entire blob back. The last writer wins. Cache entries remain in `IMAGE_CACHE`, but their metadata entries can disappear, so the 50 MB LRU cap undercounts real cache bytes and future eviction cannot delete lost entries. The user sees browser quota churn, repeated cold fetches, and incorrect recency after busy gallery paints.

Suggested fix:

Serialize metadata mutations in the service worker with a process-global promise chain or mutex around `getMeta/mutate/setMeta`. A stronger fix is to store one metadata record per URL in IndexedDB or a cache entry that can be updated independently. Add a service-worker test that runs concurrent `recordAndEvict()` and `touchMeta()` calls against the same starting metadata and asserts no unrelated entry is lost.

### PERF30-02 - Color pipeline sidecar materializes all candidates and enqueues all tasks before draining

Severity: Medium
Confidence: High
Status: Confirmed issue

Evidence:

- `apps/web/scripts/backfill-color-pipeline.ts:343-360` selects every processed stale candidate into `rows` with no `LIMIT`.
- `apps/web/scripts/backfill-color-pipeline.ts:475-512` iterates all `rows`, adds one PQueue closure per row, then waits for `queue.onIdle()`.
- `apps/web/src/lib/admin-backfill-runner.ts:394-423` shows the safer in-app shape: keyset-paginated batches of 100 candidates.

Failure scenario:

After a pipeline version bump or with `--force-reencode`, a large gallery can have tens of thousands of processed candidates. The sidecar asks MySQL to materialize the full result and then stores the full row array plus one pending closure per image before the queue has drained. On a disk-constrained or memory-constrained deploy host, the script can inflate RSS, slow MySQL with a large initial result, or OOM before useful progress is committed.

Suggested fix:

Mirror the in-app runner: fetch `id > cursor ORDER BY id ASC LIMIT 100`, enqueue only that batch, drain it, flush DB updates, then fetch the next batch. Keep per-batch counters and update arrays local to the batch. If the script must preserve a start-of-run snapshot, stream IDs to a small temp table instead of keeping all candidates and closures in Node memory.

### PERF30-03 - Public map can serialize and hydrate up to 10,000 markers plus a 10,000-item fallback list

Severity: Medium
Confidence: High
Status: Confirmed issue

Evidence:

- `apps/web/src/lib/data.ts:1667-1685` returns up to `MAP_MAX_MARKERS` map rows.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:41-60` fetches all rows server-side and serializes every marker into client props.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:87-96` renders a normal list item for every marker.
- `apps/web/src/components/map/map-client.tsx:86-90` allocates latitude/longitude arrays and spreads them into `Math.min`/`Math.max`.
- `apps/web/src/components/map/map-client.tsx:119-140` renders one React Leaflet `Marker` and `Popup` subtree per marker.

Failure scenario:

An admin marks a large travel/archive topic as map-visible. A visitor opens `/map`; the server serializes thousands of markers, the browser hydrates thousands of Leaflet marker components and thousands of list items, and bounds fitting allocates and spreads two large arrays. Mid-range mobile browsers can freeze or become unresponsive even though the DB result is bounded.

Suggested fix:

Lower the initial client payload to a UI-safe count and load markers by viewport/bbox. Use clustering or a canvas/vector layer for map rendering, and virtualize or paginate the fallback list. Replace the spread-based bounds calculation with a single loop.

## Likely Issues

### PERF30-04 - Semantic search scan limits allow request-thread decode, score, and full sort costs to scale too high

Severity: Medium
Confidence: High
Status: Likely issue

Evidence:

- `apps/web/src/lib/clip-embeddings.ts:36-44` allows `SEMANTIC_SCAN_LIMIT` and `SEMANTIC_TOP_K_MAX` up to 25,000.
- `apps/web/src/app/api/search/semantic/route.ts:270-279` fetches up to that many embedding blobs for the active model.
- `apps/web/src/app/api/search/semantic/route.ts:301-311` decodes every embedding, computes every score, and then calls `topK()`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:164-201` repeats the same scan and score pattern for similar-image search.
- `apps/web/src/lib/clip-embeddings.ts:164-168` filters and sorts the full scored array before slicing.

Failure scenario:

Production semantic search is enabled and an operator raises `SEMANTIC_SCAN_LIMIT` for recall. Ten concurrent requests at the 25,000-row cap can fetch hundreds of MB of embedding blobs from MySQL, allocate many `Float32Array`s, compute millions of dot-product operations, and sort large arrays on the single Node event loop. Public SSR, server actions, queue callbacks, and admin requests can stall behind GC and CPU work even though the endpoint is rate-limited.

Suggested fix:

Keep the production cap lower until a different retrieval path exists. Replace full sort with a fixed-size min-heap. Chunk scoring and yield between batches, or move decode/scoring to worker threads or a sidecar. Long term, use an ANN/vector index so public requests retrieve only candidate IDs.

### PERF30-05 - Public exact counts remain on first-page listing and smart-collection queries

Severity: Medium
Confidence: High
Status: Likely issue

Evidence:

- `apps/web/src/lib/data.ts:878-907` adds `COUNT(*) OVER()` to the public listing query while also joining tags, grouping by image ID, ordering chronologically, and limiting to `pageSize + 1`.
- `apps/web/src/lib/data.ts:1417-1460` uses a cursor path for later smart-collection pages but keeps `COUNT(*) OVER()` on the initial/offset path.
- `apps/web/src/lib/data.ts:856-875` only needs `rows.length > pageSize` for `hasMore`; the exact `totalCount` is additional hot-path work.

Failure scenario:

The homepage, topic pages, or public smart-collection first pages receive crawler or visitor traffic. Each request returns about 30 visible cards but asks MySQL to compute an exact grouped total over every matching row. On galleries with many tags or broad smart collections, this turns the hottest unauthenticated page into a scan/count/sort workload.

Suggested fix:

Remove exact public totals from dynamic hot paths. Use `LIMIT pageSize + 1` for pagination and show "more" rather than exact counts, or read counts from a cached/materialized rollup updated by image/tag mutations. For smart collections, keep the cursor-safe query shape even on page 1 when possible.

### PERF30-06 - Public keyword and smart-collection contains predicates can force text scans

Severity: Medium
Confidence: Medium
Status: Likely issue

Evidence:

- `apps/web/src/lib/data.ts:1545-1563` searches title, description, camera, lens, topic slug, and topic label with `containsLike()`.
- `apps/web/src/lib/data.ts:1590-1621` falls back to tag and alias branches that also use `containsLike()` and run in parallel.
- `apps/web/src/lib/smart-collections.ts:221-223` compiles field `contains` predicates to `containsLike()`.
- `apps/web/src/lib/smart-collections.ts:261-267` compiles tag `contains` predicates through a subquery with `containsLike(tags.name, ...)`.

Failure scenario:

Common short search terms or admin-created public smart collections with broad `contains` predicates trigger leading-wildcard scans over image text columns, tags, and aliases. Per-IP budgets and page-size caps bound result volume, but they do not make the DB predicates sargable. Public requests can still spend CPU scanning and grouping rows.

Suggested fix:

Introduce a search-specific index: MySQL FULLTEXT where acceptable, an ngram table for Korean/partial search, or a normalized token table for tags/topics. Raise minimum lengths for contains search, prefer exact/prefix matching for tag and alias branches, and add EXPLAIN-based guardrails for public smart collections before publishing them.

## Risks Needing Manual Validation

### PERF30-07 - Timeline and On This Day routes use documented non-sargable date functions

Severity: Low
Confidence: Medium
Status: Risk needing manual validation

Evidence:

- `apps/web/src/lib/data-timeline.ts:97-116` uses `MONTH(capture_date)` and `DAY(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:129-145` uses `YEAR(capture_date)` for the year list.
- `apps/web/src/lib/data-timeline.ts:186-207` uses `YEAR(capture_date)` and optional `MONTH(capture_date)` for timeline pages.
- The comments at `apps/web/src/lib/data-timeline.ts:92-95` and `apps/web/src/lib/data-timeline.ts:180-184` explicitly acknowledge this as personal-gallery-scale behavior.

Failure scenario:

If the image table grows well beyond current personal-gallery scale, `/timeline`, `/year/[year]`, and On This Day widgets scan the processed dated slice and evaluate date functions row-by-row on dynamic public pages. Crawlers can amplify the cost across year/month URLs.

Suggested fix:

Use range predicates for year and month pages. For On This Day, add generated/indexed month/day columns or maintain an archive rollup table. Validate with `EXPLAIN ANALYZE` against a production-size DB before deciding severity.

## Final Sweep Notes

- Rate limiter/map growth: in-memory rate-limit maps use bounded maps with hard-cap enforcement at `apps/web/src/lib/bounded-map.ts:91-99` and pruning at `apps/web/src/lib/bounded-map.ts:156-187`. I did not find a confirmed unbounded in-memory rate-limit map in current HEAD.
- Image queue: queue concurrency defaults to 1 and is clamped in `apps/web/src/lib/image-queue.ts:76-108`; per-image claims are held through encode work. This is a deliberate connection-pinning tradeoff rather than a new confirmed bug in this pass.
- Sharp pipeline: `apps/web/src/lib/process-image.ts` disables Sharp cache and caps libvips concurrency. No new confirmed per-image memory leak was found.
- UI responsiveness: `load-more` and search components guard stale responses and duplicate loads; the strongest confirmed UI risk in this cycle is the `/map` marker/list payload.
- Skipped areas: generated build output, binary assets, uploads/data directories, `.git`, `node_modules`, historical screenshots, and prior review archives were not line-reviewed. Prior reports were used only to avoid stale assumptions.
