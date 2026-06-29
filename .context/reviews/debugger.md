# Cycle 19 Debugger Review

Review lane: `debugger`
Date: 2026-06-30 KST
Mode: repository-wide latent bug/failure-mode/regression review. No source code was changed. No commit or push was made.

## Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Repository inventory performed before findings:

- Tracked/source inventory with `rg --files`: app source, migrations, tests, scripts, config, docs, and plans.
- App routes inventoried with a route/runtime scan under `apps/web/src/app`, including public pages, admin pages, public API routes, admin API routes, upload serving, feeds, OG routes, health/live probes, semantic search, and similar search.
- Server actions reviewed under `apps/web/src/app/actions`, with focus on auth/origin gates, rollback paths, cache invalidation, upload quota settlement, delete cleanup, topic mutations, sharing, and public analytics actions.
- Core libraries reviewed under `apps/web/src/lib`, including data access, schema validation, gallery config, upload paths, image processing, image queue, restore maintenance, CLIP/semantic search, rate limits, request origin, API auth, smart collections, storage, serving, audit, and retention.
- Operational code reviewed: `apps/web/scripts/*`, Drizzle migrations/journal/reconcile path, Docker/nginx/deploy config, PWA/service worker generation, and existing tests around the reviewed invariants.
- Existing modified review artifacts in `.context/reviews/` were observed and left untouched except this requested file.

## Findings

### DBG19-01 - Database backup/restore child processes can hang forever while holding restore maintenance and advisory locks

Severity: High
Confidence: High

Code regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:157-183` acquires `LOCK_DB_RESTORE` and spawns `mysqldump`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:205-290` resolves backup only on child `close`, stream error, or spawn error; there is no timeout or abort path.
- `apps/web/src/app/[locale]/admin/db-actions.ts:372-438` begins restore maintenance, quiesces uploads/image processing, and releases locks only after `runRestore()` returns.
- `apps/web/src/app/[locale]/admin/db-actions.ts:560-642` spawns `mysql`, pipes the uploaded dump, and resolves only on `close`, stream error, stdin error, or spawn error; there is no timeout or progress watchdog.
- `apps/web/src/app/[locale]/admin/db-actions.ts:667-693` spawns the post-restore migration script with the same no-timeout pattern.

Failure scenario:

A network partition, wedged MySQL server, stalled TLS handshake, blocked pipe, or hung migration leaves `mysqldump`, `mysql`, or `node scripts/migrate.js` alive without emitting `close` or `error`. Backup holds `LOCK_DB_RESTORE` until the promise resolves. Restore is worse: the request remains inside `runRestore()`, so restore maintenance stays active, the upload-processing contract lock remains held, image processing stays quiesced, and both DB advisory locks remain tied to the pooled connection. Operators then see stale maintenance/restore-in-progress behavior with no automatic recovery.

Suggested fix:

Wrap each child process in a bounded watchdog using `AbortController`/`setTimeout`, kill the process tree on timeout, destroy attached streams, clean temp files, and settle the promise exactly once. For restore, return a failure with `keepMaintenance: true` only when the DB may have been partially modified, but still release advisory/contract locks so a deliberate retry or operator recovery can proceed. Add focused tests that fake a child process which never closes and assert maintenance/locks are unwound according to the chosen policy.

### DBG19-02 - Topic deletion can commit the DB delete, then report failure and skip invalidation if topic-image cleanup fails

Severity: Medium
Confidence: High

Code regions:

- `apps/web/src/app/actions/topics.ts:429-442` deletes the topic row inside a transaction after checking that no images reference the slug.
- `apps/web/src/app/actions/topics.ts:443-448` performs `deleteTopicImage(deletedImageFilename)` after the transaction has already committed.
- `apps/web/src/app/actions/topics.ts:449-460` logs audit, revalidates app data, and returns success only after the file cleanup succeeds.
- `apps/web/src/app/actions/topics.ts:461-469` catches any cleanup error and returns `failedToDeleteTopic`, even though the topic row may already be gone.

Failure scenario:

An admin deletes an empty topic that has a header/resource image. The DB transaction commits successfully. Then the filesystem cleanup fails due to `EACCES`, a transient disk error, a missing resource root, or a race with another cleanup. The action returns a deletion failure, skips audit logging, skips `revalidateAllAppData()`, and leaves the topic image orphaned. The UI can tell the admin the delete failed while the database state says it succeeded, and cached public/admin surfaces may stay stale until another invalidation.

Suggested fix:

Separate the committed DB mutation result from best-effort file cleanup. After a successful row delete, always audit and revalidate. Treat image cleanup failure as a logged cleanup warning/result, or return success with a cleanup warning if the UI needs to surface it. Add a regression that stubs `deleteTopicImage()` to fail and asserts the action does not report the DB delete as failed and still invalidates.

### DBG19-03 - Upload-serving route handlers are the only Node-file routes without an explicit Node runtime pin

Severity: Low
Confidence: High

Code regions:

- `apps/web/src/app/uploads/[...path]/route.ts:1-12` imports `serveUploadFile()` and handles the primary upload `GET` route without `export const runtime = 'nodejs'`.
- `apps/web/src/app/uploads/[...path]/route.ts:15-27` handles the primary upload `HEAD` route without a runtime pin.
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:1-22` repeats the same pattern for the locale-prefixed upload route.
- `apps/web/src/lib/serve-upload.ts:1-5` imports Node-only `fs`, `fs/promises`, `path`, and `stream`.
- `apps/web/src/lib/serve-upload.ts:127-132` is the shared route implementation, and `apps/web/src/lib/serve-upload.ts:269-296` opens a file stream and converts it with `Readable.toWeb()`.
- `apps/web/src/app/api/admin/db/download/route.ts:17-20` documents the local convention: routes importing Node-only modules are pinned to `runtime = 'nodejs'`.

Failure scenario:

Today these routes work under the default Node runtime, but they are runtime-fragile. A future segment-level runtime change, framework default shift, or copied route pattern can compile the upload fallback under Edge, where `fs`, `fs/promises`, and Node streams are unavailable. The break would surface only at deploy/build/runtime for image delivery, not during ordinary TypeScript checks.

Suggested fix:

Add `export const runtime = 'nodejs';` to both upload route handler files and a lightweight guard/test or lint fixture for route handlers that transitively import Node-only serving code. This aligns the primary/locale upload routes with the admin DB download route and makes the runtime contract explicit.

### DBG19-04 - Public numeric route params accept arbitrarily large digit strings and then use unsafe `parseInt()` results

Severity: Low
Confidence: Medium

Code regions:

- `apps/web/src/app/api/search/similar/[id]/route.ts:73-82` validates only `/^\d+$/`, then accepts any finite positive `parseInt()` result.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:51-59` follows the same pattern for OG image IDs.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40-52` and `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:132-140` do the same in metadata and page rendering.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:98-103` parses optional `photoId` similarly and accepts any positive parsed number.
- `apps/web/src/lib/validation.ts:166-191` already documents the exact precision-loss class for MySQL IDs and provides a safe-integer guard for insert IDs, but the public route-param path does not reuse that standard.

Failure scenario:

A request such as `/api/search/similar/9007199254740993` passes the digit regex. `parseInt()` returns an unsafe rounded JavaScript number, and the subsequent `Number.isFinite()`, positive, and integer checks pass. Most current MySQL `int` IDs will produce no row, so the practical impact is limited, but malformed inputs can be rounded into a different numeric value before DB/cache calls. The same class affects photo pages, OG routes, and selected photo IDs in shared galleries.

Suggested fix:

Centralize public ID parsing in a helper that requires a bounded decimal integer, rejects values above `Number.MAX_SAFE_INTEGER`, and ideally rejects values above the schema's actual unsigned/signed integer range. Replace the route-local `parseInt()` patterns with that helper and add malformed huge-ID regression tests for similar search, OG photo, photo page metadata/rendering, and shared-gallery selected-photo routing.

## Final Missed-Issues Sweep

Final sweep covered:

- App-route inventory and runtime exports, with special attention to routes importing Node-only modules and public mutating handlers.
- Server action auth/origin ordering, restore-maintenance checks, transaction boundaries, cleanup after committed mutations, audit logging, and revalidation after state changes.
- Admin API auth wrapper behavior, PAT Lightroom upload handling, multipart/length validation, backup download path validation, and backup/restore external command failure paths.
- Upload browser/API flows: quota preclaim/rollback/settlement, disk checks, topic checks, HDR/GPS gates, original retention paths, queue enqueueing, and delete-during-processing cleanup.
- Image queue interactions: processing claims, stale processing recovery, retry/permanent failure transitions, bootstrap of semantic embeddings, upload-delete races, and restore quiesce/resume hooks.
- Image processing and config: output-size validation, Sharp limits, color/HDR metadata, GPS stripping, derivative generation, and admin setting fallback behavior.
- Public APIs/pages: semantic/similar search gates, public analytics actions, sharing, feed/OG routes, upload serving, pagination/cursor parsing, privacy-sensitive projections, sitemap/feed freshness, and map-specific GPS exposure.
- Data/schema/migrations: Drizzle schema, journal monotonicity, reconcileLegacySchema, admin-only privacy guards, embedding/version gates, smart collection JSON parsing/remapping, and analytics/audit/view retention paths.
- Operational code: deploy script, Docker Compose, nginx config, PWA/service-worker build scripts, model-download/manifest scripts, migration scripts, and route/action lint scripts.

Validation evidence:

- Static review only; I did not run the full lint/typecheck/test/build gates because this assignment requested a review artifact only and no implementation changes.
- Exact line references above were taken from the current workspace during this review.
- Final worktree check before writing showed existing modified review artifacts; this report is the only file intentionally edited in this lane.

Final count:

- High: 1
- Medium: 1
- Low: 2
- Total findings: 4
