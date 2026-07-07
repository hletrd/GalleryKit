# Cycle 8 Performance / Concurrency / Resource Review

Role: `perf-reviewer`
Scope: whole-repository read-only performance review, except this requested artifact.
Method: read `AGENTS.md` and `CLAUDE.md` first, built an inventory, then traced data access, image processing, public/admin API routes, caching, queueing, migrations/indexes, frontend rendering, service worker behavior, e2e/dev scripts, and deployment scripts.
Mutations: no fixes, commits, pushes, deploys, service stops, file removals, or MySQL-container operations were performed.

## Inventory Reviewed

- Guidance and operations docs: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/**`, `.context/plans/**`.
- Database schema, migrations, and migration safety: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, `apps/web/src/lib/db.ts`.
- Public data access and query composition: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/sql-like.ts`.
- Image processing and resource controls: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`.
- API routes and server actions: `apps/web/src/app/api/**`, `apps/web/src/app/actions/**`, including semantic/similar search, upload/LR upload, admin image actions, OG routes, feed/sitemap/robots, and public search actions.
- Public pages and frontend rendering: `apps/web/src/app/[locale]/(public)/**`, `apps/web/src/components/home-client.tsx`, lightbox/viewer components, map components, search components, timeline/on-this-day components, admin upload/backfill/status components.
- Caching and client persistence: React `cache()` wrappers in data/config modules, `revalidate` exports on app routes, `apps/web/public/sw.template.js`, `apps/web/src/lib/sw-cache.ts`, image URL/sized-derivative helpers, middleware.
- Concurrency, background work, and shutdown paths: `apps/web/src/lib/background-db-writes.ts`, queue retry/claim paths, restore-maintenance fences, upload trackers, analytics write buffers.
- E2E/dev/runtime/deploy surfaces: `apps/web/e2e/**`, `apps/web/playwright.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, root `scripts/deploy.mjs`, `package.json` workspace scripts, `next.config.ts`.

## Findings

### PERF-C8-01: Public map still ships and hydrates up to 10,000 markers plus a duplicate 10,000-row list

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Location: `apps/web/src/lib/data.ts:1732-1782`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-15`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `apps/web/src/app/[locale]/(public)/map/page.tsx:89-110`, `apps/web/src/components/map/map-client.tsx:77-94`, `apps/web/src/components/map/map-client.tsx:120-139`

`getMapImages()` uses `MAP_MAX_MARKERS = 10000` and returns the full capped GPS set in one request. The `/map` page is `revalidate = 0`, fetches that whole set on every SSR request, maps every row into client props, passes every marker to the Leaflet client island, and renders a second accessible `<ul>` over the same marker array. `FitBounds` also allocates two full arrays and spreads them into `Math.min`/`Math.max`.

Concrete failure scenario: a gallery with 8,000-10,000 public GPS photos causes a mobile `/map` visit to download a large RSC/client payload, hydrate thousands of React Leaflet markers/popups, and render thousands of DOM list links. The page can freeze the main thread and hurt INP/LCP even though the SQL query is technically bounded.

Suggested fix: replace the one-shot marker payload with a viewport/bounds API, clustering, or a canvas/WebGL marker layer. Lower the initial SSR marker cap and load more after zoom/filter changes. Virtualize or paginate the accessible photo list. Compute bounds in one pass without temporary latitude/longitude arrays.

### PERF-C8-02: Timeline and On This Day use non-sargable date predicates on uncached public SSR paths

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Location: `apps/web/src/lib/data-timeline.ts:7-9`, `apps/web/src/lib/data-timeline.ts:88-116`, `apps/web/src/lib/data-timeline.ts:125-145`, `apps/web/src/lib/data-timeline.ts:172-207`, `apps/web/src/components/on-this-day-widget.tsx:10-22`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19-94`

The module comment says these queries target `(processed, capture_date, created_at)`, but the live predicates wrap `capture_date` in `MONTH()`, `DAY()`, and `YEAR()`. The file also documents that the timeline year/month predicates are not sargable. The homepage server component calls `getOnThisDayImages()` during SSR, and the timeline page is `revalidate = 0` while calling both `getTimelineYears()` and `getTimelineImages()`.

Concrete failure scenario: as processed photo count grows, every homepage request scans the processed/capture-date population to find six matching month/day photos, and every `/timeline` request scans again for distinct years and selected-year rows. Bot traffic or repeated public navigation can convert a small widget into steady DB CPU.

Suggested fix: use range predicates for year pages, for example `capture_date >= 'YYYY-01-01' AND capture_date < 'YYYY+1-01-01'`. For month/day matching, add generated stored columns or functional indexes such as `capture_year`, `capture_month`, and `capture_month_day`, then query those columns. Add cache/revalidation around low-churn archive widgets and invalidate on image upload, metadata edits, restore, and relevant backfills.

### PERF-C8-03: Public smart collections can execute unindexed scans and a separate count per uncached request

- Severity: Medium
- Confidence: High
- Status: Likely from query/index shape
- Location: `apps/web/src/lib/smart-collections.ts:21-30`, `apps/web/src/lib/smart-collections.ts:142-147`, `apps/web/src/lib/smart-collections.ts:221-238`, `apps/web/src/lib/smart-collections.ts:250-267`, `apps/web/src/lib/sql-like.ts:5-10`, `apps/web/src/db/schema.ts:117-125`, `apps/web/src/db/schema.ts:127-135`, `apps/web/src/lib/data.ts:1488-1550`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17-18`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:96-111`

Smart-collection rules allow predicates over EXIF/text fields such as `iso`, `focal_length`, `f_number`, `exposure_time`, `camera_model`, `lens_model`, `capture_date`, `topic`, and `tag`. The AST is shape-bounded, which is good, but `contains` compiles to `%term%` `LIKE`, tag `contains` runs through a subquery, and the `images` index set does not include the EXIF fields used by numeric/date smart-collection predicates. The public `/c/[slug]` route is `revalidate = 0` and the first page executes both the grouped listing query and a separate `count(*)` over the same compiled condition.

Concrete failure scenario: an admin publishes a smart collection such as "camera_model contains Sony OR lens_model contains 35" or a broad ISO/focal-length predicate. Every public visit and crawler hit can scan much of `images`, join/group tags for the listing, and run a second count query before rendering a 30-photo page.

Suggested fix: classify smart-collection predicates as indexable/non-indexable at save time and warn or block public publishing for expensive shapes. Add targeted indexes for supported numeric/date predicates that need to be public at scale. Consider materialized smart-collection membership tables refreshed on image metadata/tag changes, and avoid or cache exact counts for expensive public predicates.

### PERF-C8-04: Batch image deletion repeats full derivative-directory scans per selected image and format

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Location: `apps/web/src/app/actions/images.ts:778-785`, `apps/web/src/app/actions/images.ts:860-884`, `apps/web/src/lib/process-image.ts:575-630`

Batch deletion caps selected IDs at 100 and bounds cleanup concurrency, but each selected image calls `deleteImageVariantsStrict(..., [])` for WebP, AVIF, and JPEG. Passing an empty `sizes` array triggers `collectImageVariantFilenames()` to scan the whole upload directory to discover historical size variants. For a 100-image delete this can become up to 300 full directory scans, with five images scanning concurrently by default.

Concrete failure scenario: on a NAS-backed production host with tens of thousands of derivatives per format directory, deleting 100 photos after an image-size config change causes hundreds of `opendir`/directory-iteration passes. The admin action can run for a long time and contend with serving image assets or encoder writes.

Suggested fix: for batch deletes, scan each derivative directory once, build a filename set for all selected base names, then delete matching variants. Another option is to delete only deterministic current-size filenames inline and schedule one low-priority orphan-variant sweep for old size configs.

### PERF-C8-05: Semantic and similar search can still become a CPU/RSS hot path at the maximum scan cap

- Severity: Low
- Confidence: Medium
- Status: Risk
- Location: `apps/web/src/lib/clip-embeddings.ts:22-44`, `apps/web/src/lib/clip-embeddings.ts:135-202`, `apps/web/src/lib/clip-embeddings.ts:209-231`, `apps/web/src/db/schema.ts:271-300`, `apps/web/src/app/api/search/semantic/route.ts:176-184`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`

The current `topK()` implementation keeps only K winners, so the previous full-sort concern is resolved. The remaining cost is the bounded brute-force scan: `SEMANTIC_SCAN_LIMIT` defaults to 2,000 and can be configured up to 25,000. Both public search routes read embedding blobs, decode every scanned row, and compute 512-dimensional scores in-process. Rate limiting and abort checks reduce abuse, but the maximum setting still means roughly tens of MB of embedding payload plus millions of float operations per request.

Concrete failure scenario: with `SEMANTIC_SCAN_LIMIT=25000`, several legitimate concurrent semantic/similar searches can load and score around 25,000 vectors each, pushing Node CPU, increasing request latency, and temporarily raising RSS from decoded vector views/copies and MySQL packet buffers.

Suggested fix: keep production scan caps conservative and log/warn when configured above a tested budget. Add benchmark coverage for production vector counts. If the gallery outgrows brute force, move to an ANN/vector index or maintain an in-memory matrix with explicit memory budgeting and single-flight refresh. Cache frequent query embeddings/results where freshness requirements allow.

## Positive Performance Evidence

- Main public listing paths use bounded page sizes, keyset cursor support, lean count queries, and React `cache()` request deduplication where appropriate (`apps/web/src/lib/data.ts:1471`, `apps/web/src/lib/data.ts:1493-1550`, `apps/web/src/lib/data.ts:1785-1800`).
- Image processing has explicit resource controls: Sharp concurrency/cache controls, maximum source-pixel limits, atomic derivative writes, and cleanup for partial outputs in `apps/web/src/lib/process-image.ts`.
- The image queue clamps worker concurrency against the DB pool budget, reserves live connections, and bounds retry/permanent-failure tracking (`apps/web/src/lib/image-queue.ts:100-151`).
- Analytics writes are buffered with fixed concurrency and a pending cap instead of spawning unlimited writes (`apps/web/src/lib/background-db-writes.ts:3-10`, `apps/web/src/lib/background-db-writes.ts:42-75`).
- The service worker has bounded image/HTML caches, serializes metadata mutations, uses head-walk LRU eviction, and lazy-starts image revalidation (`apps/web/public/sw.template.js:31-39`, `apps/web/public/sw.template.js:98-143`, `apps/web/public/sw.template.js:304-340`).
- Semantic routes charge rate limits before expensive work and include abort checks around inference/scan stages (`apps/web/src/app/api/search/semantic/route.ts:169-184`, `apps/web/src/app/api/search/semantic/route.ts:247-283`).
- Deployment script preserves the live container/image, waits for health, and prunes Docker artifacts after `up -d` rather than before replacement, matching the documented disk-hygiene contract.

## Final Sweep

Checked for N+1 query patterns, missing or mismatched indexes, unbounded result sets, blocking server work, memory/RSS blowups, expensive client hydration, cache consistency hazards, queue saturation, DB pool contention, retry-timer growth, service-worker quota growth, e2e/dev script hazards, deployment disk pressure, and UI responsiveness/web-vitals risks.

No Critical or High severity performance defects were found in this static pass. The remaining notable risks are the five findings above, all bounded but capable of hurting large-gallery or high-concurrency operation. I did not run load tests, browser traces, MySQL `EXPLAIN`, or any command against the temporary MySQL container, so runtime cardinalities and production query plans remain unmeasured.
