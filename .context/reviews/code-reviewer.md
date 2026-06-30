# Code Reviewer Report - Cycle 23

Review role: code-reviewer  
Repository: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-06-30 KST  
Mode: review-only. Source code was not modified; this report is the only intended file change.

## Inventory

Required context read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Repository surface inventoried before findings:

- 505 `apps/web/src` TypeScript/TSX/JS source files.
- 273 unit-test files under `apps/web/src/__tests__`.
- 31 migration/journal files under `apps/web/drizzle`.
- App routes/actions/API handlers, shared libs, DB schema/pool, scripts, migrations, Docker/nginx/deploy config, public worker assets, i18n files, current review artifacts, and relevant tests were included in static review/sweeps.

Broad checks run during review:

- Route/action auth and rate-limit inventory.
- Raw SQL/query/advisory-lock sweeps.
- Upload, image-queue, Lightroom ingest, restore/maintenance, retention, serving, topic rename, privacy-field, migration, and deployment-doc cross-file tracing.
- Prior cycle findings revalidated against current source; stale fixed issues were not carried forward.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 5
- Low: 2

## Findings

### C23-01 - Foreground image processing can pin most of the shared MySQL pool

Severity: Medium  
Confidence: High  
Status: Confirmed maintainability/operational risk

Evidence:

- The shared MySQL pool is fixed at 10 connections with queue limit 20: `apps/web/src/db/index.ts:23-33`.
- `QUEUE_CONCURRENCY` can be raised to 8: `apps/web/src/lib/image-queue.ts:87-90`.
- Each queue job acquires a MySQL advisory-lock connection and keeps it as `lockConnection`: `apps/web/src/lib/image-queue.ts:519-546`.
- That connection remains held while the worker reads the row, resolves the original, runs Sharp fan-out, verifies outputs, and updates the DB: `apps/web/src/lib/image-queue.ts:554-657`.
- It is released only in the final cleanup: `apps/web/src/lib/image-queue.ts:812-815`.
- The backfill runner has explicit pool-budget arithmetic and clamps concurrency to preserve live-request headroom: `apps/web/src/lib/admin-backfill-runner.ts:105-141`, `apps/web/src/lib/admin-backfill-runner.ts:667-678`. The foreground queue has no equivalent cap.

Failure scenario:

An operator sets `QUEUE_CONCURRENCY=8` for a large import. Eight image jobs can hold eight of ten shared DB connections across encode-duration Sharp work. Live pages, login/session checks, admin actions, public search, and the queue's own update queries then compete for two remaining connections and a 20-item wait queue, causing avoidable 500/503 symptoms while CPU and MySQL are otherwise healthy.

Concrete fix:

Do not hold shared-pool advisory-lock connections across image encoding. Prefer a short DB row-claim transition, a small dedicated advisory-lock pool, or a foreground queue cap derived from `POOL_CONNECTION_LIMIT` that reserves live traffic headroom like `resolveBackfillConcurrency`. Add a source or behavior test proving `QUEUE_CONCURRENCY` cannot consume the live pool reserve.

### C23-02 - Browser and Lightroom upload ingestion still duplicate the same lifecycle

Severity: Medium  
Confidence: High  
Status: Confirmed SOLID/maintainability risk

Evidence:

- Browser upload owns quota claim, disk/topic validation, per-file ingest, DB insert, queue payload, settlement, audit, and revalidation in `apps/web/src/app/actions/images.ts:238-596`.
- Lightroom upload independently mirrors quota claim/settle and many equivalent branches at `apps/web/src/app/api/admin/lr/upload/route.ts:130-151`, then DB insert and queue payload at `apps/web/src/app/api/admin/lr/upload/route.ts:404-516`.
- The Lightroom route carries parity-fix comments for fields previously missed on that parallel path: settings snapshot and semantic mode at `apps/web/src/app/api/admin/lr/upload/route.ts:489-505`, captions at `apps/web/src/app/api/admin/lr/upload/route.ts:506-515`, and color/HDR metadata at `apps/web/src/app/api/admin/lr/upload/route.ts:431-451`.
- `ImageProcessingJob`/`ProcessingSettingsSnapshot` is shared at the queue boundary, but the adapters still hand-assemble payloads separately: `apps/web/src/lib/image-queue.ts:92-120`.

Failure scenario:

A new upload-time setting, metadata column, GPS/HDR policy, audit field, or queue-job field is added to dashboard uploads. Browser uploads work because that path is changed and tested, but Lightroom publishes silently omit the new field until a backfill or manual comparison exposes drift. This exact class has already recurred across settings, captions, semantic mode, and color metadata.

Concrete fix:

Extract a server-only ingest service that owns config snapshotting, quota claim/settle, original save, GPS/HDR gates, insert DTO construction, audit payload shape, and queue-job construction. Keep browser and Lightroom code as request adapters. Add a shared regression test that fails when one adapter can persist/enqueue a field the other cannot.

### C23-03 - The single-writer topology is documented but not enforced by the application

Severity: Medium  
Confidence: High  
Status: Likely architecture risk requiring manual validation in deployment

Evidence:

- `CLAUDE.md` states the shipped deployment is single web-instance/single-writer and warns that restore maintenance flags, upload quota tracking, image queue state, rate-limit buckets, and view buffers are process-local: `CLAUDE.md:233-236`.
- Restore maintenance is process-local `globalThis` state: `apps/web/src/lib/restore-maintenance.ts:1-56`.
- Upload quota tracking is a process-local `globalThis` map: `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/upload-tracker-state.ts:70-78`.
- Queue bootstrap runs in each Node process: `apps/web/src/instrumentation.ts:1-6`.
- Shared-group view counts are buffered in module-local memory: `apps/web/src/lib/data.ts:13-41`.

Failure scenario:

An operator starts a second web process against the same DB/upload tree for availability. Process A begins restore maintenance; process B cannot see A's maintenance flag, upload tracker, queue state, or analytics buffer. B can accept uploads, run queue bootstrap, or buffer analytics during A's restore window, violating the single-writer restore and original-file integrity assumptions without a startup failure.

Concrete fix:

Make the topology executable. If the product remains single-writer, acquire a startup DB advisory lease and fail fast when another writer is active. If multi-process support is desired, move restore state, upload quotas, queue ownership, rate-limit buckets that matter for abuse, and buffered analytics to shared durable coordination.

### C23-04 - `topics.slug` is a mutable natural key with manual fan-out on rename

Severity: Medium  
Confidence: High  
Status: Confirmed maintainability risk

Evidence:

- `topics.slug` is the primary key: `apps/web/src/db/schema.ts:4-6`.
- Slug FKs exist in `topic_aliases.topic_slug`, `images.topic`, and `topic_views.topic`: `apps/web/src/db/schema.ts:14-17`, `apps/web/src/db/schema.ts:19-34`, `apps/web/src/db/schema.ts:239-242`.
- Smart collections store topic references inside JSON: `apps/web/src/db/schema.ts:297-306`.
- Rename is implemented as create-new/update-dependents/remap-JSON/delete-old: `apps/web/src/app/actions/topics.ts:255-339`.
- The rename implementation documents previous missed-sibling failures for `topic_views` and smart-collection JSON remapping: `apps/web/src/app/actions/topics.ts:292-309`.

Failure scenario:

A new table, JSON predicate, cache key, or integration payload stores topic slugs. The schema compiles, but the rename transaction is not updated. A later slug rename leaves stale references, empty public collections, analytics loss through cascade, or mismatched admin/public organization.

Concrete fix:

Use immutable surrogate topic IDs for relational ownership and keep slug as a unique mutable route attribute. If that migration is too large, centralize slug referrers in an explicit rename registry/remapper and add tests that fail when schema/JSON slug references are added without rename-path support.

### C23-05 - Browser upload quota settlement is still guarded by topology comments instead of one idempotent cleanup path

Severity: Medium  
Confidence: High  
Status: Likely future-regression risk

Evidence:

- Browser uploads synchronously pre-claim quota at `apps/web/src/app/actions/images.ts:238-242`.
- Several post-claim awaited branches manually roll back with `settleUploadTrackerClaim(...)`: `apps/web/src/app/actions/images.ts:247-264`, `apps/web/src/app/actions/images.ts:280-292`.
- The code relies on a comment invariant that any future awaited work after claim must settle on throw: `apps/web/src/app/actions/images.ts:271-279`.
- One post-claim cleanup await is safe only because `deleteOriginalUploadFile` currently never rejects: `apps/web/src/app/actions/images.ts:536-551`.
- Lightroom has the more robust idempotent settlement closure: `apps/web/src/app/api/admin/lr/upload/route.ts:139-151`.
- The current regression lock is source-shape based, not behavior-level cleanup: `apps/web/src/__tests__/cycle-22-source-contracts.test.ts:96-108`.

Failure scenario:

A future validation, DB read, or cleanup step is inserted after the browser quota claim and throws before the final success/all-failed settlement. The upload-processing lock is still released, but the upload tracker keeps the failed files/bytes charged until the window expires, causing false cumulative-upload-limit rejections for the admin.

Concrete fix:

Port the Lightroom idempotent `trackerSettled` pattern into `uploadImages` and wrap the whole post-claim region in a `try/finally` that settles `(0, 0)` if no earlier path settled. Add behavior tests that mock failures after the claim and assert tracker state is restored.

### C23-06 - Audit retention deletes all expired rows in one unbounded statement

Severity: Low  
Confidence: High  
Status: Confirmed operational boundedness issue

Evidence:

- `purgeOldAuditLog` validates retention input and then performs one unbounded delete: `apps/web/src/lib/audit.ts:97-122`.
- The analogous analytics retention code explicitly batches deletes with `.limit(VIEW_PURGE_BATCH)` and an iteration cap: `apps/web/src/lib/view-retention.ts:31-37`, `apps/web/src/lib/view-retention.ts:64-89`.
- Audit retention tests verify cutoff safety, not bounded delete behavior: `apps/web/src/__tests__/audit-retention.test.ts:52-95`.

Failure scenario:

A long-lived site with a large audit backlog runs hourly GC. One large MySQL delete transaction can create avoidable lock, undo, redo, and replication pressure, delaying admin writes that also insert audit events. This is not a correctness wipe bug; it is an avoidable operational spike.

Concrete fix:

Mirror `purgeOldViewEvents`: delete expired audit rows in conservative batches with a per-run iteration cap, return or log the deleted count, and test that retention uses bounded `DELETE ... LIMIT` rather than one unbounded statement.

### C23-07 - Upload fallback serving validates a path and later streams by pathname

Severity: Low  
Confidence: Medium  
Status: Manual-validation risk within the same-host trust boundary

Evidence:

- `serveUploadFile` performs `lstat`, rejects symlinks/non-files, resolves realpath, and checks root containment: `apps/web/src/lib/serve-upload.ts:169-184`.
- It builds `Content-Length` and ETag from the earlier `lstat` result: `apps/web/src/lib/serve-upload.ts:216-257`.
- It then opens a new stream by pathname and explicitly notes this is not descriptor-backed validation: `apps/web/src/lib/serve-upload.ts:263-269`.
- The admin backup download route uses the stronger descriptor-backed pattern: open once, `fileHandle.stat()`, then `fileHandle.createReadStream()`: `apps/web/src/app/api/admin/db/download/route.ts:58-90`.

Failure scenario:

A same-host process with write access to the upload tree swaps the target after validation but before `createReadStream(resolvedPath)`. The response can stream bytes from a different inode than the one used for validation and ETag/length calculation. Under the documented deployment this requires same-host compromise or mispermissioning, so severity is low, but the route already has a local example of the safer pattern.

Concrete fix:

Open the file once with `fs.promises.open`, run `fileHandle.stat()` on that descriptor, reject non-regular files, build headers from descriptor stats, and stream via `fileHandle.createReadStream({ autoClose: true })`. Keep the realpath containment check, but make served bytes come from the same descriptor that was validated.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm test --workspace=apps/web -- cycle-22-source-contracts.test.ts audit-retention.test.ts serve-upload.test.ts image-queue-quiesce.test.ts`: passed, 4 files / 22 tests.

## Non-Findings Checked

- Cycle 22 advisory-lock `BigInt(1)` issue is fixed through shared `isAdvisoryLockAcquired` usage (`apps/web/src/lib/advisory-locks.ts:55` plus current call sites).
- Cycle 22 smart-collection numeric tag-value issue is fixed by requiring tag values to be strings in `validatePredicateSemantics`.
- SQL restore scanner now scans both comment-as-empty and comment-as-space normalized forms, so comment-separated dangerous multi-token statements were not refiled.
- Semantic search now rejects missing `Content-Length` before body read, lower-cases tokenized `Transfer-Encoding`, rate-limits before the DB-backed mode lookup, and byte-checks with `Buffer.byteLength`.
- Lightroom upload now forwards `semanticSearchMode` into the queue payload.
- The stale `docker compose` docs issue is fixed in `CLAUDE.md`, README, deploy script, and source-contract tests.
- Admin API auth wrappers, mutating server-action origin gates, and public mutating route rate-limit scanner all pass.
- Public privacy projections, map GPS gating, semantic/similar enrichment fields, and `_PrivacySensitiveKeys` guards were reviewed by source/search without a new leak finding.

## Final Missed-Issues Sweep / Skipped Files

Final sweep covered app routes, API handlers, server actions, shared libs, DB schema, queue/backfill, upload serving, restore/backup, migrations/journal, scripts, Docker/nginx/deploy config, i18n keys, public workers, and relevant tests. No active executable source category was intentionally skipped.

Skipped from manual line-by-line review: dependency/build/runtime artifacts (`node_modules`, `.next`, `.git`, local upload/data directories), binary/media/font fixtures, generated screenshots, and historical review/plan archives not tied to current source behavior. Those were covered only by inventory, targeted grep, or not considered executable source for this review.
