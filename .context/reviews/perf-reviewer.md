# Performance reviewer — cycle 4 provenance

Review target: `01d39653`, 2026-07-18 KST. Review only.

## Inventory and review coverage

I classified the complete maintained product inventory before review: all public/admin SSR and route handlers, every data/analytics/search query, 61 components, Sharp/color/HDR/CLIP paths, queue/backfill/maintenance writers, DB schema/migrations, PWA caches, upload/restore pipelines, deploy/container assets, 369 unit-test files, 12 Playwright files, and operating/deferred documentation. I reviewed the full Cycle 3-to-HEAD diff and swept CPU, memory, I/O, request waterfalls, DB-pool occupancy, pagination/cardinality, hydration, layout, listeners/timers, and image scheduling across the rest of the repository.

API/auth/action/rate-limit gates, typecheck, focused tests, and diff hygiene passed. Production SSR now emits one eager masonry image and no longer emits the invalid first-N media preload set.

## New performance findings

No new runtime performance defect was confirmed at this HEAD. `d2ef7817` intentionally trades speculative desktop first-row acceleration for correct identity ownership under browser-balanced CSS columns; viewport-native lazy loading still discovers the other visible column leaders. The remaining obsolete preload comments/dead policy parameters are recorded as `CR-C4-02` / `ARCH-C4-02`, not inflated into a measured performance regression.

## Revalidated carry-forward performance findings

### PERF-C4-R1 — Independent background workers reserve the same DB-pool capacity

- Severity: **High**
- Confidence: **High**
- Status: **Confirmed carry-forward; not new**
- Regions: `apps/web/src/db/index.ts:21-45`; `apps/web/src/lib/image-queue.ts:120-152`; `apps/web/src/lib/admin-backfill-runner.ts:97-142`; `apps/web/src/lib/background-db-writes.ts`

The image queue and in-app backfill compute independent concurrency budgets against the same pool, while analytics/background writes and request traffic share the remaining connections.

Concrete failure: queue processing overlaps a two-worker backfill at the shipped 10-connection pool, leaving approximately one connection for public/admin traffic and causing pool waits or request latency spikes.

Suggested fix: introduce a shared weighted background admission controller or mutual exclusion for the high-cost workers, with foreground reserve telemetry and an overlap stress test.

### PERF-C4-R2 — The public map can hydrate thousands of duplicate marker/list records

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed carry-forward; exit criterion has not fired in repository evidence**
- Regions: `apps/web/src/lib/data.ts:1759-1816`; `apps/web/src/app/[locale]/(public)/map/page.tsx:42-109`; `apps/web/src/components/map/map-client.tsx:77-145`

The bounded query can still serialize up to 10,000 geotagged records and render marker data plus an accessible fallback list.

Concrete failure: a large gallery pays a multi-megabyte RSC/client payload and long map/list hydration before interaction.

Suggested fix: when production cardinality triggers the documented threshold, use clustered viewport fetch and paginate or virtualize the accessible list.

### PERF-C4-R3 — Semantic and similar routes repeat bounded blob transfer/decode/ranking

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed carry-forward**
- Regions: `apps/web/src/app/api/search/semantic/route.ts:263-353`; `apps/web/src/app/api/search/similar/[id]/route.ts:137-270`

Each request re-reads and decodes the embedding window and ranks vectors in the web process.

Concrete failure: concurrent semantic requests repeatedly move and decode the same blobs, consuming DB bandwidth and CPU even though scan caps prevent unbounded work.

Suggested fix: at production activation/scale, adopt a model-versioned bounded in-memory snapshot/index or vector store with explicit invalidation and memory limits.

## Final missed-issue sweep

The closing sweep covered query/index alignment, pagination and bounds, Sharp/CLIP concurrency, combined pool occupancy, service-worker cache mutation, image srcset/sizes/eager output, client state growth, observers, timers, and deploy cleanup. No additional new performance issue survived validation.
