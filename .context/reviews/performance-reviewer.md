# Cycle 30 Performance Reviewer Report

Review target: current HEAD `666b74f8704024bb1a1fa1faa02a8e34114e678c`
Review role: `performance-reviewer`
Mode: review-only. Product code was not changed.

## Inventory

Project context read:

- `AGENTS.md`
- `CLAUDE.md`

Current implementation surfaces reviewed:

- Public request paths: gallery homepage/topic pages, smart collections, keyword search, semantic search, similar search, map, timeline, feeds, sitemaps, share/OG routes.
- Background paths: image queue, CLIP embeddings, color-pipeline backfills, upload tracker, restore drains, shutdown drains.
- Runtime/deploy paths: Dockerfile, compose, deploy script, MySQL pool, service worker cache, nginx proxy headers, rate-limit DB and memory buckets.
- Client paths: masonry/load-more, search, semantic suggestions, map, service worker warm-cache behavior.

Static evidence only: no production profiles, browser traces, or `EXPLAIN ANALYZE` were run in this prompt. Findings below distinguish confirmed code behavior from likely operational bottlenecks and validation risks.

## Confirmed Issues

### PRF30-01 - Service worker image-cache LRU is not concurrency-safe

Severity: Medium
Confidence: High
Status: Confirmed issue

Code region:

- `apps/web/public/sw.template.js:100-130` (`recordAndEvict`)
- `apps/web/public/sw.template.js:161-175` (`touchMeta`)
- `apps/web/public/sw.template.js:177-181` (`deleteMeta`)
- `apps/web/public/sw.template.js:203-217` and `apps/web/public/sw.template.js:258-262` (call sites)

Concrete failure scenario:

Twenty image requests are handled concurrently by the same service worker during a masonry paint. Several call `recordAndEvict()` after network revalidation while several cached tiles call `touchMeta()`. Each operation reads the same metadata blob, mutates a local `Map`, and overwrites the whole blob. Later writes can erase earlier unrelated entries. The image cache then contains bytes that are no longer counted by metadata, so the documented 50 MB LRU cap becomes inaccurate and eviction misses orphaned cache entries.

Suggested fix:

Add a service-worker-local mutation queue such as `metaUpdateChain = metaUpdateChain.then(async () => { const entries = await getMeta(); mutate(entries); await setMeta(entries); })`. Keep all metadata writes, including delete/touch, inside that queue. Consider IndexedDB with transactional per-URL metadata if cache metadata grows.

### PRF30-02 - Operator color backfill sidecar has O(total candidates) memory and queue pressure

Severity: Medium
Confidence: High
Status: Confirmed issue

Code region:

- `apps/web/scripts/backfill-color-pipeline.ts:343-360` fetches all candidates.
- `apps/web/scripts/backfill-color-pipeline.ts:475-512` schedules all candidates before waiting for idle.
- `apps/web/src/lib/admin-backfill-runner.ts:394-423` is the contrasting batch/keyset implementation.

Concrete failure scenario:

An operator runs `backfill-color-pipeline.ts --force-reencode` after a color policy change. With 60,000 processed images, the script keeps the full candidate array and 60,000 queued closures in memory. Even at low encode concurrency, memory spikes before work drains; if the host is already running the web container and MySQL, the sidecar can pressure swap/OOM and slow the live site.

Suggested fix:

Use keyset batches. Fetch at most `BATCH_SIZE`, run the PQueue for that batch, flush updates, release references, advance the cursor, and repeat. This also makes progress reporting and partial reruns less expensive.

### PRF30-03 - Map route can exceed practical mobile hydration budgets despite a DB cap

Severity: Medium
Confidence: High
Status: Confirmed issue

Code region:

- `apps/web/src/lib/data.ts:1667-1685`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:41-60`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:87-96`
- `apps/web/src/components/map/map-client.tsx:86-90`
- `apps/web/src/components/map/map-client.tsx:119-140`

Concrete failure scenario:

The DB cap permits 10,000 map-visible photos. The page sends all markers to the client, then renders a Leaflet marker/popup for each plus a complete accessible list. A mobile client pays for route payload parsing, React hydration, Leaflet marker creation, list layout, and bounds calculation in one route load. The app can appear hung even though no single SQL query is unbounded.

Suggested fix:

Treat 10,000 as a server-side safety cap, not an initial-render target. Load by viewport and zoom, cluster markers, use a canvas/vector marker layer, and virtualize or page the fallback list. Use one-pass bounds calculation.

## Likely Issues

### PRF30-04 - Semantic search can monopolize request-thread CPU and memory when configured near its max

Severity: Medium
Confidence: High
Status: Likely issue

Code region:

- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/lib/clip-embeddings.ts:164-168`
- `apps/web/src/app/api/search/semantic/route.ts:270-311`
- `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`

Concrete failure scenario:

`SEMANTIC_SCAN_LIMIT=25000` is accepted. A burst of semantic and similar requests causes MySQL to return large embedding blobs. Node decodes them, scores every vector, filters and sorts the whole array, then enriches results. The CLIP inference queue controls model inference, but it does not limit this DB fetch/decode/sort phase. Event-loop delay and GC can degrade unrelated public routes.

Suggested fix:

Add a separate semaphore for scan/scoring and keep the configured limit conservative. Replace full-array sort with a min-heap, and chunk/yield CPU work if it remains in-process. Prefer a vector index or sidecar worker for production-scale search.

### PRF30-05 - Dynamic first-page listing queries compute exact grouped totals

Severity: Medium
Confidence: High
Status: Likely issue

Code region:

- `apps/web/src/lib/data.ts:878-907` (`getImagesLitePage`)
- `apps/web/src/lib/data.ts:1446-1460` (initial smart-collection query)

Concrete failure scenario:

Crawler traffic repeatedly hits public first pages. Each render does tag joins, grouping, chronological ordering, and `COUNT(*) OVER()` even though pagination could use only `pageSize + 1`. On a large tagged gallery, MySQL spends time counting every matching group to show a UI total while the user needs only the next page state.

Suggested fix:

Remove exact totals from unauthenticated dynamic pages or read them from cached rollups. Keep the count only in admin/reporting contexts where exactness is worth the cost.

### PRF30-06 - Leading-wildcard public search remains a DB CPU risk

Severity: Medium
Confidence: Medium
Status: Likely issue

Code region:

- `apps/web/src/lib/data.ts:1545-1563`
- `apps/web/src/lib/data.ts:1590-1621`
- `apps/web/src/lib/smart-collections.ts:221-223`
- `apps/web/src/lib/smart-collections.ts:261-267`

Concrete failure scenario:

Users search common text or an admin publishes a broad smart collection using `contains`. The query planner cannot use normal b-tree indexes for leading-wildcard terms, so it scans processed rows and joined tag/alias tables. Rate limits bound request count, not per-request DB cost.

Suggested fix:

Use a search index appropriate to the locale and partial-match requirements. For smart collections, consider a validation step that flags non-indexable public predicates before publish.

## Risks Needing Manual Validation

### PRF30-07 - Date archive queries are intentionally non-sargable and need scale validation

Severity: Low
Confidence: Medium
Status: Risk needing manual validation

Code region:

- `apps/web/src/lib/data-timeline.ts:97-116`
- `apps/web/src/lib/data-timeline.ts:129-145`
- `apps/web/src/lib/data-timeline.ts:186-207`

Concrete failure scenario:

With enough processed images, dynamic timeline and On This Day pages scan and evaluate date functions per row. This may be acceptable for the current gallery, but the comments already mark the scale boundary.

Suggested fix:

Run `EXPLAIN ANALYZE` on production-like data. If scans are material, rewrite year/month to date ranges and add generated/indexed month/day columns for On This Day.

### PRF30-08 - Proxy/IP configuration can turn per-client rate limits into shared global buckets

Severity: Medium
Confidence: Medium
Status: Risk needing manual validation

Code region:

- `apps/web/src/lib/rate-limit.ts:166-197`
- `apps/web/src/lib/rate-limit.ts:80-99` and `apps/web/src/lib/rate-limit.ts:115-124`

Concrete failure scenario:

If the deployment is behind an upstream TLS/load balancer and nginx/app headers are not preserving the actual client chain, `getClientIp()` can fall back to one proxy address or `unknown`. Then public search, OG/share, login, and admin-token buckets are bounded in memory, but keyed too coarsely. One abusive client can throttle all users, or all clients can share one hot DB bucket.

Suggested fix:

Validate live request headers from the deployed edge. Configure trusted real-IP handling and `TRUSTED_PROXY_HOPS` to match the actual chain. Add a deployment smoke check that reports the derived client IP for a known request through the edge.

### PRF30-09 - Queue/deploy shutdown budget may be too small for worst-case image side effects

Severity: Low
Confidence: Low
Status: Risk needing manual validation

Code region:

- `apps/web/src/lib/image-queue.ts:499-536` starts queue shutdown and waits for queue idle.
- `apps/web/src/lib/image-queue.ts:646-704` keeps Sharp encode and processed-row update inside a queue task.
- `apps/web/Dockerfile:140-143` uses a liveness healthcheck; deploy/runtime stop behavior depends on container stop grace and app shutdown drain behavior described in `CLAUDE.md`.

Concrete failure scenario:

A deployment or restart lands while one large image is encoding and post-processing side effects are pending. If the shutdown drain budget is shorter than the actual encode plus DB update window, the process can exit before the job reaches its final persisted state. Existing queue retry logic likely recovers, but users may see delayed derivatives or transient processing errors.

Suggested fix:

Measure worst-case encode duration on the deploy host with the largest expected originals and AVIF settings. Align app shutdown timeout, Docker stop grace, and deploy wait behavior to that measured window, or make long encode jobs explicitly resumable with shorter DB leases.

## Final Sweep Notes

- No unbounded rate-limit `Map` growth was confirmed. The bounded-map implementation enforces caps on `set()` and prune.
- No new UI stale-response race was confirmed in `load-more` or search; both guard duplicate/stale async responses. Their remaining risk is workload size, not stale state.
- No new Sharp cache leak was found. The pipeline disables libvips cache and uses temp-file/rename rollback for derivatives.
- No source area relevant to performance was intentionally skipped. Generated output, binary media, uploads/data, `.git`, `node_modules`, and historical screenshots were excluded.
