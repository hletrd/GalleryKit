# Architect Review - Cycle 22

Review role: architect
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `ec7cd52883d4973e32f056324620154228190335` on `master`
Source edits: none. This report is the only file written.

## Inventory Reviewed

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Repository inventory checked:

- App/router/actions/API: 77 files under `apps/web/src/app`
- Shared library/domain layer: 97 files under `apps/web/src/lib`
- UI/component layer: 57 files under `apps/web/src/components`
- Tests: 272 files under `apps/web/src/__tests__`
- Total source inventory: 512 files under `apps/web/src`; 613 tracked files under `apps/web`

Primary files/docs inspected:

- Runtime/deploy docs: `README.md`, `CLAUDE.md`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`
- Schema/migrations/scripts: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/scripts/*`
- Ingest/write paths: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Runtime coordination/data lifecycle: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/instrumentation.ts`
- Public expensive/read paths: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/og-photo-fetch.ts`
- Data/privacy/storage/cache contracts: `apps/web/src/lib/gallery-config*.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/storage/*`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/analytics*.ts`, `apps/web/src/lib/view-retention.ts`
- Prior review context: `.context/reviews/run9-cycle7/architect.md`, `.context/reviews/run9-cycle8/architect.md`, previous `.context/reviews/architect.md`

Validation evidence:

- Confirmed `git rev-parse HEAD` is `ec7cd52883d4973e32f056324620154228190335`.
- Fresh static/source inspection across the surfaces above.
- Grep sweeps covered process-local state, advisory locks, upload/enqueue sites, restore maintenance, public rate-limit helpers, storage imports, deployment env propagation, migration journal guards, TODO/deferred markers, and prior cycle findings.
- I did not run lint/typecheck/tests/build because this task was a read-only architecture review; claims below are source-inspection claims.

## Findings

### ARCH22-01 - Upload ingest still has multiple implementation owners

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- Browser upload owns the full ingest lifecycle: auth/config/quota at `apps/web/src/app/actions/images.ts:114-190`, quota claim and preflight at `apps/web/src/app/actions/images.ts:238-292`, save-original/metadata/DB insert/queue payload at `apps/web/src/app/actions/images.ts:340-531`.
- Lightroom/PAT upload independently mirrors the same lifecycle: auth + maintenance gate at `apps/web/src/app/api/admin/lr/upload/route.ts:68-83`, quota claim/settle at `apps/web/src/app/api/admin/lr/upload/route.ts:114-151`, upload contract/config snapshot at `apps/web/src/app/api/admin/lr/upload/route.ts:243-275`, save-original/HDR/GPS/insert at `apps/web/src/app/api/admin/lr/upload/route.ts:307-461`, and queue payload at `apps/web/src/app/api/admin/lr/upload/route.ts:479-516`.
- The shared queue snapshot exists in `apps/web/src/lib/image-queue.ts:92-120`, but both adapters still manually thread every field.
- The LR route carries many parity-fix comments for prior browser/LR drift, e.g. settings forwarding at `apps/web/src/app/api/admin/lr/upload/route.ts:489-505`, caption EXIF forwarding at `apps/web/src/app/api/admin/lr/upload/route.ts:506-515`, HDR parity at `apps/web/src/app/api/admin/lr/upload/route.ts:348-365`, and GPS parity at `apps/web/src/app/api/admin/lr/upload/route.ts:367-385`.

Concrete failure scenario:

A future upload-time setting or metadata column is added. The browser action forwards it, but the PAT route misses it. Photos uploaded from the dashboard and Lightroom then diverge in original stripping, color metadata, derivatives, captions, embeddings, or audit linkage until a backfill or later review catches the drift.

Suggested fix:

Extract a server-only ingest service that owns config snapshotting, quota claim/settle, original save, GPS/HDR gates, insert DTO, `processing_settings_json`, tag hooks, and queue job construction. Keep browser and PAT routes as thin adapters. Add an exhaustiveness/source-contract test around the shared ingest DTO and `ProcessingSettingsSnapshot`.

### ARCH22-02 - Queue workers can pin most of the shared MySQL pool during Sharp work

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- The shared MySQL pool is fixed at 10 connections with queue limit 20 in `apps/web/src/db/index.ts:23-33`.
- `QUEUE_CONCURRENCY` can be raised to 8 in `apps/web/src/lib/image-queue.ts:87-90`.
- Each job acquires a MySQL advisory lock by checking out a shared pool connection and returning it as the lock handle in `apps/web/src/lib/image-queue.ts:446-455`.
- That connection stays held while the job reads the row, resolves/verifies the original, runs `processImageFormats`, verifies outputs, and updates `images` in `apps/web/src/lib/image-queue.ts:519-657`.
- The lock connection is released only in the final cleanup in `apps/web/src/lib/image-queue.ts:812-815`.
- The codebase already has a safer pool-budget pattern for admin backfill: reserve live headroom and cap concurrency in `apps/web/src/lib/admin-backfill-runner.ts:105-141`, applied at `apps/web/src/lib/admin-backfill-runner.ts:667-678`.

Concrete failure scenario:

An operator raises `QUEUE_CONCURRENCY=8` to drain a large upload. Eight image jobs can hold eight of ten pool connections across AVIF/WebP/JPEG encoding. Live page renders, auth checks, uploads, search, and queue DB writes then fight for two remaining connections and a 20-request queue, so a healthy DB can still produce avoidable app-level 500/503s.

Suggested fix:

Do not hold shared-pool advisory-lock connections across Sharp work. Prefer a durable DB row claim/state transition, a dedicated small advisory-lock pool, or a queue concurrency cap derived from `POOL_CONNECTION_LIMIT` with reserved live headroom, mirroring the backfill runner budget. Add a source/stress test that proves foreground queue settings cannot consume more than the background connection budget.

### ARCH22-03 - Single-process topology is documented but not enforced

Severity: Medium
Confidence: High
Status: Risk

Evidence:

- The docs explicitly state the deployment is single web-instance/single-writer and list process-local state in `CLAUDE.md:232-235`.
- Restore maintenance is only a `globalThis` flag in `apps/web/src/lib/restore-maintenance.ts:1-56`.
- Upload quota/active-upload state is a `globalThis` `Map` in `apps/web/src/lib/upload-tracker-state.ts:7-20` and `apps/web/src/lib/upload-tracker-state.ts:70-78`.
- Shared-group view counts are buffered in module-local memory in `apps/web/src/lib/data.ts:13-41` and drained on signal by `apps/web/src/instrumentation.ts:18-65`.
- Queue bootstrap is per process in `apps/web/src/instrumentation.ts:1-6`; the queue state itself is `globalThis`-backed in `apps/web/src/lib/image-queue.ts:76-90`.
- Compose currently defines one web service in `apps/web/docker-compose.yml:1-28`, but there is no startup lease or writer-count assertion that fails fast if a second process joins.

Concrete failure scenario:

A future operator starts a second web process behind the same reverse proxy for availability. Process A begins DB restore and sets its local maintenance flag. Process B does not see that flag and can accept uploads, queue work, public rate-limit traffic, or view-count buffering during the restore window. Public rate-limit budgets and admin backfill status also split by process.

Suggested fix:

Make the topology executable. If single-writer remains the product contract, add a startup DB advisory lease with a clear fatal error when another writer is active. If multi-process is desired, move restore state, upload quotas, public rate-limit buckets that matter, queue ownership, and buffered analytics to shared durable coordination.

### ARCH22-04 - `topics.slug` is a mutable natural key with manual fan-out

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- `topics.slug` is the primary key in `apps/web/src/db/schema.ts:4-12`.
- FK children store the slug directly: `topicAliases.topicSlug` in `apps/web/src/db/schema.ts:14-17`, `images.topic` in `apps/web/src/db/schema.ts:19-34`, and `topicViews.topic` in `apps/web/src/db/schema.ts:239-242`.
- Smart collections store topic predicates inside JSON rather than an FK-backed relation in `apps/web/src/db/schema.ts:297-306`.
- Topic rename is implemented as create-new/update dependents/remap JSON/delete-old in `apps/web/src/app/actions/topics.ts:255-339`.
- The rename block already contains comments for previously missed siblings: analytics cascade-loss in `apps/web/src/app/actions/topics.ts:292-301` and smart-collection JSON remapping in `apps/web/src/app/actions/topics.ts:303-335`.

Concrete failure scenario:

A new table or JSON payload starts referencing topic slugs. The rename transaction is not updated. A later slug rename leaves stale references that render empty pages/searches, or the old topic delete cascades analytics/content before the new referrer is repointed.

Suggested fix:

Move to immutable surrogate topic IDs for relational ownership and keep slug as a unique route attribute/history record. If that is too large, centralize slug referrers in a registry/remapper and make tests fail whenever a schema/JSON referrer is added without a rename-path update.

### ARCH22-05 - `CLAUDE.md` still documents a compose build command that bypasses `.env.local`

Severity: Low-Medium
Confidence: High
Status: Confirmed

Evidence:

- `README.md` now gives the correct manual command with `--env-file apps/web/.env.local` in `README.md:180-190`.
- The deploy helper also uses `docker compose --env-file apps/web/.env.local ... up -d --build` in `apps/web/deploy.sh:30-32`.
- But `CLAUDE.md` still says to run `docker compose -f apps/web/docker-compose.yml up -d --build` in `CLAUDE.md:642-659`.
- Compose build args read `BASE_URL`, `IMAGE_BASE_URL`, `UPLOAD_MAX_TOTAL_BYTES`, and `NEXT_UPLOAD_BODY_MAX_BYTES` from the Compose interpolation environment in `apps/web/docker-compose.yml:4-11`; runtime `env_file` is separate in `apps/web/docker-compose.yml:18-22`.

Concrete failure scenario:

An operator follows `CLAUDE.md`, sets `BASE_URL`, `IMAGE_BASE_URL`, or upload body caps only in `apps/web/.env.local`, and runs the stale command. The runtime sees the env file, but the image build used empty/default build args. The built Next image can miss CDN remote patterns or bake different upload/body limits than the runtime configuration implies.

Suggested fix:

Update `CLAUDE.md:657` to match README/deploy script. Add a docs source-contract test that scans documented `docker compose ... --build` commands and requires `--env-file apps/web/.env.local` unless the surrounding text explicitly tells operators to export every build arg in the shell.

## Fixed / Non-Findings Checked

- Prior backup-download descriptor leak appears fixed: `apps/web/src/app/api/admin/db/download/route.ts:42-96` tracks the opened handle and closes it on catch before stream ownership transfers.
- README's manual compose command is fixed at `README.md:187-189`; only `CLAUDE.md` still drifts.
- The storage abstraction remains quarantined: `apps/web/src/lib/storage/index.ts:1-18` states it is not wired into the live pipeline, and grep found no production importers outside `lib/storage`.
- Migration journal monotonicity and silent-skip protection are guarded by `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:1-120` and `apps/web/src/__tests__/migration-journal.test.ts:1-121`; `migrate.js` still has per-entry hash reconciliation and postconditions.
- Public OG/search/semantic expensive routes have explicit rate-limit/source-contract posture in the inspected route files and `apps/web/src/lib/rate-limit.ts:1-58`.

## Final Sweep / Skipped Files

Final sweep covered architecture/design risks, module boundaries, layering, invariants, deployment topology, data lifecycle, long-horizon coupling, prior architect findings, and broad source/deploy/schema/test surfaces. I did not inspect binary screenshots/assets, generated lockfile internals beyond package/deploy context, or every historical plan/archive file line-by-line; they are not part of the live architecture/runtime contract. No relevant source, deployment, schema, migration, or current project instruction file was intentionally skipped.
