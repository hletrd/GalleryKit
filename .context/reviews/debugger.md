# Debugger Review - Cycle 25

Review role: debugger
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `4cb1258ba0b2cca689846a85423264edc2d96b90`
Date: 2026-06-30 KST
Mode: review-only. I modified only this report file. Per user instruction, I did not commit or push.

## File Inventory First

Required project instructions read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Tracked inventory from `git ls-files`:

- 2,585 tracked files total.
- Main runtime tree: `apps/` with 616 tracked files.
- Review/plan/history tree: `.context/` with 1,771 tracked files and `plan/` with 180 tracked files.
- Dominant file types: 1,825 Markdown, 433 TypeScript, 104 TSX, 81 PNG, 28 SQL migrations, 22 JSON, 20 logs, 16 text files, 12 PID files, 6 JS, 6 MJS, 6 JPG, 5 ICC profiles, 3 shell scripts, 3 GitHub workflow files.

Runtime surfaces inventoried and reviewed:

- Upload/process/serve: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-tracker*.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, upload routes, storage helpers, queue shutdown, backfill runners.
- Restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, MySQL SSL helpers, migration scripts, restore/upload lock tests.
- Auth/session: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`, admin token flows, origin/rate-limit guards.
- Semantic search: semantic and similar API routes, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/gallery-config*.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, CLIP path/model contracts.
- Analytics: public view-recording actions, analytics reporting, retention GC, view count buffers.
- Deploy: `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, Dockerfile, compose, dockerignore, deploy-script contract tests.

Skipped by design: dependency/build artifacts, generated `.next` output, binary image fixtures except where route or filename contracts mattered, and historical review files as evidence for runtime behavior.

## Confirmed Findings

### DBG25-01 - Failed restore can leave the app in an unrecoverable in-process maintenance state

Severity: High
Confidence: Medium-high
File/region: `apps/web/src/app/[locale]/admin/db-actions.ts:447-503`, `apps/web/src/app/[locale]/admin/db-actions.ts:670-730`, `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/app/actions/auth.ts:70-75`

Root cause:

Restore maintenance is a process-local `globalThis` boolean (`restore-maintenance.ts:1-56`). `restoreDatabase` intentionally keeps that flag active when the mysql import exits non-zero or post-restore migrations fail (`db-actions.ts:670-730`), because the database may be partially rewritten. The outer finally only calls `endRestoreMaintenance()` when the restore succeeded or `keepMaintenance` is false (`db-actions.ts:496-503`). At the same time, the login action rejects all login attempts while maintenance is active (`auth.ts:70-75`).

Concrete failure scenario:

An admin uploads a dump that passes header and dangerous-SQL scanning but fails halfway through mysql import, or imports successfully and then fails post-restore migration. The action returns failure with `keepMaintenance: true`; the image queue stays paused and in-process maintenance remains active. If the session table was replaced or the current cookie is no longer valid against the restored/partial DB, the operator cannot log in because login returns `restoreInProgress`. A container restart clears the process-local flag, but that may resume traffic against a partially restored database, which is exactly the state maintenance was trying to protect.

Suggested fix:

Add a durable restore recovery mode with an explicit, narrow recovery surface. Options: persist restore state in a small durable flag/table or host-side marker, allow a restore-only recovery endpoint while maintenance is active, and permit already-authenticated or recovery-token-authenticated operators to upload another dump or explicitly mark recovery complete. Avoid relying on process restart as the only escape hatch. Add tests for failed mysql import, failed post-restore migration, login behavior during recovery mode, and queue resume only after verified recovery.

### DBG25-02 - Public analytics view writes can race into the database during restore

Severity: Medium
Confidence: High
File/region: `apps/web/src/app/actions/public.ts:370-390`, `apps/web/src/app/actions/public.ts:397-421`, `apps/web/src/app/actions/public.ts:428-456`, `apps/web/src/app/[locale]/admin/db-actions.ts:481-489`

Root cause:

`recordPhotoView`, `recordTopicView`, and `recordSharedGroupView` check `isRestoreMaintenanceActive()` only before async work starts (`public.ts:372`, `404`, `432`). Each then awaits headers, rate-limit derivation, and target validation queries before scheduling a fire-and-forget insert (`public.ts:383-390`, `414-421`, `449-456`). Restore preparation flushes shared-group count buffers and quiesces the image queue (`db-actions.ts:481-489`), but it does not track, drain, or block these public analytics insert promises.

Concrete failure scenario:

A public photo page starts `recordPhotoView` just before an admin begins restore. The action passes the early maintenance check, awaits headers and a `visibleImage` SELECT, then restore enters maintenance and imports a new DB. After the awaited work resumes, the action schedules `db.insert(imageViews)` with an image ID from the pre-restore request. Depending on timing and restored IDs, the insert either fails noisily on a foreign key, or succeeds against a different/restored image and pollutes post-restore analytics with a pre-restore event. The same race exists for topic and shared-group views.

Suggested fix:

Add a late maintenance gate immediately before each insert and track analytics write promises so restore can drain them, or route view recording through a small queue/buffer with pause/drain semantics similar to image side effects. A minimal patch should re-check `isRestoreMaintenanceActive()` after target validation and before `db.insert(...)`; the robust fix should also make restore wait for already-started analytics writes to settle.

### DBG25-03 - Deploy reports success without proving the new container is healthy

Severity: Medium
Confidence: High
File/region: `apps/web/deploy.sh:28-63`, `apps/web/Dockerfile:139-142`, `apps/web/src/__tests__/deploy-script-contract.test.ts:20-101`

Root cause:

The deploy script runs `docker compose ... up -d --build` and then immediately prunes old Docker artifacts and prints `Deployment Complete!` (`deploy.sh:28-63`). The Dockerfile defines a health check against `/api/live` (`Dockerfile:139-142`), but the script does not wait for Docker health or curl a readiness/liveness endpoint. Existing deploy contract tests assert start-before-prune and env/build contracts, but they do not require any post-start health gate (`deploy-script-contract.test.ts:20-101`).

Concrete failure scenario:

A deployment builds and starts a container, but the Next server crashes on startup, fails to bind, lacks a runtime native dependency, or returns 500 due to bad environment. `docker compose up -d --build` can still exit successfully once the container is created. The script then prunes old images and prints success, giving the operator a false green deploy and reducing rollback material before the failure is surfaced externally.

Suggested fix:

After `up -d --build`, wait with a bounded timeout for either Docker health status `healthy` on `gallerykit-web` or an explicit HTTP 200 from `http://localhost:3000/api/live`. On failure, print recent container logs and exit non-zero. Prefer moving prune after the health gate, or at least keep enough rollback material until health has passed. Add a deploy-script contract test that fails if no health wait/check exists between compose up and prune/success output.

### DBG25-04 - CLIP image embedding generation still runs after restore maintenance has begun

Severity: Low
Confidence: High
File/region: `apps/web/src/lib/image-queue.ts:351-385`, `apps/web/src/lib/image-queue.ts:1053-1080`

Root cause:

`storeImageEmbeddingForMode` performs the expensive embedding generation first (`embedImageReal(originalPath)` at `image-queue.ts:358-360`) and checks `isRestoreMaintenanceActive()` only afterward (`image-queue.ts:367-370`). Restore quiesce pauses and clears the queue, waits for in-flight work, then drains side effects (`image-queue.ts:1053-1080`). If a semantic side effect is already running when restore begins, quiesce waits for the real CLIP inference to finish even though the subsequent DB write will be skipped.

Concrete failure scenario:

Production semantic mode is enabled and an upload has just queued an embedding side effect. An admin starts restore while ONNX inference is still running. Restore maintenance is active, but the model inference continues to consume CPU and delay `drainQueueSideEffects`. On a large image or constrained host, restore start latency can become much longer for work whose result will be discarded.

Suggested fix:

Move the maintenance check to the top of `storeImageEmbeddingForMode`, before `embedImageReal`, and keep the existing late check before the DB write. Optionally pass an abort signal or generation token into embedding side effects so restore can cancel pending inference rather than merely wait for it.

## Refuted Hypotheses

- Upload/restore interleaving across browser uploads: refuted. Browser upload acquires the upload-processing contract lock before config, disk, original-save, insert, and enqueue work; restore acquires the same lock before beginning maintenance. Late restore cleanup also exists after original save.
- Lightroom upload/restore interleaving: mostly refuted. The LR route has the same restore gates, size/body checks, upload tracker settlement, original cleanup paths, and contract lock around the critical save/insert/enqueue region.
- Duplicate queue processing after concurrent enqueue/bootstrap: refuted. The queue uses in-memory `enqueued`, MySQL per-image advisory locks, row re-checks, and `processed=false` conditional updates before marking processed.
- Serve-upload traversal, symlink, and open/stat TOCTOU: refuted. `serve-upload.ts` validates allowed directories/extensions/path segments, rejects symlinks with `lstat`, checks realpath containment, opens the file descriptor, and stats the same descriptor before streaming.
- Semantic stub/production result mixing: refuted. Search routes filter embeddings by `modelVersion`, production mode heals to disabled without the explicit environment opt-in, and similar-photo search is production-only.
- Admin API auth wrapper bypass: refuted in reviewed routes. Admin API handlers route through `withAdminAuth`; token and cookie paths have separate scope/origin checks and response hardening.
- Unbounded analytics retention: refuted. Retention GC and chunked purge logic exist. The confirmed analytics issue is restore-time write interleaving, not retention.
- Dangerous SQL restore primitives such as `DROP DATABASE`, `CREATE DATABASE`, and cross-schema `USE`: refuted for the scanner path inspected. The restore code streams to disk, scans chunks with tail carryover, invokes mysql with `--one-database`, and uses TLS helper checks.

## Final Sweep

Final pass focused on stale assumptions and latent failure modes in the requested surfaces:

- Upload/process/serve: checked original-save cleanup, HDR rejection, GPS-strip replacement cleanup, strict derivative generation rollback, delete-mid-processing cleanup, advisory locks, queue bootstrap, failed-image retry, and upload tracker settlement.
- Restore: checked same-origin/admin gates, advisory lock release paths, upload-processing lock, color/semantic backfill locks, restore SQL scan, mysql child process watchdog, temp file cleanup, post-restore migrations, queue quiesce/resume, and recovery behavior after partial failure.
- Auth/session: checked session secret behavior, token verification, login/update-password maintenance gates, admin token verification, API auth wrapper, proxy cookie pre-check, and origin/rate-limit ordering.
- Semantic search: checked content-length and chunked rejection, query validation, rate limits, stub vs production gating, model-version filters, CLIP lazy loading, embedding normalization, similar route production gating, and backfill lock/scan limits.
- Analytics: checked bot/referrer/IP sanitization, rate limiting, retention purge, shared view count buffering, and restore-time behavior.
- Deploy: checked local and remote deploy scripts, Dockerfile native dependency/health contracts, compose mounts/env forwarding, dockerignore protection, and deploy tests.

## Validation Evidence

Commands and inspections used:

- `git ls-files` inventory and file-type/top-level summaries.
- Targeted `nl -ba` reads for all confirmed line references.
- `rg --files` and targeted `rg` sweeps over upload, restore, auth/session, semantic search, analytics, deploy, advisory locks, raw SQL, child processes, file operations, fire-and-forget promises, rate limits, origin/auth guards, and maintenance gates.
- No source tests were run because this was a review-only task and no runtime code changed. The validation evidence is static source inspection plus the requested report artifact.

Working tree note:

- Before this report edit, unrelated `.context/reviews/*` modifications/deletions were already present. I did not revert or touch them.
- Only `.context/reviews/debugger.md` was intentionally modified for this cycle-25 report.
