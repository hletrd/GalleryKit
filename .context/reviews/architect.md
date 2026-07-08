# Cycle 36 Architect Review

Role: `cycle-36 architect review worker`
Scope: whole repository static review from architecture, layering, coupling, ownership, and cross-file interaction angles.
Constraint: review-only. No production code was changed.
Date: 2026-07-08 KST

## Inventory First

Guidance read:

- `AGENTS.md`
- `CLAUDE.md`

Architecture-relevant inventory:

- Runtime/deploy topology: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/proxy.ts`
- DB/schema/migrations: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`
- Public data layer: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/photo-title.ts`
- Background coordination: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/scripts/backfill-color-pipeline.ts`
- Semantic ownership: `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`
- Restore/mutation boundaries: `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/advisory-locks.ts`, `apps/web/src/lib/advisory-lock-release.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Public/admin route boundaries: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/api/**/route.*`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`
- Storage/serving boundaries: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/storage/{index,local,types}.ts`

Cross-file interactions inspected:

- Single-writer assumptions in docs and runtime bootstrap versus process-local state in queues, rate limits, and view-count buffers.
- Public projection definitions across list, detail, map, timeline/year/on-this-day, and semantic enrichment routes.
- Advisory-lock ownership across live queue, in-app backfill, sidecar backfills, restore maintenance, and shutdown drains.
- Semantic work ownership across request routes, live bootstrap, admin action, and sidecar.
- Map data access and client rendering boundary.

## Findings

### ARCH-C36-01 - Background resource ownership is fragmented across independent modules

Severity: Medium
Confidence: High
Classification: confirmed

Exact file:line/region:

- `apps/web/src/db/index.ts:31-41` defines one 10-connection pool for the web process.
- `apps/web/src/lib/image-queue.ts:121-141` defines image-queue connection reservation and concurrency locally.
- `apps/web/src/lib/image-queue.ts:456` constructs a local PQueue with that concurrency.
- `apps/web/src/lib/admin-backfill-runner.ts:97-143` defines a separate backfill reservation formula over the same pool.
- `apps/web/src/lib/admin-backfill-runner.ts:722-733` constructs a separate local PQueue.
- `apps/web/src/lib/image-queue.ts:107-110` and `apps/web/src/lib/image-queue.ts:609-625` add a fixed semantic-embedding bootstrap concurrency inside the image queue module.
- `apps/web/src/app/actions/embeddings.ts:30` and `apps/web/src/app/actions/embeddings.ts:173-210` add a separate admin semantic backfill concurrency.
- `apps/web/src/lib/background-db-writes.ts:8-10` and `apps/web/src/lib/background-db-writes.ts:42-75` add another local queue for analytics/background writes.

Failure scenario:

The app is still deployed as a single writer, but within that process multiple background owners can be active at once: image processing, in-app color backfill, missing-embedding bootstrap, admin semantic backfill, analytics drains, and maintenance. Each owner has a reasonable local cap, but no shared architectural lease proves aggregate DB-bearing work stays below the foreground reserve. Under upload/backfill/search activity, foreground admin and public requests can queue behind background work even though every module is obeying its own contract.

Suggested fix:

Introduce a single background resource coordinator as a small internal service/module. It should expose typed leases such as `dbLockLane`, `dbBurstLane`, `cpuImageLane`, and `semanticInferenceLane`, and all background workers should acquire those leases before running work. Keep module-local queues for sequencing, but move capacity decisions to the coordinator. For sidecar processes, use a MySQL advisory lock or lease table so maintenance jobs can announce high-load periods to the web process.

### ARCH-C36-02 - Public image projection ownership is split between canonical and hand-mirrored field sets

Severity: Medium
Confidence: High
Classification: confirmed

Exact file:line/region:

- `apps/web/src/lib/data.ts:368-407` defines `publicSelectFields` as the canonical unauthenticated field set.
- `apps/web/src/lib/data.ts:450-475` exports public field keys and a privacy-sensitive compile-time guard.
- `apps/web/src/lib/data-timeline.ts:17-36` states that `timelineSelectFields` mirrors `publicSelectFields` from `data.ts`.
- `apps/web/src/lib/data-timeline.ts:36-61` hand-maintains a second public-safe projection.
- `apps/web/src/lib/data-timeline.ts:63-74` guards only sensitive-key leakage and exports timeline field keys.
- `apps/web/src/lib/data-timeline.ts:76-80` also hand-mirrors `tagNamesAgg` from `data.ts`.

Failure scenario:

A future change adds, removes, or renames a public-safe rendering field in `data.ts` for masonry/detail performance or UI behavior. The timeline/year/on-this-day projection in `data-timeline.ts` does not update because the guard only rejects sensitive fields; it does not enforce projection parity or shared query shape. The result can be inconsistent public UI behavior, missing optimization metadata, or accidental over-selection of fields in one path while tests still pass.

Suggested fix:

Move public projection construction into a shared data-layer helper instead of hand-copying object literals. One option is an exported public image projection factory from `data.ts` or a dedicated `public-image-select-fields.ts` module that can produce the base projection plus route-specific additions. Share the tag aggregation expression from the same module. Add a parity test that checks timeline/year/on-this-day projections intentionally equal the canonical public projection minus explicitly documented route omissions.

### ARCH-C36-03 - Semantic search and similar-photo routes duplicate a request-path vector-scan architecture

Severity: Medium
Confidence: High
Classification: risk

Exact file:line/region:

- `apps/web/src/app/api/search/semantic/route.ts:1-10` documents request-path embedding plus capped scan.
- `apps/web/src/app/api/search/semantic/route.ts:263-311` performs the DB scan, vector decode/scoring, and top-K ranking inline.
- `apps/web/src/app/api/search/semantic/route.ts:317-330` begins route-local enrichment after ranking.
- `apps/web/src/app/api/search/similar/[id]/route.ts:177-214` repeats scan and vector scoring for the similar-photo route.
- `apps/web/src/app/api/search/similar/[id]/route.ts:237-280` repeats enrichment/result shaping for similar-photo responses.
- `apps/web/src/lib/clip-model.ts:53-72` bounds CLIP inference with a process-local queue.
- `apps/web/src/lib/clip-model.ts:156-173` admits inference work with no cross-route or cross-process semantic service boundary.

Failure scenario:

Semantic search grows from a small-gallery feature into a core navigation path. Both public routes now own their own scan/rank flow and depend on request-path DB blob reads plus in-process vector scoring. A ranking, filtering, privacy, or scale change must be duplicated across both route handlers. Once gallery size exceeds the scan limit, results become "best among recent scanned embeddings" rather than "best in gallery", but that scale boundary is implicit in route code rather than represented as a service contract.

Suggested fix:

Extract a semantic retrieval service with one contract: inputs, model version, candidate policy, ranking policy, enrichment policy, and result privacy shape. Both public routes should call it. The service can initially keep the current capped scan implementation, but it should own telemetry and make the scale boundary explicit. That creates a clean migration point for a vector index, ANN table, precomputed neighbors, or worker-thread scorer without rewriting route handlers.

### ARCH-C36-04 - The map page crosses data, accessibility-list, and Leaflet rendering concerns in one route payload

Severity: Low
Confidence: High
Classification: likely

Exact file:line/region:

- `apps/web/src/lib/data.ts:1766-1775` documents that the map query cap is a stopgap until bbox filtering or clustering exists.
- `apps/web/src/lib/data.ts:1784-1816` returns the whole capped map-visible marker set.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-67` transforms all rows into a client marker model inside the route.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:90-111` couples the same marker array to both the map and a full accessible list.
- `apps/web/src/components/map/map-client.tsx:78-95` derives global map bounds from all markers in the client.
- `apps/web/src/components/map/map-client.tsx:121-142` owns direct marker rendering.

Failure scenario:

As the gallery grows, fixing map performance requires changing data selection, marker payload shape, accessible list behavior, and Leaflet rendering together because they are all coupled to one all-markers route payload. A future bbox API or clustering layer would need to preserve the full-page list contract or rewrite it at the same time, increasing risk for both performance and accessibility regressions.

Suggested fix:

Separate the map into three contracts: initial page shell, viewport marker/cluster data source, and accessible photo list source. The page can render a lightweight shell and a paginated/virtualized list, while the map component consumes a marker-provider interface that can start with the current all-marker implementation and later switch to bbox/clusters. Keep the GPS privacy filter inside the data source.

## Accepted Or Documented Constraints, Not Defects

- Single web instance / single writer is documented and is partly guarded by startup checks. Process-local rate limits, queues, and shared-group view-count buffering are accepted within that topology.
- Shared-group view counts are documented as best-effort analytics, not audit/billing state.
- `site-config.json`, image base URL behavior, and deploy-time config constraints are documented.
- The storage abstraction is intentionally quarantined; I did not find active runtime use of `getStorage()` in the upload/process/serve path.
- Public dynamic page rate limiting is largely an edge/Nginx concern per project docs; this review did not validate the live host Nginx state.
- Multiple root admins with no role/capability split is an explicit product constraint.

## Confirmed Guardrails / Non-Findings

- Admin API, server-action origin, and public route rate-limit scanners exist and are part of the project quality gates.
- Restore coordination has multiple layers: durable marker, mutation barrier, queue/backfill locks, drains, and maintenance status.
- Per-image advisory locks are shared between live image processing and in-app color backfill, reducing derivative write races.
- Public map GPS exposure is constrained to `topics.map_visible = true` at query level with a runtime assertion.
- Semantic enrichment fields are already centralized in `search-enrichment-fields.ts`, which reduces a previous privacy/coupling risk in the semantic/similar response shape.
- Migration bootstrap has journal-hash postconditions and legacy reconcile hooks documented in `AGENTS.md`.

## Final Missed-Issue Sweep

Sweep methods:

- Re-read `CLAUDE.md` for architecture constraints around single writer, restore, semantic search, image processing, storage, migrations, deployment, and public route boundaries.
- Searched the repo for key architecture/performance terms including `queue`, `concurrency`, `cache`, `SEMANTIC_SCAN_LIMIT`, `MAP_MAX_MARKERS`, `publicSelectFields`, and `timelineSelectFields`.
- Followed the main cross-file paths rather than reviewing files in isolation: queue/backfill/process-image, semantic routes/model/backfills, public data selectors/routes/components, restore/mutation guards, and map data/client rendering.

Missed-issue conclusion:

- No new production-code corruption race was confirmed in the image derivative writer paths.
- No new live storage abstraction leak was confirmed.
- No new public/admin boundary inversion was confirmed from static inspection.
- The highest-value architectural issues are still ownership boundaries: shared background capacity, shared public projection ownership, semantic retrieval service ownership, and map payload/rendering separation.

## Skipped-File Accounting

Reviewed by inventory, not line-by-line:

- Most tests under `apps/web/src/__tests__` and `apps/web/e2e`; I used targeted search for contracts relevant to the reviewed architecture.
- Historical `.context/` review/plan archives; I inventoried them but did not treat them as current code.
- Drizzle migrations and generated metadata; I checked the migration policy in `AGENTS.md` and schema context but did not audit every migration statement.

Skipped intentionally:

- `node_modules/`, generated `.next/`, uploaded media, screenshots, Playwright artifacts, binary assets, live MySQL data, live host Nginx, Docker runtime state, and production environment variables.

Validation:

- Review artifact only. No tests/build were run because production code was not changed.
