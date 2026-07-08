# Cycle 25 Code Reviewer Report

Date: 2026-07-08 KST
Review HEAD: `7c0c4db810cc2b99c8d221eb4f74512e3e710adc`
Role: code-reviewer lane
Scope: deep whole-repo review for code quality, logic correctness, maintainability, SOLID boundaries, data flow, races, shared state, error handling, invalid assumptions, and cross-file interactions. Product code was not edited.

## Inventory

Relevant tracked inventory was built before source inspection, excluding generated/runtime payloads. The review covered 3,527 tracked files, including 626 TypeScript/TSX source files, 12 App Router route handlers, 14 server-action files, 115 shared library files, 31 operational scripts, 34 migration/meta files, 373 tests, and the root/project docs.

Docs and authority read: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, current plan/deferred history relevant to sidecars, restore, image processing, semantic search, and deployment.

High-risk source areas examined in detail: admin/browser/LR upload ingestion, image queue, color backfill sidecar and in-app runner, gallery config accessors, restore/backup maintenance, DB pool/advisory locks, rate limiting, admin auth, semantic/similar search, public data projections, storage, background DB writes, pending cleanup queues, migrations, and source-contract tests.

## Findings

### CR25-01: Color re-encode write paths fail open to default settings when `admin_settings` cannot be read

Severity: High
Confidence: High
Status: Confirmed correctness/data-quality risk

Code regions:

- `apps/web/src/lib/gallery-config.ts:168-184`
- `apps/web/src/lib/gallery-config.ts:219-237`
- `apps/web/src/lib/admin-backfill-runner.ts:701-714`
- `apps/web/src/lib/admin-backfill-runner.ts:615-629`
- `apps/web/scripts/backfill-color-pipeline.ts:355-368`
- `apps/web/scripts/backfill-color-pipeline.ts:466-492`

`_getGalleryConfig()` catches any settings-read error, logs a warning, and returns defaults (`gallery-config.ts:168-175`). `getGalleryConfigDetached()` calls that same fail-open helper (`gallery-config.ts:219-237`). Both color re-encode writers then use the resolved values to select quality, size, chroma, color-conversion, effort, and wide-gamut limits: the in-app runner at `admin-backfill-runner.ts:701-714`, and the sidecar at `backfill-color-pipeline.ts:355-368`. On success, both persist new derivative metadata and can advance `pipeline_version` to the current version (`admin-backfill-runner.ts:615-629`, `backfill-color-pipeline.ts:466-492`).

Concrete failure scenario:

An admin starts "Re-encode existing photos" or an operator runs `scripts/backfill-color-pipeline.ts` during a transient `admin_settings` read failure. Instead of aborting like upload/retry ingest paths do with `getGalleryConfigStrict`, the re-encode proceeds with default quality/sizes/color policy. The newly written derivative files can be produced with the wrong processing contract, and rows are marked current with `pipeline_version = IMAGE_PIPELINE_VERSION`, so normal backfill retry logic will not revisit them. This is especially risky for photographer-intent settings such as forced sRGB derivatives, JPEG chroma, AVIF effort, and configured image sizes.

Suggested fix:

Add a strict detached accessor, or call `getGalleryConfigStrict()` from both re-encode write paths after the shared backfill lock/restore guard and before any row work. If settings cannot be read, release the lock and fail the run without writing derivatives or advancing `pipeline_version`. Update the source-contract test that currently expects the sidecar to call `getGalleryConfig()` and add behavior tests that mock settings-read failure for both in-app and sidecar paths and assert no encode/update occurs.

### CR25-02: Image queue and admin backfill each reserve live DB headroom independently, so running both can nearly saturate the shared pool

Severity: Medium
Confidence: High
Status: Confirmed resource/race risk, already documented but not fixed

Code regions:

- `apps/web/src/db/index.ts:31-42`
- `apps/web/src/lib/image-queue.ts:121-153`
- `apps/web/src/lib/admin-backfill-runner.ts:106-143`
- `apps/web/src/lib/admin-backfill-runner.ts:324-378`
- `CLAUDE.md:269-284`

The app ships with a 10-connection MySQL pool and queue limit 20 (`db/index.ts:31-42`). `resolveImageQueueConcurrency()` reserves `max(3, ceil(pool / 2))` for live traffic and caps the queue independently (`image-queue.ts:121-153`). `resolveBackfillConcurrency()` performs similar arithmetic for the admin color backfill, including one global lock plus per-image claim connections (`admin-backfill-runner.ts:106-143`, `admin-backfill-runner.ts:324-378`). The formulas do not coordinate with each other. `CLAUDE.md:269-284` explicitly documents the same mutual over-subscription window, but the code still has no shared background budget.

Concrete failure scenario:

With the default pool of 10, an active upload queue at effective concurrency 2 and an admin-triggered color re-encode at effective concurrency 2 can overlap because they use different locks. The backfill can pin about 1 global lock plus 2 workers times 2 connections, while the upload queue can pin 2 workers times 2 connections. That leaves roughly 1 free connection, not the 5 live connections each resolver claims to reserve. A live photo page or search request that fans out several DB queries can then queue behind encode-duration connection holds and hit the pool `queueLimit` under ordinary admin maintenance plus upload activity.

Suggested fix:

Introduce a single background DB budget/semaphore shared by image queue processing and admin color backfill, or make backfill startup quiesce/pause the upload queue before it begins. The invariant should be "all background processing combined leaves live headroom", not "each background processor leaves live headroom in isolation." Add a regression/source-contract test that proves queue concurrency plus backfill concurrency cannot exceed the shared pool budget at `POOL_CONNECTION_LIMIT = 10`.

### CR25-03: Restore temp-file ownership is transferred before `spawn()` is known to have succeeded

Severity: Low
Confidence: Medium
Status: Edge-case cleanup leak

Code regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:887-900`
- `apps/web/src/app/[locale]/admin/db-actions.ts:977-980`

`runRestore()` sets `cleanupTransferredToRestoreProcess = true` immediately before constructing the `spawn('mysql', ...)` promise (`db-actions.ts:887-900`). The `finally` block only unlinks the uploaded temporary SQL file when that flag is false (`db-actions.ts:977-980`). In the common failure mode where `spawn` emits an `error`, the child-process handler performs cleanup. But if `spawn()` throws synchronously before handlers are attached, ownership has already been marked transferred and the fallback cleanup is skipped.

Concrete failure scenario:

A malformed runtime environment or unexpected Node child-process option failure causes `spawn()` to throw synchronously. The restore reports failure, but the temp SQL file remains in the OS temp directory because the outer `finally` believes cleanup belongs to the restore process.

Suggested fix:

Move `cleanupTransferredToRestoreProcess = true` until after `spawn()` returns and error/close handlers are registered, or wrap `spawn()` in its own `try` that resets the flag before rethrowing. Add a small unit test that mocks synchronous `spawn` failure and asserts the temp file cleanup path is still taken.

## Missed-Issue Sweep

- Searched all config accessor call sites. Request/page/route reads mostly use cached `getGalleryConfig()`, upload/retry ingest uses strict accessors, and the re-encode paths above are the write-path fail-open exceptions.
- Searched advisory locks, `PQueue`, concurrency formulas, and DB pool usage. The unshared image-queue/admin-backfill pool budget is the remaining concrete saturation issue found.
- Searched raw SQL, `sql.raw`, and password/secret handling. No untrusted string-concatenated SQL or unsanitized DB-password logging issue was confirmed in this pass.
- Checked runtime/export shape for route handlers and mutating server actions against the documented lint contracts. No new missing auth/origin/rate-limit issue was confirmed.
- Reviewed restore maintenance fencing, durable marker checks, background DB write draining, pending deletion/session queues, and sidecar restore guards. Only the restore temp ownership edge case above was confirmed.

## Verification

This was a read-only review plus report write. I did not run the full quality gates because the task was a code review and no product code changed. Static inventory and targeted source sweeps were run with `rg`, `git ls-files`, and line-numbered reads. Current recommendation: request changes for CR25-01 before treating color re-encode maintenance as fail-closed.
