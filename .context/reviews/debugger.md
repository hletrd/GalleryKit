# Run-10 Cycle 34 Debugger Review

Role lane: debugger
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `e94455d372daf74d8de9c909558ad7173b6cc864`
Status: review-only. No source fixes, commits, pushes, or deploys performed.

## Inventory First

I read the workspace rules in `AGENTS.md` and `CLAUDE.md`, then inventoried the bug-prone surfaces before drilling into code. Relevant files inspected:

- Upload/delete: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-tracker*.ts`, `apps/web/src/lib/pending-file-deletions.ts`, `apps/web/src/lib/process-image.ts`.
- Queue/backfill/image processing: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/lib/clip-*`, `apps/web/src/lib/caption-generator.ts`.
- Restore/auth/session: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance*.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/pending-session-revocations.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, admin layouts.
- Migrations/data/routes: `apps/web/scripts/migrate.js`, `apps/web/drizzle/**`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, semantic/similar/OG/upload route handlers, public actions.
- Service worker/deploy: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/scripts/build-sw.ts`, `apps/web/src/lib/sw-cache.ts`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/next.config.ts`, nginx config references.

## Confirmed Issues

### DBG-R10C34-01 - In-app backfill is not part of graceful shutdown/drain

- Severity: Medium
- Confidence: High
- File/region: `apps/web/src/lib/admin-backfill-runner.ts:45-51`, `675-727`, `821-865`, `917-920`; `apps/web/src/instrumentation.ts:49-61`; `apps/web/src/lib/process-image.ts:1142-1202`, `1411-1455`.
- Failure scenario: An admin starts "Re-encode existing photos" and then a deploy/restart sends SIGTERM. `triggerAdminBackfill()` intentionally launches `runBackfill(lockConnHandoff).catch(...)` fire-and-forget at `admin-backfill-runner.ts:917-920`. The shutdown handler drains the image queue, maintenance scheduler, buffered view writes, and single-writer guard at `instrumentation.ts:49-61`, but it never imports or awaits the admin backfill runner. If the process exits while `runBackfill()` is inside `processImageFormats()`, per-file atomic renames keep individual files from being torn, but the whole photo set can be left mixed across formats/sizes/settings before the DB `pipeline_version` update. The row remains a candidate, but no automatic post-restart backfill resumes it; an operator must notice `candidateCount` later.
- Why tests/comments can mislead: The runner header says a kill mid-backfill will "pick up where this one left off" (`admin-backfill-runner.ts:45-51`). That is true for manual re-invocation, not for graceful shutdown. `processImageFormats()` has JS-level rollback on thrown errors (`process-image.ts:1142-1202`, `1451-1455`), but process termination is outside that `catch/finally` contract.
- Fix: Track the active backfill promise in module state and export a `drainAdminBackfillForShutdown(timeoutMs)`/`abortAdminBackfillForShutdown()` hook. Call it from `instrumentation.ts` and from the restore drain checklist, or persist a durable backfill-incomplete marker and have startup/status surface it explicitly. At minimum, update the comment to say resume is manual and add a shutdown test that proves SIGTERM waits for or cancels the in-app runner.

## Likely Risks

### DBG-R10C34-02 - Server Action multipart upload/restore admission still happens after framework parsing

- Severity: Medium
- Confidence: Medium-High
- File/region: `apps/web/next.config.ts:111-119`; `apps/web/src/lib/upload-limits.ts:1-6`, `33-35`; `apps/web/src/app/actions/images.ts:87-106`, `154-221`; `apps/web/src/app/[locale]/admin/db-actions.ts:421-447`, `789-814`; safer contrast `apps/web/src/app/api/admin/lr/upload/route.ts:101-187`.
- Failure scenario: Browser upload and DB restore are Server Actions. The app-level checks for admin/auth/locks/quota happen inside the action, but Next must accept and parse the multipart body up to `NEXT_SERVER_ACTION_BODY_SIZE_LIMIT` first. A large restore body or a few oversized browser-upload attempts can spend parser memory/CPU before `uploadImages()` reaches `formData.getAll()` and the upload contract lock, or before `restoreDatabase()` writes the restore file to its temp path. The Lightroom route is safer because it checks `Content-Length`, rejects chunked transfer, enforces quota, and acquires a parse slot before `request.formData()`.
- Why tests/comments can mislead: `upload-limits.test.ts` verifies the 266 MB framework cap, and upload code enforces per-file and total quotas after parsing. Those tests do not prove early rejection under lock contention, restore maintenance, or parser pressure.
- Fix: Consider moving browser upload and DB restore ingestion to Node route handlers with pre-parse `Content-Length` checks, explicit parse semaphores, and streaming temp-file writes. Keep Server Actions as thin form shims only after the route-level admission controls exist.

### DBG-R10C34-03 - Queue/post-commit "self-healing" relies on restart/bootstrap timing

- Severity: Low-Medium
- Confidence: Medium
- File/region: `apps/web/src/app/actions/images.ts:484-516`, `580-607`; `apps/web/src/app/api/admin/lr/upload/route.ts:523-587`; `apps/web/src/lib/image-queue.ts:737-742`, `1139-1283`; `apps/web/src/instrumentation.ts:9-10`.
- Failure scenario: Both browser and Lightroom upload paths commit an image row and then call `enqueueImageProcessing()` as post-commit work. The LR route explicitly states missed enqueue is self-healing (`lr/upload/route.ts:523-531`). That is mostly true: bootstrap scans `processed=false AND processing_error IS NULL` rows on startup. The weak spot is operator visibility and latency. If enqueue returns `false` because shutdown has started (`image-queue.ts:737-742`) or post-commit work fails, the upload response can still be success while the photo stays pending until the next bootstrap/restart/resume path. If bootstrap itself hits transient DB errors, retry timers eventually heal, but the user sees a successful upload with no immediate processing progress.
- Why tests/comments can mislead: Existing tests lock many source-ordering properties, but I did not find a behavior test that simulates "post-commit enqueue rejected by shutdown" and proves the admin UI/status makes the pending state clear before a restart.
- Fix: Treat a post-commit enqueue rejection as an explicit admin-visible pending state: log structured event, increment a metric/status counter, and schedule a bounded bootstrap retry when not in restore/shutdown. Add a focused test for `enqueueImageProcessing()` returning false after a committed upload.

## Manual-Validation Risks

### DBG-R10C34-04 - Restore-maintenance recovery depends on a documented restart after sidecar clear

- Severity: Medium
- Confidence: High for dependency, Low for source defect because it is documented
- File/region: `apps/web/src/lib/restore-maintenance-durable.ts:90-96`, `121-127`; `apps/web/scripts/restore-maintenance-recovery.mjs:76-85`; `CLAUDE.md:437-438`; tests `apps/web/src/__tests__/restore-maintenance-recovery-mjs.test.ts:68-80`, `apps/web/src/__tests__/restore-maintenance.test.ts:71-83`.
- Failure scenario: A failed restore leaves process-local maintenance active and writes the durable marker. The recovery script clears the marker from a separate Node process, but it cannot clear the already-running web process' in-memory flag. `CLAUDE.md` correctly says restart/redeploy after sidecar clear. If an operator only runs the clear command and trusts its JSON `active:false`, the live site can keep returning maintenance until the container restarts.
- Fix: Add the restart requirement to the command output after `clear`, or make the command refuse to imply live-process recovery. A lightweight health/status route could report both durable marker and process-local maintenance state for operator confirmation.

### DBG-R10C34-05 - Advisory locks are mostly process-safe but not instance-namespaced except the warn-only singleton

- Severity: Medium
- Confidence: Medium
- File/region: `apps/web/src/lib/advisory-locks.ts:10-18`, `20-52`, `70-75`; `CLAUDE.md:247`, `442-446`.
- Failure scenario: The repo documents that most MySQL advisory locks are server-global, not database-scoped. The single-writer guard is DB-scoped and warn-only, but restore/upload/backfill/image-processing lock names are shared across all GalleryKit databases on the same MySQL server. A legitimate co-located second gallery can serialize or block maintenance work in the first gallery, while a misconfigured second instance of the same gallery can still pass traffic because the singleton guard warns but does not block.
- Fix: Manual validation should confirm the production MySQL server hosts only this GalleryKit DB, or that cross-gallery lock sharing is accepted. Long-term, prefix all advisory locks with a stable instance/database hash, preserving an intentional global lock only where cross-DB serialization is desired.

## Confirmed Non-Findings

- Delete durability is substantially covered: `deleteImage()`/`deleteImages()` insert `pending_file_deletions` before DB row deletion and cleanup uses strict delete helpers plus hourly/restore drains (`actions/images.ts:677-723`, `814-892`; `pending-file-deletions.ts:72-139`; migration/schema mirror checked).
- Restore import failure keeps maintenance for the dangerous handoff paths: mysql nonzero/timeout and post-restore migration failures return `keepMaintenance: true` and the finalizer preserves the durable marker (`db-actions.ts:986-1010`, `704-714`).
- Auth/session paths short-circuit restore and same-origin checks in the expected order, with pending session revocations for logout/restore windows (`auth.ts`, `session.ts`, `pending-session-revocations.ts`).
- Service worker generated version matches the template hash plus image pipeline version: expected and actual `SW_VERSION` are `fc3ca358-p7`; admin/revocable route bypass patterns matched the documented `/admin`, `/p`, `/s`, `/g`, `/c`, and `/map` exclusions.
- Migration reconcile currently mirrors the pending deletion table and recent image columns (`migrate.js:397-502`, `720-749`), and the `_journal.json` entry for `0030_pending_file_deletions` exists.

## Final Sweep

Final pass checked upload/delete races, pending cleanup, queue retries/permanent failures, bootstrap and restore resume, in-app and sidecar backfills, restore child-process handoff, auth/session revocation, public data field omissions, semantic/similar search bounds, service-worker cache exclusions, migration baseline/reconcile coupling, deploy pruning, and recovery scripts.

No critical confirmed bug was found. The main actionable issue is the in-app backfill shutdown gap; the other items are likely/manual risks where the current code is mostly correct but depends on operational behavior or delayed self-healing.
