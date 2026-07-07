# Run-10 Cycle 6/100 - Code-Reviewer Lane

Date: 2026-07-07
Reviewer: code-reviewer
HEAD reviewed: `423fa6c1f599a267d80738271152e7f6f7968598`
Mode: repository-wide read-only review except this artifact. No source files were modified.

## Inventory First

Review-relevant inventory built before findings:

- Instructions and context: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/plans/README.md`, current `.context/reviews/_aggregate.md`, top-level reviewer mirrors, and Cycle 5 plan/deferred artifacts.
- Source surface: 604 files under `apps/web/src`, including 344 unit/source-contract test files.
- Operational surface: 29 `apps/web/scripts` files, 33 Drizzle migration/journal files, `Dockerfile`, `docker-compose.yml`, `nginx/default.conf`, `next.config.ts`, `public/sw.template.js`, generated `public/sw.js`, and 12 e2e/fixture files.
- Recent implementation delta reviewed from Cycle 5 start `591b44bd` to current `423fa6c1`: maintenance scheduler extraction, background analytics queue, semantic embedding bootstrap cap, sidecar color-backfill paging, feed/sitemap indexes, service-worker lifetime coverage, LR upload route tests, CSP/docs dispositions, migration reconcile updates, and Cycle 5 ledgers.

Static/code paths read in depth:

- Restore and mutation fencing: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/instrumentation.ts`.
- Queue/backfill/processing: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/process-image.ts` scan points.
- Public/search/semantic/LR routes: `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, matching tests.
- Schema/privacy/gates: `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, Drizzle journal, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, security lint scripts.

Validation run:

- `git diff --check HEAD` - clean.
- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm test --workspace=apps/web -- maintenance-scheduler-source background-db-writes image-queue-embedding-bootstrap-cap sw-template-contract migrate-reconcile-coverage migration-journal-monotonicity` - 6 files / 131 tests passed.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 1 confirmed
- Low: 0
- Likely issues: 0
- Risks needing validation: 3

## Confirmed Issues

### CQR6-01 - Independent maintenance sweeps can write during a DB restore window

- Severity: Medium
- Confidence: High
- Status: Confirmed source defect
- Files/regions:
  - `apps/web/src/lib/maintenance-scheduler.ts:13-26`
  - `apps/web/src/lib/maintenance-scheduler.ts:28-36`
  - `apps/web/src/instrumentation.ts:1-10`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:538-556`
  - `apps/web/src/lib/restore-maintenance.ts:21-26`

Problem:

Cycle 5 correctly moved session/rate-limit/audit/view-retention sweeps out of `image-queue.ts`, but the new `runMaintenanceSweep()` executes four DB-mutating purges without consulting `isRestoreMaintenanceActive()`. `instrumentation.register()` starts the scheduler before `bootstrapImageProcessingQueue()`, so the startup sweep and hourly interval are now independent of queue bootstrap and can run even while durable restore maintenance is active. The restore path drains shared-group view-count writes, image queue work, background DB writes, and foreground admin mutation slots before `runRestore()`, but it has no ownership of this scheduler and cannot drain or block its deletes.

Concrete failure scenario:

1. A restore starts and sets the durable/process restore-maintenance marker.
2. `restoreDatabase()` reaches the preparation section and drains queue/background/admin writes (`db-actions.ts:538-556`).
3. The hourly scheduler fires, or a process boots during a stale/active restore marker and runs the startup sweep.
4. `runMaintenanceSweep()` launches `DELETE` work against `sessions`, `rate_limit_buckets`, `audit_log`, and analytics view tables while the restore import expects an exclusive write window. At best this creates avoidable lock contention or deadlocks during import; at worst it mutates the just-restored snapshot outside the restore lifecycle and breaks the documented "no writes during restore" invariant.

Suggested fix:

Make maintenance restore-aware. Import `isRestoreMaintenanceActive()` into `maintenance-scheduler.ts` and return before scheduling purge work when maintenance is active. Re-check inside each purge or before each async call so a marker that flips after the sweep starts stops later writes. After restore completes, explicitly run or allow the next scheduler tick to run a catch-up sweep. Add a behavior/source test that fails if `runMaintenanceSweep()` lacks the restore-maintenance guard, not only the current ownership test that verifies the scheduler moved out of `image-queue.ts`.

## Likely Issues

None. I did not find another repository-wide code-quality or logic issue with enough evidence to classify as likely. The areas that looked suspicious from stale Cycle 5 text were rechecked against current HEAD and are either fixed or intentionally tracked as risks below.

## Risks Needing Validation

### RISK-CQR6-01 - Analytics queue drops admitted writes at capacity by design

- Severity: Low-Medium risk
- Confidence: Medium
- Files/regions: `apps/web/src/lib/background-db-writes.ts:42-75`, `apps/web/src/app/actions/public.ts:436-525`.
- Risk: `trackAnalyticsDbWrite()` returns `undefined` when `active + queued >= 1000`, after the public action has already charged the view-record rate limit and validated the target. This is an acceptable overload policy if intentional, but it means admitted page views can be silently dropped under distributed traffic. Keep the cap/drop policy documented and add metrics/log sampling if operators need analytics completeness.

### RISK-CQR6-02 - CLIP production behavior remains outside default CI

- Severity: Medium manual-validation risk
- Confidence: High
- Files/regions: `apps/web/src/lib/clip-model.ts:200-229`, `apps/web/src/app/api/search/semantic/route.ts:186-204`, `apps/web/src/__tests__/clip-offline-load.test.ts`, `apps/web/src/__tests__/clip-semantic-integration.test.ts`.
- Risk: real model load/ranking requires seeded weights and explicit env flags, so default unit gates cannot prove production semantic search. This is already documented, but any future CLIP path/provider/model change should include the manual offline-load and integration gates before production enablement.

### RISK-CQR6-03 - Source-contract tests still dominate the restore/LR failure-mode surface

- Severity: Medium test-risk
- Confidence: Medium
- Files/regions: `apps/web/src/app/[locale]/admin/db-actions.ts:403-933`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-609`, `apps/web/src/__tests__/db-restore.test.ts`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts`.
- Risk: Cycle 5 added useful LR route behavior coverage, but the restore path still has many child-process/lock/marker cleanup branches that are mostly guarded by source shape. The current source is careful; the residual risk is regression detection. Extracting or injecting the child-process runner remains the cleanest way to test timeout, stream error, nonzero close, and post-migration failure cleanup directly.

## Non-Findings / Closed Stale Candidates

- Cycle 5 CQR5-01 is fixed in source ownership: `startMaintenanceScheduler()` is called from instrumentation and `image-queue.ts` no longer owns `purgeExpiredSessions`. CQR6-01 is a new edge introduced by that extraction, not a duplicate of the old coupling issue.
- Semantic embedding bootstrap now clamps each query to remaining scan budget with `batchLimit = Math.min(..., remainingScanBudget)` in `image-queue.ts:568-590`; the targeted cap tests passed.
- Sidecar color backfill now keyset-pages candidates with `id > lastCandidateId` and `LIMIT BATCH_SIZE` in `backfill-color-pipeline.ts:409-427`; the in-app runner has the same keyset shape.
- Feed/sitemap updated-order indexes are present in migration `0029`, Drizzle schema, and `reconcileLegacySchema`; journal `when` is monotonic above `0028`.
- `sw.template.js` and generated `sw.js` both include `extendLifetime(event, promise)` around stale image revalidation; the template/generated contract test passed.
- Admin API auth, server-action origin, and public route rate-limit lint gates passed on current HEAD.

## Final Skipped-File / Common-Missed-Issues Sweep

- Skipped generated/dependency bulk: `node_modules`, `.next`, screenshots, binary fixtures, uploaded assets, fonts, and icons. Generated `apps/web/public/sw.js` was checked against the template because it is served.
- Checked common missed surfaces: migration journal/reconcile parity, admin-only privacy field guards, API auth wrappers, action origin guards, public route rate limits, restore-maintenance gates, queue/backfill concurrency, service-worker lifetime, content-length parsing, `parseInt` hotspots, `as any`/suppression scans, and stale review carry-forward items.
- No source files were edited. The only write is this review artifact.
