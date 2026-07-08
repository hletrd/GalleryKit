# Cycle 38 Architect Review

## Provenance

- Role: cycle-38 architect.
- Date: 2026-07-08 KST.
- Scope: repository architecture/design-risk review for `/Users/hletrd/flash-shared/gallery`.
- Constraints honored: read `AGENTS.md` and `CLAUDE.md` first; review-only except this file; no commits, pushes, destructive commands, production deploys, or live host changes.
- Review method: built an architecture inventory from `rg --files`, `omx explore`, package/deploy manifests, route/action trees, schema/migration files, worker/runtime modules, guard scripts, and architecture tests before selecting findings. This was not a sampled review of a few files; every architecture-relevant category found in the inventory was covered.

## Inventory Reviewed

Architecture/control documents:

- `AGENTS.md`
- `CLAUDE.md`
- root and workspace package manifests
- `.github/workflows/quality.yml`
- `.github/workflows/clip-preflight.yml`

Deployment/topology/config:

- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `apps/web/nginx/default.conf`
- `apps/web/next.config.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/proxy.ts`

Database, schema, migrations, and migration verification:

- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/drizzle/*.sql`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/scripts/migrate.js`
- `apps/web/src/__tests__/migration-journal.test.ts`
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`
- `apps/web/src/__tests__/advisory-lock-release-contract.test.ts`

Public/admin contracts and guardrails:

- `apps/web/src/app/actions/*.ts`
- `apps/web/src/app/**/route.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/scripts/check-api-auth.ts`
- `apps/web/src/scripts/check-action-origin.ts`
- `apps/web/src/scripts/check-public-route-rate-limit.ts`

Background workers/runtime coordination:

- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/src/lib/background-db-writes.ts`
- `apps/web/src/lib/maintenance-scheduler.ts`
- `apps/web/src/lib/admin-mutation-barrier.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/restore-maintenance-durable.ts`
- `apps/web/src/lib/restore-drain-checklist.ts`
- `apps/web/src/lib/pending-file-deletions.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- semantic-search/CLIP modules under `apps/web/src/lib/clip-*`

Data access, public projection, storage, upload/serve paths:

- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/smart-collections.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-filenames.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/storage/*`
- `apps/web/src/__tests__/storage-quarantine.test.ts`

Scale-sensitive public features:

- public map page and map client
- public search semantic route
- public image-similarity route
- relevant search/map/data tests and route-limit scanners

Repository size anchors used for completeness:

- `apps/web/src`: 627 TypeScript/TSX files.
- `apps/web/src/app`: 80 TypeScript/TSX files.
- `apps/web/src/__tests__`: 364 TypeScript/TSX test files.
- `apps/web/drizzle`: 34 migration/meta files.

Validation evidence:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Targeted architecture tests passed:
  - `migration-journal`
  - `migrate-reconcile-coverage`
  - `advisory-lock-release-contract`
  - `check-api-auth`
  - `check-action-origin`
  - `check-public-route-rate-limit`
  - `nginx-config`
  - `single-writer-guard`
  - `maintenance-scheduler-source`
  - `image-queue-concurrency-cap`
- Result: 11 test files, 370 tests passed.

## Findings

### ARCH-38-01: Background Capacity Budgeting Is Fragmented Across Independent Queues

- Severity: High.
- Confidence: High.
- Classification: Confirmed issue.

Evidence:

- `apps/web/src/db/index.ts:31-41` fixes the shared MySQL pool at 10 connections with `queueLimit: 20`.
- `apps/web/src/lib/image-queue.ts:121-153` computes an image-queue-only concurrency cap from that same pool.
- `apps/web/src/lib/admin-backfill-runner.ts:97-143` computes a separate admin-backfill-only cap from the same pool.
- `apps/web/src/app/actions/embeddings.ts:30-34` hard-codes semantic embedding backfill concurrency and in-memory backfill rate state.
- `apps/web/src/lib/background-db-writes.ts:3-10` adds another independent background/analytics write queue with concurrency 2 and pending cap 1000.
- `apps/web/src/lib/clip-model.ts:53-72` adds a separate process-local CLIP inference queue.

Failure scenario:

Each subsystem is locally reasonable, but there is no shared resource ledger for DB connections, CPU-heavy Sharp work, CLIP inference, analytics writes, maintenance sweeps, and admin backfills. A normal image queue plus an admin color backfill plus semantic backfill/action work can each believe it has reserved enough live headroom while collectively exhausting the 10-connection pool or saturating CPU. The result is request latency spikes, pool queue failures, restore drain timeouts, and confusing operator behavior because every subsystem logs only its own clamp.

Concrete fix:

Introduce a central background resource coordinator with named lanes, for example `db-heavy`, `cpu-encode`, `clip-inference`, `analytics`, and `maintenance`. All long-running workers should acquire leases from that coordinator before starting work; the coordinator should enforce one global pool budget derived from `POOL_CONNECTION_LIMIT`, expose current usage for admin/ops, and make restore/drain checks ask the coordinator to quiesce all lanes. Keep subsystem-specific caps as secondary limits, not primary safety boundaries.

### ARCH-38-02: The Single-Writer Topology Is Critical But Production Enforcement Is Warn-Only

- Severity: High.
- Confidence: High.
- Classification: Manual-validation risk.

Evidence:

- `CLAUDE.md:245-248` documents a single web-instance/single-writer topology and states that process-local restore, upload quota, queue, admin backfill, and some rate-limit state are not horizontally safe.
- `apps/web/docker-compose.yml:3-17` ships one host-networked `web` service, but Compose itself does not prevent a second independently launched container or process from using the same DB.
- `apps/web/src/lib/single-writer-guard.ts:6-16` says two live processes break restore fences, upload quota tracking, and rate-limit fast paths, and that the guard cannot enforce single-instance operation.
- `apps/web/src/lib/single-writer-guard.ts:277-305` starts the guard best-effort and continues startup when the DB probe is unavailable or the lock is not acquired.

Failure scenario:

An operator can accidentally run a second web process against the same DB during troubleshooting, blue/green testing, manual `docker compose` usage, or host migration. The guard logs, but both processes can continue serving traffic. Because restore maintenance markers, queue state, some rate-limit buckets, and backfill status are process-local or only partially DB-fenced, the second process can accept writes or expensive requests during a window the first process believes is fenced.

Concrete fix:

Add a production fail-closed option such as `GALLERYKIT_ENFORCE_SINGLE_WRITER=true`. In that mode, fail readiness and do not accept traffic until the singleton DB lock is held, with a bounded rolling-deploy grace window if needed. If future horizontal scale is desired, explicitly migrate the unsafe state to shared durable stores first and then remove the single-writer invariant rather than keeping it as prose plus warnings.

### ARCH-38-03: Host Nginx Is an Architecture Dependency But Deploys Do Not Verify the Live Edge Policy

- Severity: Medium.
- Confidence: High.
- Classification: Manual-validation risk.

Evidence:

- `CLAUDE.md:248` states public pages are throttled at the Nginx edge and that deploys rebuild the container only, not host Nginx.
- `CLAUDE.md:536-548` describes manual host recovery/config work outside normal deploy flow.
- `apps/web/nginx/default.conf:1-29` defines the public, login, admin, `_next/image`, and connection rate-limit zones and warns that `$binary_remote_addr` needs real-IP configuration in LB-fronted topologies.
- `apps/web/nginx/default.conf:274-295` applies the public catch-all limiter and explicitly says this config is not touched by deploys.
- `apps/web/deploy.sh:51-77` builds/starts the app container and health-checks it, with no `nginx -T`, template checksum, or reload verification.

Failure scenario:

A repository change can pass app tests and be deployed while the live host still runs an older Nginx policy. The app assumes public dynamic pages, public search/OG/live paths that fall through `location /`, and `_next/image` have edge backstops; production may not. In an LB-fronted topology, all visitors can also collapse into one limiter bucket unless real-IP config is applied live, producing either weak protection or false 429s.

Concrete fix:

Add a deploy preflight that compares the live `nginx -T` policy or a managed checksum against `apps/web/nginx/default.conf` and clearly fails or warns before health success when they diverge. If the infrastructure repo owns Nginx, put the same checksum in that repo and have GalleryKit deploy validate it read-only. Separately document and test the real-IP contract for LB/CDN topologies.

### ARCH-38-04: Public Projection Ownership Is Split Across Hand-Mirrored Field Sets

- Severity: Medium.
- Confidence: High.
- Classification: Confirmed issue.

Evidence:

- `apps/web/src/lib/data.ts:368-407` defines `publicSelectFields` as the canonical unauthenticated field set derived from `adminSelectFields`.
- `apps/web/src/lib/data.ts:409-430` starts a separate public map field set that intentionally retains GPS coordinates under the map-visible contract.
- `apps/web/src/lib/data-timeline.ts:17-36` states that timeline fields mirror `publicSelectFields` and documents a prior drift where admin-only color fields leaked into this hand-maintained mirror.
- `apps/web/src/lib/data-timeline.ts:36-80` re-declares timeline fields and tag aggregation rather than importing a shared public projection.
- `apps/web/src/lib/search-enrichment-fields.ts:1-45` is a positive counterexample: semantic/similar search now share a centralized compile-guarded enrichment select.

Failure scenario:

When a new image column is added or a privacy decision changes, maintainers must update multiple hand-maintained projections and tests. Current sensitive-key guards reduce leak risk, but they do not guarantee public feature parity or consistent payload semantics. Public surfaces can quietly diverge: timeline/search/map/gallery may show different metadata, omit new safe fields, or carry stale query shapes.

Concrete fix:

Move public field ownership into one projection module with named variants: `publicImageBase`, `publicImageWithTags`, `publicMapImage`, and `publicSearchEnrichment`. Generate variant field sets by extension/omission from the same source, and add parity tests that assert intentional differences only. The existing `search-enrichment-fields.ts` pattern is the right direction; apply it to timeline and map.

### ARCH-38-05: Semantic Search and Similar-Image Retrieval Duplicate a Request-Path Brute-Force Ranking Architecture

- Severity: Medium.
- Confidence: High.
- Classification: Likely issue.

Evidence:

- `apps/web/src/app/api/search/semantic/route.ts:263-311` scans up to `SEMANTIC_SCAN_LIMIT` recent embeddings, decodes each vector, scores in-process, and top-Ks the scanned set.
- `apps/web/src/app/api/search/semantic/route.ts:313-350` performs route-local result enrichment after scoring.
- `apps/web/src/app/api/search/similar/[id]/route.ts:137-171` separately loads and decodes the target image embedding.
- `apps/web/src/app/api/search/similar/[id]/route.ts:177-214` repeats the same scan/decode/score/top-K pattern for similar images.
- `apps/web/src/app/api/search/similar/[id]/route.ts:220-280` repeats route-local enrichment and public score stripping.
- `apps/web/src/lib/clip-model.ts:53-72` shows inference queuing is also process-local, so search cost management is not centralized.

Failure scenario:

The architecture ranks only within the most recently scanned embeddings, not the full corpus, once the gallery exceeds the scan cap. That may be acceptable now, but the limitation is split across two public routes. A future ranking threshold, model-version rollout, privacy field, telemetry, vector cache, or approximate index integration must be changed twice. Under traffic, both routes perform DB scans and in-process vector scoring on the request path, competing with live gallery traffic and background embedding work.

Concrete fix:

Extract a semantic retrieval service that owns model gating, scan/index selection, vector decoding, ranking, thresholding, result enrichment, score stripping, and telemetry. Both routes should call that service. Then the implementation can evolve from capped scans to a DB/vector-index-backed strategy behind one interface, with one test matrix for privacy and ranking semantics.

### ARCH-38-06: The Public Map Couples One Full Marker Query to SSR, Leaflet Rendering, and the Accessible List

- Severity: Medium.
- Confidence: High.
- Classification: Likely issue.

Evidence:

- `apps/web/src/lib/data.ts:1766-1775` documents `MAP_MAX_MARKERS = 10000` as a hard upper bound and says viewport/bbox filtering or clustering would be needed beyond that.
- `apps/web/src/lib/data.ts:1784-1816` returns one most-recent-first marker set plus a truncation flag.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-67` fetches `getMapImages()` during SSR and transforms all returned rows into client markers.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:90-111` passes the same marker array to the map and to the full accessible photo list.
- `apps/web/src/components/map/map-client.tsx:78-95` computes bounds across all markers.
- `apps/web/src/components/map/map-client.tsx:121-142` renders a Leaflet marker for every marker in the payload.

Failure scenario:

The current cap is a useful safety valve, but the page architecture ties data retrieval, initial SSR payload size, client marker rendering, map bounds, and accessibility list size to one array. When the map-visible corpus grows, a performance fix becomes a multi-layer rewrite because the accessible list and visual map are not independently paginated or viewport-driven. Truncation also means the map silently becomes “most recent 10k” rather than a spatial view.

Concrete fix:

Introduce a map marker provider contract. The initial page should render a bounded summary/list and fetch markers by viewport or cluster bucket through a public API with rate limiting and cache semantics. Keep the accessible list paginated/searchable separately from marker rendering so accessibility does not force a full marker payload.

### ARCH-38-07: SQL Restore Is Strongly Fenced, But File-State Consistency Is Outside the App Boundary

- Severity: Medium.
- Confidence: High.
- Classification: Manual-validation risk.

Evidence:

- `CLAUDE.md:228` documents that admin DB backup/restore is SQL-only and does not snapshot or roll back `data/uploads/original`, `public/uploads`, or `public/resources`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:625-667` shows a strong restore drain checklist for in-process DB writers before import.
- `apps/web/src/app/[locale]/admin/db-actions.ts:800-990` validates and imports only the SQL dump, then runs post-restore migrations.
- `apps/web/src/lib/pending-file-deletions.ts:82-125` drains explicit pending deletion rows but is not a general DB-to-filesystem reconciliation system.
- `apps/web/src/lib/upload-paths.ts:12-47` shows image storage lives in local host directories outside the SQL dump.

Failure scenario:

Restoring an old database over newer host files, or restoring SQL without matching filesystem snapshots, can produce DB rows whose originals/derivatives are missing, files with no DB rows, stale topic covers/resources, or pending-deletion rows that reflect a different filesystem point in time. The restore transaction can be correct from MySQL’s perspective while the public gallery has broken images or orphaned disk usage.

Concrete fix:

Add a post-restore consistency report that verifies every restored image row has expected original and derivative files and that every upload/resource file is either referenced, pending deletion, or explicitly orphaned. For full rollback, extend the backup workflow to include a filesystem snapshot ID/manifest and display a restore warning when the SQL dump cannot be matched to the current file snapshot. Keep SQL restore fenced as-is; add file-state validation as a separate phase.

### ARCH-38-08: The Storage Abstraction Is Quarantined But Still Looks Usable

- Severity: Low.
- Confidence: High.
- Classification: Confirmed issue.

Evidence:

- `apps/web/src/lib/storage/types.ts:1-16` says the storage backend is experimental and live upload/processing/public serving still use direct filesystem helpers.
- `apps/web/src/lib/upload-paths.ts:12-47` defines the live local upload roots.
- `apps/web/src/__tests__/storage-quarantine.test.ts:1-27` explains the hazard: importing `@/lib/storage` would create a second unaudited path parallel to the real upload/process pipeline.
- `apps/web/src/__tests__/storage-quarantine.test.ts:111-120` enforces that source files outside `lib/storage` do not import the module.

Failure scenario:

The quarantine test prevents accidental runtime imports today, but the module exports a working-looking backend and interface. A future storage change could wire one feature through it while other paths still use direct filesystem helpers, splitting path traversal, GPS stripping, derivative invalidation, pending deletion, and serving semantics across two storage systems.

Concrete fix:

Either delete the unused runtime abstraction until a full storage migration is planned, or make the quarantine louder by adding `@deprecated`/throw-on-production integration comments at the module boundary and a short design note that states the all-or-nothing migration plan. When storage is eventually adopted, migrate upload, processing, serving, deletion, backup/restore validation, and tests in one feature branch.

### ARCH-38-09: Migration Reconcile Coverage Is Source-Based, Not Structural

- Severity: Low.
- Confidence: Medium.
- Classification: Likely issue.

Evidence:

- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19` states the reconcile test checks table/column name presence and cannot verify types or defaults.
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:106-122` states the index coverage test is also a source tripwire, not structural equivalence.
- The current journal inventory has 31 entries with one documented historical non-monotonic inversion at `0006` -> `0007`; later entries, including `0030_pending_file_deletions`, are strictly newer than the current maximum journal timestamp.

Failure scenario:

The current tripwires catch missing table/column/index names, which is valuable, but a migration can still drift structurally: wrong column type, wrong nullability/default, wrong index columns/order, missing FK behavior, or different charset/collation. Existing deployments that rely on `reconcileLegacySchema` can green-light a deploy while ending with a schema that only partially matches `schema.ts` and the Drizzle SQL.

Concrete fix:

Add a structural schema diff gate against a disposable MySQL database: run fresh init plus migrations/reconcile, then compare `information_schema` tables/columns/indexes/FKs against an expected manifest generated from Drizzle/schema metadata and committed migration SQL. Keep the existing source tripwires because they are fast; use the structural gate for the classes they explicitly cannot prove.

## Confirmed Guardrails And Non-Findings

- Admin API auth scanner passed; admin route exports currently wrap `withAdminAuth(...)`.
- Mutating server-action origin scanner passed; non-auth mutations currently require same-origin admin guard or documented exemption.
- Public route rate-limit scanner passed; mutating/expensive public route handlers currently carry app-layer rate limiting or documented exemption.
- Restore DB-writer quiescence is substantially better than a simple import lock: `apps/web/src/app/[locale]/admin/db-actions.ts:625-667` drains shared-group view counts, image queue, background DB writes, maintenance sweeps, and admin mutations before import.
- `apps/web/src/lib/restore-drain-checklist.ts:1-18` clearly documents the manual checklist invariant for future process-local DB writers.
- The storage quarantine is enforced by an AST-based test; the risk is maintainability/clarity, not current accidental imports.
- Semantic/similar search enrichment has a shared field module; the remaining issue is the duplicated retrieval/ranking architecture, not the public enrichment projection itself.

## Final Sweep

Commonly missed areas checked:

- Hidden mutating server actions: covered by `check-action-origin` scanner and targeted test.
- Admin API wrappers: covered by `check-api-auth` scanner and targeted test.
- Public expensive route limiters/exemptions: covered by `check-public-route-rate-limit` scanner and targeted test.
- Migration journal ordering: checked current journal; only the documented historical inversion remains.
- Restore critical section: inspected DB restore action, durable marker/barrier path, and drain checklist.
- Background queues: inspected image queue, admin backfill runner, semantic backfill action, CLIP inference queue, background DB writes, maintenance sweeps.
- Public/admin projection split: inspected canonical data projection, timeline mirror, map projection, semantic enrichment.
- Deployment topology: inspected Compose, deploy script, Nginx template, and topology docs.
- Storage boundary: inspected live upload-paths and quarantined storage abstraction/test.

Skipped files:

- No architecture-relevant source category discovered in the inventory was intentionally skipped.
- I did not line-read every presentational component, every unit test body, generated/build artifacts, `node_modules`, `.next`, uploaded media/resources, screenshots, historical review/plan archives, or live host files. Those are outside the architecture-control surface for this review unless referenced by the inventory above.
- Manual validation not performed: live `nginx -T`, production MySQL `information_schema`, a real restore against a file snapshot, actual host process inventory, and live traffic/resource profiling.
