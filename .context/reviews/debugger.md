# Debugger Review - Cycle 6 Prompt 1

Date: 2026-07-07 KST
HEAD reviewed: `c5d6b27e`
Scope: latent bug surfaces, failure modes, regressions, edge cases, async/race hazards, null/undefined assumptions, and deployment/runtime breakages. Review-only; no source code edits or commits.

## Inventory

Inventoried before detailed inspection:

- Review contract and repo guidance: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/prompts/debugger.md`, `.context/reviews/prompts/common_review_scope.md`.
- Current cycle context and prior findings: `.context/reviews/_aggregate.md`, `.context/reviews/debugger.md` from cycle 5, current `perf-reviewer.md` and `security-reviewer.md`, plus recent commits through `c5d6b27e`.
- Restore and mutation fences: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`.
- Auth/session mutation paths: `apps/web/src/app/actions/auth.ts`, password/login UI callers, session schema and migration FK wiring.
- Upload/process/backfill concurrency: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`.
- Runtime lifecycle and background work: `apps/web/src/instrumentation.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/lib/background-db-writes.ts`, shared-group view flushing in `apps/web/src/lib/data.ts`.
- File/OG serving and cache paths: `apps/web/src/lib/serve-upload.ts`, upload route handlers, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`, service-worker template.
- Schema/deploy/package surfaces: `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, latest migration `0029_feed_updated_indexes.sql`, `apps/web/Dockerfile`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, package manifests.

## Confirmed Issues

### DBG-C6-01 - Medium - Password-change auth mutations are outside the restore mutation barrier

Severity: Medium
Confidence: High

Evidence:
- The restore flow sets durable restore maintenance, quiesces background queues, then drains foreground admin mutations before importing the SQL dump: `apps/web/src/app/[locale]/admin/db-actions.ts:538-556`.
- That drain only sees actions that hold a slot from `acquireAdminMutationSlot()`; the barrier counts `inFlight`, blocks new slots with `exclusiveActive`, and resolves when slot holders dispose: `apps/web/src/lib/admin-mutation-barrier.ts:76-129`.
- Most mutating admin actions follow that pattern, for example `uploadImages()` checks maintenance/origin and acquires the slot before continuing: `apps/web/src/app/actions/images.ts:129-143`.
- `updatePassword()` is a mutating admin action but has no barrier slot. It checks same-origin, reads current user, checks maintenance once, then later updates `admin_users.password_hash`, deletes sessions, and inserts a new session in one transaction: `apps/web/src/app/actions/auth.ts:290-410`.
- `auth.ts` imports restore maintenance but not the mutation barrier: `apps/web/src/app/actions/auth.ts:12-22`.

Failure scenario:
1. An admin submits a password change and passes the one-time maintenance check at `apps/web/src/app/actions/auth.ts:303-306`.
2. The action spends time in Argon2 verification/hash generation at `apps/web/src/app/actions/auth.ts:382-390`.
3. During that window, another admin starts DB restore. Restore sets the durable marker and drains admin mutation slots, but this password-change action is invisible to the drain.
4. Restore imports the backup, then the password-change transaction commits against the restored database at `apps/web/src/app/actions/auth.ts:399-410`.

Result: restored `admin_users` and `sessions` state can be overwritten by a mutation that was admitted before the restore window. This is the exact failure class the new barrier is meant to prevent for non-auth admin actions.

Concrete fix:
- Add `acquireAdminMutationSlot()` to `updatePassword()` with the same lifetime pattern used by other mutating admin actions: acquire immediately after origin/maintenance admission and before any long awaits or Argon2 work, return `restoreInProgress` if not acquired, and let `using` release on every exit path.
- Consider the same fence or a dedicated auth-session fence for `login()` and `logout()` session writes (`apps/web/src/app/actions/auth.ts:208-230`, `apps/web/src/app/actions/auth.ts:267-287`) so session-table writes cannot land mid-restore either. The password-change path is the higher-impact confirmed case because it mutates `admin_users`.
- Add a source or behavior regression test that `updatePassword()` imports and uses `acquireAdminMutationSlot()` before the password transaction.

## Likely Issues

### DBG-C6-02 - Low - Upload stream abort listener is never explicitly removed on normal completion

Severity: Low
Confidence: Medium-low

Evidence:
- GET upload routes pass the request `AbortSignal` into `serveUploadFile()`: `apps/web/src/app/uploads/[...path]/route.ts:7-15` and `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:7-15`.
- `serveUploadFile()` creates a file stream and registers a one-shot abort listener that closes over that stream: `apps/web/src/lib/serve-upload.ts:330-360`.
- The normal response path returns the converted web stream without any visible `removeEventListener` on stream `close`, `end`, or `error`: `apps/web/src/lib/serve-upload.ts:362-366`.

Failure scenario:
Under normal browser image loads the body stream finishes successfully, so the file descriptor should close through `autoClose` / `Readable.toWeb()`. If the runtime keeps the request `AbortSignal` object reachable longer than the body stream, the one-shot listener can retain the already-closed stream object until request GC. This is not an observed fd leak, but it is an avoidable retention edge on a high-volume image-serving path.

Concrete fix:
- Store the abort handler in a named function and remove it on `fileStream.once('close' | 'end' | 'error', cleanup)`, while keeping the current `{ once: true }` behavior for actual aborts.
- Add a focused unit/source test around listener cleanup if `AbortSignal` can be mocked cleanly.

## Risks Requiring Manual Validation

### DBG-C6-03 - Medium - Restore child-process failure behavior is still mostly source-shape tested

Severity: Medium validation risk
Confidence: Medium

Evidence:
- Restore uses a watchdog that destroys stdio, sends `SIGTERM`, and then schedules `SIGKILL`: `apps/web/src/app/[locale]/admin/db-actions.ts:42-80`.
- The mysql import path has multiple event-driven exits: read stream error, stdin error, spawn error, timeout, nonzero close, successful close followed by post-restore migration: `apps/web/src/app/[locale]/admin/db-actions.ts:760-848`.
- Current restore tests assert many important source strings and helper behavior, but the child-process cleanup checks are still textual rather than simulated child-process behavior: `apps/web/src/__tests__/db-restore.test.ts:47-75`, `apps/web/src/__tests__/restore-upload-lock.test.ts:48-91`.

Failure scenario:
A timeout, `mysql` spawn error, stream error, or post-restore migration failure can leave the system in different intended states: sometimes maintenance must remain active, sometimes queues should resume, and all locks/temp files should be cleaned. A source-shape test can pass while one event ordering leaks a marker, resolves twice, resumes too early, or misses temp cleanup.

Concrete fix:
- Extract a small injectable child-process runner for restore/import/migrate and behavior-test: nonzero close, timeout kill, stdin EPIPE, read-stream error, spawn error, and post-migration failure.
- Assert final state for each case: durable marker kept/cleared, upload/backfill/restore locks released, queue resumed only when intended, temp file cleanup called, and response shape.

## Final Sweep

Checked and did not promote:

- Cycle-5 sidecar full-table materialization is fixed: `apps/web/scripts/backfill-color-pipeline.ts:409-427` now keyset-fetches `LIMIT ${BATCH_SIZE}`, and `apps/web/scripts/backfill-color-pipeline.ts:573-583` processes page-by-page.
- Maintenance scheduling is now independent from image queue bootstrap: `apps/web/src/instrumentation.ts:7-10` starts `maintenance-scheduler.ts`, and queue bootstrap only keeps queue-local GC: `apps/web/src/lib/image-queue.ts:1233-1241`.
- Analytics writes are now bounded and callers catch fire-and-forget failures: `apps/web/src/lib/background-db-writes.ts:34-75`, `apps/web/src/app/actions/public.ts:450-457`, `apps/web/src/app/actions/public.ts:482-489`, `apps/web/src/app/actions/public.ts:518-525`.
- Feed/sitemap freshness indexes are mirrored in migration, schema, and reconcile: `apps/web/drizzle/0029_feed_updated_indexes.sql:1-3`, `apps/web/src/db/schema.ts:120-122`, `apps/web/scripts/migrate.js:705-707`.
- Lightroom upload route has at least one real route behavior test for late HDR rejection cleanup/settlement: `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:172-199`.
- Route params/searchParams generally follow the async Next 16 shape; sampled public/API dynamic routes await `params`/`searchParams`.

No critical/high runtime defect was confirmed in this pass. I did not run the full quality gates because this lane was a static review-only task; findings above are grounded in source inspection with exact regions.
