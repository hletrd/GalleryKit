# Cycle 23 Critic Review

Reviewer: cycle 23 critic
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `45208b2181add5db64395e4dac30134cfd1fcf35` on `master`
Source edits: none. This review artifact is the only file written.
Commit/push/deploy: not performed because this task asked for a review artifact only and production deploys are outside this review write.

## Inventory Examined

Guidance and current review state:

- `AGENTS.md:1-49` for workspace git, deploy, schema, quality-gate, and review-output rules.
- `CLAUDE.md:1-671` for architecture, security model, runtime topology, color/HDR, migration, CLIP, deploy, and testing contracts.
- `/Users/hletrd/.agents/skills/code-review/SKILL.md:1-145` for the required review stance.
- Current cycle-22 artifacts and follow-up plan state: `.context/reviews/_aggregate.md:1-420`, `.context/reviews/critic.md` previous content, `.context/plans/cycle-22-2026-06-30-plan.md:1-105`, `.context/plans/cycle-22-2026-06-30-deferred.md:1-74`.
- Recent post-review commits: `4b3a4107`, `f9c03aff`, `bb62c0be`, `88ea74e1`, and `45208b21`.

Repository breadth checked:

- App/router/actions/API: browser upload, Lightroom/PAT upload, public semantic and similar search routes, OG routes, public server actions, admin DB actions, settings, tokens, topics, collections, and route/error surfaces.
- Core libraries: DB pool, advisory locks, image queue, image processing entry points, upload tracker, restore maintenance, data selectors/privacy guards, settings hash, smart collections, serve-upload, audit/view retention, CLIP model/path/limits, rate limits, validation, storage quarantine, and migration runner.
- Deploy/config/docs: root/web package manifests, Dockerfile, compose, nginx, deploy helper docs, README files, `.env.local.example`, `CLAUDE.md`, migrations, journal, and migration tests.
- Tests/source contracts: cycle-22 source contracts, advisory locks, smart collections, migration journal, privacy fields, audit retention, serve-upload, topic slug registry, semantic scan/route tests, CLIP model/offline gated tests, and relevant UI source-contract tests.

Validation evidence:

- `git rev-parse HEAD` returned `45208b2181add5db64395e4dac30134cfd1fcf35`; `git status --short` was clean before this artifact edit.
- Focused Vitest subset passed: `cycle-22-source-contracts.test.ts`, `advisory-locks.test.ts`, `smart-collections.test.ts`, `migration-journal.test.ts`, `migration-journal-monotonicity.test.ts`, `privacy-fields.test.ts`, `audit-retention.test.ts`, `serve-upload.test.ts` -> 8 files, 80 tests passed.
- Security lint gates passed:
  - `npm run lint:api-auth --workspace=apps/web`
  - `npm run lint:action-origin --workspace=apps/web`
  - `npm run lint:public-route-rate-limit --workspace=apps/web`
- Full lint/typecheck/build/Vitest/Playwright were not rerun in this critic pass because no source code was changed. Cycle-22 implementation records full gates green, and this pass reran the guards most relevant to the current findings.

## Findings

### CRIT23-01 - Foreground image queue can pin most of the shared MySQL pool when concurrency is raised

Severity: Medium  
Confidence: High  
Status: Confirmed operational risk

Evidence:

- The shared MySQL pool is fixed at 10 connections with queue limit 20 in `apps/web/src/db/index.ts:23-33`.
- `QUEUE_CONCURRENCY` is operator-configurable up to 8 in `apps/web/src/lib/image-queue.ts:87-90`.
- Each image job acquires a MySQL advisory-lock connection and returns the connection as the claim handle in `apps/web/src/lib/image-queue.ts:446-455`.
- That lock connection remains held while the job checks DB state, resolves the original, runs `processImageFormats`, verifies files, and updates the row in `apps/web/src/lib/image-queue.ts:554-657`.
- The claim is released only in final cleanup at `apps/web/src/lib/image-queue.ts:812-815`.
- The admin backfill path already has the missing pool-budget pattern: it documents the same pinned-connection arithmetic at `apps/web/src/lib/admin-backfill-runner.ts:108-127`, computes a cap at `apps/web/src/lib/admin-backfill-runner.ts:129-141`, and clamps runtime concurrency at `apps/web/src/lib/admin-backfill-runner.ts:667-678`.

Failure scenario:

An operator raises `QUEUE_CONCURRENCY=8` during a large import. Eight foreground jobs can hold eight of ten shared pool connections across long Sharp AVIF/WebP/JPEG work. Live page renders, session checks, public search, admin pages, and queue writes then compete for two connections and a 20-item wait queue, causing request failures even though the DB and encoder are individually healthy.

Concrete fix:

Either stop holding shared-pool advisory-lock connections across image encoding, or give the foreground queue the same pool-budget cap as admin backfill. A conservative first fix is `resolveImageQueueConcurrency(requested, POOL_CONNECTION_LIMIT)` with reserved live headroom and a regression test proving configured queue concurrency cannot consume the pool budget reserved for live traffic. A larger fix is a durable row-claim state or a dedicated small advisory-lock pool.

### CRIT23-02 - Single-process topology is documented but not enforced at startup

Severity: Medium  
Confidence: High  
Status: Confirmed architecture risk

Evidence:

- `CLAUDE.md:233-236` says the shipped deployment is single web-instance/single-writer and warns against horizontal scaling because restore maintenance, upload tracking, queues, and rate limits are process-local.
- Restore maintenance is a `globalThis` flag in `apps/web/src/lib/restore-maintenance.ts:1-56`.
- Upload tracking is a `globalThis` `Map` in `apps/web/src/lib/upload-tracker-state.ts:7-20`, with active-claim checks also process-local at `apps/web/src/lib/upload-tracker-state.ts:70-78`.
- Image queue state is also `globalThis`/module-local in `apps/web/src/lib/image-queue.ts:76-90` and `apps/web/src/lib/image-queue.ts:276-316`.
- Compose currently declares one `web` service and `container_name: gallerykit-web` in `apps/web/docker-compose.yml:3-28`, but there is no DB lease or process-count assertion that fails if another web process joins the same DB/uploads tree.

Failure scenario:

A future operator starts a second web process for availability. Process A begins a restore and sets only its local maintenance flag. Process B still accepts uploads, maintains its own quota and public-rate-limit maps, bootstraps its own queue, and buffers analytics. The system violates the documented single-writer restore and upload-integrity assumptions without a loud startup failure.

Concrete fix:

Make the topology executable. If single-writer remains the product contract, acquire a startup MySQL advisory lease such as `gallerykit_web_writer:<instance>` and fail fast when another writer is active. If multi-process support is desired, move restore state, upload quota tracking, public rate-limit buckets, queue ownership, and buffered analytics to shared durable coordination.

### CRIT23-03 - Upload ingest still has two implementation owners

Severity: Medium  
Confidence: High  
Status: Confirmed maintainability/product-correctness risk

Evidence:

- Browser upload owns its own auth/config/tracker setup at `apps/web/src/app/actions/images.ts:175-210`, post-claim preflight at `apps/web/src/app/actions/images.ts:238-292`, per-file GPS/HDR/restore/insert path at `apps/web/src/app/actions/images.ts:340-474`, and queue payload at `apps/web/src/app/actions/images.ts:499-531`.
- Lightroom/PAT upload independently mirrors the same lifecycle: tracker and idempotent settlement at `apps/web/src/app/api/admin/lr/upload/route.ts:114-151`, upload-contract/config snapshot at `apps/web/src/app/api/admin/lr/upload/route.ts:243-275`, HDR/GPS/restore gates at `apps/web/src/app/api/admin/lr/upload/route.ts:347-402`, and queue payload at `apps/web/src/app/api/admin/lr/upload/route.ts:479-516`.
- The Lightroom path carries multiple comments documenting parity fixes for settings, captions, HDR, GPS, restore, and EXIF/color propagation at `apps/web/src/app/api/admin/lr/upload/route.ts:348-356`, `apps/web/src/app/api/admin/lr/upload/route.ts:371-376`, `apps/web/src/app/api/admin/lr/upload/route.ts:388-394`, and `apps/web/src/app/api/admin/lr/upload/route.ts:489-515`.

Failure scenario:

A new upload-time privacy gate, metadata column, processing setting, or audit field is added to the browser dashboard path and tested there. Lightroom publishes then diverge in GPS stripping, HDR rejection, captions, semantic embedding mode, processing settings, or audit payloads. The defect is likely to be noticed only after comparing browser and external-client uploads.

Concrete fix:

Extract a server-only ingest service that owns config snapshotting, quota settlement, original save, GPS/HDR/restore gates, insert DTO construction, tag hooks, audit shape, and queue job construction. Keep browser actions and Lightroom route code as request adapters. Add parity tests that construct one canonical ingest DTO and assert both adapters call it with equivalent inputs.

### CRIT23-04 - Browser upload quota settlement remains structurally fragile

Severity: Medium  
Confidence: Medium-High  
Status: Likely future-regression risk

Evidence:

- Browser upload pre-claims quota synchronously at `apps/web/src/app/actions/images.ts:238-242`.
- Known post-claim preflights settle manually on disk and topic failures at `apps/web/src/app/actions/images.ts:247-264` and `apps/web/src/app/actions/images.ts:280-292`.
- The code comment explicitly says any future await between claim and final settle must roll the claim back on throw at `apps/web/src/app/actions/images.ts:271-279`.
- A post-claim cleanup await is safe only because `deleteOriginalUploadFile` currently swallows unlink failures, documented at `apps/web/src/app/actions/images.ts:540-548` and implemented at `apps/web/src/lib/upload-paths.ts:71-77`.
- Final reconciliation is manual at `apps/web/src/app/actions/images.ts:570-596`.
- The Lightroom route uses the sturdier pattern: one idempotent `settleTrackerToActual` closure at `apps/web/src/app/api/admin/lr/upload/route.ts:139-151`.
- The cycle-22 regression added source-shape coverage, but it is still static string coverage around the known span at `apps/web/src/__tests__/cycle-22-source-contracts.test.ts:96-108`, not a scoped lifecycle helper.

Failure scenario:

A future validation, cleanup, or metadata-enrichment await is inserted after the browser claim and before the final settle, or `deleteOriginalUploadFile` is changed to surface filesystem errors. A transient failure escapes to the outer finally-only area and leaves the admin/IP upload tracker charged for up to the one-hour window, rejecting legitimate follow-up uploads.

Concrete fix:

Adopt the Lightroom route's idempotent settlement closure in `uploadImages`, wrapping the full post-claim span in a `try/finally`. Preserve the current success/all-failed semantics, but have the finally settle `(0, 0)` if no earlier settlement ran. Add a behavior test that injects a throw from a post-claim await and asserts the tracker is reconciled.

### CRIT23-05 - Audit retention deletes all expired rows in one statement

Severity: Low  
Confidence: High  
Status: Likely operational risk

Evidence:

- `purgeOldAuditLog` validates retention inputs, computes a cutoff, and then runs one unbounded `db.delete(auditLog).where(lt(auditLog.created_at, cutoff))` in `apps/web/src/lib/audit.ts:97-122`.
- The analogous analytics retention path uses chunked deletes with a per-statement cap and per-run iteration cap in `apps/web/src/lib/view-retention.ts:31-37` and `apps/web/src/lib/view-retention.ts:64-87`.
- Current audit tests focus on retention-window parsing, not delete boundedness, in `apps/web/src/__tests__/audit-retention.test.ts`.

Failure scenario:

On a long-lived install or after a temporary retention misconfiguration, expired audit rows accumulate. The hourly queue maintenance job then issues one large delete transaction, creating avoidable lock/undo/redo pressure and delaying admin actions that write audit rows.

Concrete fix:

Mirror `purgeOldViewEvents`: delete expired audit rows in conservative batches, cap batches per sweep, return/log the total deleted, and add a test that the audit retention path calls `.limit(...)` or otherwise proves bounded deletes.

### CRIT23-06 - Upload fallback serving validates one path and streams a later path by name

Severity: Low  
Confidence: Medium  
Status: Manual-validation / same-host trust risk

Evidence:

- `serveUploadFile` validates path segments, allowed directories, extension, `lstat`, symlink status, and `realpath` containment in `apps/web/src/lib/serve-upload.ts:137-184`.
- It builds `Content-Length` and ETag from the earlier `lstat` result at `apps/web/src/lib/serve-upload.ts:216-257`.
- It later opens the body with `createReadStream(resolvedPath)` in `apps/web/src/lib/serve-upload.ts:263-269`; the comment states this is not descriptor-backed validation.
- The authenticated backup download route already uses the safer descriptor pattern: `open`, `fileHandle.stat`, and `fileHandle.createReadStream()` in `apps/web/src/app/api/admin/db/download/route.ts:42-90`.

Failure scenario:

A same-host process with write access to `public/uploads` swaps the file after validation but before `createReadStream`. The response can stream bytes from an inode different from the one used for ETag and length calculation. Under the documented trust model this is not a remote-only exploit, but it keeps public file serving dependent on same-host trust rather than descriptor-backed invariants.

Concrete fix:

Open the file once after containment resolution, run `fh.stat()` on that descriptor, validate `isFile`, build headers from the descriptor stat, and stream via `fh.createReadStream({ autoClose: true })`. Keep realpath containment for traversal defense, but serve the same descriptor that was validated.

### CRIT23-07 - Mutable topic slugs remain structural debt despite current guards

Severity: Low-Medium  
Confidence: High  
Status: Confirmed structural debt, currently guarded

Evidence:

- `topics.slug` is the primary key at `apps/web/src/db/schema.ts:4-12`.
- Slug FKs exist in `topic_aliases.topic_slug`, `images.topic`, and `topic_views.topic` at `apps/web/src/db/schema.ts:14-17`, `apps/web/src/db/schema.ts:19-33`, and `apps/web/src/db/schema.ts:239-249`.
- Smart collections store topic predicates in JSON at `apps/web/src/db/schema.ts:297-310`.
- Rename is implemented as insert-new-topic, manually update FK children and JSON predicates, then delete old topic at `apps/web/src/app/actions/topics.ts:255-340`.
- The repo has a good current guard for schema FK siblings in `apps/web/src/__tests__/topic-slug-fk-registry.test.ts:1-83`, but that test explicitly calls the surrogate-ID or `ON UPDATE CASCADE` fix deferred at `apps/web/src/__tests__/topic-slug-fk-registry.test.ts:20-22`.

Failure scenario:

A new non-FK slug store, external integration payload, cache key, or JSON predicate shape starts referencing topic slugs outside the test's schema-FK parser. A later rename leaves stale references or empty collections. The current guard catches many FK additions, but the data model still requires every future contributor to remember slug fan-out.

Concrete fix:

Plan a migration to immutable surrogate topic IDs for relational ownership, keeping slug as a unique route attribute plus optional slug history. If that remains too large, expand the registry beyond schema FKs to include every JSON/cache/integration slug referrer and require rename-path tests for each registered owner.

### CRIT23-08 - Production CLIP activation still depends on opt-in manual smoke coverage

Severity: Medium  
Confidence: Medium  
Status: Manual-validation risk

Evidence:

- The real CLIP encoder loads weights offline from `CLIP_MODELS_ROOT` and disables remote model fetches at `apps/web/src/lib/clip-model.ts:167-204`.
- The public docs say weights are not baked into the image and must be seeded into a host bind mount before going live in `CLAUDE.md:496-545` and `apps/web/README.md:59-80`.
- The strongest real-load tests are deliberately gated: `clip-semantic-integration.test.ts` runs only when `CLIP_INTEGRATION=1` at `apps/web/src/__tests__/clip-semantic-integration.test.ts:4-31`, and `clip-offline-load.test.ts` runs only when `CLIP_OFFLINE_LOAD=1` plus a seeded `CLIP_MODELS_ROOT` at `apps/web/src/__tests__/clip-offline-load.test.ts:2-41`.
- The default `clip-model-contract.test.ts` relies on source-shape assertions for queue bounds and lazy loading at `apps/web/src/__tests__/clip-model-contract.test.ts:20-54`.

Failure scenario:

Default gates pass while production model weights are missing, mis-seeded, incompatible with the pinned revision, or fail to load on the target CPU/Node platform. Semantic search is documented as active in production, so this becomes a runtime 503 or degraded search issue that default CI cannot catch.

Concrete fix:

Keep default gates weight-free, but add an operator/release gate that runs `CLIP_OFFLINE_LOAD=1 CLIP_MODELS_ROOT=/app/data/models/clip npm test --workspace=apps/web -- clip-offline-load.test.ts` on seeded hosts before enabling or changing production semantic search. For model/revision upgrades, make that opt-in smoke part of the plan checklist and persist the output in `.context/gate-logs/`.

## Cleared Checks And Non-Findings

- Cycle-22 high findings were rechecked at current HEAD and not reopened:
  - advisory lock acquisition now routes through `isAdvisoryLockAcquired`; targeted advisory tests passed.
  - smart-collection numeric tag predicates are rejected; targeted smart-collection tests passed.
  - re-encode now has a confirmation dialog; source contract passed.
  - public P3 badge accessibility and route-error escape hatch are source-locked.
  - README/CLAUDE deploy and analytics wording was updated and source-locked.
- Public semantic and similar search routes have same-origin, rate-limit, mode, scan-limit, and body/ID bounds in the inspected current code; no new public API abuse path was found there.
- Migration journal non-monotonicity is known historical state, not a new finding. Current tests explicitly allow only the documented idx-7 inversion and require future entries to exceed prior/global max; targeted migration tests passed.
- Privacy guards are aligned after the `processing_settings_json` sensitive-field addition. Targeted privacy tests passed.
- Storage abstraction remains quarantined; no live pipeline import was found outside the storage module/tests.

## Final Sweep / Skipped Files

Final sweep covered product correctness, operational safety, data integrity, maintainability, UX/accessibility regressions from cycle-22 fixes, implicit deployment assumptions, docs drift, migrations, and cross-file source contracts.

Skipped or not line-read exhaustively:

- Binary/photo/font assets, generated screenshots, runtime logs, `.git`, `.omx` runtime state, dependency directories, and gitignored local env files.
- Historical review/archive markdown and `.context/plans/` older than the current cycle were searched or sampled for carried risks rather than read line-by-line.
- The full 267-file unit-test tree was not line-read end-to-end; tests were targeted around reviewed invariants and source contracts.
- Full lint/typecheck/build/Vitest/Playwright and live deploy were not run in this pass because this was a review artifact edit only. The relevant source-contract and security lint subset did run and passed.

No critical or high-severity current source bug was confirmed at HEAD `45208b21`. The highest-signal residuals are Medium architectural/operational risks around foreground queue pool budgeting, enforceable single-writer topology, ingest ownership, browser upload quota structure, and production CLIP smoke validation.
