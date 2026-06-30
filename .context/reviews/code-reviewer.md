# Cycle 28 Code Review

Reviewer: cycle-28 code-reviewer  
Repo: `/Users/hletrd/flash-shared/gallery`  
HEAD reviewed: `395de19bf474f729fac15f693f260c1190428842`  
Date: 2026-06-30 KST

## Inventory

Read first and treated as review constraints:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/_aggregate.md`
- Prior `.context/reviews/code-reviewer.md`
- `README.md`
- `apps/web/README.md`

Tracked review-relevant code/config/docs inventoried and included in the sweep:

| Area | Coverage |
| --- | ---: |
| `apps/web/src/**/*` source, tests, app routes, server actions, components, libraries | all tracked files |
| `apps/web/scripts/**/*` operator/build/migration scripts | all tracked files |
| `apps/web/drizzle/**/*` migrations and Drizzle metadata | all tracked files |
| `apps/web/e2e/**/*` Playwright specs/helpers/fixtures | all tracked files |
| Root and app configs (`package.json`, `next.config.ts`, TS configs, Vitest, Playwright, Docker, NGINX) | all tracked files |
| PWA/service-worker sources (`apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `scripts/build-sw.ts`) | all tracked files |
| Current review/plan history under `.context/reviews` and `.context/plans` | reviewed for stale/deferred issue dedupe |

Inventory commands produced 3,852 review-relevant filesystem entries after excluding `.git`, `node_modules`, `.next`, test reports, and `.claude/worktrees`. The tracked app/script/migration/e2e surface was 586 files; the TypeScript/JavaScript/SQL app surface under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, and `apps/web/e2e` was 574 files / 87,125 lines.

Manual line-level inspection focused on the cross-file interactions most relevant to quality and logic risk:

- Restore lifecycle: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/scripts/restore-maintenance-recovery.{mjs,ts}`, `apps/web/src/instrumentation.ts`
- Public analytics and data flushing: `apps/web/src/app/actions/public.ts`, public photo/topic/share pages, `apps/web/src/lib/data.ts`, `apps/web/src/__tests__/public-actions.test.ts`, `apps/web/src/__tests__/data-view-count-flush.test.ts`
- Upload/image processing: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, upload/dropzone component, upload and queue tests
- Auth/action/API gates: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/proxy.ts`, lint scripts for API auth/action origin/public rate limits
- Privacy/search/semantic surfaces: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, semantic API routes, CLIP model/embedding libraries, privacy and semantic tests
- Service worker/offline cache: `apps/web/public/sw.template.js`, generated `sw.js`, SW contract tests, cache helpers
- Migrations/schema/operator scripts: Drizzle SQL/meta, `apps/web/scripts/migrate.js`, reconcile/migration tests, backfill scripts and tests

Generated/build/cache directories and binary fixture contents were not manually read byte-for-byte; their references, tracked metadata, and source contracts were included where relevant. No review-relevant source, config, migration, test, or documentation file in the current tracked surface was intentionally skipped.

## Findings

### C28-CODE-MED-01 - Public analytics inserts can still cross the restore-maintenance boundary

Classification: Likely issue  
Severity: Medium  
Confidence: Medium

Regions:

- `apps/web/src/app/actions/public.ts:408-437`
- `apps/web/src/app/actions/public.ts:443-469`
- `apps/web/src/app/actions/public.ts:475-505`
- `apps/web/src/app/[locale]/admin/db-actions.ts:491-495`
- `apps/web/src/__tests__/public-actions.test.ts:241-253`
- `apps/web/src/__tests__/public-actions.test.ts:327-342`

Problem:
The public view recorders intentionally schedule direct analytics inserts without awaiting or tracking them. Each recorder checks `isRestoreMaintenanceActive()` before and after target validation, but the actual `db.insert(...).values(...).catch(...)` runs independently after that last check. Restore maintenance drains `flushBufferedSharedGroupViewCounts()` and `quiesceImageProcessingQueueForRestore()` before import, but there is no equivalent drain or pause for already-scheduled direct inserts into `image_views`, `topic_views`, or `shared_group_views`.

Concrete failure scenario:
A public photo/topic/share render starts just before an admin DB restore. The recorder passes the maintenance checks at `public.ts:418` and `public.ts:428` (or the sibling topic/group checks), then schedules the insert at `public.ts:430-437`. The admin restore then enters maintenance and proceeds after draining only the buffered shared-group counter and image queue at `db-actions.ts:491-495`. The detached analytics insert can land during the `mysql` import or just after the restored snapshot is loaded, creating analytics rows that belong to the pre-restore request rather than the restored DB state. The tests currently pin the non-blocking behavior and the pre-insert maintenance checks, but they do not prove a restore-start drain for inserts already handed to the DB promise chain.

Suggested fix:
Move public analytics writes behind a tiny tracked recorder similar to the image queue/shared counter drains: increment an in-flight counter before scheduling the insert, re-check the durable maintenance marker immediately before the write, and expose `quiescePublicAnalyticsForRestore()` for `db-actions.ts` to await after `beginDurableRestoreMaintenance()`. If strict non-blocking page rendering is still required, keep the render detached but make the detached work observable and drainable by restore maintenance. Add a regression test where maintenance begins after target validation but before the tracked insert resolves.

### C28-CODE-LOW-01 - Browser upload audit metadata undercounts RAW rejects in multi-file server-action calls

Classification: Confirmed issue  
Severity: Low  
Confidence: High

Regions:

- `apps/web/src/app/actions/images.ts:558-575`
- `apps/web/src/app/actions/images.ts:595-610`
- `apps/web/src/app/actions/images.ts:615-626`
- `apps/web/src/__tests__/images-actions.test.ts:299-306`

Problem:
`uploadImages()` tracks RAW rejections separately from generic failures. It correctly computes `totalFailures = failedFiles.length + rawRejectedCount` and returns `rawRejectedCount` / `rawRejectedFiles` to the caller, but the audit event records only `failed: failedFiles.length`. A mixed multi-file server-action call with at least one success and one RAW reject therefore writes an `image_upload` audit row that says zero failed files even though the action returned a RAW rejection warning.

Concrete failure scenario:
An operator or future client submits one `FormData` containing `photo.jpg` and `raw.nef`. The JPEG succeeds, the RAW path increments `rawRejectedCount`, and the action returns success with a RAW warning. The audit row at `images.ts:605-610` records `{ count: 1, failed: 0 }`, so later incident/audit review cannot reconcile the UI warning or returned `rawRejectedFiles` with the audit log. The current browser dropzone sends one file per action call, which reduces normal UI exposure, but the server action itself still accepts multiple `files` entries and has multi-file accounting.

Suggested fix:
Record a total failure count in audit metadata, for example `failed: failedFiles.length + rawRejectedCount`, and include `rawRejectedCount` / sanitized RAW filenames if the audit log is expected to explain rejection categories. Add a unit test for a mixed success-plus-RAW FormData call so the action return and audit metadata stay consistent.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed
- `npm run lint:action-origin --workspace=apps/web` - passed
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed
- `npm run typecheck --workspace=apps/web` - passed
- `npm run lint --workspace=apps/web` - passed
- `npm test --workspace=apps/web` - passed: 270 test files, 2 skipped; 2,528 tests passed, 4 skipped
- `find`/`git ls-files` inventory sweeps for tracked source, tests, scripts, migrations, docs, configs, and review history
- `rg` sweeps for analytics recorders, unawaited writes, audit events, restore/backfill/runbook terms, TODO/FIXME/BUG markers, skipped/focused tests, and stale cycle-27 findings
- `git diff`/source inspection confirmed the cycle-27 SQL restore scanner and maintenance recovery findings are fixed in the current source and were not refiled

`npm run test:e2e --workspace=apps/web` was not run because this was a code-quality review and the identified issues are server-action/race/accounting defects covered better by targeted unit/source-contract tests.

## Final Sweep Confirmation

Final sweep covered restore/backup, public analytics, upload/LR upload, image queue/backfill, auth/session/API gates, public route rate limits, data privacy selects, search/semantic routes, service worker cache behavior, migration/reconcile scripts, schema/journal metadata, tests, configs, and current `.context` review/plan history. No relevant file from the tracked code/config/test/migration/documentation surface was skipped. Stop condition met: report written with exact regions, concrete failure scenarios, fixes, severity, confidence, validation evidence, and stale prior-cycle findings deduplicated.
