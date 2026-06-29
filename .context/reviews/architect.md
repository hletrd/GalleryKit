# Architect Review - Cycle 10

Review target: current `HEAD`, `42c5b2269473cac2dea172cd993cd0d8a4933f45`.

I read `AGENTS.md` and `CLAUDE.md` before inspecting the repository. This is Prompt 1 only: I did not edit source, plans, migrations, tests, or deploy files. The only intended change from this lane is this review artifact.

## Inventory Built Before Findings

Review-relevant inventory at current `HEAD`:

- Operating authority and architecture docs: `AGENTS.md`, `CLAUDE.md`, root package/deploy files, schema/deploy runbooks, and `.context/reviews/**` conventions.
- App/request surface: all 75 TypeScript/TSX files under `apps/web/src/app`, including admin/public pages, route handlers, server actions, and API routes.
- Domain/data layer: all 95 TypeScript/TSX files under `apps/web/src/lib`, plus `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, and shared select/privacy helpers.
- UI/client boundary: all 57 TypeScript/TSX files under `apps/web/src/components`, with focus on client/server import boundaries and action callers.
- Schema, migrations, operations: Drizzle SQL and journal files, `apps/web/scripts/migrate.js`, operational scripts under `apps/web/scripts/**`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, and `apps/web/next.config.ts`.
- Tests/contracts: 256 test files under `apps/web/src/__tests__`, with targeted reads of migration/reconcile, privacy fields, public route rate limiting, action-origin, upload/restore locks, queue failures, semantic search, generated artifact, and restore scanner coverage.
- Total reviewed source/config artifact set for the live app/deploy/schema surface: 290 files under `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/components`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/nginx`, and `apps/web/public` with relevant source/config extensions.

I excluded `.next/`, `node_modules/`, binary fixtures/screenshots, secrets, and historical scratch material that does not define current behavior. Cross-file paths traced: upload -> original file -> DB insert -> queue -> derivatives -> public serving; restore/maintenance; analytics writes/retention; semantic-search embedding/backfill/query; topic rename/alias/smart-collection invariants; admin/public auth boundaries; migration baselining; Docker/deploy topology; generated artifact contracts.

## Confirmed Issues

None found.

Evidence supporting that conclusion:

- Admin API auth boundary passed: `npm run lint:api-auth --workspace=apps/web` reported both admin API routes wrapped correctly.
- Mutating server action origin boundary passed: `npm run lint:action-origin --workspace=apps/web` reported all mutating actions enforce same-origin provenance or carry explicit read-only/public exemptions.
- Public mutating route rate-limit boundary passed: `npm run lint:public-route-rate-limit --workspace=apps/web` reported semantic search uses a rate-limit helper and the other public API routes have no mutating handlers.
- Public privacy fields are compile-guarded: `apps/web/src/lib/data.ts:458-506` defines the sensitive-key and large-payload guards for public select shapes.
- The cycle 9 confirmed analytics-retention index issue is fixed in HEAD: `apps/web/src/db/schema.ts:232-233`, `apps/web/src/db/schema.ts:247-248`, and `apps/web/src/db/schema.ts:260-261` define `viewed_at, id` indexes; `apps/web/drizzle/0027_analytics_retention_indexes.sql:1-3` ships them; `apps/web/drizzle/meta/_journal.json:197-198` journals the migration; `apps/web/scripts/migrate.js:581-618` mirrors the indexes for legacy/fresh reconciliation.

## Likely Issues

None found.

## Risks Needing Manual Validation

### ARCH-C10-RISK-01 - Horizontal scaling would break process-local coordination assumptions

Severity: Medium  
Confidence: High  
Status: Risk, not a confirmed defect under the documented single-web-instance deployment  
Area: deployment topology, consistency boundaries, runtime coordination

Evidence:

- The shipped deploy topology defines one long-lived web container with bind-mounted app data: `apps/web/docker-compose.yml:11-27`.
- Restore maintenance is a `globalThis` boolean local to one Node process: `apps/web/src/lib/restore-maintenance.ts:1-22`, with begin/end transitions at `apps/web/src/lib/restore-maintenance.ts:44-56`.
- The image-processing queue, dedupe sets, retry maps, bootstrap cursor, and side-effect drain set are also process-local: `apps/web/src/lib/image-queue.ts:274-324`.
- Restore quiescence only pauses and clears that process's queue before resetting local queue state: `apps/web/src/lib/image-queue.ts:1019-1073`.
- Shared-group view increments buffer in module-local `Map`s and timers: `apps/web/src/lib/data.ts:12-34`, drained by a local flush loop at `apps/web/src/lib/data.ts:74-112`.
- Several abuse/limit/status fast paths are process-local: OG/share/search/semantic limit maps at `apps/web/src/lib/rate-limit.ts:74-109` and `apps/web/src/lib/rate-limit.ts:312-346`, upload claims at `apps/web/src/lib/upload-tracker-state.ts:7-20`, and admin backfill status at `apps/web/src/lib/admin-backfill-runner.ts:219-230`.

Failure scenario:

An operator adds a second web process, enables Node clustering, or runs a blue/green pair against the same MySQL database and bind-mounted upload tree. Process A begins restore maintenance and quiesces only its queue while process B still accepts uploads, holds its own upload tracker, maintains its own semantic/public rate-limit buckets, and can enqueue/encode against the same filesystem. The DB advisory locks cover some critical sections, but they do not propagate the restore-maintenance flag, queue pause, view buffer drain, or public limiter budgets. The result can be inconsistent restore/upload interleaving, duplicate CPU work, lost buffered analytics increments on process death, and weakened unauthenticated rate limits.

Concrete fix:

Keep the single-web-instance invariant explicit in deploy/runbooks and add a startup guard that fails closed when a multi-replica deployment is detected unless a shared coordination backend is configured. Before scaling out, move restore maintenance, queue state/claims, upload counters, shared-group view buffering, admin backfill status, and public/semantic limiter state into shared primitives such as MySQL lease rows, durable job tables, Redis, or another single source of truth. Add an integration test or smoke script that asserts a restore/upload lock is visible across two independently started processes.

### ARCH-C10-RISK-02 - Database restore remains SQL-only while media/resources are filesystem state

Severity: Medium  
Confidence: High  
Status: Risk, documented architecture gap rather than a current code regression  
Area: restore semantics, data/file consistency, recovery operations

Evidence:

- Restore serializes with upload/backfill locks and starts local maintenance before quiescing buffered view counts and the local image queue: `apps/web/src/app/[locale]/admin/db-actions.ts:304-365`.
- The actual restore imports the submitted SQL into MySQL via `mysql --one-database`; it does not restore or validate `data/uploads`, public derivatives, or resources: `apps/web/src/app/[locale]/admin/db-actions.ts:520-526`.
- A successful SQL import then runs post-restore migrations and resumes app data without a filesystem reconciliation phase: `apps/web/src/app/[locale]/admin/db-actions.ts:563-578`.
- The deploy model persists media outside the image via bind mounts: `apps/web/docker-compose.yml:23-27`.
- Queue processing fails if a restored DB row references an original file that is not present on disk: `apps/web/src/lib/image-queue.ts:546-557`.

Failure scenario:

An operator downloads a database dump, later restores it after originals, derivatives, or resources have been pruned, moved, or replaced independently. The restored SQL can reference `images.filename_original`, derivative filenames, shared resources, or processed flags whose files do not exist in the bind-mounted filesystem. `processed = false` rows repeatedly fail queue processing because the original is missing; `processed = true` rows can remain publicly visible while their derivative paths 404; resource links can point to absent files. The restore itself can report success because the SQL and migrations succeeded.

Concrete fix:

Define restore as a paired DB+filesystem snapshot operation or make SQL-only restore explicitly verify media consistency before re-enabling the site. A practical implementation is to emit a manifest during backup, restore the matching `data/uploads`, `public/uploads`, and `public/resources` trees with the SQL dump, then run a post-restore integrity scanner that checks every referenced original/derivative/resource. For mismatches, either block restore completion in maintenance mode or atomically mark affected images/resources unavailable with an operator report. Add a test fixture that restores a DB referencing a missing original and verifies the site remains in a safe maintenance/remediation state.

### ARCH-C10-RISK-03 - Production semantic search depends on a manual three-part rollout invariant

Severity: Low  
Confidence: Medium  
Status: Risk, guarded by fail-closed behavior but still operationally easy to mis-sequence  
Area: semantic search activation, model/version coupling, operator workflow

Evidence:

- Production semantic mode heals to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` is set: `apps/web/src/lib/gallery-config.ts:123-142`.
- The real CLIP loader is offline-only and reads the pinned model from `CLIP_MODELS_ROOT`: `apps/web/src/lib/clip-model.ts:77-82` and `apps/web/src/lib/clip-model.ts:105-114`.
- The pinned Hugging Face model/revision is centralized in `apps/web/src/lib/clip-model-id.ts:12-25`.
- Production embeddings are versioned with `PRODUCTION_MODEL_VERSION = 'jina-clip-v2-d512-q8'`: `apps/web/src/lib/clip-embeddings.ts:171-173`.
- The backfill script selects and upserts rows at the active target version, replacing stale rows only when it is run with the intended mode: `apps/web/scripts/backfill-clip-embeddings.ts:77-79` and `apps/web/scripts/backfill-clip-embeddings.ts:130-177`.
- The live semantic route scans only rows matching the active model version and returns 503 when production has no rows: `apps/web/src/app/api/search/semantic/route.ts:242-261`.

Failure scenario:

An operator sets the production env gate and DB setting before seeding the exact pinned weights or before completing the production backfill. The route fails closed with 503 for semantic search, and similar-image search will not find production-version rows for affected images. That is safer than returning mixed stub/production results, but it still presents as an avoidable feature outage and can be mistaken for an app regression.

Concrete fix:

Add an explicit readiness/activation command for semantic production mode. It should verify the pinned model files are present and loadable from `CLIP_MODELS_ROOT`, confirm at least one or all expected `image_embeddings.model_version = PRODUCTION_MODEL_VERSION` rows exist, and only then set the DB setting or produce the exact operator command to do so. Also expose a read-only admin health indicator showing env gate, DB mode, model-load status, production row count, and last backfill result.

## Notable Non-Issues Verified

- Uploads snapshot processing settings before enqueueing and pass those snapshots into queue jobs, avoiding one upload straddling later admin settings changes: `apps/web/src/app/actions/images.ts:183-190`, `apps/web/src/app/actions/images.ts:481-513`, `apps/web/src/lib/image-queue.ts:559-621`.
- Delete-mid-processing cleanup now scans all configured derivative sizes instead of only defaults: `apps/web/src/lib/image-queue.ts:637-660`.
- Restore no longer has the earlier paused-queue/onIdle deadlock shape; the quiesce path pauses, clears, awaits idle, drains side effects, and resets bootstrap state: `apps/web/src/lib/image-queue.ts:1019-1073`.
- Topic slug rename keeps dependent rows and smart-collection filters aligned in the same transaction: `apps/web/src/app/actions/topics.ts:255-338`.
- Semantic search and similar search filter by active model version, so stub and production rows are not co-ranked: `apps/web/src/app/api/search/semantic/route.ts:242-261`, `apps/web/src/app/api/search/similar/[id]/route.ts:123-148`.

## Final Missed-Issue Sweep

I ran repository-wide sweeps for:

- Raw SQL/advisory-lock/destructive statements: `db.execute`, `connection.query`, `GET_LOCK`, `RELEASE_LOCK`, `DROP`, `TRUNCATE`, `DELETE FROM`, `CREATE INDEX`, and `ALTER TABLE`.
- Process-local state: `globalThis`, `Map`, timers, buffers, queues, bootstrap cursors, and in-memory rate limits.
- Restore/maintenance/orphan/invariant comments and TODO/FIXME markers.
- Migration/schema parity for retention indexes, embedding indexes, sensitive-field guards, and legacy reconciler coverage.
- Public/admin boundary scripts for admin API auth, action origin checks, and public mutating-route rate limits.

Validation run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.

Full application `lint`, `typecheck`, `build`, and `npm test` were not run because this prompt was a review-only architecture pass and no source behavior was changed.
