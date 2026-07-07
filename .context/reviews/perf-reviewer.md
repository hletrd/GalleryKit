# Cycle 20 Performance / Concurrency Review

Role lane: perf-reviewer
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Write scope: `.context/reviews/perf-reviewer.md`

## Review Method

Read first: `AGENTS.md` and `CLAUDE.md`.

Built an inventory from `rg --files`, then reviewed every performance-relevant source/config surface under `apps/web/src`, `apps/web/scripts`, `apps/web/public`, `apps/web/drizzle`, plus root/package/deploy config. Generated `.next` output and binary image/font fixtures were excluded as non-source artifacts. Runtime production measurements were not available in this lane, so DB-plan and CPU/RSS claims below are source-level unless explicitly marked as manual-validation risks.

## Inventory and Files Examined

Primary source/config inventory examined:

- Next.js App Router pages and route handlers: `apps/web/src/app/**`
- Server actions: `apps/web/src/app/actions/**`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Data/query layer: `apps/web/src/lib/data.ts`, `analytics-data.ts`, `analytics.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `search-enrichment-fields.ts`, `smart-collections.ts`, `sql-like.ts`
- DB/pool/schema/migrations: `apps/web/src/db/*`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`
- Queue/concurrency/lifecycle: `image-queue.ts`, `admin-backfill-runner.ts`, `maintenance-scheduler.ts`, `background-db-writes.ts`, `queue-shutdown.ts`, `single-writer-guard.ts`, advisory-lock helpers, restore-maintenance helpers
- Image/color/CLIP processing: `process-image.ts`, `process-topic-image.ts`, `clip-model.ts`, `clip-inference.ts`, `clip-embeddings.ts`, `color-detection.ts`, `gain-map-detection.ts`, `icc-*`, `gps-exif-strip.ts`, backfill scripts
- Cache/serving/PWA: `serve-upload.ts`, `sw-cache.ts`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `next.config.ts`, `nginx/default.conf`
- Client responsiveness: gallery/search/lightbox/map/upload/admin components under `apps/web/src/components/**` and admin/public route clients
- Operational scripts/config: `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `scripts/*.ts`, `scripts/*.js`, `scripts/*.mjs`

Pattern sweeps covered `Promise.all`, `Promise.allSettled`, `PQueue`, timers, browser listeners, observers, workers, object URLs, service-worker caches, dynamic route/cache directives, DB locks, raw SQL, `COUNT`, `GROUP BY`, `LIKE`, Sharp calls, CLIP inference, revalidation, and cache headers.

## Confirmed Issues

### C20-PERF-01 - Background image queue and admin backfill have independent CPU/DB budgets

- Severity: High
- Confidence: High
- File/region: `apps/web/src/db/index.ts:31-45`; `apps/web/src/lib/image-queue.ts:121-153`, `441`, `868-883`; `apps/web/src/lib/admin-backfill-runner.ts:106-143`, `716-727`; `apps/web/src/lib/process-image.ts:36-57`, `1205-1418`

`image-queue.ts` and `admin-backfill-runner.ts` each derive a safe-looking concurrency from the same 10-connection MySQL pool, but neither budget accounts for the other. The upload queue creates its own `PQueue` from `QUEUE_CONCURRENCY`; the admin backfill creates another `PQueue` from `ADMIN_BACKFILL_CONCURRENCY`. Each image job then calls `processImageFormats()`, which runs WebP, AVIF, and JPEG generation in parallel while Sharp has a process-wide native thread cap.

Failure scenario: the upload queue is processing images while an admin starts a color/format backfill. With the default pool, both lanes can independently choose concurrency 2. The backfill also holds a whole-run advisory-lock connection, workers can hold per-image advisory-lock connections, and both lanes do DB reads/writes around Sharp work. Four active image jobs can fan out into three format encoders each, multiplied by Sharp's native concurrency. Public SSR, search, analytics writes, and CLIP requests then compete with a nearly saturated DB pool and oversubscribed CPU.

Concrete fix: add one process-wide background-work budget shared by upload processing, admin backfills, semantic embedding bootstrap, and related side effects. Acquire tokens before DB advisory locks and before Sharp encoding, or make admin backfills pause/refuse while foreground queue work is active. Consider serializing per-image format generation when multiple image jobs are already active. Add a source-contract or unit test proving combined queue + backfill concurrency cannot exceed the shared budget.

### C20-PERF-02 - Gallery listing indexes omit the final `id` ordering/cursor key

- Severity: Medium
- Confidence: Medium
- File/region: `apps/web/src/db/schema.ts:123-131`; `apps/web/src/lib/data.ts:761-783`, `806-828`, `918-939`, `1498-1509`, `1522-1544`

Public gallery and smart-collection queries order and page by `capture_date`, `created_at`, and `id`; the cursor condition also uses `id` as the final tie-breaker. The main listing indexes stop at `created_at`: `idx_images_processed_capture_date(processed, capture_date, created_at)` and `idx_images_topic(topic, processed, capture_date, created_at)`.

Failure scenario: imports or burst uploads create many rows with identical `capture_date`/`created_at`, or many `NULL` capture dates. Cursor and first-page queries must still sort/filter ties by `id`, but the selected indexes do not cover that final key. On larger galleries this can turn otherwise bounded keyset pagination into extra filesort/temp-table work, amplified by grouped tag aggregation and `revalidate = 0` public pages.

Concrete fix: add schema and migration coverage for indexes matching the full query order, for example `(processed, capture_date, created_at, id)` and `(topic, processed, capture_date, created_at, id)`, with direction chosen from production MySQL support and verified plans. Run `EXPLAIN ANALYZE` for home, topic, load-more cursor, and smart-collection branches before dropping older overlapping indexes.

### C20-PERF-03 - Public keyword search is rate-limited but still does leading-wildcard scans

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/app/actions/public.ts:247-317`; `apps/web/src/lib/data.ts:1574-1584`, `1637-1655`, `1693-1737`; `apps/web/src/lib/sql-like.ts:9-10`

The public search action accepts two-code-point queries, consumes a DB-backed rate limit, then calls `searchImages()`. The SQL path uses `%term%` matching across image title, description, camera/lens metadata, topic fields, tag names, and topic aliases. The response limit caps returned rows but does not make the leading-wildcard predicates sargable.

Failure scenario: broad two-character queries such as common Korean syllables or short English fragments are submitted repeatedly from one or more IPs. Each accepted search can scan large portions of `images`, joined topic rows, and tag relationships, then group/order/limit results. This burns DB CPU and pool slots in the same process that handles dynamic SSR and background processing.

Concrete fix: move public keyword search to a search-specific indexed path: MySQL FULLTEXT/ngram where available, a materialized `image_search_terms` table, or another indexed token store. Short-term guards: raise the minimum keyword length, cache hot search results for a short TTL, and add statement timeouts or MySQL `MAX_EXECUTION_TIME` for search branches. Capture `EXPLAIN ANALYZE` for main/tag/alias branches at production row counts.

### C20-PERF-04 - Public smart collections can encode expensive unindexed predicates on every hit

- Severity: Medium
- Confidence: Medium
- File/region: `apps/web/src/lib/smart-collections.ts:142-148`, `221-223`, `250-267`, `316-352`; `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17`, `96-112`; `apps/web/src/lib/data.ts:1488-1551`

Smart collection JSON has structural budgets, but public collections can still contain `contains` predicates compiled to `%LIKE%`, tag `contains` subqueries, and broad OR groups. The public collection page is `revalidate = 0`; every request parses/compiles the saved query and runs the dynamic condition, while the first page also runs the row query and total count.

Failure scenario: an admin accidentally publishes a broad smart collection with many text/tag `contains` predicates over camera, lens, topic, tag, or other metadata. Crawlers or normal users hitting `/c/[slug]` repeatedly cause full or temp-table scans over `images`, `tags`, and `image_tags`, even though only 30 rows render.

Concrete fix: classify smart-collection query cost at save time. For public collections, restrict or warn on `contains`, broad OR groups, and non-indexed fields; prefer equality/range predicates backed by indexes. For expensive public collections, materialize membership into a table refreshed on image/tag changes and serve from that table. Add plan tests for representative public smart-collection predicates.

### C20-PERF-05 - Semantic and similar-photo routes perform request-local vector scans in Node

- Severity: Low
- Confidence: High
- File/region: `apps/web/src/db/schema.ts:292-304`; `apps/web/src/lib/clip-embeddings.ts:22-48`; `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`

The CLIP routes are bounded by `SEMANTIC_SCAN_LIMIT`, top-k selection, and rate limits, which prevents unbounded work. The remaining shape is still CPU and memory intensive per accepted request: select recent embedding blobs from MySQL, decode them into JS/typed arrays, score each row in Node, then top-k rank locally.

Failure scenario: production semantic search is enabled and several users run semantic queries or open similar-photo panels while image backfills are active. Each request consumes DB bandwidth, heap for decoded embeddings, and CPU for dot products in the same process that is already doing Sharp and SSR work. The cap makes this a scaling limit rather than an immediate correctness bug.

Concrete fix: move similarity search to a vector/ANN index or a process-owned preloaded vector matrix with refresh/version invalidation. Intermediate steps: add a semantic-search concurrency budget, cache hot text-query and target-image results briefly, and expose scan counts/latency in telemetry so the cap can be tuned from production data.

## Likely Issues

The confirmed issues above include the current likely source-level risks. I did not find a separate likely issue that was strong enough to report without production DB plans or runtime measurements.

## Manual-Validation Risks

- DB query plans: run production-sized `EXPLAIN ANALYZE` for home/topic/listing cursor queries, smart collections, public search, semantic/similar enrichment, feed/sitemap, and analytics breakdowns. This is required to rank C20-PERF-02 through C20-PERF-04 accurately.
- CPU/RSS envelope: profile concurrent uploads + admin backfill + semantic inference on the deploy host. Source review confirms overlapping budgets; only live profiling can set the right shared token counts.
- Browser responsiveness: run Lighthouse/Chrome Performance traces for the gallery, lightbox, search, upload, analytics dashboard, and map on representative mobile hardware. Static review found cleanup and worker bounds, but not frame-time evidence.
- Service worker behavior: validate cache pressure and stale-image revalidation in a real browser profile with enough derivatives to exceed the 50 MB cap.
- Nginx limits: source config has public/page and image limiter rules, but live host application of `apps/web/nginx/default.conf` is operator-owned per `CLAUDE.md`; verify on the deployed host before relying on it.

## Final Missed-Issues Sweep

Additional sweeps looked for commonly missed performance/concurrency issues: unbounded `Promise.all`, runaway timers, missing listener cleanup, worker leaks, unreclaimed object URLs, unbounded service-worker caches, missing abort handling, fire-and-forget DB writes, cache invalidation storms, DB advisory-lock leaks, Sharp cache/thread misuse, and N+1/count scans.

No additional reportable issues were found in these areas:

- Service worker cache pressure: `apps/web/public/sw.template.js` and generated `sw.js` have image byte caps, metadata trimming, offline page limits, HEAD timeouts, and LRU-style cleanup.
- Browser resource cleanup: reviewed search abort controllers, histogram worker lifecycle, resize/requestAnimationFrame cleanup, object URL revocation, and listener removal were present in the relevant components.
- Background write queues: analytics/background DB write queues are bounded and drained during shutdown through `maintenance-scheduler.ts`, `background-db-writes.ts`, and `instrumentation.ts`.
- Image processing safety: Sharp global concurrency/cache settings, input pixel caps, temp-file atomic writes, stale-temp cleanup, and retry paths are present. The remaining issue is combined cross-lane budgeting, not missing per-lane bounds.
- Next.js route behavior: dynamic public pages intentionally use `revalidate = 0`; route handlers reviewed had cache headers, rate limits, or explicit no-store behavior appropriate to their current surfaces.
- Cache invalidation: static derivative invalidation relies on atomic rewrite mtime/size and route-served derivatives use settings-hash ETags; no new invalidation bug found beyond the documented operational need to re-encode after byte-impacting setting changes.

Findings: 5 confirmed, 0 additional likely-only findings.
