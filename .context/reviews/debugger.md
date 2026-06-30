# Cycle 21 Debugger Review

Review lane: `debugger`
Date: 2026-06-30 KST
HEAD reviewed: `1ed96484` (`docs(security): preserve cycle 21 audit evidence`)
Mode: repository-wide latent bug / failure-mode / regression review. No implementation code was changed. No commit or push was made.

## Inventory

Primary guidance and workflow inputs read:
- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`
- Prior review artifacts: `.context/reviews/debugger.md`, `.context/reviews/archive/cycle-21/debugger.md`, `.context/reviews/archive/cycle-21/_aggregate.md`, `.context/reviews/_aggregate.md`

Repository inventory performed before findings:
- Counted current source surface: `api=8`, `actions=14` including `db-actions.ts`, `lib=97`, `components=57`, `scripts=27`, `drizzle=31`, `unit_tests=270`, `e2e=8`, `config=21`.
- Inventoried app routes/actions/components/libs/scripts under `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, `apps/web/scripts`, `apps/web/drizzle`.
- Re-checked prior debugger findings against current HEAD: DB child-process SIGKILL fallback is fixed, smart-collection missing/private load-more no longer refunds after lookup, single-image delete now returns not-found on `deletedRows === 0`, backup download now streams from one validated file handle, topic `order` parsing now uses `Number()`, semantic limits now read env with bounded clamps, and similar-search now checks abort between async phases.
- Focused sweep areas: route prefetch side effects, analytics recording, upload/delete cleanup, atomic image writes, audit/view retention, backup/download streaming, upload serving, queue timers, CLIP scan limits, parser coercion, auth/origin/rate-limit lint coverage, and current source-contract tests.

## Confirmed Findings

### DBG21-01 - Photo hover prefetch can count adjacent photos as viewed

Severity: Medium
Confidence: Medium-High
Status: Confirmed code path; runtime count inflation should be validated with a browser/network trace.

Code regions:
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:154-156` records a photo view during server render.
- `apps/web/src/components/photo-navigation.tsx:220-228` prefetches the previous photo route on hover.
- `apps/web/src/components/photo-navigation.tsx:235-243` prefetches the next photo route on hover.
- `apps/web/src/app/actions/public.ts:370-389` inserts an `image_views` row once `recordPhotoView()` runs.
- Same render-time analytics pattern also exists at `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:105-107`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-164`, and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:127-132`.

Failure scenario:
On a photo page with adjacent images, a desktop user moves the pointer over the Prev/Next controls. `router.prefetch(getPhotoPath(...))` asks Next for the target route payload. The target photo page renders on the server and runs `void recordPhotoView(image.id)` before the user clicks or sees the target photo. That can insert a durable `image_views` row for a non-committed view, inflating analytics and consuming the public view-recording rate-limit budget.

Suggested fix:
Move view recording to a committed client-visible boundary, for example a small client component that calls a dedicated analytics endpoint/action from `useEffect` after hydration and only for the route actually displayed. Until that exists, remove/manual-disable `router.prefetch()` for photo navigation or make the server-side recorder detect and ignore RSC prefetch requests. Add an e2e or route-level regression proving hover prefetch does not write `image_views`.

### DBG21-02 - Audit retention purge still runs as one unbounded DELETE

Severity: Low operational risk
Confidence: High
Status: Confirmed

Code regions:
- `apps/web/src/lib/audit.ts:97-122` computes the cutoff and deletes every matching audit row in one statement.
- `apps/web/src/lib/view-retention.ts:31-87` shows the established bounded chunking pattern for high-volume retention deletes.

Failure scenario:
If audit volume grows, or an operator lowers `AUDIT_LOG_RETENTION_DAYS` after a long-running instance, the hourly cleanup can issue one large `DELETE FROM audit_log WHERE created_at < cutoff`. On MySQL this can hold locks and create a large transaction/binlog burst. The positive-retention parsing is now safe, but the delete shape is still operationally unbounded.

Suggested fix:
Mirror `purgeOldViewEvents()`: delete audit rows in batches with a per-sweep iteration cap, return the deleted count for observability, and extend `audit-retention.test.ts` to lock the chunked behavior.

### DBG21-03 - Upload fallback serving validates by path, then reopens by path

Severity: Low
Confidence: Medium
Status: Residual same-host race; not remotely exploitable without local write access.

Code regions:
- `apps/web/src/lib/serve-upload.ts:175-184` `lstat()`/`realpath()` validate the requested derivative path and containment.
- `apps/web/src/lib/serve-upload.ts:216-257` computes `ETag` and `Content-Length` from that earlier `stats` object.
- `apps/web/src/lib/serve-upload.ts:263-300` later calls `createReadStream(resolvedPath)` by path, not by an already-open descriptor.
- `apps/web/src/app/api/admin/db/download/route.ts:56-75` shows the stronger descriptor-backed pattern now used for backup downloads.

Failure scenario:
A same-host process with write access to `apps/web/public/uploads` replaces a validated derivative file after `serveUploadFile()` has read `stats`/`realpath()` but before `createReadStream(resolvedPath)` opens the path. The response can advertise the old `Content-Length`/`ETag` while streaming bytes from the replacement file. The path validation still prevents traversal and symlink serving, so this is a local filesystem trust-boundary issue, but the backup download route has already moved to descriptor-backed streaming to close the same metadata/body split.

Suggested fix:
Open the validated derivative once and derive `stat`, `ETag`, `Content-Length`, and the response stream from that file descriptor. Keep the existing symlink/non-file/containment checks, then add a unit test modeled after `backup-download-route.test.ts` that proves metadata and bytes are bound to the same opened file.

## Positive Debugging Evidence / Non-Findings

- `apps/web/src/app/[locale]/admin/db-actions.ts:39-77` now tracks `exit`/`close` and sends delayed `SIGKILL` unless the child actually settled; the old `child.killed` bug is gone.
- `apps/web/src/app/actions/public.ts:207-211` no longer rolls back the load-more limiter after a missing/private smart-collection lookup; invalid/private probes remain charged after DB work.
- `apps/web/src/app/actions/images.ts:685-695` now returns `imageNotFound` when a concurrent single-image delete deletes zero rows, before file cleanup/revalidation.
- `apps/web/src/app/api/admin/db/download/route.ts:56-75` now validates, stats, and streams from the same `FileHandle`; the prior path-backed backup download race is closed.
- `apps/web/src/app/actions/topics.ts:108-113` and `:214-219` now use `Number()` plus `Number.isFinite()` for topic ordering; the archived cycle-21 `parseInt('1e3')` finding is fixed and covered.
- `apps/web/src/lib/clip-embeddings.ts:36-44` now reads and clamps `SEMANTIC_SCAN_LIMIT` / `SEMANTIC_TOP_K_MAX`; targeted env tests pass.
- `apps/web/src/app/api/search/similar/[id]/route.ts:82-204` now checks `request.signal` between route phases. The synchronous decode/score loop remains bounded by `SEMANTIC_SCAN_LIMIT`, so I treated it as a scale/perf residual rather than a debugger finding.
- `apps/web/src/lib/data.ts:164-174` now deletes `viewCountRetryCount` entries when post-flush buffer eviction drops a group, closing the stale retry-count sibling.
- I inspected the archived DBG21-02 hard-link/copy concern in `process-image.ts:1391-1418`; current control flow does not re-copy into the already hard-linked temp after a post-link rename failure, so I did not file it as a current defect.

## Validation Evidence

Commands run:
- `npm run lint:api-auth --workspace=apps/web` → 2 admin routes OK.
- `npm run lint:action-origin --workspace=apps/web` → all mutating server actions enforce same-origin provenance; public analytics/load-more/search exemptions are explicit.
- `npm run lint:public-route-rate-limit --workspace=apps/web` → public mutating route scan OK; semantic route uses rate-limit helper.
- `npm test --workspace=apps/web -- topics-actions.test.ts clip-semantic-limits-env.test.ts backup-download-route.test.ts public-actions.test.ts` → 4 files passed, 61 tests passed.

I did not run the full lint/typecheck/build/Vitest/e2e suite because this assignment requested a review artifact only and no implementation changes.

## Final Missed-Issue Sweep

Final sweep covered:
- App route/action inventories, same-origin/auth wrappers, public rate-limit policies, and rollback-after-protected-work behavior.
- Analytics recorders and render/prefetch paths for photo, shared photo, topic, and shared group pages.
- Upload, Lightroom upload, retry, image queue, admin backfill, delete, and restore-maintenance cleanup paths.
- DB backup/restore child processes, file-handle streaming, upload serving, migration/reconcile scripts, Docker/nginx/deploy config, and retention jobs.
- Parser/coercion sites (`parseInt`, `Number`, env integer helpers), timer lifecycles, abort handling, and bounded in-memory maps.
- Prior cycle-21 archived findings and current aggregate findings to avoid re-filing issues already fixed in HEAD.

Final count:
- Medium: 1
- Low: 2
- Total confirmed findings: 3
