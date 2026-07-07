# Review-Plan-Fix Cycle 19 Performance Review

Role lane: perf-reviewer
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Write scope: `.context/reviews/perf-reviewer.md`

## Scope and Inventory

Read first, per repo policy: `AGENTS.md`, `CLAUDE.md`, root `README.md`, root `package.json`, `apps/web/package.json`, `apps/web/README.md`, existing `.context/reviews/perf-reviewer.md`, and `.context/reviews/_aggregate.md`.

Inventory built with `find`/`rg` before findings:

- 619 TypeScript/TSX/JS/MJS files under `apps/web/src`.
- 81 app route/action/page/layout files, 61 components, 114 library/db/i18n modules.
- 29 scripts and 33 Drizzle migration/meta files.
- Public assets/service worker, Docker/deploy/nginx runtime config, package scripts, tests/e2e, queue/backfill scripts, and schema/index files were included in the review.

Reviewed performance/concurrency surfaces: Next public/admin pages, route handlers, Server Actions, data/query layer, Drizzle schema/migrations/indexes, upload/restore/Lightroom ingest, Sharp/HDR/GPS image processing, image queue, admin/sidecar backfills, CLIP/semantic search, search/map/timeline/feed/sitemap paths, rate limits, analytics/background writes, service worker caching, frontend listing/map/search responsiveness, Docker/Compose/deploy/nginx runtime behavior, and performance-relevant tests.

No source fixes were implemented. No commits were made.

## Findings Summary

- Confirmed issues: 6
- Likely issues: 2
- Manual-validation risks: 2

## Confirmed Issues

### C19-PERF-01 - Foreground queue and admin backfill can over-reserve the same DB pool

- Severity: High
- Confidence: High
- Status: Confirmed issue
- File/region: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:121-142`, `668-683`, `805-883`, `899-903`; `apps/web/src/lib/admin-backfill-runner.ts:106-143`, `324-352`, `520-671`, `716-727`

The shared MySQL pool has `connectionLimit: 10` and `queueLimit: 20`. The image queue independently reserves half the pool and clamps its worker count, but each worker can hold an advisory-lock connection while doing row checks, Sharp encode work, and final DB updates. The admin color backfill uses a separate formula with its own whole-run lock and per-image locks, then runs a separate `PQueue`.

Failure scenario: a normal upload queue is active while an admin starts a color-pipeline backfill. At default pool size, queue concurrency can be 2 and backfill concurrency can be 2. The backfill can pin 1 global lock + 2 per-image lock connections + transient DB work; the foreground queue can pin 2 more per-image lock connections + transient DB work. The intended "leave about five connections for live traffic" guarantee is true for either lane alone, but not for both together. Live photo pages, search, analytics writes, and queue updates can then stack behind one remaining pool slot and hit the pool queue cap.

Suggested fix: introduce one process-wide background DB budget shared by image queue, admin backfill, semantic backfill, and side effects. Either make admin backfill acquire the same semaphore as queue workers, or require the backfill to pause/drain foreground queue work before starting. Expose active worker/lock counts in status so operators can see when background work is consuming the pool.

### C19-PERF-02 - Large multipart surfaces still materialize bodies before app-level streaming

- Severity: High
- Confidence: High
- Status: Confirmed issue
- File/region: `apps/web/src/lib/upload-limits.ts:1-6`, `33-35`; `apps/web/next.config.ts:111-119`; `apps/web/src/app/api/admin/lr/upload/route.ts:101-188`; `apps/web/src/app/actions/images.ts:129-148`, `184-249`, `367-378`; `apps/web/src/app/[locale]/admin/db-actions.ts:385`, `663-684`; `apps/web/src/lib/process-image.ts:882-887`

The app has useful caps: 200 MiB per photo, 250 MiB restore files, and a Server Action body cap derived from the largest accepted body. The Lightroom route also requires `Content-Length`, rejects chunked uploads, and serializes `request.formData()` parsing. The browser upload and DB restore paths, however, are Server Actions that receive already-built `FormData`/`File` values; their later `File.stream()` pipelines only start after Next/Undici has accepted and materialized the body.

Failure scenario: an admin uploads a 200 MiB image or restores a 250 MiB dump while the same Node process is handling public SSR and Sharp queue work. RSS spikes before the application can stream to disk, and concurrent dashboard uploads are not protected by the Lightroom parse semaphore. This can produce long GC pauses, request stalls, or OOM on the disk-constrained production host.

Suggested fix: move browser upload and DB restore ingest to route handlers with a streaming multipart parser that enforces byte/file limits while reading. Keep Server Actions for small control mutations. Add a shared ingress semaphore across LR upload, dashboard upload, and restore so large multipart parsing has one global memory budget.

### C19-PERF-03 - GPS stripping reads whole originals into memory after upload

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- File/region: `apps/web/src/app/actions/images.ts:409-416`; `apps/web/src/app/api/admin/lr/upload/route.ts:417-428`; `apps/web/src/lib/process-image.ts:1724-1750`, `1759-1778`

When `stripGpsOnUpload` is enabled, both browser and Lightroom ingest paths call `stripGpsFromOriginal()` after the original is saved. That function does `await fs.readFile(filePath)` for the entire original, then may also hold a scrubbed output buffer before writing a temp file. For fallback re-encodes it keeps the original `input` buffer around while Sharp processes the same file.

Failure scenario: a 150-200 MiB JPEG/HEIC/TIFF upload arrives with GPS data. The process may already have the multipart `File` materialized, then reads the whole original again and may allocate a second scrubbed buffer. A couple of such uploads can multiply RSS far beyond the nominal per-file cap before Sharp work even starts.

Suggested fix: make GPS stripping bounded/streaming by container. For JPEG/TIFF/ISOBMFF/WebP, scan and rewrite metadata segments without reading the full file into one Buffer. Until then, include this step in the shared large-ingress semaphore and consider a lower accepted upload cap when GPS stripping is enabled.

### C19-PERF-04 - Semantic and similar-photo routes do request-local vector scans in Node

- Severity: High
- Confidence: High
- Status: Confirmed issue
- File/region: `apps/web/src/lib/clip-embeddings.ts:36-48`, `217-235`; `apps/web/src/db/schema.ts:292-304`; `apps/web/src/app/api/search/semantic/route.ts:247-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`

The embedding table has a model/version index, and the scan limit is hard-clamped. Still, every semantic request selects up to `SEMANTIC_SCAN_LIMIT` MEDIUMBLOB vectors from MySQL, decodes them, scores them in Node, and top-k ranks them locally. The similar-photo endpoint repeats the same scan after loading the target vector.

Failure scenario: production semantic search is enabled and embeddings are populated. Several users open search or similar-photo panes while image processing is active. Each request burns DB bandwidth, heap for decoded vectors, and CPU for dot products, while CLIP inference and Sharp processing compete for the same process.

Suggested fix: use an ANN/vector index or a preloaded vector matrix owned by a worker with a refresh/version contract. As a near-term guard, add a semantic-search concurrency budget and cache hot query/target results with invalidation on embedding model/version changes.

### C19-PERF-05 - Public map page can ship and render 10k markers plus a 10k-link list

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- File/region: `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`, `51-66`, `89-109`; `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/components/map/map-client.tsx:77-140`

`/map` is always dynamic. `getMapImages()` caps results at 10,000 markers and returns latitude/longitude rows for all map-visible topics. The page passes all markers into Leaflet and also renders an accessible `<ul>` entry for every marker. `FitBounds` makes full latitude and longitude arrays and spreads them into `Math.min`/`Math.max`; the render then creates one React Leaflet `<Marker>` per item.

Failure scenario: a gallery grows to thousands of GPS-tagged public photos. The initial `/map` response carries a large marker payload, React mounts thousands of marker components, and the page also creates thousands of list links. Mobile browsers can freeze before the user can pan or search.

Suggested fix: switch to viewport-bounded marker fetches plus server-side clustering or tile aggregation. Keep the accessible list, but paginate or sync it to the current viewport. For the interim, lower the initial cap and compute bounds in one pass without spread arrays.

### C19-PERF-06 - Admin CSV export intentionally materializes up to 50k rows and the full CSV string

- Severity: Low
- Confidence: High
- Status: Confirmed issue
- File/region: `apps/web/src/app/[locale]/admin/db-actions.ts:45-50`, `68-83`, `90-120`

The CSV export comment correctly documents the current memory profile. The action queries up to 50,000 grouped rows, builds a `csvLines` array, clears the DB result array, then joins the entire CSV into one string returned across the Server Action boundary.

Failure scenario: an admin exports near the 50k cap while uploads/backfills are running. Heap temporarily holds row objects, CSV line strings, and the final CSV string, adding avoidable GC pressure in the same Node process that handles public traffic.

Suggested fix: move CSV export to an authenticated route handler that streams rows through a cursor/keyset iterator into a `ReadableStream`. Keep the 50k warning or emit a manifest row, but avoid returning the entire file through a Server Action string.

## Likely Issues

### C19-PERF-07 - Public smart collections allow expensive dynamic predicates on every uncached page hit

- Severity: Medium
- Confidence: Medium
- Status: Likely issue; needs `EXPLAIN` against production-sized data
- File/region: `apps/web/src/app/actions/collections.ts:39-58`, `96-113`; `apps/web/src/lib/smart-collections.ts:142-147`, `221-238`, `250-267`, `316-352`; `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17`, `96-112`; `apps/web/src/lib/data.ts:1488-1544`

Smart-collection JSON is bounded structurally, but the current public budget still permits 512 AST nodes, 64 children per group, `contains` predicates compiled to `%LIKE%`, and tag `contains` subqueries. Public collection pages are `revalidate = 0`; the first page also runs the row query and a separate `count(*)` in parallel, and load-more repeats the compiled condition.

Failure scenario: an admin publishes a smart collection with broad OR groups and multiple text/tag `contains` predicates. Every public hit to `/c/[slug]` generates a large predicate tree and likely full or temp-table scans over `images`, `tags`, and `image_tags`, even though only 30 rows are rendered.

Suggested fix: add a performance class to smart-collection validation. For public collections, lower AST/group budgets, restrict `contains`, or require indexed/sargable predicates. Longer-term, materialize smart-collection membership into a table refreshed on image/tag changes and serve public pages from that membership table.

### C19-PERF-08 - Keyword search is rate-limited but still built on multi-query `%LIKE%` scans

- Severity: Low
- Confidence: Medium
- Status: Likely issue; scale depends on row count and MySQL plans
- File/region: `apps/web/src/lib/sql-like.ts:9-10`; `apps/web/src/lib/data.ts:1574-1584`, `1637-1655`, `1693-1738`; `apps/web/src/app/actions/public.ts:266-317`; `apps/web/src/components/search.tsx:302-315`

Public keyword search is debounced client-side and rate-limited server-side. The SQL shape still uses `%term%` across title, description, camera/lens, topic labels, tag names, and topic aliases. If the first query does not fill the result limit, it runs tag and alias queries in parallel, so one accepted search can use several DB round trips and non-sargable predicates.

Failure scenario: a broad two-character query misses the main fields and falls through to tag/alias matching. Repeated searches from multiple IPs can consume DB CPU even though each response returns only 20 rows.

Suggested fix: add a full-text/search index path for public keyword search, or raise the minimum query length and cache popular searches. At minimum, capture `EXPLAIN ANALYZE` for the main/tag/alias branches at current data size and add a regression fixture for the chosen plan.

## Manual-Validation Risks

### MV-C19-PERF-01 - Edge public-page limiter is config-only and not applied by deploy

- Severity: Medium
- Confidence: High
- Status: Manual-validation risk
- File/region: `apps/web/nginx/default.conf:1-29`, `274-295`, `290-293`; `apps/web/deploy.sh:51-56`

The nginx template defines public, admin, login, and Next image limiter zones, but the file itself says it is not touched by deploys and must be applied/reloaded manually. `apps/web/deploy.sh` builds and starts Docker Compose; it does not validate the live nginx config.

Failure scenario: the repository contains correct limiter configuration, but the production host is still running an older nginx file. Dynamic public pages (`revalidate=0`) then rely only on app-layer route/action limits, leaving regular page navigation, map, timeline, and smart-collection SSR without the intended edge flood backstop.

Suggested validation/fix: add a deployment smoke check that compares the live nginx config to the committed limiter blocks, or manage nginx through the deploy pipeline. At minimum, document the exact host command and capture `nginx -T` output in ops notes after each limiter change.

### MV-C19-PERF-02 - Source review did not include live heap, browser, or DB-plan measurements

- Severity: Medium
- Confidence: High
- Status: Manual-validation risk

This review is source-based. I did not run production-like uploads, browser traces, MySQL `EXPLAIN ANALYZE`, heap snapshots, or live nginx checks. The confirmed issues above are visible from code, but their operational priority should be calibrated with:

- Heap/RSS profile for dashboard upload, LR upload, restore, and GPS-strip flows near the 200-250 MiB caps.
- `EXPLAIN ANALYZE` for map, smart collection, keyword search, semantic scan, and analytics "all" queries at production row counts.
- Mobile browser trace for `/map` at high marker counts and warm/cold service-worker image cache states.
- Live production check for nginx limiter and proxy IP topology.

## Final Sweep

File categories examined:

- Instructions/context: `AGENTS.md`, `CLAUDE.md`, README/package scripts, `.context/reviews` conventions.
- Next app surfaces: public/admin pages, layouts, route handlers, Server Actions, metadata/feed/sitemap/OG routes.
- Data layer: `apps/web/src/lib/data.ts`, timeline/analytics/search helpers, rate limits, background writes, schema exports, migrations/indexes, migration scripts.
- Image/queue surfaces: upload limits, upload tracker, Sharp processing, GPS stripping, topic image processing, image queue, queue shutdown, admin backfill, CLIP model/embeddings, semantic backfill paths, sidecar scripts.
- Frontend: masonry/home/load-more/search/photo viewer/lightbox/map/admin settings/upload components and global CSS performance hooks.
- Runtime/deploy/cache: service worker template, upload serving/cache headers, nginx template, Dockerfile, Compose, deploy script, public assets.
- Tests/scripts: unit/e2e directories and performance/source-contract tests were inventoried for guard coverage.

Skipped: no source category intentionally skipped. Live production nginx state, DB query plans, browser performance traces, heap profiles, and end-to-end load tests were not executed in this review lane.
