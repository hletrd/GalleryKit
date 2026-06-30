# Architect Review - Cycle 21

Review role: architect
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `1ed96484` on `master`
Implementation files edited: none, except this review report

## Summary

- Findings: 6
- Severity mix: 0 critical, 0 high, 5 medium, 1 low-medium
- Confidence mix: 5 high, 1 medium-high
- Recommendation: keep current single-instance production posture; address the medium coupling/deploy/pool risks before the next scaling or ingest-expansion cycle.

## Inventory Reviewed

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Current/prior context reviewed:

- Current cycle artifacts: `.context/reviews/code-reviewer.md`, `.context/reviews/critic.md`, `.context/reviews/verifier.md`, `.context/reviews/perf-reviewer.md`, `.context/reviews/security-reviewer.md`, `.context/plans/cycle-21-plan.md`, `.context/plans/cycle-21-deferred.md`
- Prior aggregate context: `.context/reviews/_aggregate.md`, `.omx/context/cycle20-review-plan-fix-20260630T010801Z.md`

Relevant HEAD inventory:

- App/router/actions/API: 77 files under `apps/web/src/app`
- Shared library/domain layer: 97 files under `apps/web/src/lib`
- UI/component layer: 57 files under `apps/web/src/components`
- Tests: 271 files under `apps/web/src/__tests__`
- Total source inventory: 509 files under `apps/web/src`; 608 tracked app files under `apps/web`
- Schema/migrations/scripts/deploy surfaces: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/scripts/**`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `README.md`, `apps/web/README.md`, `CLAUDE.md`

Validation evidence:

- Static inventory and line-level review of upload ingest, Lightroom ingest, queue locking, DB pool budgeting, topic slug rename fan-out, process-local runtime state, storage quarantine, manual/scripted Docker deploy paths, backup download streaming, privacy select guards, and rate-limit/auth wrapper surfaces.
- Grep sweeps covered `globalThis`, process-local state, `@/lib/storage` imports, TODO/FIXME markers, admin API wrappers, server-action origin guards, public route rate-limit helpers, deployment env propagation, and current cycle deferred items.
- I did not run full lint/typecheck/test/build because this was a read-only architecture review artifact. Existing cycle-21 artifacts report recent focused and full gates, but this report's claims are based on fresh source inspection at `1ed96484`.

## Findings

### ARCH21-01 - Upload ingest still has multiple implementation owners

Severity: Medium
Confidence: High
Status: Confirmed architecture/layering issue

Evidence:

- Browser upload owns auth, input validation, config snapshot, upload tracker claim, disk precheck, topic existence, save-original, GPS/HDR gates, DB insert DTO, processing snapshot persistence, and queue payload construction in `apps/web/src/app/actions/images.ts:114-190`, `apps/web/src/app/actions/images.ts:238-292`, `apps/web/src/app/actions/images.ts:340-463`, and `apps/web/src/app/actions/images.ts:499-531`.
- The Lightroom route says it reuses existing upload infrastructure in `apps/web/src/app/api/admin/lr/upload/route.ts:15-18`, but it independently owns the same lifecycle: quota claim and settle closure at `apps/web/src/app/api/admin/lr/upload/route.ts:114-151`, validation and topic lookup at `apps/web/src/app/api/admin/lr/upload/route.ts:153-241`, contract lock/config/disk/save-original at `apps/web/src/app/api/admin/lr/upload/route.ts:243-331`, insert DTO at `apps/web/src/app/api/admin/lr/upload/route.ts:404-462`, and queue payload at `apps/web/src/app/api/admin/lr/upload/route.ts:479-516`.
- The shared queue snapshot type is centralized in `apps/web/src/lib/image-queue.ts:92-120`, but both adapters still have to remember every field explicitly.
- Current code comments in the Lightroom route document repeated parity fixes for browser-path drift: config field forwarding at `apps/web/src/app/api/admin/lr/upload/route.ts:489-505`, EXIF caption forwarding at `apps/web/src/app/api/admin/lr/upload/route.ts:506-515`, HDR gate parity at `apps/web/src/app/api/admin/lr/upload/route.ts:348-365`, and GPS strip parity at `apps/web/src/app/api/admin/lr/upload/route.ts:367-385`.

Failure scenario:

A future processing/privacy setting is added to `ProcessingSettingsSnapshot` or a new upload-time gate is introduced. The browser action forwards/enforces it, but the Lightroom PAT route or retry path misses one branch. The same production gallery then stores different originals, metadata, derivatives, captions, or embeddings depending on upload client until a manual backfill or reviewer catches the drift.

Suggested fix:

Extract a server-only ingest application service that owns the domain operation: config snapshot, quota claim/settle, original save, GPS/HDR gates, insert DTO, `processing_settings_json`, and queue job construction. Browser actions and PAT routes should become thin adapters that supply actor/source/request DTOs. Add an exhaustiveness/source-contract test that fails when the image insert contract or `ProcessingSettingsSnapshot` changes without updating the shared ingest builder.

### ARCH21-02 - Image queue workers can pin most of the shared MySQL pool during Sharp work

Severity: Medium
Confidence: High
Status: Confirmed runtime topology/performance architecture issue

Evidence:

- The shared MySQL pool has `POOL_CONNECTION_LIMIT = 10` and `queueLimit: 20` in `apps/web/src/db/index.ts:23-38`.
- Queue concurrency is env-configurable up to 8 in `apps/web/src/lib/image-queue.ts:87-90`.
- Each image job acquires a MySQL advisory lock using a connection from the shared pool and returns that connection as the lock handle in `apps/web/src/lib/image-queue.ts:446-455`.
- The same job keeps that lock connection while it checks the row, resolves and verifies the original, runs CPU/file-heavy Sharp processing, verifies output files, and updates the row in `apps/web/src/lib/image-queue.ts:519-657`.
- The lock connection is released only in the final cleanup at `apps/web/src/lib/image-queue.ts:812-815`.
- The repo already has a pool-budget cap pattern for admin backfill: it reserves roughly half the pool and caps effective concurrency in `apps/web/src/lib/admin-backfill-runner.ts:108-142`, then applies that cap at `apps/web/src/lib/admin-backfill-runner.ts:667-678`.

Failure scenario:

An operator raises `QUEUE_CONCURRENCY=8` to drain a large upload batch. Eight image jobs can hold eight of ten shared pool connections for the duration of AVIF/WebP/JPEG generation. Live requests, session checks, search, admin pages, uploads, and queue DB writes then contend for two remaining connections plus a queue of only 20. The database can be healthy while the app returns avoidable 500/503 responses due to pool starvation.

Suggested fix:

Do not hold shared-pool advisory-lock connections across Sharp work. Use a durable DB row claim/state transition, a small dedicated advisory-lock pool, or a queue concurrency cap derived from `POOL_CONNECTION_LIMIT` with reserved live headroom, matching the backfill runner's budget model. Add a stress/source-contract test that proves queue configuration cannot pin more than the chosen background connection budget.

### ARCH21-03 - Single-process topology is documented but not enforced

Severity: Medium
Confidence: High
Status: Confirmed latent topology risk

Evidence:

- The docs correctly warn that the Compose deployment is single web-instance/single-writer, and `README.md:152` says restore maintenance, upload quotas, and queue state are process-local.
- Restore maintenance is a `globalThis` flag in `apps/web/src/lib/restore-maintenance.ts:1-56`.
- Upload quota and active-upload checks use a `globalThis` `Map` in `apps/web/src/lib/upload-tracker-state.ts:7-20` and `apps/web/src/lib/upload-tracker-state.ts:70-78`.
- Shared-group view-count buffering is module-local state in `apps/web/src/lib/data.ts:13-41` and drains on process shutdown in `apps/web/src/instrumentation.ts:18-65`.
- Queue bootstrap/shutdown are process-local lifecycle hooks in `apps/web/src/instrumentation.ts:1-89`.
- Compose currently defines one `gallerykit-web` service with host networking in `apps/web/docker-compose.yml:1-28`, but there is no startup lease, replica-count assertion, or health warning that prevents a second app process from joining service.

Failure scenario:

A future operator runs two web processes behind the same reverse proxy to improve availability. Process A starts a DB restore and sets its local maintenance flag; Process B does not see that flag and accepts uploads or queue work during the restore window. Similarly, upload quota, public rate-limit fast paths, backfill status, and buffered view counts split by process.

Suggested fix:

Choose and enforce the product topology. If single-instance remains the contract, add a startup DB advisory lease or runtime assertion that fails fast when another writer process is active, and document the lease near `instrumentation.ts` and deployment files. If multi-process support is desired, move restore state, upload quotas, rate-limit buckets that matter, queue ownership, and buffers into shared durable storage/advisory-lock-backed coordination.

### ARCH21-04 - `topics.slug` is a mutable natural key with manual fan-out

Severity: Medium
Confidence: High
Status: Confirmed data-model boundary risk, currently fenced by tests/docs

Evidence:

- `topics.slug` is the primary key in `apps/web/src/db/schema.ts:4-12`.
- FK children use that natural key directly: `topicAliases.topicSlug` in `apps/web/src/db/schema.ts:14-17`, `images.topic` in `apps/web/src/db/schema.ts:19-34`, and `topicViews.topic` in `apps/web/src/db/schema.ts:239-250`.
- Smart collections store topic references inside JSON instead of an FK-backed relation in `apps/web/src/db/schema.ts:297-310`.
- Topic rename is implemented as insert-new, update each dependent store, remap matching smart-collection AST references, then delete old in `apps/web/src/app/actions/topics.ts:285-339`.
- The rename code already carries comments explaining prior missed siblings, including `topic_views` cascade-loss risk in `apps/web/src/app/actions/topics.ts:292-301` and smart collection JSON remapping in `apps/web/src/app/actions/topics.ts:303-334`.

Failure scenario:

A new feature adds another table or JSON payload referencing topic slugs. The rename transaction is not updated in the same change. A topic rename then either leaves stale references that produce empty public pages/searches or deletes analytics/content through cascade behavior before rows are re-pointed.

Suggested fix:

Move to immutable surrogate topic IDs for relational ownership and keep slug as a unique route attribute/history record, or add `ON UPDATE CASCADE` where supported and keep JSON referrers behind one explicit registry/remapper. Until then, keep the existing set-equality regression pattern and require any new topic-slug referrer to update the rename transaction and tests in the same change.

### ARCH21-05 - Manual Docker deployment docs still bypass the env file needed for build-time args

Severity: Medium
Confidence: High
Status: Confirmed deployment contract drift

Evidence:

- `README.md:175-182` tells operators to configure `apps/web/.env.local`, then run `docker compose -f apps/web/docker-compose.yml up -d --build`.
- `CLAUDE.md:645-659` repeats the manual deployment checklist and uses the same compose command at `CLAUDE.md:657`.
- Compose build args are resolved from Compose interpolation, not from the runtime `env_file`: `BASE_URL`, `IMAGE_BASE_URL`, `UPLOAD_MAX_TOTAL_BYTES`, and `NEXT_UPLOAD_BODY_MAX_BYTES` are under `build.args` at `apps/web/docker-compose.yml:4-11`, while `env_file: .env.local` is only runtime env at `apps/web/docker-compose.yml:18-22`.
- The scripted deploy path was fixed to pass the env file explicitly with `docker compose --env-file apps/web/.env.local ... up -d --build` in `apps/web/deploy.sh:30-32`.
- `README.md:148-151` warns that build-time values must be present before build, but the later copy-paste command at `README.md:180-182` does not make `.env.local` part of the Compose interpolation environment.

Failure scenario:

An operator follows the manual README path, sets `IMAGE_BASE_URL` or `NEXT_UPLOAD_BODY_MAX_BYTES` only in `apps/web/.env.local`, and runs the documented compose command. The runtime container sees the values through `env_file`, but the image was built with default or empty build args. CDN image hosts may be missing from build-time Next config, or the server-action body cap may be baked differently than runtime docs imply.

Suggested fix:

Update every documented manual compose build command to `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build`, or place an explicit `export`/Compose environment instruction immediately beside the command. Add a docs source-contract test that scans README/CLAUDE compose commands with `--build` and fails if they omit `--env-file apps/web/.env.local` without an adjacent export instruction.

### ARCH21-06 - Backup download can leak an opened descriptor on pre-stream failures

Severity: Low-Medium
Confidence: Medium-High
Status: Confirmed resource-lifecycle issue

Evidence:

- The backup download route opens the descriptor in `apps/web/src/app/api/admin/db/download/route.ts:56`.
- It closes the descriptor only on the `!stats.isFile()` branch in `apps/web/src/app/api/admin/db/download/route.ts:57-64`.
- It then awaits `getCurrentUser()`, derives the client IP, and writes an audit event before handing the descriptor to a stream in `apps/web/src/app/api/admin/db/download/route.ts:66-75`.
- The catch block returns 404/500 with no reference to close a descriptor opened before the failure in `apps/web/src/app/api/admin/db/download/route.ts:87-99`.
- The current verifier review identified the same gap and notes focused tests do not cover a throw after `open()` succeeds but before stream ownership begins in `.context/reviews/verifier.md:69-89`.

Failure scenario:

A transient session/auth/audit/header-path exception occurs after `open()` succeeds and before `fileHandle.createReadStream()` is constructed. The request returns 500 and the descriptor remains open until garbage collection or process exit. Repeated failed downloads can exhaust file descriptors in the single web process and make unrelated backup, upload, or image-serving operations fail.

Suggested fix:

Track the file handle and whether ownership has been transferred to a stream. Declare `let fileHandle: FileHandle | undefined; let streamCreated = false;` outside the try, set `streamCreated = true` immediately before creating/returning the stream, and close `fileHandle` in the catch path when `!streamCreated`. Add a regression that mocks an after-open failure and asserts `close()` is called.

## Guardrails Checked / Non-Findings

- The cycle-20 build/runtime env split for the scripted deploy is closed in `apps/web/deploy.sh:30-32`; only the manual documentation path remains stale.
- The Lightroom semantic enqueue drift called out by earlier cycle artifacts appears closed at HEAD: browser upload forwards `semanticSearchMode` in `apps/web/src/app/actions/images.ts:523-526`, and Lightroom forwards it in `apps/web/src/app/api/admin/lr/upload/route.ts:499-505`.
- `@/lib/storage` remains quarantined: it documents non-integration in `apps/web/src/lib/storage/index.ts:1-18`, has zero live non-test importers in the grep sweep, and is guarded by `apps/web/src/__tests__/storage-quarantine.test.ts:1-27`. I did not count the storage `createReadStream` whitelist mismatch as a live finding because CI is intended to fail before the module gains a production importer.
- The `PrivacySensitiveKeys` union is still hand-maintained in `apps/web/src/lib/data.ts:459-477`, but cycle-21 context correctly treats the current state as a cohesion/merge-risk item rather than a live runtime coupling bug. Public map/listing guards are present at `apps/web/src/lib/data.ts:479-507`.
- Source sweeps did not show an obvious current admin API wrapper gap or public mutating route rate-limit gap; dedicated lint gates should remain the authority for those invariants.

## Missed-Issues Sweep

Final sweep covered routing boundaries, server actions, public/admin API routes, upload/browser/LR ingest parity, queue and advisory-lock lifecycles, DB pool budgeting, restore/upload process-local topology, schema/migration/topic ownership, smart-collection JSON references, deployment env propagation, backup streaming lifecycle, storage abstraction quarantine, privacy select guards, current cycle deferred findings, and prior cycle aggregate issues. I did not intentionally skip relevant files for the requested architecture, ownership-boundary, deployment/runtime-topology, data-model, or maintainability review angles.
