# Cycle 24 Architect Review

Role: architect
Date: 2026-07-08 09:29 KST
Reviewed HEAD: `4b43fad7ab471287b82fe5c8dac85c05c511220a`
Status: review-only; no source-code edits.

## Inventory

I first inventoried architecture-relevant files with repository file listing and targeted symbol searches, then inspected the relevant source, scripts, config, migrations, tests, and planning records. Generated/runtime artifacts such as `.next`, `.omc`, `test-results`, uploads, and dependency folders were excluded.

Relevant categories examined:

- Operating context and plans: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, Cycle 23 plan/deferred ledgers, and existing review files for carry-forward context.
- App/runtime topology: `apps/web/src/instrumentation.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/single-writer-guard.ts`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`.
- Schema and migrations: `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, restore SQL scanners and migration tests.
- Upload, storage, and processing boundaries: browser upload action, Lightroom/PAT upload route, upload path helpers, storage abstraction modules, direct upload serving, image queue, CLIP/semantic processing, pending file deletion cleanup.
- Auth, restore, queue, and state ownership: admin auth/session/token modules, restore maintenance modules, admin mutation barrier, pending revocations, pending file deletions, background DB write queue, admin backfill runner, maintenance scheduler.
- Public/admin route layering: App Router public pages/routes, protected admin layouts/pages, admin API routes, public API routes, rate-limit/auth/origin lint scanners.
- Frontend component architecture: large client components including viewer, upload, search, map, settings, image manager, histogram, bottom sheet, color details, lightbox, and admin navigation components.
- Tests and static contracts: privacy/schema tests, migration journal/reconcile tests, auth/origin/rate-limit scanners, upload/queue/restore tests, touch-target audit, component and route tests.

Validation evidence: this was a read-only architecture review. I did not run destructive commands. I did not run the full gate suite because the requested output is a review artifact, not implementation.

## Confirmed Issues

### ARCH-C24-01 - Browser and Lightroom uploads duplicate the same multi-phase ingest transaction

Severity: High
Confidence: High
Status: confirmed design issue

Evidence:

- Browser upload owns auth/origin, processing-slot reservation, upload tracker claim, topic validation, original file write, HDR/GPS decisions, restore rechecks, DB insert, and queue enqueue in one action: `apps/web/src/app/actions/images.ts:87-106`, `apps/web/src/app/actions/images.ts:156-221`, `apps/web/src/app/actions/images.ts:265-278`, `apps/web/src/app/actions/images.ts:325-516`.
- Lightroom/PAT upload separately repeats the same lifecycle with its own tracker, restore rechecks, upload contract lock, file write, HDR/GPS handling, insert, and enqueue: `apps/web/src/app/api/admin/lr/upload/route.ts:84-99`, `apps/web/src/app/api/admin/lr/upload/route.ts:130-178`, `apps/web/src/app/api/admin/lr/upload/route.ts:254-280`, `apps/web/src/app/api/admin/lr/upload/route.ts:357-580`.
- The route contains parity comments tying one path to the other, which confirms this is maintained by manual mirroring rather than a shared boundary.

Why this is a problem:

The core ingest transaction is a bounded context, but it is implemented twice at route/action level. The duplicated code has to preserve the same ordering across quota reservation, disk writes, metadata extraction, privacy stripping, topic validation, restore maintenance checks, DB insert, queue enqueue, and cleanup. That is too much cross-cutting state for manual parity.

Concrete failure scenario:

A future fix adds a new privacy field, post-restore guard, upload setting, or queue snapshot value to browser upload only. Browser uploads remain correct, but Lightroom uploads persist different metadata or enqueue stale settings. The failure may appear later as inconsistent derivative generation, unstripped GPS data, bad quota accounting, or files present on disk without matching DB rows.

Suggested fix:

Extract a shared ingest service with one transaction-shaped API, for example `ingestUploadedImage({ principal, source, file, topicId, settingsSnapshot, quotaClaim })`. Keep transport-specific concerns at the edge: browser form parsing and PAT auth stay in their callers, while file persistence, metadata policy, restore rechecks, DB insert, cleanup, and queue enqueue live in the service. Add parity tests that drive both transports through the same service and assert equivalent persisted/enqueued records.

### ARCH-C24-02 - The storage abstraction is not the live storage boundary

Severity: Medium
Confidence: High
Status: confirmed design issue

Evidence:

- The storage index explicitly states that production upload, processing, and serving still use direct filesystem paths and that the abstraction is only future-facing: `apps/web/src/lib/storage/index.ts:4-12`.
- The storage interface repeats that not all gallery storage goes through it and exposes future stream methods: `apps/web/src/lib/storage/types.ts:4-9`, `apps/web/src/lib/storage/types.ts:51-76`.
- The local backend maps storage keys to `UPLOAD_ROOT` and local originals: `apps/web/src/lib/storage/local.ts:38-61`, `apps/web/src/lib/storage/local.ts:159-167`.
- Production upload/serve paths bypass the abstraction through direct filesystem helpers: `apps/web/src/lib/upload-paths.ts:12-23`, `apps/web/src/lib/upload-paths.ts:28-41`, `apps/web/src/lib/upload-paths.ts:59-88`, `apps/web/src/lib/serve-upload.ts:198-229`, `apps/web/src/app/actions/images.ts:336-373`.
- Repository search found no production callers of `getStorage()`, `switchStorageBackend()`, or `StorageBackend` outside the storage module itself.

Why this is a problem:

The codebase has a named storage boundary, but the authoritative upload, processing, derivative, and serving flows are still coupled to local disk paths. That creates a false extension point: future maintainers can switch or extend the storage module and believe the app is backend-agnostic when the operationally important paths remain local-only.

Concrete failure scenario:

An object-storage backend is added behind `StorageBackend` and enabled through configuration. Tests around the storage module pass, but browser uploads still write to `public/uploads/originals`, image serving still realpaths local files, and processors still derive local paths. The deployment now has split storage, missing originals, or URLs that point at objects never written by the active upload path.

Suggested fix:

Either retire the unused abstraction until a real migration is scheduled, or make it the enforced boundary. A real migration should route original writes, derivative writes, reads, deletion queueing, and URL generation through a single storage service. Keep local filesystem as one backend and add contract tests at the upload/process/serve level, not only at the storage-module level.

### ARCH-C24-03 - Background work budgets are independent and can oversubscribe shared DB and CPU resources

Severity: High
Confidence: High for source design; Medium for production saturation threshold
Status: confirmed design issue

Evidence:

- Image queue state is process-local and has its own concurrency reservation logic: `apps/web/src/lib/image-queue.ts:100-153`, `apps/web/src/lib/image-queue.ts:313-372`, `apps/web/src/lib/image-queue.ts:389-472`.
- Admin backfill has a separate concurrency resolver and its own process-local status state: `apps/web/src/lib/admin-backfill-runner.ts:12-51`, `apps/web/src/lib/admin-backfill-runner.ts:97-142`, `apps/web/src/lib/admin-backfill-runner.ts:145-180`.
- Analytics/background writes have another process-local queue and fixed write concurrency: `apps/web/src/lib/background-db-writes.ts:3-10`, `apps/web/src/lib/background-db-writes.ts:42-75`, `apps/web/src/lib/background-db-writes.ts:77-112`.
- CLIP inference has a separate process-local queue with independent concurrency, pending limit, and timeout settings: `apps/web/src/lib/clip-model.ts:53-72`, `apps/web/src/lib/clip-model.ts:117-173`.

Why this is a problem:

The repo has several subsystems that correctly limit themselves locally, but there is no shared background-work budget across image processing, admin backfill, analytics writes, semantic embedding, and restore drains. Each subsystem can be locally "safe" while the aggregate exceeds MySQL pool, CPU, memory, or disk I/O capacity.

Concrete failure scenario:

An admin starts a color/embedding backfill while uploads are processing and public traffic is writing analytics events. The queue and backfill both compute available DB headroom independently, analytics drains with its own concurrency, and CLIP inference queues separately. Under load, request handlers contend with background jobs for DB connections and CPU, causing admin API timeouts, queue retries, or public page latency spikes even though no individual subsystem violated its own cap.

Suggested fix:

Introduce a shared background budget coordinator for DB write slots, CPU/inference slots, and long-running maintenance slots. Queue, backfill, analytics drains, semantic embedding, restore cleanup, and future maintenance jobs should acquire leases from the same coordinator. Add stress tests that run queue processing plus backfill plus analytics drain against a small configured DB pool and assert foreground requests keep reserved capacity.

### ARCH-C24-04 - The single-writer guard detects unsafe multi-instance topology but does not enforce it

Severity: High
Confidence: High
Status: confirmed design issue

Evidence:

- The guard documents that the app is intended for one web instance and one startup process, but that startup guard is intentionally warn-only: `apps/web/src/lib/single-writer-guard.ts:7-16`.
- The topology warning states that multiple instances are unsafe while startup continues: `apps/web/src/lib/single-writer-guard.ts:218-235`.
- Startup runs the guard as a non-fatal fire-and-forget check: `apps/web/src/instrumentation.ts:22-31`.
- Process-local mutation and queue state are initialized during runtime startup: `apps/web/src/instrumentation.ts:1-10`, `apps/web/src/lib/image-queue.ts:313-372`, `apps/web/src/lib/background-db-writes.ts:3-10`.

Why this is a problem:

The app's correctness relies on process-local state: queue de-duplication, upload tracking, mutation barriers, rate limiter memory, background write queues, and graceful shutdown drains. A second app process is therefore a data-consistency event, not merely an operational warning. The current guard surfaces the condition but lets both processes serve traffic.

Concrete failure scenario:

An operator scales Docker replicas to two or briefly runs an old and new container during a manual deploy. Both processes bootstrap queues and accept uploads. They can double-process images, split upload quota/tracker state, run independent background drains, and disagree about restore or mutation barriers. Logs show the topology warning, but the damage can occur before an operator sees it.

Suggested fix:

Make topology enforcement match the product contract. For a single-instance product, fail startup or fail readiness when another live writer is detected, with an explicit emergency override such as `ALLOW_UNSAFE_MULTI_WRITER=1`. If multi-instance support is desired, move queue ownership, upload locks, mutation barriers, rate limits, and background budgets to durable DB/Redis-backed leases before allowing multiple writers.

## Likely Issues

### ARCH-C24-05 - Smart collections are a partial bounded context without an operable admin lifecycle

Severity: Medium
Confidence: Medium
Status: likely issue; functional need and operator expectations need product validation

Evidence:

- Smart collections have schema and public metadata fields: `apps/web/src/db/schema.ts:328-342`.
- Server actions can create, update, and delete collections: `apps/web/src/app/actions/collections.ts:16-68`, `apps/web/src/app/actions/collections.ts:71-123`, `apps/web/src/app/actions/collections.ts:125-150`.
- The read helper was removed because there are no current callers and endpoint hardening was not needed yet: `apps/web/src/app/actions/collections.ts:152-158`.
- Public collection pages read and compile saved collection rules: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-111`.
- Admin navigation exposes dashboard, categories, tags, SEO, settings, tokens, password, users, DB, and analytics, but no collection management surface: `apps/web/src/components/admin-nav.tsx:15-26`.
- User-facing copy says custom collections are not editable in the admin UI yet and can require direct database edits when deleting referenced topics: `messages/en.json:507-508`.

Why this is a problem:

The bounded context is neither fully internal nor fully operable. Schema, public rendering, and mutating actions exist, but the admin lifecycle is incomplete. That creates a feature island whose records can affect public behavior while normal administrators cannot list, validate, repair, or safely detach them.

Concrete failure scenario:

A collection references a topic that needs deletion. The delete flow blocks because the topic is referenced by a collection, but the admin UI has no collection editor to remove that reference. The operator is pushed toward direct DB edits, bypassing application validation and risking malformed collection rules or broken public collection pages.

Suggested fix:

Either complete the bounded context or hide it behind a clear feature flag. Completing it means an admin collection list/editor, validation preview, reference management during topic/tag deletion, and tests for rule compile/render behavior. If it remains intentionally dormant, remove or harden unused mutating actions and keep public routes disabled unless records are managed through a supported path.

### ARCH-C24-06 - Large client components concentrate unrelated UI state and domain side effects

Severity: Medium
Confidence: High for source shape; Medium for defect likelihood
Status: likely issue

Evidence:

- `apps/web/src/components/photo-viewer.tsx` is 1064 lines and imports routing, sharing, lightbox state, histogram, color detail, similar image fetches, URL transforms, display capability checks, and download labels in one component region: `apps/web/src/components/photo-viewer.tsx:47-71`.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` is 895 lines and mixes settings form state, backfill polling/timers, validation, save actions, and trigger actions: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:55-75`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:91-149`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:160-253`.
- `apps/web/src/components/image-manager.tsx` is 696 lines and combines table presentation, selection, tag editing, deletion, upload/processing status, and mutation handling: `apps/web/src/components/image-manager.tsx:72-120`, `apps/web/src/components/image-manager.tsx:427-620`.
- `apps/web/src/components/search.tsx` is 581 lines and keeps query state, filters, semantic/text mode behavior, async result loading, and rendering together: `apps/web/src/components/search.tsx:131-260`.

Why this is a problem:

These components are doing container, state-machine, data-fetch, mutation, accessibility, and presentation work at the same layer. The architecture makes it hard to reason about invariants such as "which async result is current," "which modal owns focus," "which mutation is allowed during restore," or "which state resets when filters change."

Concrete failure scenario:

A seemingly visual change to the photo viewer or admin settings page changes local state ordering and accidentally leaves stale async results visible, double-triggers a backfill action, breaks keyboard focus, or bypasses an existing disabled state during restore. Because behavior and rendering are interleaved, review has to re-audit the whole component for each localized edit.

Suggested fix:

Refactor incrementally by behavior boundary, not by cosmetic sections. Move async/search/backfill/viewer state into focused hooks or reducers, split pure presentational children from mutation containers, and add interaction tests for the extracted state machines. Keep the public props narrow so domain decisions remain in one container per workflow.

## Risks Needing Manual Validation

### ARCH-C24-07 - Nginx and real-client-IP behavior are operator-owned but safety-critical

Severity: Medium
Confidence: Medium
Status: risk needing manual validation

Evidence:

- Nginx rate-limit zones and comments depend on client IP behavior: `apps/web/nginx/default.conf:1-29`.
- The config explicitly documents an operator contract around `X-Forwarded-For` and trusted proxy topology: `apps/web/nginx/default.conf:59-71`.
- Admin DB restore upload limits are enforced in Nginx config: `apps/web/nginx/default.conf:115-120`.
- Next image and public SSR limiters live in the same config: `apps/web/nginx/default.conf:254-295`.
- App deploy rebuilds/restarts compose services but does not apply external Nginx config: `apps/web/deploy.sh:51-55`, `apps/web/deploy.sh:79-104`.

Why this is a problem:

Several security and availability controls live outside the app deployment unit. If the live reverse proxy config drifts from the repository copy, app tests and app deploy success do not prove that public/admin rate limits, DB restore caps, or real-client-IP behavior are active in production.

Concrete failure scenario:

The app deploy succeeds, but the host Nginx config was never reloaded after a repository change. Public SSR requests are rate-limited by proxy IP instead of client IP, or a restore upload cap remains at an old value. The app appears healthy, but production abuse controls or admin upload behavior differ from reviewed source.

Suggested fix:

Add an operator validation step that compares the live Nginx config/checksum and effective `real_ip` behavior against the repository contract during deploy or post-deploy health checks. Keep app deploy non-destructive, but make drift visible and fail the operational checklist when safety-critical proxy config is stale.

### ARCH-C24-08 - Build-time and runtime environment split can produce stale image/site behavior after restart-only operations

Severity: Medium
Confidence: Medium
Status: risk needing manual validation

Evidence:

- Next image remote patterns are built from `IMAGE_BASE_URL` at module/build configuration time: `apps/web/next.config.ts:32-38`, `apps/web/next.config.ts:121-125`.
- Docker build args bake `BASE_URL`, `IMAGE_BASE_URL`, upload limits, and related public values into the build step: `apps/web/Dockerfile:91-99`, `apps/web/Dockerfile:117-120`.
- Runtime uses an env file and mounts site config, while compose comments state that `src/site-config.json` is build-time inlined and the runtime mount is inert unless the image was built with that file: `apps/web/docker-compose.yml:18-32`.
- Remote deploy is config-driven through an env file and then runs the remote deploy command: `scripts/deploy-remote.sh:22-29`, `scripts/deploy-remote.sh:55-80`, `scripts/deploy-remote.sh:87-93`.

Why this is a problem:

Some values are runtime configuration, while others affect compiled Next output. The boundary is documented, but it is easy for an operator to perform a restart-only change and expect new image host/site values to apply. The result can be a running container whose runtime env and compiled Next config disagree.

Concrete failure scenario:

An operator changes `IMAGE_BASE_URL` or site config in the deploy env file and restarts the container instead of rebuilding. Server code sees one value, but Next's image optimizer remote allowlist or inlined site metadata still reflects the old build. Public pages then fail to optimize images from the new host or display stale site metadata until a full rebuild occurs.

Suggested fix:

Make build-scoped settings explicit in tooling. The deploy helper should print or validate a build-required-change list when build-time env/site config differs from the image labels used to build the current container. Alternatively, move values that truly need runtime mutability out of Next build config and into runtime-serving paths with tests that prove restart-only changes work.

## Final Sweep

Relevant file categories examined:

- App Router public pages, admin protected pages, public/admin API routes, and server actions.
- Auth/session/token/origin/rate-limit boundaries, including scanner tests and route wrappers.
- Restore maintenance, mutation barriers, pending session revocations, pending file deletions, graceful shutdown, and startup instrumentation.
- Upload, direct filesystem paths, storage abstraction modules, direct upload serving, image processing queue, CLIP model/inference, semantic search and similar-image APIs.
- Database schema, migration journal, migration runner, DML baseline guard, and legacy schema reconciliation.
- Runtime/deploy topology: Dockerfile, compose, deploy scripts, Nginx config, Next config, instrumentation, and single-writer guard.
- Frontend component architecture, especially large client components and admin/public workflow containers.
- Existing plan/deferred ledgers to avoid re-filing already resolved Cycle 23 items as new defects.

Common missed issues checked:

- Migration journal/schema contract: no new finding. The migration runner has a journal/hash postcondition and DML baseline guard, and the schema reconciliation path mirrors committed schema state in the inspected regions.
- Admin API auth wrappers and action origin policy: no new finding from architecture inspection; these boundaries are covered by dedicated scanners.
- Privacy-sensitive admin-only fields: no new finding from the reviewed schema/data privacy guard pattern.
- Restore maintenance coverage: Cycle 23 appears to have addressed the protected-admin gate class that existed in the previous architect review; I did not re-raise it.
- Public map/search/semantic scale risks: still architecturally relevant and partly documented as deferred scale work, but I did not raise them as new confirmed defects beyond the manual-validation/operator and shared-budget risks above.
- Upload/storage abstraction, background budget ownership, single-writer topology, frontend component boundaries, smart collection lifecycle, and deploy/operator boundaries remain the primary architectural risk areas for this cycle.
