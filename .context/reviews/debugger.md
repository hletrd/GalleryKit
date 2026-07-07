# Cycle 22 Debugger Review

Role lane: debugger
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `8b795862079b0e5318242a09390b4cdff1dc2058`
Write scope: `.context/reviews/debugger.md`

Review-only. I did not implement fixes. I read `AGENTS.md`, `CLAUDE.md`, and `.context/plans/README.md`, then reviewed current source for latent bug surfaces, failure modes, regressions, and causal debugging hypotheses with special attention to upload/restore/queue/backfill/semantic-search/service-worker/database/admin/public route flows and Cycle 21 fixes.

## Bug-Prone Inventory

- Upload paths: browser upload action, Lightroom/PAT upload route, upload tracker state, upload-processing contract lock, GPS/HDR/color metadata handling, original persistence, queue enqueue, audit/revalidation cleanup.
- Restore and maintenance: DB backup/restore actions, SQL scanner, durable restore marker, mutation barrier, queue/background/maintenance drains, advisory lock release helpers, migration/reconcile and journal.
- Queue/backfill: image processing queue, retry/permanent-failure state, queue restore quiesce/resume, admin backfill runner, color sidecar scripts, pending file deletion ledger.
- Public flows: search/load-more actions, map/timeline/home/photo/share/group/smart collection pages, semantic/similar APIs, analytics/view recording, service worker HTML/image caching.
- Admin/UI flows: image manager delete/retry/bulk operations, settings backfill, dashboard failed-image retry, tokens/admin auth surfaces, map and accessibility changes from Cycle 21.
- Tests and gates: custom lint scanners, source-contract tests, queue/backfill/migration/upload/search/SW tests, Playwright e2e entry points, root script syntax gate.

I did not inspect binary fixtures/media bytes, generated build output, runtime upload/data stores, `node_modules`, live DB rows, live nginx/proxy state, or local secret/env files.

## Findings

### DBG-C22-01 - Pending file deletion rows persist after cleanup failure, but no current flow retries them

- Severity: High
- Confidence: High
- Status: Confirmed current bug surface
- File/region: `apps/web/src/lib/pending-file-deletions.ts:70-90`; `apps/web/src/app/actions/images.ts:680-727`, `808-907`; `apps/web/src/lib/maintenance-scheduler.ts:34-45`; `apps/web/scripts/migrate.js:486-502`; `apps/web/src/lib/sql-restore-scan.ts:12-31`.
- Failure scenario: `deleteImage` or `deleteImages` inserts `pending_file_deletions` before deleting image rows, then `cleanupPendingFileDeletion()` retries once and records `attempts`/`last_error` if unlinking original or derivative files still fails. That is durable state, but `rg` finds no scheduler/startup/admin action/API route that selects old `pending_file_deletions` rows and calls `cleanupPendingFileDeletion()` again. A transient EIO/permission/NFS problem that clears five minutes later still leaves public derivative/original files on disk indefinitely unless another manual DB/script intervention is added outside the app.
- Concrete fix: add a bounded maintenance task and/or admin repair action that selects `pending_file_deletions` ordered by `updated_at`, calls `cleanupPendingFileDeletion()`, caps attempts/backoff, and surfaces remaining failures in admin health/status. Include the task in restore/shutdown drain reasoning if it can run concurrently with restore. Add behavior tests with mocked cleanup failures and later success.

### DBG-C22-02 - Large multipart upload/restore paths still fail before domain code can apply streaming controls

- Severity: High
- Confidence: High for source shape; Medium for live impact without RSS trace
- Status: Confirmed current risk
- File/region: `apps/web/next.config.ts:111-119`; `apps/web/src/lib/upload-limits.ts:1-6`, `19-35`; `apps/web/src/components/upload-dropzone.tsx:243-260`; `apps/web/src/app/actions/images.ts:129-149`; `apps/web/src/app/api/admin/lr/upload/route.ts:152-188`; `apps/web/src/app/[locale]/admin/db-actions.ts:717-739`.
- Failure scenario: the app has good post-parse checks and disk streaming, but Server Actions and `request.formData()` parse large multipart bodies before `uploadImages()`, LR ingest, or `runRestore()` can enforce app backpressure. Near-limit uploads/restores can therefore produce RSS/GC/OOM failures whose stack traces point at framework body parsing rather than `saveOriginalAndGetMetadata()` or restore streaming code.
- Concrete fix: replace the largest payload Server Action/formData paths with streaming route handlers and a shared temp-file handoff. Add RSS smoke coverage for concurrent near-limit browser upload, PAT upload, and restore.

### DBG-C22-03 - Browser and PAT upload adapters still duplicate the same ingest contract

- Severity: High
- Confidence: High
- Status: Likely regression class, not a newly reproduced divergence at HEAD
- File/region: `apps/web/src/app/actions/images.ts:129-560`; `apps/web/src/app/api/admin/lr/upload/route.ts:84-630`.
- Failure scenario: the browser action and Lightroom/PAT route separately implement topic/tag validation, config snapshotting, upload quota settlement, original save, GPS stripping, HDR rejection, blur validation, DB insert fields, queue payload fields, audit, revalidation, and cleanup. Cycle history shows this adapter split has repeatedly caused one-path-only fixes. A future privacy/color/audit/queue field can land in one path and silently diverge the other.
- Concrete fix: extract a shared `ingestUploadedImage(...)` service that owns the post-auth transaction contract. Keep transport/auth/response shaping in the adapters only. Add parity tests that feed the same synthetic metadata through browser/PAT adapters and compare inserted columns plus queue payloads.

### DBG-C22-04 - Cached shared-group reader still owns a view-count side effect

- Severity: Medium
- Confidence: Medium
- Status: Confirmed current risk
- File/region: `apps/web/src/lib/data.ts:1392-1407`, `1828-1834`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-142`; `apps/web/src/app/actions/public.ts:517-559`.
- Failure scenario: `getSharedGroupCached = cache(getSharedGroup)` wraps a reader that can call `bufferGroupViewCount()` depending on options and selected photo state. The page separately records durable analytics with the same resolved selected-image decision. A future preload/render path or second cached call with different option semantics can let React request-local cache ordering decide whether the denormalized count side effect runs, while durable analytics still records or skips independently.
- Concrete fix: split shared-group reads into a pure cached reader and explicit page/action orchestration for denormalized count increments. Keep `recordSharedGroupView()` independent but drive both counters from the same resolved page-level decision. Add a test that cached shared-group reads are side-effect-free.

### DBG-C22-05 - Safety-critical tests still overfit source text for migration/restore and the new deletion ledger

- Severity: Medium
- Confidence: High
- Status: Confirmed test-risk
- File/region: `apps/web/src/__tests__/pending-file-deletions-source.test.ts:11-45`; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-180`; `apps/web/src/__tests__/db-restore.test.ts:47-136`; `apps/web/scripts/migrate.js:486-502`, `720-724`; `apps/web/src/app/[locale]/admin/db-actions.ts:717-780`.
- Failure scenario: the new deletion ledger, reconcile/schema equivalence, and restore child-process paths are mostly pinned by source text or structural scans. A refactor can preserve strings like `tx.insert(pendingFileDeletions)` or `CREATE TABLE IF NOT EXISTS pending_file_deletions` while changing transaction behavior, column defaults, FK/index details, child-process settlement, or cleanup retry behavior. Tests stay green while production failures appear only during migration, restore, or filesystem cleanup.
- Concrete fix: keep source contracts as cheap tripwires, but add behavior tests: DB-backed reconcile/schema diff against `INFORMATION_SCHEMA`, stub-binary restore tests covering child success/failure/timeout/trailer cases, and mocked filesystem tests proving pending deletion rows are retried/deleted across separate maintenance invocations.

## Cycle 21 Fixes Verified, Not Re-Raised

- `AGG-C21-01` mutation-barrier scanner order proof is fixed: `check-action-origin.ts:664-709` requires the acquired-state check immediately after the `using` declaration, and `check-action-origin.test.ts:745-760` fails a mutation-before-check fixture.
- `AGG-C21-02` direct "no durable deletion row" bug is partially fixed: `images.ts:680-699` and `images.ts:814-834` insert `pending_file_deletions` rows before deleting image rows, and `pending-file-deletions.ts:78-88` keeps rows on cleanup failure. The remaining retry-consumer gap is filed separately as `DBG-C22-01`.
- `AGG-C21-06` permanent-failure cap bypass is fixed: `image-queue.ts:374-387` centralizes `markPermanentlyFailed`, with production call sites at `image-queue.ts:782` and `image-queue.ts:1044`.
- `AGG-C21-15` backfill candidate index is fixed in schema, migration, and reconcile: `schema.ts:123-128`, `0030_pending_file_deletions.sql:19`, `migrate.js:720-724`.
- `DBG-C21-01` persisted datetime rendering is fixed in production code by `parseMySqlDateTimeParts` and its call sites. Some older `data-timeline.test.ts:121-204` helper assertions still use `new Date(...)`, but production no longer depends on that parser behavior and `mysql-datetime.test.ts:44-72` covers the parser.
- Service worker revocable-object stale HTML caching remains fixed: `sw.template.js:59-64` and `sw.template.js:555-558` bypass offline HTML caching for photo/share/group/smart-collection/map routes.

## Final Missed-Issue Sweep

I rechecked upload, restore, queue, backfill, semantic-search, service-worker, DB/migration, admin, and public route flows after drafting findings. I did not find a current restore-write race beyond the listed large-body and pending-cleanup retry gaps. Auth/PAT wrappers, same-origin guards, restore maintenance barriers, queue quiesce/resume, and service-worker revocable-page exclusions match the documented contracts in the inspected source.

Uninspected categories: binary fixtures/media, generated build output, runtime upload/data directories, live production DB/proxy/nginx state, `node_modules`, and local secret/env files. I did not run the full test suite because this was a review-only lane with no code fixes; validation is static line-level inspection at the reviewed HEAD.

Findings: 5 total.
