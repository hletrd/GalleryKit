# Cycle 9 Performance / Concurrency / Resource Review

Role: `perf-reviewer`
Scope: whole-repository read-only review from performance, concurrency, CPU/memory, DB, image pipeline, caching, and UI responsiveness angles.
Mutation boundary: report artifact only. No application code, schema, config, deploy script, service, database, or generated asset was changed.

## Inventory

- Read first: `AGENTS.md`, `CLAUDE.md`.
- Built inventory: 6,822 first-party review-relevant text files after excluding dependency/build/runtime output (`.git`, `node_modules`, `.next`, generated test results); focused source inventory under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, and `apps/web/nginx` contained 685 files.
- Reviewed performance-relevant surfaces across the repo: data access/query composition, migrations/indexes, queue/backfill/restore concurrency, public/admin rate limits, semantic search, image processing/deletion, upload paths, service worker/cache policy, public pages and React islands, admin UI flows, deployment scripts, and committed plan/review history for prior accepted performance debt.
- Final sweep searched for missed patterns: unbounded/large result sets, `revalidate = 0` hot paths, `GROUP BY`/`GROUP_CONCAT`, leading-wildcard `LIKE`, queue/concurrency fan-out, repeated directory scans, DB pool pressure, large client hydration, service-worker quota growth, and deploy disk/CPU hazards.

## Findings

### PERF-C9-01: Batch image deletion does O(images x formats x directory size) derivative scans

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Location: `apps/web/src/app/actions/images.ts:735-744`, `apps/web/src/app/actions/images.ts:759-884`, `apps/web/src/lib/process-image.ts:575-664`

Single and batch delete intentionally pass `[]` to `deleteImageVariantsStrict()` so old size variants are removed. In `collectImageVariantFilenames()`, `sizes.length === 0` opens and scans the whole derivative directory. `deleteImages()` caps the batch at 100 IDs and chunks by `IMAGE_CLEANUP_CONCURRENCY`, but each selected image still scans WebP, AVIF, and JPEG directories separately.

Concrete failure scenario: deleting 100 photos on a NAS-backed deployment with tens of thousands of derivative files per format performs up to 300 full directory walks, with five images scanning concurrently by default. The admin action can run for a long time, contend with image serving and encoder writes, and create visible dashboard latency.

Suggested fix: add a batch cleanup helper that scans each derivative directory once, indexes entries by selected base filename prefixes, and deletes all matches. Keep deterministic current-size deletes inline, and move historical-orphan cleanup to a one-shot low-priority sweep when image sizes change.

### PERF-C9-02: Hourly maintenance sweeps can overlap and contend with themselves

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Location: `apps/web/src/lib/maintenance-scheduler.ts:32-45`, `apps/web/src/lib/maintenance-scheduler.ts:61-69`, `apps/web/src/lib/view-retention.ts:64-87`

`runMaintenanceSweep()` tracks active promises so restore can drain them, but it does not single-flight. `startMaintenanceScheduler()` calls it at startup and every hour. The view-retention task can delete up to 200 batches of 5,000 rows from each of three view tables per sweep.

Concrete failure scenario: after a traffic spike or long retention gap, a slow MySQL/NAS host spends more than one hour purging old view rows. The next interval starts another sweep before the first completes, doubling delete pressure and lock/index churn while public view writes and page queries continue sharing the same DB.

Suggested fix: add an in-flight guard or promise reuse: if a sweep is active, skip/log the new interval. Preserve the active set for restore draining, but prevent concurrent sweep bodies.

### PERF-C9-03: Color-pipeline backfill candidate scans lack a supporting pipeline-version index

- Severity: Medium
- Confidence: Medium
- Status: Likely from query/index shape
- Location: `apps/web/src/lib/admin-backfill-runner.ts:390-428`, `apps/web/scripts/backfill-color-pipeline.ts:372-417`, `apps/web/src/db/schema.ts:117-125`, `apps/web/src/db/index.ts:21-41`

Both in-app and sidecar backfills select processed rows where `pipeline_version IS NULL OR pipeline_version < CURRENT`, with keyset pagination by `id`. The current image indexes cover processed/capture/update/topic paths, but none include `pipeline_version`. The in-app runner shares the live DB pool and explicitly reserves connections, which helps concurrency but does not remove the scan cost.

Concrete failure scenario: after an image pipeline bump on a large gallery, the admin status count and each backfill batch walk many processed rows to find stale candidates. While encoders are also consuming CPU and holding per-image advisory-lock connections, those scans can add DB CPU and queue latency for public pages.

Suggested fix: add a migration-backed index after measuring with `EXPLAIN ANALYZE`, likely starting with `(processed, pipeline_version, id)` for stale-candidate count/filtering. If preserving strict `ORDER BY id` is more important, compare `(processed, id, pipeline_version)` against realistic stale-row density. Mirror the index in `reconcileLegacySchema`.

### PERF-C9-04: Fresh public listing pages still aggregate tags before limiting rows

- Severity: Medium
- Confidence: Medium
- Status: Risk
- Location: `apps/web/src/lib/data.ts:786-829`, `apps/web/src/lib/data.ts:893-940`, `apps/web/src/app/[locale]/(public)/page.tsx:155-178`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:139-191`, `apps/web/src/app/actions/public.ts:132-164`

The count split removed the prior window-function materialization cost, but the row query still joins `image_tags`/`tags`, groups by `images.id`, computes `GROUP_CONCAT`, orders, and then applies `LIMIT 31`. Home and topic pages are `revalidate = 0`, and load-more calls reuse the same grouped listing shape.

Concrete failure scenario: a tag-heavy gallery grows from a few thousand to tens of thousands of processed images. Every uncached home/topic render and cursor page can spend DB work aggregating tags for rows outside the returned page, especially when topic/tag filters are broad.

Suggested fix: use a two-phase listing query: first select only page image IDs with the covering image index and cursor/order predicates, then join/aggregate tags for those IDs only while preserving order. Keep the existing lean count query separate.

### PERF-C9-05: Public smart collections can publish expensive unindexed predicates to uncached pages

- Severity: Medium
- Confidence: High
- Status: Likely from query/index shape
- Location: `apps/web/src/lib/smart-collections.ts:142-147`, `apps/web/src/lib/smart-collections.ts:221-267`, `apps/web/src/lib/sql-like.ts:5-10`, `apps/web/src/lib/data.ts:1488-1550`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17-111`, `apps/web/src/db/schema.ts:117-139`

Smart-collection AST shape is bounded, but `contains` compiles to `%term%` `LIKE`, tag `contains` runs through a subquery, and several allowed EXIF columns have no supporting indexes. The public collection route is dynamic and runs a grouped listing plus a separate exact count for the initial page.

Concrete failure scenario: an admin publishes a collection like `camera_model contains Sony OR lens_model contains 35` or broad ISO/focal-length filters. Crawlers or visitors repeatedly hitting `/c/[slug]` can force broad image scans, tag joins, grouping, and a second count before returning 30 tiles.

Suggested fix: classify predicates at save/publish time as index-friendly or expensive. Warn or block public publication of expensive shapes, add targeted indexes for supported public predicates, or materialize collection membership and refresh it on image/tag metadata changes.

### PERF-C9-06: Public map hydrates up to 10,000 markers plus a duplicate accessible list

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Location: `apps/web/src/lib/data.ts:1732-1782`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `apps/web/src/app/[locale]/(public)/map/page.tsx:89-110`, `apps/web/src/components/map/map-client.tsx:77-140`

`getMapImages()` is bounded, but the bound is 10,000 rows. The dynamic `/map` page maps that full set into client props, hydrates every React Leaflet marker/popup, and renders a second `<ul>` over the same marker array. `FitBounds` also allocates latitude/longitude arrays and spreads them into min/max.

Concrete failure scenario: a map-visible travel archive with 8,000-10,000 GPS photos causes a mobile map visit to ship a large RSC/client payload, hydrate thousands of markers and links, and stall the main thread before interaction.

Suggested fix: move to viewport/bounds loading with clustering or a canvas/WebGL marker layer. Lower the initial SSR marker cap, virtualize or paginate the accessible list, and compute bounds in one pass without spread arrays.

## Reviewed Without New Findings

- Image queue: concurrency is clamped against DB pool headroom, retries are bounded, per-image advisory locks prevent double encodes, and shutdown/restore drain paths account for side effects.
- Sharp/image pipeline: global `sharp.concurrency()` and `sharp.cache(false)` are set, input pixels are capped, outputs use atomic writes and cleanup, and the multi-format decode cost is an explicit quality/correctness tradeoff.
- Semantic search: public routes pre-increment rate limits before inference/scan, cap scan size, use top-K rather than full sort, and gate production mode. Brute force remains known scale debt, but no new unbounded path was found.
- Rate limits: public search/load-more have in-memory plus DB-backed counters; semantic routes are process-local by design under the documented single-instance topology.
- Service worker/cache: image and HTML caches are size/count bounded, metadata writes are serialized, and derivative cache policy avoids `immutable` because backfills rewrite bytes in place.
- Deploy/disk hygiene: deploy health-checks before pruning and avoids `volume prune -a`; current policy preserves bind-mounted data while reclaiming stale build artifacts.

## Final Sweep

No Critical or High performance/concurrency defect was confirmed in this static pass. The main remaining risks are bounded but scale-sensitive: repeated filesystem scans, overlapping maintenance, stale-candidate backfill scans, grouped listing queries, expensive public smart collections, and large map hydration.

Skipped from manual line-by-line review as non-source or generated/runtime material: dependency directories, `.next`, `.git`, binary image fixtures, and transient test/runtime state. They were inventoried as exclusion classes, not sampled as application logic. No load tests, browser traces, production MySQL `EXPLAIN`, or production deploy commands were run.
