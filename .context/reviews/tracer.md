# Tracer Review - Cycle 5 Prompt 1

Scope: causal tracing of upload, process, delete, restore, settings, config/cache, and backfill flows. Read-only source review; only this artifact was written.

## Inventory

Traced flows and files:
- Browser/admin upload: `apps/web/src/app/actions/images.ts:129-653`
- Lightroom upload: `apps/web/src/app/api/admin/lr/upload/route.ts:84-609`
- Queue continuation and restore pause/resume: `apps/web/src/lib/image-queue.ts:694-1344`
- Image write/derivative processing: `apps/web/src/lib/process-image.ts:887-1485`, `apps/web/src/lib/upload-paths.ts:1-193`
- Delete/bulk delete: `apps/web/src/app/actions/images.ts:655-923`
- Database restore and maintenance barriers: `apps/web/src/app/[locale]/admin/db-actions.ts:403-933`, `apps/web/src/lib/restore-maintenance*.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`
- Settings/cache/static file serving: `apps/web/src/app/actions/settings.ts:44-239`, `apps/web/src/lib/gallery-config.ts:1-256`, `apps/web/src/lib/settings-hash.ts:1-181`, `apps/web/src/lib/serve-upload.ts:69-382`
- Color backfill: `apps/web/src/lib/admin-backfill-runner.ts:401-431`, `apps/web/scripts/backfill-color-pipeline.ts:379-560`

## Confirmed Issues

### TR-1: Sidecar color backfill violates its own bounded-batch causal contract

Trace:
1. `apps/web/scripts/backfill-color-pipeline.ts:379-382` states the intent: batch size should bound DB reads and in-memory arrays.
2. The sidecar then runs a single candidate query in `apps/web/scripts/backfill-color-pipeline.ts:383-400`.
3. It keeps all candidates in `rows` and builds processing promises over that full list in `apps/web/scripts/backfill-color-pipeline.ts:525-560`.
4. The in-app backfill flow uses keyset pagination in `apps/web/src/lib/admin-backfill-runner.ts:401-431`, so the repo already has the safer causal shape.

Failure scenario:
- On a large gallery, a manual sidecar backfill can spend startup time and memory materializing every candidate before bounded processing helps. With `FORCE_REENCODE=1`, the candidate set can approach the full image table.

Suggested fix:
- Reuse the in-app runner's cursor loop: fetch one `BATCH_SIZE` page, process it with existing concurrency, flush progress, then fetch the next page by `id`.
- Add a regression test or dry-run mode that proves only one page is materialized at once.

Confidence: Medium.

## Likely Issues

### TR-2: Lightroom upload success/failure ordering is hard to verify from current tests

Trace:
1. Route entry takes token/cookie actor, maintenance guard, content-length gate, tracker preclaim, and multipart parse slot in `apps/web/src/app/api/admin/lr/upload/route.ts:84-186`.
2. It takes the upload-processing contract lock after parsing and before topic/config/disk work in `apps/web/src/app/api/admin/lr/upload/route.ts:252-279`.
3. It saves original data and reads metadata in `apps/web/src/app/api/admin/lr/upload/route.ts:340-410`.
4. It can reject late for maintenance, HDR policy, GPS stripping, DB insert errors, audit failures, or queue failures across `apps/web/src/app/api/admin/lr/upload/route.ts:412-609`.
5. Focused tests in `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:38-335` verify text shape instead of running the route.

Failure scenario:
- A late policy rejection after the original file is written could regress cleanup or tracker settlement while source-contract assertions still pass. This is especially risky because the browser upload action has a separate implementation in `apps/web/src/app/actions/images.ts:367-562`.

Suggested fix:
- Add an executable route trace test for one late rejection and one success path. Assert the emitted side effects in order: tracker claim, lock acquire, save original, policy result, DB insert or cleanup, queue enqueue, tracker settle, lock release.

Confidence: Medium.

### TR-3: Restore path has many lock layers with limited executable failure tracing

Trace:
1. Restore enters nested coordination in `apps/web/src/app/[locale]/admin/db-actions.ts:403-605`: DB restore lock, upload-processing lock, color backfill lock, semantic backfill lock, durable maintenance marker, queue quiesce, background DB write drain.
2. The SQL import child is spawned and watched in `apps/web/src/app/[locale]/admin/db-actions.ts:760-848`.
3. Post-restore migrations run through a second child/watchdog path in `apps/web/src/app/[locale]/admin/db-actions.ts:856-933`.
4. Cleanup and release are split between inner restore logic and the outer `finally` in `apps/web/src/app/[locale]/admin/db-actions.ts:606-629`.

Failure scenario:
- A timeout or stream failure in either child process can produce a partial restore state. The desired causal result differs by failure point: temp file cleanup should happen, locks should release, durable maintenance may need to remain if `keepMaintenance` was set, and queues must resume only when safe.

Suggested fix:
- Add failure-trace tests with injected child events for timeout, nonzero close, stdin error, and post-migration error. The assertions should be about final state of every lock/marker/queue flag, not only source text.

Confidence: Medium.

## Manual-Validation Risks

### TR-4: Settings-derived static files intentionally remain stale until backfill

Trace:
1. Settings update normalizes and persists image sizes/quality/GPS options in `apps/web/src/app/actions/settings.ts:44-167`.
2. The action detects existing images needing backfill and returns a warning in `apps/web/src/app/actions/settings.ts:168-199`.
3. Static upload serving uses existing files and stable ETags in `apps/web/src/lib/serve-upload.ts:162-382`.
4. The upload path resolver keeps public and original paths separate in `apps/web/src/lib/upload-paths.ts:1-193`.

Failure scenario:
- After settings change, old derivatives remain causally valid from the static server's perspective. User-visible output changes only after backfill regenerates files.

Suggested fix:
- Treat the warning as part of the settings flow contract. For releases touching this path, manually verify the warning and backfill operation together.

Confidence: Medium.

### TR-5: Delete flow clears queue state before DB/file deletion, making partial failures operationally important

Trace:
1. Single delete clears queue state in `apps/web/src/app/actions/images.ts:707-718`, then deletes DB row and files in `apps/web/src/app/actions/images.ts:719-756`.
2. Bulk delete clears queue state for all IDs in `apps/web/src/app/actions/images.ts:825-835`, then deletes DB rows and files in `apps/web/src/app/actions/images.ts:837-923`.
3. Queue state is in-memory plus timer-driven in `apps/web/src/lib/image-queue.ts:378-480` and `apps/web/src/lib/image-queue.ts:694-1068`.

Failure scenario:
- If DB/file deletion fails after queue state is cleared, the item can remain in DB without the previous queued/processing state. That may be intentional because delete should cancel work first, but it is a manual trace risk when debugging partial deletes.

Suggested fix:
- Add logging/assertions around partial delete failures, or include a focused regression test that the chosen state after file deletion failure is intentional and recoverable through retry.

Confidence: Low.

## Final Sweep

Competing hypotheses checked:
- Restore versus upload race: both browser upload and Lightroom upload check durable maintenance and upload-processing contract locks before commit; likely protected, with executable route coverage still recommended.
- Browser upload cleanup: `uploadImages` has late maintenance checks and explicit cleanup in `apps/web/src/app/actions/images.ts:489-562`, plus final tracker settle/release in `apps/web/src/app/actions/images.ts:592-652`.
- Queue restore behavior: queue quiesce/resume and bootstrap continuation were traced through `apps/web/src/lib/image-queue.ts:1117-1344`.
- Static cache behavior: cache hash TTL and ETag generation checked in `apps/web/src/lib/serve-upload.ts:69-124`.

No confirmed restore/upload race was found in source review. The strongest causal defect is the sidecar backfill batching mismatch.
