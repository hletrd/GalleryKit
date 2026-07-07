# Cycle 14 Performance + Architecture Review

Role: `perf-reviewer` + `architect reviewer`
Date: 2026-07-07
Scope: performance, concurrency, CPU/memory, UI responsiveness, query behavior, caching, architecture/design boundaries, coupling, layering, and operational risks.
Mutation boundary: report artifact only. Source code, CI/deploy files, commits, pushes, deploys, and containers were not modified.

## Inventory

- Guidance read: `AGENTS.md`, `CLAUDE.md`, and the local code-review skill.
- Source inventory built before analysis:
  - 259 executable source files under `apps/web/src` (`.ts`, `.tsx`, `.js`, `.mjs`), excluding tests from proof.
  - 61 script/schema files under `apps/web/scripts` and `apps/web/drizzle`.
  - Runtime/config surfaces: root and web `package.json`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, compose/nginx config, public service worker, schema and migration helpers.
- Review-relevant areas examined: public routes, admin routes, API routes, server actions, client components with timers/listeners/workers, data access, DB schema/indexes, image queue, backfill runners, image processing, upload paths, CLIP/semantic search, analytics writers/readers, service-worker cache behavior, deploy/runtime resource settings, and operational helper scripts.
- Validation basis: static code inspection and cross-file behavior tracing only. Tests/comments were used for navigation context, not as proof of behavior.
- Files intentionally not line-reviewed as executable risk: `node_modules`, `.next`, generated build output, static binary assets, screenshots, and locale-copy-only files.

## Summary

- Total findings: 12
- Confirmed issues: 6
- Likely issues: 3
- Risks needing manual validation: 3
- Highest severity: Medium

## Confirmed Issues

### PERF-C14-01: Background queue and in-app backfill reserve DB pool headroom independently

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/db/index.ts:31-41`, `apps/web/src/lib/image-queue.ts:123-140`, `apps/web/src/lib/image-queue.ts:640-667`, `apps/web/src/lib/image-queue.ts:714-774`, `apps/web/src/lib/image-queue.ts:868-870`, `apps/web/src/lib/admin-backfill-runner.ts:105-142`, `apps/web/src/lib/admin-backfill-runner.ts:323-388`, `apps/web/src/lib/admin-backfill-runner.ts:713-724`

Problem: the default MySQL pool is 10 connections with a queue limit of 20. The live image queue and in-app color backfill each clamp their own worker count to leave about half the pool for live traffic, but neither subtracts the other subsystem's active workers. Both also hold advisory-lock connections across encode work and use transient DB connections for checks/updates.

Concrete failure scenario: uploads are being processed with effective queue concurrency 2 while an admin starts the in-app backfill at effective concurrency 2. The backfill can pin one whole-run lock plus two per-image locks and transient updates; the queue can pin two per-image locks and transient checks/updates. Public photo pages, which fan out DB reads after the initial image lookup, and admin dashboards can then queue behind background work or hit the mysql2 queue limit.

Suggested fix: introduce one shared in-process background resource budget for queue, in-app backfill, embedding bootstrap, and cleanup work. Budget weighted DB slots and CPU slots globally, pause or reduce the queue while in-app backfill is active, and surface the effective combined budget in admin status. If multiple processes become supported, move the budget to a DB-backed lease/semaphore.

### PERF-C14-02: Sidecar color backfill bypasses the web pool-budget clamp

- Severity: Medium
- Confidence: High
- Location: `apps/web/scripts/backfill-color-pipeline.ts:378-387`, `apps/web/scripts/backfill-color-pipeline.ts:470-490`, `apps/web/src/db/index.ts:31-41`, `apps/web/src/lib/admin-backfill-runner.ts:129-142`

Problem: the sidecar `backfill-color-pipeline.ts` script uses `BACKFILL_CONCURRENCY` with max 8 and creates `new PQueue({ concurrency })`. Unlike the in-app runner, it does not use the pool-budget formula, but it imports the normal DB module and can open its own 10-connection pool from a separate process.

Concrete failure scenario: an operator runs `BACKFILL_CONCURRENCY=8` during live traffic or while uploads are encoding. The sidecar can drive up to eight encode/update workers plus DB updates from a separate pool, bypassing the web process's safeguards and increasing MySQL, CPU, and disk pressure.

Suggested fix: extract the in-app backfill budget helper into a shared module usable by scripts. Make high sidecar concurrency require an explicit maintenance-window override, and check for active web backfill/queue locks before allowing aggressive settings.

### PERF-C14-03: Public map over-fetches rows and hydrates up to 10,000 markers plus a duplicate list

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/lib/data.ts:409-444`, `apps/web/src/lib/data.ts:1759-1791`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `apps/web/src/app/[locale]/(public)/map/page.tsx:89-109`, `apps/web/src/components/map/map-client.tsx:77-94`, `apps/web/src/components/map/map-client.tsx:108-140`

Problem: `getMapImages()` selects `publicMapSelectFields`, which is based on the broad public image field set plus latitude/longitude, then caps at 10,000 rows. The page narrows those rows only after the DB read, serializes marker data to the client, renders a Leaflet `Marker` for every row, and also renders a full accessible `<ul>` over the same marker list. `FitBounds` additionally allocates latitude/longitude arrays and spreads them into `Math.min`/`Math.max`.

Concrete failure scenario: a GPS-heavy gallery with thousands of map-visible photos sends a large RSC/client payload and hydrates thousands of React Leaflet objects plus thousands of list rows. On mobile, the page can become main-thread bound before the map is interactive.

Suggested fix: create a lean map select containing only `id`, `latitude`, `longitude`, `title`, `filename_jpeg`, and `topic`; lower the initial SSR marker cap; cluster or fetch markers by viewport; virtualize/paginate the accessible list; compute bounds in one pass without spread arrays.

### PERF-C14-04: Dynamic homepage runs a non-sargable on-this-day query on every render

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/app/[locale]/(public)/page.tsx:155-178`, `apps/web/src/app/[locale]/(public)/page.tsx:232-234`, `apps/web/src/components/on-this-day-widget.tsx:15-22`, `apps/web/src/lib/data-timeline.ts:111-130`, `apps/web/src/db/schema.ts:123-130`

Problem: the homepage is dynamic (`revalidate = 0`) and always renders `OnThisDayWidget`. The widget calls `getOnThisDayImages()`, whose filter wraps `capture_date` in `MONTH()` and `DAY()`. The images table has processed/date indexes, but no generated month/day key that can satisfy this predicate directly.

Concrete failure scenario: as the dated archive grows, every public homepage request scans and groups more candidate rows just to return six images, adding DB CPU to the main listing and count work.

Suggested fix: add a generated `capture_month_day` or `capture_month`/`capture_day` column and a covering index such as `(processed, capture_month_day, capture_date, created_at, id)`. Query equality on the generated key. A short cache can help repeated traffic, but the predicate should be made indexable first.

### PERF-C14-05: Backfill candidate selection lacks a `pipeline_version` index

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/lib/admin-backfill-runner.ts:390-428`, `apps/web/scripts/backfill-color-pipeline.ts:372-387`, `apps/web/src/db/schema.ts:82-83`, `apps/web/src/db/schema.ts:123-131`

Problem: both in-app and sidecar backfills select stale rows with `processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < CURRENT)`, but the images table has no index involving `pipeline_version`. Existing indexes cover processed/date/topic/uploaded fields, not stale pipeline selection.

Concrete failure scenario: after most images are current, a backfill run still counts and keyset-scans large processed ranges to find a small stale tail. During maintenance this competes with live reads and can make "nothing to do" checks expensive.

Suggested fix: add an index shaped for candidate discovery, for example `(processed, pipeline_version, id)`, and verify the `IS NULL OR <` predicate with `EXPLAIN ANALYZE`. If MySQL does not use the OR efficiently, split null and stale queries or maintain a boolean/generated stale flag.

### PERF-C14-06: Batch image deletion repeatedly scans derivative directories

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/app/actions/images.ts:860-884`, `apps/web/src/lib/process-image.ts:588-627`, `apps/web/src/lib/process-image.ts:644-660`

Problem: `deleteImages()` chunks cleanup concurrency, but each image still calls `deleteImageVariantsStrict(..., [])` for WebP, AVIF, and JPEG. Passing an empty sizes array triggers a full directory scan to find historical variants. A 100-image batch can therefore perform up to 300 derivative-directory scans.

Concrete failure scenario: on a NAS-backed deployment with tens of thousands of derivative files, a large admin delete spends seconds repeatedly walking the same directories after DB rows have already been deleted, contending with image serving and encoder writes.

Suggested fix: add a batch cleanup helper that scans each derivative directory once per batch, indexes entries by selected base filename prefixes, and deletes matching variants. Keep strict single-image cleanup for narrow deletes.

## Likely Issues

### PERF-C14-07: Public listing queries aggregate tags before limiting the page

- Severity: Medium
- Confidence: Medium
- Location: `apps/web/src/lib/data.ts:802-828`, `apps/web/src/lib/data.ts:893-940`, `apps/web/src/app/[locale]/(public)/page.tsx:175-178`

Problem: `getImagesLite()` and `getImagesLitePage()` join `image_tags` and `tags`, compute `GROUP_CONCAT`, group by `images.id`, order, then apply the page limit. The count query is lean, but the row query can still do grouping/sort work over many matching rows before returning 30-31 images.

Concrete failure scenario: broad home/topic pages in a tag-heavy archive can create temporary grouping and sort work proportional to matching images rather than page size on every uncached public render.

Suggested fix: use a two-phase query. First fetch page image IDs from `images` with only image predicates and the covering sort index. Then aggregate tags only for those IDs and restore page order in SQL or application code.

### PERF-C14-08: Admin analytics fans out multiple aggregation queries against one shared pool

- Severity: Medium
- Confidence: Medium
- Location: `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-36`, `apps/web/src/lib/analytics-data.ts:28-46`, `apps/web/src/lib/analytics-data.ts:62-79`, `apps/web/src/lib/analytics-data.ts:93-127`, `apps/web/src/lib/analytics-data.ts:161-180`, `apps/web/src/lib/analytics-data.ts:188-207`

Problem: the admin analytics page runs five aggregation queries concurrently. For the `all` window, breakdown queries intentionally scan the full non-bot slice of covering indexes and aggregate into temp tables. This is admin-only, but it shares the same pool and database as live traffic and background processing.

Concrete failure scenario: an admin opens `/admin/analytics?window=all` during uploads/backfill. Five grouping queries occupy DB work concurrently while queue/backfill workers hold locks and issue updates, increasing live request latency.

Suggested fix: serialize or limit analytics query concurrency, cache analytics snapshots/rollups, and consider materialized daily aggregates for country/referrer/topic/photo/shared-group summaries. Keep `all` behind explicit "refresh" semantics if production data grows.

### PERF-C14-09: Timeline year list uses `YEAR(capture_date)` on an uncached public route

- Severity: Low
- Confidence: Medium
- Location: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-94`, `apps/web/src/lib/data-timeline.ts:143-159`, `apps/web/src/db/schema.ts:123-130`

Problem: `/timeline` is dynamic and always calls `getTimelineYears()`. The query selects and orders by `YEAR(capture_date)`, preventing direct use of a plain capture-date index for distinct-year lookup.

Concrete failure scenario: a large archive with many dated images makes timeline entry perform a full processed/date scan plus distinct/order work before the selected year's bounded page query runs.

Suggested fix: add a generated `capture_year` column and index `(processed, capture_year, capture_date, created_at, id)`, or maintain a small year summary table during image writes/backfills. Validate with `EXPLAIN ANALYZE` on production-like row counts.

## Risks Needing Manual Validation

### PERF-C14-10: Public text search and smart-collection `contains` predicates are table-scan surfaces

- Severity: Low
- Confidence: Medium
- Location: `apps/web/src/lib/data.ts:1574-1655`, `apps/web/src/lib/data.ts:1682-1713`, `apps/web/src/lib/smart-collections.ts:221-223`, `apps/web/src/lib/smart-collections.ts:261-267`, `apps/web/src/app/actions/public.ts:247-329`

Problem: public search and smart-collection `contains` predicates use substring `LIKE` behavior across image text fields, topic labels, tag names, and aliases. Public search is DB-backed rate-limited, but a single allowed request can still be expensive on a large archive.

Concrete failure scenario: repeated low-selectivity terms under the rate limit scan large portions of `images`, `tags`, or `topic_aliases`, then group/order results. Admin-authored smart collections with `contains` predicates can put similar work on dynamic collection pages.

Suggested fix: collect `EXPLAIN ANALYZE` for common and worst-case terms. If material, move to FULLTEXT or a normalized search index, increase minimum query length for text search, and warn or lint admin smart-collection rules that compile to non-sargable predicates.

### PERF-C14-11: Semantic routes brute-force embedding blobs in the web process

- Severity: Low
- Confidence: Medium
- Location: `apps/web/src/lib/clip-embeddings.ts:36-48`, `apps/web/src/lib/clip-embeddings.ts:188-235`, `apps/web/src/lib/clip-model.ts:53-64`, `apps/web/src/lib/clip-model.ts:156-173`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`, `apps/web/src/lib/rate-limit.ts:393-416`

Problem: semantic search and similar-photo routes read up to `SEMANTIC_SCAN_LIMIT` embedding blobs, decode them, and score in-process. The default scan limit is 2,000 and hard cap is 25,000. Model inference has an in-process queue, but the vector scan itself is still web-process CPU/memory work, and semantic rate limiting is process-local.

Concrete failure scenario: if the scan cap is raised near the hard maximum, one request can read and decode tens of megabytes of vector blobs and score them on the same Node process serving SSR and uploads. Concurrent requests after a restart can bypass durable rate accounting.

Suggested fix: keep production scan caps conservative until measured. For growth, use a vector index/store, cached in-memory matrix with worker-thread scoring and single-flight refresh, or a DB/vector extension. Make semantic rate limiting durable if multi-instance or restarts matter.

### PERF-C14-12: Lightroom upload route may buffer a max-size multipart file before disk streaming

- Severity: Low
- Confidence: Medium
- Location: `apps/web/src/app/api/admin/lr/upload/route.ts:60-74`, `apps/web/src/app/api/admin/lr/upload/route.ts:101-128`, `apps/web/src/app/api/admin/lr/upload/route.ts:178-186`, `apps/web/src/app/api/admin/lr/upload/route.ts:346-348`, `apps/web/src/lib/process-image.ts:887-923`

Problem: the Lightroom route correctly requires `Content-Length`, caps size, and serializes multipart parsing to one in-flight parse, but it still calls `request.formData()` before `saveOriginalAndGetMetadata()` streams the resulting `File` to disk. Peak RSS therefore depends on Next/undici multipart buffering behavior for a max-size upload.

Concrete failure scenario: a 200 MB upload can be materialized as a large `File`/Blob during parse, then streamed to disk and inspected by Sharp metadata/blur/color probes. Even with one parser slot, this can produce a large transient memory spike in the web process.

Suggested fix: profile RSS during max-size LR uploads. If material, replace `request.formData()` with a streaming multipart parser that writes the file part directly to the private original directory after auth/content-length checks, then passes the path into the existing metadata pipeline.

## Architecture Notes / Confirmed Non-Findings

- Sharp CPU concurrency is intentionally bounded by default and cache is disabled, while each image still fans out WebP/AVIF/JPEG generation in parallel (`apps/web/src/lib/process-image.ts:36-58`, `apps/web/src/lib/process-image.ts:1433-1440`). The main remaining risk is combined workload budgeting, covered in PERF-C14-01 and PERF-C14-02.
- Browser uploads are client-serialized by `upload-dropzone`, and the LR API route has a one-request multipart parse slot. The unresolved LR concern is peak memory during `formData()`, not unbounded parser concurrency.
- Analytics fire-and-forget writers are bounded separately; the analytics finding concerns read-side admin aggregation fan-out.
- Public load-more and text search actions have explicit server-side rate limits and input caps. The remaining risk is per-allowed-request query cost.
- Service-worker cache sizing, static derivative cache headers, and Next image config were reviewed; no new issue found in those surfaces.

## Final Sweep

- Common missed areas checked: public dynamic pages (`revalidate = 0`), admin aggregation pages, API upload body limits, advisory locks, pool sizing, background queues, scripts that bypass web guards, directory cleanup loops, client hydration of large lists/maps, semantic vector scans, non-sargable date/text predicates, generated/static cache behavior, and schema/index coverage.
- No implementation, tests, build, lint, commits, pushes, deploys, or container operations were performed due the PROMPT 1 read-only boundary.
- Recommended validation before fixes: `EXPLAIN ANALYZE` for PERF-C14-04, PERF-C14-05, PERF-C14-07, PERF-C14-09, and PERF-C14-10 on production-like data; browser performance trace for PERF-C14-03; RSS profiling for PERF-C14-12; operational load test for PERF-C14-01 and PERF-C14-02.
