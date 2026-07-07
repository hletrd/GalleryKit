# Debugger Review - Cycle 11

Date: 2026-07-07 KST
Reviewer lane: debugger
HEAD reviewed: `18b2a0c3`
Scope: latent bug surface, failure modes, regressions, edge cases, exception/error handling, and cross-file behavior across the Gallery repo.
Execution constraints honored: review-only; no application source or plan edits; no commit, push, deploy, service stop, file deletion, or database mutation. The only written file is this review artifact.

## Result Summary

- Active confirmed defects: 0
- Active likely/manual findings: 0
- Prior finding rechecked: 1 previously confirmed migration-path defect is now covered by current source and tests.
- Validation run:
  - `npm run lint:api-auth --workspace=apps/web` passed.
  - `npm run lint:action-origin --workspace=apps/web` passed.
  - `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
  - `npm run test --workspace=apps/web -- migrate-pending-migrations` passed: 1 file, 20 tests.

No new severity-rated debugger finding met the reporting bar after inventory, cross-file inspection, and final missed-issue sweep.

## Inventory

Read first:

- AGENTS instructions supplied for `/Users/hletrd/flash-shared/gallery`.
- `CLAUDE.md`.
- Code review skill instructions at `/Users/hletrd/.agents/skills/code-review/SKILL.md`.

Repository surfaces inventoried:

- App routes/pages/actions under `apps/web/src/app`, including public gallery routes, admin pages, admin DB restore/backup actions, public API routes, admin API routes, upload serving routes, and root/locale feeds.
- Core library files under `apps/web/src/lib`, including auth/session/origin/rate-limit helpers, image queue, image processing, upload path handling, restore maintenance, mutation barrier, gallery config, semantic search, data reads, revalidation, service-worker cache, storage, and migration-adjacent helpers.
- DB schema and migrations under `apps/web/src/db`, `apps/web/drizzle`, and `apps/web/scripts/migrate.js`.
- Focused tests and source-contract tests around migration tail handling, auth/origin/rate-limit enforcement, failed-image retry, image queue settings, privacy fields, semantic search gating, restore/upload locking, and service-worker/cache behavior.

High-risk paths inspected in detail:

- Admin authentication and origin controls: `apps/web/src/lib/api-auth.ts:72`, `apps/web/src/lib/api-auth.ts:114`, `apps/web/src/lib/action-guards.ts:20`, `apps/web/src/app/actions/auth.ts:132`, `apps/web/src/lib/session.ts:45`, `apps/web/src/lib/request-origin.ts:1`, `apps/web/src/lib/rate-limit.ts:1`.
- Mutating server actions and admin barriers: `apps/web/src/app/actions/images.ts:129`, `apps/web/src/app/actions/images.ts:687`, `apps/web/src/app/actions/images.ts:959`, `apps/web/src/app/actions/images.ts:1163`, `apps/web/src/app/actions/settings.ts:73`, `apps/web/src/app/actions/topics.ts:65`, `apps/web/src/app/actions/sharing.ts:30`, `apps/web/src/lib/admin-mutation-barrier.ts:76`.
- Upload and processing pipeline: `apps/web/src/app/actions/images.ts:198`, `apps/web/src/app/actions/images.ts:478`, `apps/web/src/app/actions/images.ts:527`, `apps/web/src/app/api/admin/lr/upload/route.ts:272`, `apps/web/src/app/api/admin/lr/upload/route.ts:500`, `apps/web/src/app/api/admin/lr/upload/route.ts:528`, `apps/web/src/lib/image-queue.ts:690`, `apps/web/src/lib/image-queue.ts:714`, `apps/web/src/lib/image-queue.ts:965`, `apps/web/src/lib/image-queue.ts:1105`, `apps/web/src/lib/process-image.ts:889`, `apps/web/src/lib/upload-paths.ts:103`.
- Restore, migration, and fencing behavior: `apps/web/src/app/[locale]/admin/db-actions.ts:430`, `apps/web/src/app/[locale]/admin/db-actions.ts:447`, `apps/web/src/app/[locale]/admin/db-actions.ts:550`, `apps/web/src/lib/restore-maintenance.ts:1`, `apps/web/src/lib/restore-maintenance-durable.ts:48`, `apps/web/src/lib/upload-processing-contract-lock.ts:1`, `apps/web/scripts/migrate.js:460`, `apps/web/scripts/migrate.js:843`, `apps/web/scripts/migrate.js:858`, `apps/web/scripts/migrate.js:901`.
- Public read and search surfaces: `apps/web/src/lib/data.ts:610`, `apps/web/src/lib/data.ts:925`, `apps/web/src/lib/data.ts:1289`, `apps/web/src/lib/data.ts:1454`, `apps/web/src/lib/data.ts:1574`, `apps/web/src/lib/data.ts:1759`, `apps/web/src/app/actions/public.ts:72`, `apps/web/src/app/api/search/semantic/route.ts:192`, `apps/web/src/app/api/search/similar/[id]/route.ts:122`.
- Download/serving/cache paths: `apps/web/src/app/api/admin/db/download/route.ts:1`, `apps/web/src/lib/serve-upload.ts:1`, `apps/web/src/app/uploads/[...path]/route.ts:1`, `apps/web/src/lib/sw-cache.ts:1`, `apps/web/src/components/register-service-worker.tsx:1`.

## Findings

No active findings.

All candidate defects either had current source-level mitigation, existing regression coverage, or remained below the confidence threshold for a debugger finding. No issue is reported without a concrete failure scenario, root-cause hypothesis, fix, severity, confidence, and validation label.

## Rechecked Prior Defect

### DBG-C9-01 migration tail failure - no longer active

Severity if absent: High
Confidence: High
Validation label: confirmed fixed by source inspection plus targeted test

Relevant file regions:

- Historical migration still references `failed_at`: `apps/web/drizzle/0025_processing_settings_snapshot.sql:1`.
- Current preflight creates the prerequisite columns before Drizzle applies pending 0025: `apps/web/scripts/migrate.js:843-856`.
- Pending-tail path invokes that preflight before returning to Drizzle: `apps/web/scripts/migrate.js:901-910`.
- Reconcile still mirrors the final schema for fresh/baseline cases: `apps/web/scripts/migrate.js:478-481`.
- Regression coverage exists: `apps/web/src/__tests__/migrate-pending-migrations.test.ts:113`.

Reproduction/failure scenario rechecked:

1. A healthy DB cursor sits at 0024 and lacks `images.processing_error` / `images.failed_at`.
2. 0025 is pending and still adds `processing_settings_json` `AFTER failed_at`.
3. Current `prepareLegacyDatabaseIfNeeded()` computes the pending tail, calls `ensureHistoricalPendingMigrationPrerequisites()`, idempotently creates `processing_error` and `failed_at`, then lets Drizzle apply 0025.
4. Targeted test `migrate-pending-migrations` passed and includes the historical 0025 pre-create case.

Root-cause hypothesis of the old bug:

- `processing_error` and `failed_at` originally existed only in the reconcile path, while 0025 assumed `failed_at` already existed.

Concrete current status:

- No source fix is currently required. The preflight path is the concrete fix and is covered by the targeted migration test.

## Rejected Candidates

- Upload accepted while restore starts: rejected. Restore takes `LOCK_UPLOAD_PROCESSING_CONTRACT` before durable maintenance and admin mutation drain (`db-actions.ts:430-574`), while browser and Lightroom uploads hold the same lock through insert/enqueue (`images.ts:198-650`, `route.ts:272-574`).
- Ignored `enqueueImageProcessing()` return in normal uploads: below finding bar. The queue rejects during shutdown/maintenance/invalid metadata/permanent failure (`image-queue.ts:690-705`); uploads are blocked by restore maintenance and the upload contract lock, generated filenames satisfy queue metadata validation, and unprocessed rows are bootstrapped on startup (`image-queue.ts:1105-1173`).
- Public API origin/rate-limit drift: rejected by source inspection and lint gates. Admin API wrapping, mutating server-action origin guards, and public route rate-limit scanners all passed.
- Public privacy leakage through data select sets: rejected by current omit blocks and symmetric privacy fixtures inspected around `data.ts` plus existing privacy-field test coverage.
- Semantic search accidentally enabling production mode: rejected. Runtime config resolves production only behind `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, routes recheck `semanticSearchMode`, and queue embedding writes apply the same runtime gate.
- Shared group view count overcount on selected image navigation: rejected. `getSharedGroup()` skips increments for valid selected-photo navigation and buffers only group-view lookups (`data.ts:1402-1407`).

## Final Missed-Issue Sweep

- Searched exception and swallow patterns: `catch {}`, `.catch(() => {})`, `throw new Error`, `console.error`, `TODO`, and `FIXME` across `apps/web/src` and `apps/web/scripts`; inspected the high-risk hits rather than treating cleanup/file-delete/test helpers as findings.
- Rechecked migration and schema drift paths: journal cursor handling, fresh DB baseline, current-schema reconcile, historical 0025 preflight, postcondition hash checks, and migration tests.
- Rechecked admin mutation controls: `withAdminAuth`, same-origin server-action guards, admin mutation barrier, restore maintenance marker, upload processing contract lock, and Lightroom token path.
- Rechecked image failure handling: per-image advisory lock retries, claim exhaustion persistence, permanent failure persistence, retry clearing, bootstrap resume, settings snapshot capture, and shutdown drain.
- Rechecked public read/search paths: list pagination, smart collections, search/semantic/similar routes, share/group access, map GPS guard, sitemap caps, and public analytics side effects.
- Rechecked cache/download paths: upload serving, original/private path fallback, backup download route, service-worker cache policy, and ETag/settings hash behavior.

## Residual Risk

- This was a source-review/debugger lane, not a full release verification run.
- I did not run the full Vitest suite, full typecheck, Next build, Playwright E2E, or a real MySQL migration fixture.
- Unrelated source files were already modified in the worktree during review (`apps/web/src/components/ui/sonner.tsx`, `apps/web/src/components/ui/table.tsx`); they were not edited or evaluated as part of this assigned artifact.
