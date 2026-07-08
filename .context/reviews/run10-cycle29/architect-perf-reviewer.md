# Run-10 Cycle 29 Architect / Performance Review

Reviewer: architecture/performance
Date: 2026-07-08 KST
HEAD: `d985f549afa73b23cdccf5d8fea30f4bfc840847`
Branch: `master`
Scope: architecture drift, schema/migration/reconcile consistency, derived list/source-contract drift, concurrency and pool budget, expensive queries, memory/CPU paths, service worker/cache invariants, deployment/ops contracts.

## Verdict

No new actionable architecture/performance findings were found at current HEAD.

Confidence: High. This review inspected current source and tests only, checked current Run-10 Cycle 28 deferred exit criteria, and avoided re-filing already tracked scale/operator backlog whose exit conditions were not met by current HEAD.

## Inventory

| Surface | Current source/test regions inspected | Result |
| --- | --- | --- |
| Schema, migrations, reconcile | `apps/web/src/db/schema.ts:25-153`, `apps/web/src/db/schema.ts:244-325`, `apps/web/scripts/migrate.js:348-501`, `apps/web/scripts/migrate.js:720-734`, `apps/web/scripts/migrate.js:803-993`, `apps/web/drizzle/meta/_journal.json:201-220` | Current committed schema, legacy reconcile, journal cursor handling, and post-migration hash assertion remain aligned for the reviewed surfaces. |
| Derived public/admin lists and privacy contracts | `apps/web/src/lib/search-enrichment-fields.ts:29-47`, `apps/web/src/lib/data-timeline.ts:36-68`, `apps/web/src/lib/settings-hash.ts:44-103`, `apps/web/src/lib/gallery-config-shared.ts:26-85`, `apps/web/src/__tests__/privacy-fields.test.ts:41-79`, `apps/web/src/__tests__/privacy-fields.test.ts:112-162` | Source-contract tests and compile-time guards cover the reviewed public select lists and sensitive-key omissions. No new list drift was found. |
| Query shape and expensive read paths | `apps/web/src/lib/data.ts:586-650`, `apps/web/src/lib/data.ts:802-947`, `apps/web/src/lib/data.ts:1473-1817`, `apps/web/src/lib/data-timeline.ts:103-157`, `apps/web/src/lib/data-timeline.ts:196-223` | Current known scale-sensitive shapes are bounded or already carried forward. No new unbounded query path was introduced at current HEAD. |
| Semantic/vector CPU and memory paths | `apps/web/src/app/api/search/semantic/route.ts:107-184`, `apps/web/src/app/api/search/semantic/route.ts:247-368`, `apps/web/src/app/api/search/similar/[id]/route.ts:68-131`, `apps/web/src/app/api/search/similar/[id]/route.ts:137-285`, `apps/web/src/lib/clip-embeddings.ts:36-48`, `apps/web/src/lib/clip-embeddings.ts:139-206` | Request-thread vector scans remain hard-capped and are already tracked as deferred scale work. No new vector retention or scoring invariant drift was found. |
| Concurrency and pool budget | `apps/web/src/lib/image-queue.ts:121-153`, `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `apps/web/src/lib/admin-backfill-runner.ts:363-434`, `apps/web/scripts/backfill-color-pipeline.ts:325-388`, `apps/web/src/lib/maintenance-scheduler.ts:52-86` | Independent background caps still match the documented near-saturation model. No new overlapping worker lane or missing single-flight guard was found. |
| Service worker and cache invariants | `apps/web/public/sw.template.js:59-64`, `apps/web/public/sw.template.js:109-145`, `apps/web/public/sw.template.js:279-296`, `apps/web/public/sw.template.js:312-501`, `apps/web/public/sw.template.js:533-567`, `apps/web/src/lib/sw-cache.ts:100-163`, `apps/web/src/lib/sw-cache.ts:221-252`, `apps/web/src/lib/sw-cache.ts:284-313` | Revocable/admin exclusions, metadata mutation serialization, LRU eviction, and stale image revalidation remain covered by mirrored pure logic and template tests. |
| Deployment and ops contracts | `apps/web/deploy.sh:51-108`, `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:46-79`, `apps/web/nginx/default.conf:99-180`, `.context/plans/run10-cycle28/deferred.md:13-16` | Deploy health/prune and nginx topology caveats match current documented operations. Existing real-IP/operator validation remains deferred, not a newly proven code defect. |

## Findings

None.

## Deferred Exit Criteria Checked, Not Re-filed

These are not counted as new findings. They remain relevant architecture/performance risks, but current HEAD did not meet the documented exit criteria for re-filing.

1. Background DB pool overlap remains a known capacity risk, not a new regression.
   Evidence: the image queue caps itself at the smaller of a configured limit and half the pool in `apps/web/src/lib/image-queue.ts:121-153`; admin backfill applies an independent half-pool reservation in `apps/web/src/lib/admin-backfill-runner.ts:97-143`; backfill candidate discovery uses count plus keyset batch reads in `apps/web/src/lib/admin-backfill-runner.ts:393-434`; one-off sidecar backfill uses a separate process lock and configurable concurrency in `apps/web/scripts/backfill-color-pipeline.ts:325-388`.
   Failure scenario if the deferred item fires: the in-process image queue, admin backfill, and normal web requests overlap under pool size 10, saturating all but one connection and causing request latency or pool queue growth.
   Fix direction: add a shared process-wide DB budget allocator for background lanes, or make one lane observe the other's active budget before starting work. This should be paired with a stress test that runs both background lanes together.

2. Semantic and similar search still score vectors in the request path, but with existing hard caps.
   Evidence: public semantic search gates content type, same-origin, maintenance, and rate limit before embedding work in `apps/web/src/app/api/search/semantic/route.ts:107-184`; it scans and scores up to the semantic cap in `apps/web/src/app/api/search/semantic/route.ts:247-311`; similar search applies the same production/rate-limit shape in `apps/web/src/app/api/search/similar/[id]/route.ts:68-131` and scores candidate vectors in `apps/web/src/app/api/search/similar/[id]/route.ts:137-214`; hard caps live in `apps/web/src/lib/clip-embeddings.ts:36-48`, and vector decode avoids avoidable copies in `apps/web/src/lib/clip-embeddings.ts:139-206`.
   Failure scenario if the deferred item fires: embedding cardinality approaches the hard scan cap during concurrent public search traffic, concentrating CPU in Node request workers and increasing tail latency.
   Fix direction: move vector candidate search behind an indexed/vector service, precomputed ANN table, worker queue, or DB-native vector index before raising caps.

3. Public query scale risks are already tracked and remain bounded by existing caps.
   Evidence: public keyword search still includes leading-wildcard and tag `EXISTS` predicates in `apps/web/src/lib/data.ts:1574-1749`; map markers are capped by `MAP_MAX_MARKERS = 10000` in `apps/web/src/lib/data.ts:1766-1817`; sitemap IDs cap at 50,000 in `apps/web/src/lib/data.ts:1752-1764`; On This Day and distinct-year helpers still use function predicates in `apps/web/src/lib/data-timeline.ts:103-157`, while the main year timeline page uses a range predicate and limit in `apps/web/src/lib/data-timeline.ts:196-223`.
   Failure scenario if the deferred item fires: public search or map traffic over a much larger corpus forces broad scans and creates slow MySQL responses despite request-level limits.
   Fix direction: add search-specific indexes/materialized tables or generated date parts, then replace function/leading-wildcard predicates with sargable access paths.

4. Service-worker image revalidation still uses bounded HEAD probes, which is already tracked as a low-priority scale concern.
   Evidence: the service worker excludes revocable share, smart collection, map, and admin-rendered HTML from offline fallback in `apps/web/public/sw.template.js:59-64` and `apps/web/public/sw.template.js:446-501`; image stale-while-revalidate schedules cache touches and revalidation in `apps/web/public/sw.template.js:312-444`; metadata writes serialize through `withMetaMutation` in `apps/web/public/sw.template.js:279-296`; the pure cache contract mirrors this behavior in `apps/web/src/lib/sw-cache.ts:100-163`, `apps/web/src/lib/sw-cache.ts:221-252`, and `apps/web/src/lib/sw-cache.ts:284-313`.
   Failure scenario if the deferred item fires: many cached images are viewed under weak networking and the 300 ms HEAD timeout still creates client-side contention or battery/network waste.
   Fix direction: switch image freshness to manifest/version-driven invalidation or coalesced background refresh before increasing cache scope.

5. Deployment readiness and proxy real-IP validation remain operator-contract items.
   Evidence: deploy waits on container health and `/api/live` in `apps/web/deploy.sh:51-77`, then prunes only after successful startup in `apps/web/deploy.sh:79-108`; nginx declares the Docker-network trust caveat in `apps/web/nginx/default.conf:20-29`; upload/admin body limits and forwarded header behavior are in `apps/web/nginx/default.conf:46-79` and `apps/web/nginx/default.conf:99-180`; Cycle 28 deferred exit criteria for proxy validation remain open in `.context/plans/run10-cycle28/deferred.md:13-16`.
   Failure scenario if the deferred item fires: production proxy topology changes or shared-IP anomalies make rate limits unfair, or `/api/live` passes while DB-dependent user paths fail.
   Fix direction: run the host-nginx validation runbook with operator authority, then either document the confirmed topology or change trusted real-IP/probe behavior. This review did not make production network changes.

## Validation Evidence

- `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/settings-hash.test.ts src/__tests__/sw-cache.test.ts src/__tests__/sw-template-contract.test.ts src/__tests__/migrate-pending-migrations.test.ts src/__tests__/image-queue-concurrency-cap.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts`
  - Result: passed, 8 test files, 169 tests.
- `npm run lint:public-route-rate-limit --workspace=apps/web`
  - Result: passed.
- `npm run lint:action-origin --workspace=apps/web`
  - Result: passed.

Full lint, typecheck, build, full Vitest, e2e, production deploy, host-nginx validation, and load testing were not run for this read-only reviewer artifact.

## Exit Check

Stop condition met: current-HEAD architecture/performance review completed, source/test inventory captured, prior current-cycle deferred items checked, no new findings filed, and the review artifact written for Run-10 Cycle 29.
