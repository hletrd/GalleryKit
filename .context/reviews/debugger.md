# Debugger Review - Cycle 11

Scope: latent bug surface, failure modes, async hangs, queue/restore regressions, and data-loss-adjacent runtime behavior in current `HEAD` of `/Users/hletrd/flash-shared/gallery`.

Constraints honored:
- Read and followed `AGENTS.md`, `CLAUDE.md`, and the `code-review` skill instructions.
- Built the review inventory before findings.
- Review-only lane: no production code edits.
- Wrote only this report artifact.
- Left the pre-existing dirty sibling review artifact `.context/reviews/critic.md` untouched.

## Inventory Summary

Review-relevant inventory:
- 564 tracked source/script/e2e/migration/config files across `apps/web/src`, `apps/web/scripts`, `apps/web/e2e`, `apps/web/drizzle`, app manifests, Docker/deploy config, and root project docs.
- Current top-level review artifacts under `.context/reviews/*.md`.
- Prior debugger report (`Cycle 10`) and the Cycle 10 fix commit `d5d79e17` to avoid re-reporting closed cleanup-observability findings.

Primary runtime surfaces inspected:
- Upload/delete/processing: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`.
- Semantic search / CLIP repair: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, semantic/similar API routes, and related tests.
- Restore / migration / locks: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/scripts/migrate.js`, `apps/web/Dockerfile`, and restore lock tests.
- Public/admin rate-limit and async surfaces: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/app/actions/public.ts`, OG routes, sharing actions, topic actions, and data-layer view-count buffering.

## Findings

### DBG11-01 - Bootstrap embedding repair schedules unbounded concurrent side effects

Severity: Medium
Confidence: High
Status: Confirmed issue

Code regions:
- `apps/web/src/lib/image-queue.ts:370-421` defines `bootstrapMissingActiveEmbeddings`.
- `apps/web/src/lib/image-queue.ts:383-400` pages rows in batches of `BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE = 50`.
- `apps/web/src/lib/image-queue.ts:402-412` starts one tracked async side effect per row but does not await the batch before fetching the next batch.
- `apps/web/src/lib/image-queue.ts:415-420` advances the cursor immediately and continues the loop, so every missing embedding row can be scheduled in one bootstrap pass.
- `apps/web/src/lib/image-queue.ts:333-367` writes the embedding row; in stub mode `embedImageStub` is synchronous at `image-queue.ts:344`, so the DB upsert path has no inference-slot backpressure.
- `apps/web/src/lib/clip-model.ts:53-71` and `clip-model.ts:171-222` bound real CLIP inference, but only after production work reaches `embedImageReal`; they do not bound the number of scheduled side-effect promises, pre-slot filesystem probes, or stub-mode DB writes.
- The operator script has the safer shape for comparison: `apps/web/scripts/backfill-clip-embeddings.ts:149-190` processes each batch with `BATCH_CONCURRENCY = 2` and awaits each chunk.

Concrete failure scenario:
After production semantic search is enabled, the process restarts with many processed images missing the active model embedding. `bootstrapImageProcessingQueue()` calls `bootstrapMissingActiveEmbeddings()` (`image-queue.ts:948-950`). The helper selects 50 rows at a time, but each selected row is launched via `trackQueueSideEffect(state, (async () => { ... })())` and the loop immediately continues to the next DB batch. With 5,000 missing embeddings, the process creates roughly 5,000 side-effect promises in one bootstrap pass. In production mode, the CLIP model slot eventually serializes inference, but all pending tasks are still retained in `state.sideEffects`, and many can concurrently resolve original paths before waiting. In stub mode, `embedImageStub` is synchronous, so the helper can issue a large burst of concurrent `image_embeddings` upserts against the shared MySQL pool.

User-visible impact:
Startup/bootstrap can create a memory spike, a long restore/shutdown drain (`drainQueueSideEffects` waits until `state.sideEffects.size === 0` at `image-queue.ts:423-427`), and avoidable DB pressure exactly when the app is recovering from missing embeddings. The batch-size constant gives a false sense of bounded work; it bounds SELECT size, not concurrent repair work.

Suggested fix:
Make bootstrap embedding repair process bounded chunks the way `scripts/backfill-clip-embeddings.ts` does. For example, collect the per-batch row tasks, run them through a small concurrency helper (1-2 for production, maybe 2-4 for stub), and `await Promise.allSettled(...)` for the batch before advancing to the next SELECT. Alternatively enqueue repair jobs through `PQueue` or a dedicated embedding queue. Add a regression test that stubs 3 batches of missing rows and asserts the second SELECT is not issued until the first batch's repair promises settle.

### DBG11-02 - A synchronous post-restore migration setup failure can hang restore forever

Severity: High
Confidence: Medium
Status: Likely issue

Code regions:
- `apps/web/src/app/[locale]/admin/db-actions.ts:361-374` quiesces the app, runs `runRestore`, records `restoreLifecycleVerified` / `keepRestoreMaintenance`, and returns the result.
- `apps/web/src/app/[locale]/admin/db-actions.ts:375-399` is the cleanup `finally` that ends restore maintenance, resumes the queue, releases the DB restore lock, releases the color-backfill lock, and releases the upload-processing contract lock.
- `apps/web/src/app/[locale]/admin/db-actions.ts:559-582` registers an async `restore.on('close', async (code) => { ... })` handler for the `mysql` process.
- `apps/web/src/app/[locale]/admin/db-actions.ts:564` awaits `runPostRestoreMigrations(t)` inside that event handler without a local `try/catch`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:598-613` can throw from `resolveMigrationScriptPath()` if neither candidate migration script is accessible.
- `apps/web/src/app/[locale]/admin/db-actions.ts:615-620` calls `resolveMigrationScriptPath()` before constructing the Promise that handles `spawn` close/error events, so that throw rejects the async close handler before the outer `runRestore` promise resolves.
- Current source-lock coverage checks ordering and path candidates but not this rejection path: `apps/web/src/__tests__/restore-upload-lock.test.ts:34-44`.

Concrete failure scenario:
An admin restores a SQL dump and the `mysql` import exits `0`. Before the server action can report success, `runPostRestoreMigrations()` tries to locate `scripts/migrate.js`. If a future standalone packaging change omits it, the process runs from an unexpected cwd, or filesystem permissions make both candidates inaccessible, `resolveMigrationScriptPath()` throws. Because the throw happens inside the async EventEmitter `close` handler and there is no catch around the `await runPostRestoreMigrations(t)`, the handler rejects and the `new Promise<RestoreResult>` created at `db-actions.ts:514` never calls `resolve`.

User-visible impact:
`restoreDatabase()` remains stuck awaiting `runRestore()`, so the cleanup `finally` at `db-actions.ts:375-399` is not reached. Restore maintenance remains active, the DB restore advisory connection stays leased, the upload-processing contract lock remains held, and the image queue may remain quiesced until process restart. This is the same class of operational wedge the restore code is otherwise designed to prevent.

Suggested fix:
Make the `close` handler fail closed with an explicit resolved result. Wrap the migration block:

```ts
try {
  const migrationResult = await runPostRestoreMigrations(t);
  if (!migrationResult.success) {
    resolve({ success: false, error: migrationResult.error ?? t('restoreFailed'), keepMaintenance: true });
    return;
  }
} catch (err) {
  console.error('post-restore migrate setup failed:', err);
  resolve({ success: false, error: t('restoreFailed'), keepMaintenance: true });
  return;
}
```

Also add a unit/source test that forces `resolveMigrationScriptPath()` failure or source-locks a catch around `runPostRestoreMigrations(t)` so the action always resolves and lets the outer cleanup policy run.

## Reviewed Non-Findings

- Cycle 10 cleanup-observability finding appears fixed for admin delete paths: `deleteImage` / `deleteImages` now use `deleteOriginalUploadFileStrict` and `deleteImageVariantsStrict` (`apps/web/src/app/actions/images.ts:690-697`, `images.ts:825-830`) and the strict helpers propagate non-`ENOENT` failures (`apps/web/src/lib/upload-paths.ts:82-107`, `apps/web/src/lib/process-image.ts:651-663`).
- Upload quota claim/settle paths were rechecked. The post-claim disk and topic lookup awaits roll claims back on failure (`apps/web/src/app/actions/images.ts:247-265`, `images.ts:280-292`), and per-file failures settle at the end (`images.ts:556-584`). I did not confirm a new quota leak.
- The semantic text route intentionally charges malformed/read bodies and post-embedding failures; this matches the documented posture in `apps/web/src/lib/rate-limit.ts:24-32` and route comments in `apps/web/src/app/api/search/semantic/route.ts:12-17`.
- Topic slug rename still repoints `images`, `topicAliases`, `topicViews`, and exact smart-collection topic predicates inside the transaction (`apps/web/src/app/actions/topics.ts:285-339`). I did not confirm a new slug-rename data-loss path.
- Restore locks and maintenance cleanup are present on the normal resolved paths (`apps/web/src/app/[locale]/admin/db-actions.ts:279-399`); the finding above is specifically about an unhandled synchronous setup throw inside the async process-close handler.

## Verification Evidence

Read-only checks performed:
- `git status --short --branch` before writing: existing dirty `.context/reviews/critic.md` only.
- Inventory via tracked-file listing across source, scripts, e2e, migrations, config, Docker/deploy, package manifests, and review artifacts.
- Line-numbered inspection of all cited files.
- Targeted sweeps for cleanup strictness, upload claim settlement, queue side effects, CLIP inference limits, restore advisory locks, post-restore migration execution, public route rate limits, and source-lock tests.
- Compared runtime bootstrap embedding repair against the operator backfill script's bounded concurrency pattern.

Tests not run:
- Full lint/typecheck/build/test gates were not run because this was a review-only prompt and no production code was changed. The recommended fixes should add focused regression tests before implementation.

Final missed-issues sweep result:
- No additional confirmed Critical findings found.
- The two findings above are the highest-risk debugger issues I could substantiate with exact code paths in this pass.
