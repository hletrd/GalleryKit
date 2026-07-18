# Performance reviewer — cycle 3 provenance

Review target: `afa11cf4`, 2026-07-18 KST. Review only.

## Inventory and review coverage

The complete 939-file inventory was classified before review: public/admin SSR and route handlers, all data/analytics/search queries, 61 client components, image/Sharp/CLIP pipelines, queue/backfill/maintenance writers, DB pool/schema/migrations, PWA caches, uploads/restores, deploy/container assets, 368 unit tests, 12 browser files, and operating docs/deferred history. I traced CPU, memory, I/O, DB occupancy, request waterfalls, hydration, timers/listeners, pagination/cardinality, and recent diffs. ESLint, architectural linters, and typecheck passed. A focused headless-Chromium layout experiment validated CSS-column geometry rather than relying on comments or final DOM attributes.

## Genuinely new cycle-3 finding

### PERF-C3-01 — Desktop preloads below-fold cards while missing visible column leaders

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed new cycle-3 finding**
- Regions: `apps/web/src/components/home-client.tsx:129-169,272-314,363-375`; `apps/web/src/components/masonry-card.tsx:21-33,121-145`; analogous first-N scheduling in `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:187-196,244-245` and archive pages at `timeline/page.tsx:138,227-282` / `year/[year]/page.tsx:131,189-241`

The new responsive preloads correctly avoid mobile through `media`, but select cards by row-major DOM index. CSS columns are column-major/balanced. In Chromium, 20 equal 180 px cards in four columns yielded visual top indices `0,5,10,15`; the code preloads `1,2,3` for four columns and gives indices `0..3` eager/high after hydration. Those requests target cards down column 1 while top cards in later columns receive no explicit priority.

Concrete failure: a cold desktop gallery competes for bandwidth on below-fold derivatives and can leave the actual largest above-fold photo at lazy/auto priority, worsening LCP—the inverse of the change's purpose. Variable image heights make a static first-N correction impossible under the current layout.

Suggested fix: immediately constrain explicit preload/high priority to the first universally visible item. For multi-card priority, make layout placement deterministic (explicit columns/grid derived from dimensions) or measure actual geometry before issuing lower-priority opportunistic preloads. Add cold-cache request/geometry E2E coverage; the current string fixture at `masonry-card-memo.test.ts:115-123` cannot measure the waterfall.

## Revalidated carry-forward performance findings (not new)

### PERF-C3-R1 — Queue and in-app backfill independently spend the same DB reserve

- Severity/Confidence: **High / High** (preserved carry-forward classification)
- Regions: `apps/web/src/db/index.ts:21-45`; `apps/web/src/lib/image-queue.ts:120-152`; `apps/web/src/lib/admin-backfill-runner.ts:97-142`

At the 10-connection pool, queue and backfill can each admit two workers while the backfill pins its run lock. Their independent proofs do not compose and can consume about nine connections before live request, analytics, or maintenance work. Use one weighted background admission budget or quiesce the queue during in-app backfill.

### PERF-C3-R2 — Public map duplicates up to 10,000 records into map and fallback UI

- Severity/Confidence: **Medium / High**
- Regions: `apps/web/src/lib/data.ts:1759-1791`; `apps/web/src/app/[locale]/(public)/map/page.tsx:42-109`; `apps/web/src/components/map/map-client.tsx:77-140`
- Status: unchanged carry-forward; exit criterion has not fired in repository evidence

The bounded query still serializes thousands of markers and renders a duplicate accessible list. Use clustering/viewport fetch plus paginated or virtualized accessible results when production cardinality warrants it.

### PERF-C3-R3 — Semantic routes repeat bounded blob transfer/decode/ranking

- Severity/Confidence: **Medium / High**
- Regions: `apps/web/src/app/api/search/semantic/route.ts:263-353`; `apps/web/src/app/api/search/similar/[id]/route.ts:137-270`
- Status: unchanged carry-forward

Each request reads and decodes the same embedding window and ranks it in the web process. Keep the bounded limits; at activation/scale, move to a model-versioned in-memory snapshot/index or vector store with explicit invalidation and memory limits.

## Final missed-issue sweep

I rechecked query/index alignment, non-sargable archive/search predicates, pagination, buffer materialization, Sharp and CLIP concurrency, combined pool occupancy, service-worker cache mutations, image srcset/sizes/preload output, client state growth, observers/listeners, route freshness, and deploy cleanup. The new masonry scheduling defect is the only new performance issue supported by direct runtime evidence; all other surviving items map to established deferred rows and were not double-counted.
