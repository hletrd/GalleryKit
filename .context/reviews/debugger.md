# Debugger Review - Cycle 5 Prompt 1

Scope: latent bug surfaces, edge cases, and regression modes across upload/process/delete/restore/config/cache flows. Read-only source review; only this artifact was written.

## Inventory

Examined file groups:
- Upload mutation surfaces: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`
- Processing and queue internals: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-paths.ts`
- Restore/maintenance boundaries: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`
- Settings/cache/static serving: `apps/web/src/app/actions/settings.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/serve-upload.ts`, service-worker cache tests/templates
- Backfill runners: `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`
- Gate tests: representative unit/e2e tests under `apps/web/src/__tests__` and `apps/web/e2e`

## Confirmed Issues

### DBG-1: `backfill-color-pipeline` can materialize the full candidate table despite `BATCH_SIZE`

Evidence:
- `apps/web/scripts/backfill-color-pipeline.ts:379-382` documents that `BATCH_SIZE` keeps DB reads and in-memory arrays bounded.
- The query in `apps/web/scripts/backfill-color-pipeline.ts:383-400` has no `LIMIT` or cursor pagination.
- Processing builds work from the full `rows` array in `apps/web/scripts/backfill-color-pipeline.ts:525-560`.
- The in-app runner shows the safer pattern with cursor-bounded reads in `apps/web/src/lib/admin-backfill-runner.ts:401-431`.

Concrete failure scenario:
- A production operator runs the sidecar on a large gallery, or uses force mode after changing color/HDR logic. The process reads every candidate row into memory and schedules promise work across the full list. It can exhaust memory or degrade the constrained deploy host before per-batch concurrency limits help.

Suggested fix:
- Replace the one-shot select with a keyset loop that queries `LIMIT BATCH_SIZE`, processes the batch, advances `lastId`, and repeats until empty.
- Keep the existing concurrency limiter inside each fetched page.

Confidence: Medium.

## Likely Issues

### DBG-2: Restore child-process failures are hard to reason about because cleanup is not behavior-tested

Evidence:
- Watchdog and kill behavior live in `apps/web/src/app/[locale]/admin/db-actions.ts:42-80`.
- Restore holds multiple locks and markers across `apps/web/src/app/[locale]/admin/db-actions.ts:403-629`.
- SQL import and post-migration child processes run in `apps/web/src/app/[locale]/admin/db-actions.ts:760-933`.
- Tests in `apps/web/src/__tests__/db-restore.test.ts:47-115` assert source shape, not fake child-process outcomes.

Concrete failure scenario:
- `mysql` times out after durable maintenance is set and queue processing is quiesced. A bug in one rejection path could resume queue processing too early, leak a lock, delete the temp dump at the wrong time, or clear maintenance when the UI should still show recovery mode.

Suggested fix:
- Isolate child process execution into a testable helper and add deterministic tests for close code, timeout kill, stdin write failure, stderr-heavy failure, and post-migration failure. Assert all releasers were called or deliberately retained.

Confidence: Medium.

### DBG-3: Upload route parity can regress between browser uploads and Lightroom uploads

Evidence:
- Browser upload action implements save, policy checks, insert, enqueue, audit, revalidate, tracker settle, and lock release in `apps/web/src/app/actions/images.ts:129-653`.
- Lightroom route implements a parallel path in `apps/web/src/app/api/admin/lr/upload/route.ts:84-609`.
- The Lightroom route's focused tests are source-contract checks in `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:38-335`.

Concrete failure scenario:
- A fix is applied to the browser action cleanup path but not the Lightroom route, or vice versa. One upload surface may delete the original on rejection while the other leaks it, one may settle tracker claims differently, or one may enqueue processing before DB commit.

Suggested fix:
- Add a shared behavioral test matrix for both upload surfaces, or extract shared upload commit/cleanup primitives that can be unit-tested once and invoked by both entry points.

Confidence: Medium.

### DBG-4: `serve-upload` abort listener may remain registered until request GC

Evidence:
- `apps/web/src/lib/serve-upload.ts:349-360` registers an `abort` listener that closes `streamForCleanup`.
- Normal streaming completion returns the `NextResponse` in `apps/web/src/lib/serve-upload.ts:364-382`; no explicit `removeEventListener` is visible on stream close/end.

Concrete failure scenario:
- On high-volume static upload serving, request `AbortSignal` objects should normally be garbage-collected with the request. If a platform retains signals longer, the captured stream reference can be held longer than necessary. This is a low-confidence leak surface, not an observed bug.

Suggested fix:
- Register a `fileStream.once("close", ...)` cleanup that removes the abort listener, or wrap the listener with an explicit cleanup in the stream lifecycle.

Confidence: Low.

## Manual-Validation Risks

### DBG-5: Production-only model and browser-flow gates can hide regressions in local debug loops

Evidence:
- CLIP tests skip unless explicitly enabled in `apps/web/src/__tests__/clip-offline-load.test.ts:1-65` and `apps/web/src/__tests__/clip-semantic-integration.test.ts:1-80`.
- Admin E2E is environment-gated in `apps/web/e2e/admin.spec.ts:6-12`.
- Authenticated origin-guard browser coverage skips without admin E2E config in `apps/web/e2e/origin-guard.spec.ts:28-30` and `apps/web/e2e/origin-guard.spec.ts:55-57`.

Concrete failure scenario:
- A local bugfix looks complete after unit tests, typecheck, and build, but production CLIP loading or authenticated browser upload/origin flows fail because those tests did not run.

Suggested fix:
- Treat CLIP and admin E2E as release/debug checklists for affected changes. Capture explicit evidence when touching semantic search, admin upload/delete/settings, restore, or origin-guard code.

Confidence: High.

## Final Sweep

Checked for commonly missed bug classes:
- TOCTOU around upload quota and disk claims: browser upload has tracker claim/settle and late maintenance checks in `apps/web/src/app/actions/images.ts:196-320` and `apps/web/src/app/actions/images.ts:592-652`; no confirmed quota leak found.
- Path traversal/static serving: `apps/web/src/lib/serve-upload.ts:162-229` resolves, normalizes, realpaths, and checks containment before serving; no confirmed traversal issue found.
- Queue after restore: `apps/web/src/lib/image-queue.ts:1285-1344` quiesces/resumes processing around restore; no confirmed resume omission found.
- Delete partial failures: queue state is cleared before DB/file deletion in `apps/web/src/app/actions/images.ts:707-756` and `apps/web/src/app/actions/images.ts:825-923`; this is a low-confidence operational edge case, not a confirmed bug.

No source files were modified. The highest-confidence debugger concern is the sidecar backfill batching bug surface; the rest are coverage and failure-mode risks needing executable tests or manual validation.
