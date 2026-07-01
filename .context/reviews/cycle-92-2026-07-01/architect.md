# Cycle 92 Architect Review

Review date: 2026-07-01
Lane: architect — architecture, layering, contracts, coupling, state ownership, deployment/schema boundaries, and long-term design risk.
Current HEAD reviewed: `508d35572563705008693da2dbff3e5d85442cdd` (`docs(review): 📝 close cycle 91 release evidence`).

## Constraints and validation posture

- Required context read first: `AGENTS.md` and `CLAUDE.md`.
- Output constraint honored: this lane writes only `.context/reviews/cycle-92-2026-07-01/architect.md`.
- `omx explore --prompt ...` was attempted first for the repo inventory as instructed, but this outside-tmux/restricted surface failed with `failed to initialize in-process app-server client: Operation not permitted`; I fell back to direct read-only source inspection.
- I did not run full lint/typecheck/build/test gates because the request is a report-only review and several normal gates can generate artifacts (`.next`, generated icons/SW, Playwright output). Evidence below is from read-only source/config/plan inspection with exact file:line citations.

## Inventory built first

Tracked-file inventory from `git ls-files` before issue analysis:

- Total tracked files: 3173.
- Main app workspace: 665 tracked files under `apps/web/`.
- Main app source: 559 files under `apps/web/src/`.
- Route/action surface: 77 files under `apps/web/src/app/`, including localized public pages, protected admin pages, public/admin API routes, upload-serving routes, and server actions.
- Components: 59 files under `apps/web/src/components/`.
- Library/data/security/processing helpers: 106 files under `apps/web/src/lib/`.
- Tests: 309 unit/source-contract tests under `apps/web/src/__tests__/` and 8 e2e files/fixtures under `apps/web/e2e/`.
- Operator scripts: 29 tracked files under `apps/web/scripts/`.
- Schema migrations: 29 SQL migrations under `apps/web/drizzle/` plus Drizzle metadata.

Architecture-relevant files inventoried and inspected:

- Canonical contracts and operating context: `AGENTS.md`, `CLAUDE.md`, root `package.json`, `apps/web/package.json`.
- App route/layering surface: `apps/web/src/app/[locale]/(public)/**`, `apps/web/src/app/[locale]/admin/**`, `apps/web/src/app/actions/*.ts`, `apps/web/src/app/api/**/route.*`, `apps/web/src/proxy.ts`.
- Data/schema boundary: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`.
- Restore/deployment/state boundary: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/advisory-locks.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `scripts/deploy-remote.sh`.
- Image/color/HDR/search pipeline: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/gallery-config*.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/clip-*.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/backfill-color-pipeline.ts`.
- Static/runtime config boundary: `apps/web/src/site-config.example.json`, `apps/web/src/lib/constants.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/components/nav*.tsx`, `apps/web/src/components/footer.tsx`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/sitemap.ts`, `apps/web/src/proxy.ts`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`.
- Storage boundary: `apps/web/src/lib/storage/**` and quarantine tests, plus direct filesystem upload/serve helpers.
- Review/plan state: `.context/reviews/_aggregate.md`, `.context/plans/README.md`, `.context/plans/cycle-91-2026-07-01-plan.md`, `.context/plans/cycle-91-2026-07-01-deferred.md`.

## Confirmed issues

### C92-ARCH-01 — Restore maintenance still does not fence already-in-flight non-upload admin mutations

- Severity: High.
- Confidence: High.
- Status: Confirmed source-level architecture gap; same broad deferred class as `C91-03 / C77-ARCH-01`.

Evidence:

- Restore serializes restore itself and upload/processing-sensitive work: `restoreDatabase()` acquires `LOCK_DB_RESTORE` at `apps/web/src/app/[locale]/admin/db-actions.ts:390-398`, acquires the upload-processing contract lock at `apps/web/src/app/[locale]/admin/db-actions.ts:400-410`, acquires color/semantic backfill locks at `apps/web/src/app/[locale]/admin/db-actions.ts:413-447`, then enters durable restore maintenance at `apps/web/src/app/[locale]/admin/db-actions.ts:449-453`.
- The restore window then flushes/quiesces only the known background buffers/queue before import: shared-group view counts, image queue, and background DB writes at `apps/web/src/app/[locale]/admin/db-actions.ts:492-498`; the actual import follows at `apps/web/src/app/[locale]/admin/db-actions.ts:503-506`.
- The maintenance state itself is process-local (`globalThis` symbol) with simple boolean reads/writes in `apps/web/src/lib/restore-maintenance.ts:1-31`; durable marker sync/write lives separately in `apps/web/src/lib/restore-maintenance-durable.ts:65-106`.
- Representative foreground admin writers only check maintenance at function entry. `updateTopic()` checks `getRestoreMaintenanceMessage()` at `apps/web/src/app/actions/topics.ts:182-185`, then performs awaited reads/file processing at `apps/web/src/app/actions/topics.ts:232-247` before acquiring the topic-route advisory lock and writing later.
- `deleteImage()` has the same entry-only shape: maintenance check at `apps/web/src/app/actions/images.ts:648-653`, multiple awaited reads/state changes at `apps/web/src/app/actions/images.ts:666-705`, and then a DB transaction at `apps/web/src/app/actions/images.ts:706-712`.
- The current deferred ledger records this exact gap and exit criterion: `.context/plans/cycle-91-2026-07-01-deferred.md:19-24`.

Why this matters:

A slow non-upload admin mutation can pass its entry check, then a DB restore can enter maintenance/import while that mutation is still in flight. The mutation has no shared foreground-write barrier or immediate pre-transaction maintenance recheck, so it can write into a state that is being restored or write after an older dump has been imported. That creates lost updates, misleading audit/revalidation, and DB/filesystem split-brain depending on the action.

Recommended direction:

- Add a general foreground admin mutation barrier, e.g. `withRestoreWriteBarrier(actionName, ...)`, used by every application-table writer, not just upload/settings/backfill paths.
- The barrier should participate in a DB advisory-lock protocol or otherwise recheck durable/process maintenance immediately before the write section, not only at action entry.
- Keep `LOCK_UPLOAD_PROCESSING_CONTRACT` scoped to upload-processing contract changes unless it is deliberately renamed/broadened.
- Add tests with a representative slow action proving restore entering maintenance between entry check and transaction prevents the late write.

### C92-ARCH-02 — `image_embeddings` storage cannot retain multiple model versions per image

- Severity: Medium.
- Confidence: High.
- Status: Confirmed schema/design limitation; same broad deferred class as `C91-04 / C88-03`.

Evidence:

- Drizzle schema makes `image_embeddings.image_id` the primary key, with `model_version` as a non-key column: `apps/web/src/db/schema.ts:284-290`.
- The physical migration matches the one-row-per-image design: `CREATE TABLE image_embeddings` includes `model_version` but `PRIMARY KEY (image_id)` at `apps/web/drizzle/0012_image_embeddings.sql:5-11`.
- The later serving index optimizes active-version scans but does not change identity to `(image_id, model_version)`: `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql:1-9`; schema mirror at `apps/web/src/db/schema.ts:295-299`.
- Semantic search filters rows by active model version at `apps/web/src/app/api/search/semantic/route.ts:263-279`.
- Similar-image search requires production model rows for both target lookup and scan at `apps/web/src/app/api/search/similar/[id]/route.ts:132-177`.
- Writers overwrite the single row in place. The image queue upserts on duplicate `imageId` and replaces `embedding`/`modelVersion` at `apps/web/src/lib/image-queue.ts:379-390`; the sidecar backfill does the same at `apps/web/scripts/backfill-clip-embeddings.ts:212-223`.
- The sidecar's own contract describes the overwrite behavior: the upsert replaces an existing row in place at `apps/web/scripts/backfill-clip-embeddings.ts:27-30`, and version mismatch is handled by re-embedding/overwriting at `apps/web/scripts/backfill-clip-embeddings.ts:35-42`.
- The current deferred ledger records the desired exit criterion as one row per `(image_id, model_version)`: `.context/plans/cycle-91-2026-07-01-deferred.md:26-31`.

Why this matters:

The route layer is designed as if multiple versions can be selected by `model_version`, but the storage layer preserves only one version per image. Moving from stub to production, rolling back, or introducing a future production model revision necessarily destroys the inactive version. Canarying, rollback, and side-by-side quality comparison require a full destructive re-backfill instead of a metadata/config switch.

Recommended direction:

- Add a schema migration that changes identity to `(image_id, model_version)` or equivalent composite uniqueness while preserving `(model_version, updated_at)` serving performance.
- Mirror the change in `apps/web/src/db/schema.ts` and `reconcileLegacySchema()`.
- Update queue/backfill writers to insert/update only the target version row, not replace every other version for that image.
- Add regression coverage proving two versions for one image can coexist and inactive versions survive active-version backfills/searches.

## Likely issues / design risks

### C92-ARCH-L1 — Runtime `site-config.json` bind mount remains ambiguous because consumers statically import JSON

- Severity: Medium.
- Confidence: Medium.
- Status: Likely operator-contract/design risk; local source confirms split ownership, but actual compiled-bundle behavior should be validated in Docker/Next standalone before calling it a runtime defect.

Evidence:

- Compose bind-mounts host `./src/site-config.json` into the running container as read-only: `apps/web/docker-compose.yml:24-28`.
- The Docker build validates and builds with `src/site-config.json` before producing standalone output: `apps/web/Dockerfile:96-100`; validation reads `src/site-config.json` directly at `apps/web/scripts/ensure-site-config.mjs:4-12` and enforces production URL sanity at `apps/web/scripts/ensure-site-config.mjs:23-42`.
- Multiple consumers statically import `@/site-config.json`: shared constants at `apps/web/src/lib/constants.ts:19-24`, middleware/CSP at `apps/web/src/proxy.ts:1-5` and `apps/web/src/proxy.ts:41-49`, sitemap at `apps/web/src/app/sitemap.ts:14-18`, root layout at `apps/web/src/app/[locale]/layout.tsx:11-23`, client nav at `apps/web/src/components/nav-client.tsx:14-15` and `apps/web/src/components/nav-client.tsx:71-74`, and footer at `apps/web/src/components/footer.tsx:1-4` and `apps/web/src/components/footer.tsx:32-37`.
- `getSeoSettings()` reads DB-backed editable SEO fields but still falls back to statically imported JSON values and `process.env.BASE_URL || siteConfig.url`: `apps/web/src/lib/data.ts:1765-1804`.
- Project docs simultaneously describe `site-config.json` as a runtime bind-mounted persistence item (`AGENTS.md:19`; `CLAUDE.md:477`) and as fallback/static build-time values (`CLAUDE.md:147`, `CLAUDE.md:672-673`). The active deferred ledger also keeps this ambiguity open: `.context/plans/cycle-91-2026-07-01-deferred.md:33-38`.

Risk scenario:

An operator edits the mounted host JSON and restarts the container expecting nav home link, footer text, GA/CSP domains, or sitemap base URL to change. Some values may be bundled into server/client/middleware chunks at build time, while other code paths may read env/DB at runtime. The result can be split-brain configuration semantics and hard-to-debug SEO/CSP/navigation differences.

Recommended direction:

- Choose and document one contract: either `site-config.json` is build-time-only and the runtime mount should be removed/documented as inert, or it is runtime config and all consumers should read a validated runtime loader with client-safe values passed through props/metadata.
- Add a Docker/standalone smoke test that changes the mounted JSON without rebuild and asserts the chosen behavior.

### C92-ARCH-L2 — `/api/health` is DB-backed but lacks the explicit Node runtime pin used by other Node-only routes

- Severity: Low.
- Confidence: High for the source-contract gap; Medium for real-world impact because App Router defaults currently keep it on Node.
- Status: Likely hardening issue / layering contract gap.

Evidence:

- `/api/health` imports the DB module and Drizzle SQL at `apps/web/src/app/api/health/route.ts:1-3`.
- It can execute `db.execute(sql\`SELECT 1\`)` when `HEALTH_CHECK_DB=true` at `apps/web/src/app/api/health/route.ts:19-31`.
- The route declares `dynamic = 'force-dynamic'` but no `runtime = 'nodejs'`: `apps/web/src/app/api/health/route.ts:5-8`.
- Other Node-bound routes are explicitly pinned: backup download at `apps/web/src/app/api/admin/db/download/route.ts:16-19`, PAT upload at `apps/web/src/app/api/admin/lr/upload/route.ts:76-82`, OG routes at `apps/web/src/app/api/og/route.tsx:10-13` and `apps/web/src/app/api/og/photo/[id]/route.tsx:16-19`, semantic search at `apps/web/src/app/api/search/semantic/route.ts:60-65`, similar search at `apps/web/src/app/api/search/similar/[id]/route.ts:50-53`, and upload-serving/feed routes from the route-runtime sweep.

Risk scenario:

A future route-level/runtime default refactor or broad Edge-runtime experiment can silently move the health route into a runtime where `mysql2`/DB access is not valid. Because health is used by Docker/deploy/readiness surfaces, that failure mode can make an otherwise live app look unhealthy or make DB readiness probing unreliable.

Recommended direction:

- Add `export const runtime = 'nodejs'` to `/api/health`.
- Consider a source-contract test that any route importing `@/db`, `mysql`, `sharp`, `fs`, `ImageResponse`, or upload-serving helpers explicitly exports the Node runtime.

## Manual-validation risks / accepted design constraints

### MV-C92-ARCH-01 — Current production deployment evidence for terminal HEAD is not proven by committed ledgers

- Severity: Medium.
- Confidence: High that evidence is missing; no claim about actual live state.

Evidence:

- Project policy requires `npm run deploy` after every pushed `master` commit: `AGENTS.md:17` and `CLAUDE.md:467-469`.
- The plan index says Cycle 91 is complete and records it as committed/pushed/deployed at signed `aacccbc`: `.context/plans/README.md:5-12`.
- The Cycle 91 plan's focused evidence also stops at primary release `aacccbc99ccbafe473362c7daf9eaaaa44b6ccef` and post-deploy smoke for that release: `.context/plans/cycle-91-2026-07-01-plan.md:61-65`.
- Current reviewed HEAD is later: `508d35572563705008693da2dbff3e5d85442cdd`. The diff from `aacccbc..HEAD` is docs-only (`.context/plans/README.md`, `.context/plans/cycle-91-2026-07-01-plan.md`), but the per-iteration policy still requires deploy evidence for every pushed `master` commit.

Validation needed:

Record terminal deploy/live-smoke evidence for `508d355` or explicitly document a policy exception for docs-only ledger commits. Until then, the repo ledger cannot prove whether production is at `aacccbc` or `508d355`.

### MV-C92-ARCH-02 — Single-instance/process-local state is an explicit architecture constraint, not a horizontally scalable design

- Severity: Medium if topology changes; Low if the shipped single-web-instance topology is preserved.
- Confidence: High.

Evidence:

- The shipped compose file defines one `web` service/container and host networking at `apps/web/docker-compose.yml:1-22`.
- CLAUDE documents the single web-instance/single-writer topology and warns not to horizontally scale until process-local state moves to a shared store: `CLAUDE.md:234-237`.
- Upload quota tracking is a process-global Map: `apps/web/src/lib/upload-tracker-state.ts:7-20`.
- The image queue owns process-global state under `Symbol.for('gallerykit.imageProcessingQueue')`: `apps/web/src/lib/image-queue.ts:76-89`.
- Several public/admin rate-limit fast paths are in-memory Maps: `apps/web/src/lib/rate-limit.ts:78-89`, `apps/web/src/lib/rate-limit.ts:91-101`, and `apps/web/src/lib/rate-limit.ts:115-124`.
- Shared-group view counts are buffered in module state and flushed asynchronously: `apps/web/src/lib/data.ts:13-35`, `apps/web/src/lib/data.ts:49-63`, and flush logic at `apps/web/src/lib/data.ts:75-126`.

Validation needed:

Before adding replicas, process managers, a second web host, or multi-tenant co-location, move upload quota, queue coordination/status, rate-limit state, and view-count buffering to a shared durable store or add a hard deployment guard that refuses unsupported topology.

### MV-C92-ARCH-03 — Advisory-lock names are MySQL-server-global and intentionally not instance-prefixed

- Severity: Low in the supported one-instance-per-MySQL-server deployment; Medium if multiple GalleryKit DBs share one MySQL server.
- Confidence: High.

Evidence:

- Lock names are centralized but static and unprefixed: `LOCK_DB_RESTORE`, `LOCK_UPLOAD_PROCESSING_CONTRACT`, `LOCK_TOPIC_ROUTE_SEGMENTS`, `LOCK_ADMIN_DELETE`, color/semantic backfill locks, and per-image locks at `apps/web/src/lib/advisory-locks.ts:18-47`.
- The file explicitly documents that MySQL advisory locks are scoped to the MySQL server, not a database, and says to run one GalleryKit per MySQL server or prefix lock names for multi-tenant co-location: `apps/web/src/lib/advisory-locks.ts:8-15`.
- CLAUDE repeats the same topology caveat at `CLAUDE.md:400-405`.

Validation needed:

If an operator points two GalleryKit instances at different databases on the same MySQL server, their restores/backfills/topic mutations/admin deletes/image-processing claims will serialize or collide by design. Validate deployment topology before treating lock contention as an app bug.

## Positive architecture contracts observed

- Schema drift has a maintained reconcile/baseline path: `reconcileLegacySchema()` starts at `apps/web/scripts/migrate.js:317-318`, fresh DBs route through reconcile + per-entry baseline at `apps/web/scripts/migrate.js:764-784`, legacy incomplete logs route through reconcile + baseline at `apps/web/scripts/migrate.js:787-800`, and `runMigrations()` fails loudly when any journal hash is missing at `apps/web/scripts/migrate.js:803-824`.
- Journal/file presence is currently aligned in this review: 29 SQL migrations and 29 journal entries; no missing SQL files or unjournaled migration files were found. The journal remains intentionally non-monotonic, which is why the hash-based postcondition above is load-bearing.
- The experimental storage abstraction is clearly quarantined from the live pipeline: `apps/web/src/lib/storage/index.ts:4-12` and `apps/web/src/lib/storage/types.ts:4-16` state it is not wired into upload/processing/serving; source usage sweep found no production imports outside the storage module/tests.
- Deployment persistence/prune safety remains source-aligned: compose bind-mounts `data`, `public/uploads`, `public/resources`, and `site-config.json` at `apps/web/docker-compose.yml:24-28`; `deploy.sh` runs `docker compose ... up -d --build` before best-effort prune and omits `-a` on `docker volume prune` at `apps/web/deploy.sh:51-56` and `apps/web/deploy.sh:79-104`.

## Final missed-issue sweep

Read-only sweeps performed before writing this report:

- Re-read `AGENTS.md` and `CLAUDE.md`, including deploy, schema, runtime topology, migration, restore, image/color/HDR, CLIP, storage, and quality-gate sections.
- Built a file inventory with `git ls-files`, route/action listings, library/config/deploy/schema listings, and package scripts.
- Searched restore-maintenance references across server actions, admin DB restore, public pages, API routes, queue, background writes, sidecar scripts, durable marker handling, and tests.
- Searched semantic/model-version references across schema, migrations, queue, search routes, and backfill scripts.
- Searched `site-config` static imports and runtime/build/deploy references across app, middleware/proxy, sitemap, components, Dockerfile, compose, and docs.
- Searched runtime pins across API/feed/upload-serving routes and compared Node-only imports against explicit `runtime = 'nodejs'` declarations.
- Searched raw SQL/advisory-lock/database execution boundaries and migration reconcile/postcondition logic.
- Searched `TODO`/`FIXME`/`not wired`/`experimental`/`future` markers, then de-duplicated intentional documented work (HDR WI-09, caption stubs, storage quarantine, CLIP hardening) from actionable architect findings.
- Reviewed current Cycle 91 deferred ledger and current Cycle 92 sibling lane reports to avoid misclassifying known broad deferred work as newly fixed or newly introduced.

No additional confirmed architect-level source issue was found beyond `C92-ARCH-01` and `C92-ARCH-02`. The other items above are likely hardening/design risks or manual-validation constraints rather than proven runtime failures in the current supported deployment.
