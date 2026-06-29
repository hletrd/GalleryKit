# Code Reviewer — review-plan-fix cycle 6

**Date:** 2026-06-29
**HEAD reviewed:** `e6db9241b3b4f2adbedaeeb46eb5d68275b74879` (`e6db9241`)
**Role:** code-reviewer
**Scope:** current HEAD only; code quality, logic, SOLID/maintainability, operational correctness, cross-file contracts, scripts, tests, migrations, config, and docs. No implementation fixes made.

## Required Context Read

- Read `AGENTS.md` first.
- Read `CLAUDE.md` in full.
- Loaded the `code-review` skill instructions.
- Confirmed the worktree was clean before writing this artifact and that `HEAD` was `e6db9241` on `master`.

## Inventory Built Before Findings

Tracked inventory at current HEAD:

- Total tracked files: 2,504.
- Active app/source surface: `apps/web/src` 486 files.
- Tests: `apps/web/src/__tests__` 253 files plus `apps/web/e2e` 8 files.
- Runtime scripts: `apps/web/scripts` 27 files.
- Migrations: `apps/web/drizzle` 24 SQL files plus Drizzle metadata.
- Config/deploy surface: root/app `package*.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, Dockerfile, compose, nginx, `.dockerignore`, env examples.
- Docs/plans/reviews inspected for current contracts: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, prior `.context/reviews/code-reviewer.md`, and cycle plan history enough to understand lineage without treating old findings as current evidence.

Review-relevant files and regions examined:

- App routes/actions: all files under `apps/web/src/app`, with focused reads of upload, restore, settings, topics, sharing, semantic/similar search, OG, feeds, public pages, and admin settings.
- Core libraries: `data.ts`, `image-queue.ts`, `queue-shutdown.ts`, `admin-backfill-runner.ts`, `process-image.ts`, `clip-model.ts`, `gallery-config*.ts`, `settings-hash.ts`, `upload-processing-contract-lock.ts`, `advisory-locks.ts`, `restore-maintenance.ts`, `rate-limit.ts`, `serve-upload.ts`, `smart-collections.ts`, auth/session helpers, and privacy/select-field contracts.
- Scripts/config: `migrate.js`, backfill/CLIP scripts, action/auth/rate-limit scanner scripts, Dockerfile, compose, dockerignore, nginx, service worker template/generated output.
- Tests: targeted contract tests around restore locks, admin backfill leaks, image queue embedding wiring, migration/schema coverage, settings hash, route/action lint gates, privacy guards, and service worker contracts.
- Migrations/schema: `apps/web/src/db/schema.ts`, all `apps/web/drizzle/*.sql`, `drizzle/meta/_journal.json`, and `migrate.js` reconcile coverage.

Broad sweeps run before finalizing:

- Largest-file review triage over TypeScript/TSX/JS files.
- Greps for `GET_LOCK`/`RELEASE_LOCK`, detached work, fire-and-forget promises, `setTimeout`/`setInterval`, `process.env`, Node-only imports in routes, raw SQL, `db.execute`, image mutation paths, schema/index/FK migrations, `TODO`/`FIXME`/`eslint-disable`/`as unknown as`.
- Re-checked prior cycle findings against current HEAD before deciding whether they still apply.

## Findings

### Confirmed Issues

#### HIGH — Restore lock setup can leak advisory locks before maintenance begins

**File/region:** `apps/web/src/app/[locale]/admin/db-actions.ts:279-324`, `apps/web/src/app/[locale]/admin/db-actions.ts:363-388`; related lock helper at `apps/web/src/lib/upload-processing-contract-lock.ts:9-73`; current source-contract gap at `apps/web/src/__tests__/restore-upload-lock.test.ts:46-66`.

**Issue:** `restoreDatabase()` acquires `LOCK_DB_RESTORE`, then acquires the upload-processing contract lock, then tries to acquire `LOCK_COLOR_PIPELINE_BACKFILL`. The cleanup that releases all three locks exists only in the inner `try/finally` that begins after `beginRestoreMaintenance()` succeeds. If an exception is thrown after the DB restore lock is acquired but before that inner `try/finally` is entered, the outer `finally` only calls `conn.release()` and explicitly does not release `uploadContractLock`.

The most obvious throw point is the backfill `GET_LOCK` query at lines 311-314. If that query rejects after `uploadContractLock = await acquireUploadProcessingContractLock(0)` has returned a live lock, execution skips the early-return cleanup branches and the inner restore `finally`. The current outer cleanup at lines 383-388 releases the pooled connection only. With MySQL advisory locks, returning a healthy pool connection is not the same as releasing its locks.

**Why it is a problem:** The code has multiple carefully documented lock-release paths, but the acquisition phase is not protected as one cleanup-owned state machine. That makes the correctness of restore/upload/backfill coordination depend on no query throwing in the setup gap. The nearby source-contract test asserts there is exactly one `uploadContractLock?.release()` call, which accidentally codifies the blind spot instead of proving cleanup on acquisition failure.

**Concrete failure scenario:** An admin starts a DB restore. `LOCK_DB_RESTORE` is acquired, and the upload-processing contract lock is acquired on its own pool connection. Then the backfill-lock query throws due to a transient DB protocol/connection error or pool/session problem. The server action fails before `beginRestoreMaintenance()` and before the inner `finally`. The restore lock may remain held by a pooled session, and the upload contract lock object is never released. Later restores report "restore in progress", and upload/settings operations that need the upload-processing contract can also be blocked until process restart or connection eviction.

**Suggested fix:** Treat the entire acquisition phase as cleanup-owned state:

- Track `dbRestoreLockHeld`, `backfillLockHeld`, and `uploadContractLock` immediately after acquisition.
- Add an outer `catch/finally` fallback that releases any held locks unless ownership has been deliberately transferred to the inner restore window.
- Keep the inner restore `finally` for the happy path, but do not rely on it for setup failures.
- Add a regression test that mocks the sequence: DB restore lock success, upload contract lock success, backfill `GET_LOCK` throws. Assert `RELEASE_LOCK(LOCK_DB_RESTORE)` is attempted, `uploadContractLock.release()` is called, and the pool connection is released.

**Severity:** High. A single failed restore attempt can wedge multiple admin write paths.
**Confidence:** High for the control-flow gap; Medium-High for persistent lock impact because exact MySQL driver behavior depends on whether the thrown query killed or preserved the session.

#### HIGH — Production CLIP embedding runs outside queue/restore/shutdown control

**File/region:** `apps/web/src/lib/image-queue.ts:470-567`, `apps/web/src/lib/queue-shutdown.ts:15-42`, `apps/web/src/lib/image-queue.ts:847-888`, `apps/web/src/lib/clip-model.ts:151-186`; current source-contract test only checks wiring at `apps/web/src/__tests__/image-queue-embed-wiring.test.ts:6-36`.

**Issue:** After an image job marks `processed=true`, `image-queue.ts` starts caption and embedding work in detached `void (async () => { ... })()` blocks. The production embedding branch calls `embedImageReal(originalPath)`, which decodes/resizes through Sharp and runs the ONNX model, then writes `image_embeddings`. That detached work is not part of the PQueue task lifecycle.

`drainProcessingQueueForShutdown()` and `quiesceImageProcessingQueueForRestore()` pause/clear the PQueue and wait for `queue.onIdle()`, but they have no visibility into already-started embedding IIFEs. The source test proves production embedding is wired, but it does not assert that this heavy side effect is backpressured, tracked, or drained.

**Why it is a problem:** The image-processing queue is the repository's central coordination boundary for upload CPU, restore quiescence, and shutdown. Detached production embeddings bypass that boundary while still doing expensive Sharp/ONNX work and DB writes. This weakens both resource control and restore consistency.

**Concrete failure scenario:** Production semantic search is enabled and a batch of uploads finishes derivative processing. With `QUEUE_CONCURRENCY=1`, each image job can still spawn a production embedding IIFE and return immediately, allowing many Sharp decodes and ONNX inferences to accumulate outside queue backpressure. If an admin restore starts while embeddings are running, `quiesceImageProcessingQueueForRestore()` can report the queue idle while detached embeddings continue. Those IIFEs can then write `image_embeddings` during or after the SQL import, potentially writing a stale vector for a restored row with the same image id or competing with the restore's schema/data state. On shutdown, the same detached work is not awaited before exit, so embeddings are nondeterministically lost or interrupted.

**Suggested fix:** Move embedding generation behind a tracked lifecycle boundary:

- Prefer a dedicated embedding queue with bounded concurrency, explicit in-flight tracking, and drain hooks called from restore quiesce and shutdown.
- Alternatively make embedding part of the image PQueue job when production mode is enabled, if the product accepts slower per-image completion.
- Re-check `isRestoreMaintenanceActive()` immediately before writing `image_embeddings`.
- Add tests proving restore/shutdown drains or cancels in-flight embedding work, and that production embedding concurrency cannot exceed the configured bound.

**Severity:** High. This can corrupt restore consistency and can overload CPU/DB under production semantic mode.
**Confidence:** High. The detached IIFE and queue drain mismatch are directly visible in current HEAD.

### Likely Issues

None promoted separately. The two confirmed issues above have enough source evidence to be actionable. I discarded one suspected warning gap around `image_sizes` because the setting is disabled client-side and rejected server-side once images exist, so it does not create stale derivative behavior in current HEAD.

### Risks Needing Manual Validation

- The restore lock leak's exact blast radius depends on MySQL/session behavior for the specific thrown error class. The control-flow bug is confirmed, but manual fault injection against mysql2/pool behavior would classify whether `LOCK_DB_RESTORE` survives every setup-query failure or only non-fatal session errors.
- The production embedding issue should be validated on the production-like host with semantic mode enabled and real model weights. The source-level race/backpressure gap is confirmed, but CPU pressure and restore-write timing depend on upload volume, model latency, and DB restore duration.

## Non-Findings / Verified Current Fixes

- Prior cycle Docker public-asset packaging and `public/resources` build-context findings are fixed in current HEAD: root and app `.dockerignore` now ignore `public/resources`, and the runner copies immutable `public` assets while compose bind-mounts only `public/uploads` and `public/resources`.
- Prior semantic-search disabled-mode body parsing issue is partly fixed: the route now checks config before `request.text()` and no longer rolls back a charged token after reading a body. I did not promote the remaining uncharged config read as a finding because current comments explicitly define disabled mode as uncharged and same-origin/header gates still run first.
- Prior Lightroom topic-lookup quota leak is fixed: `apps/web/src/app/api/admin/lr/upload/route.ts:198-210` catches topic lookup errors and settles the pre-claim.
- Prior restore/backfill fencing and post-restore migration work is present in current HEAD; the new finding is a setup-error cleanup gap before the protected restore window, not a rejection of the intended lock design.
- Migration/schema parity looked maintained for the current schema surface; no new admin-only privacy-column drift found in the reviewed code.

## Final Missed-Issues Sweep

Final sweep covered:

- All tracked file inventory at HEAD and category counts.
- App routes/actions, public/admin API routes, server actions, core data access, upload/processing/backfill/restore flows, semantic-search flows, and public view tracking.
- Schema, migrations, migration journal, reconcile script, and migration-related tests.
- Deployment/config surfaces: Dockerfile, compose, dockerignore, nginx, Next config, service worker, package scripts, env examples.
- Test/lint architecture: auth route scanner, action-origin scanner, public mutating route rate-limit scanner, privacy guards, touch-target audit, migration coverage, restore lock tests, image queue embedding wiring tests.
- Prior cycle aggregate/review findings checked against current HEAD so stale fixed issues were not re-reported.

Files intentionally not inspected in depth:

- Binary assets, screenshots, fixture images, generated visual artifacts, and historical archived review screenshots.
- Most historical `.context/reviews/archive/**` and `.context/plans/done/**` files beyond current aggregate/lineage checks, because they are not executable current behavior.
- `node_modules` and untracked/generated local build outputs.
- Full line-by-line review of every one of the 253 tests; I inspected representative and contract-relevant tests plus ran source sweeps across the whole test tree.

## Validation Evidence

- This was a read-only review of current HEAD. I did not run the full lint/typecheck/build/test suite because no code was changed and the task requested review findings, not implementation.
- Source evidence was gathered with tracked-file inventory, `git show HEAD:<path>` reads, `git grep` sweeps, and focused cross-file tracing.
- The review artifact itself is the only file written.

## Recommendation

**REQUEST CHANGES** for the two confirmed high-impact coordination issues before treating restore/production semantic-search behavior as robust.
