# Cycle 17 Code-Reviewer Review

Date: 2026-07-08 KST

Mode: whole-repository code review from code quality, logic, SOLID, maintainability, correctness, and cross-file interaction angles. This lane did not implement fixes; the only write is this report.

## Scope And Inventory

Instructions and project context read before judging behavior:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `apps/web/README.md`
- Current Cycle 16 aggregate/plan/deferred files used as recent review history, not as live runtime truth.

Review-relevant inventory built first:

- 695 review-relevant app/script/migration/e2e text files under `apps/web/src`, `apps/web/scripts`, `scripts`, `apps/web/e2e`, and `apps/web/drizzle`.
- 683 repo/document/config text files at shallow project scope, excluding dependency/build outputs.
- Source breakdown: 81 app route/action/admin files, 61 components, 114 library modules, 3 DB modules, 1 i18n module, 361 unit-test files, 12 e2e files, 28 scripts, 33 migration/meta files, and 5 other source files.
- TypeScript/JavaScript application/script/e2e surface: 107,782 lines.
- Migrations: 30 SQL migrations plus Drizzle journal/meta; journal currently has 30 entries and the latest entry is `0029_feed_updated_indexes`.

Files and interactions examined directly or by full-surface targeted sweeps:

- Admin/session/PAT auth, API wrappers, same-origin action guards, public route rate-limit contracts, route handlers, server actions, DB backup/restore, upload/LR-upload, upload quota/processing locks, image queue, color and semantic backfills, restore maintenance fences, public data selectors/privacy guards, sitemap/feed/OG/search routes, service worker/cache helpers, storage helpers, migrations, CI/deploy scripts, package/workflow config, current plans/reviews, and test contracts.
- Binary fixtures, icons/fonts, generated images, `node_modules`, build output, and historical review/plan archives were not treated as live runtime behavior except where they affect current project guidance.

## Validation Evidence

Read-only/static validation run:

- `npm run lint:api-auth --workspace=apps/web` - PASS.
- `npm run lint:action-origin --workspace=apps/web` - PASS.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - PASS.

Additional sweeps:

- Route export/auth/rate-limit inventory across all route handlers.
- Server-action guard inventory across all action files.
- Raw SQL/advisory lock/connection acquisition/release scan.
- Privacy selector and sensitive-field scan.
- Secret-string, URL/fetch/JSON-LD, filesystem, child-process, queue/concurrency, migration/journal, and recent-commit diff scans.

Not run:

- Full ESLint, typecheck, build, full Vitest, or Playwright. Cycle 16 plan records those gates as green at `fc15b235`; this review lane only re-ran the three custom guard scripts.

## Findings Summary

- Confirmed issues: 2
- Likely issues: 1
- Manual-validation risks: 1

## Confirmed Issues

### 1. DB backup and restore actions can throw outside their typed action result on connection/setup failure

- Location: `apps/web/src/app/[locale]/admin/db-actions.ts:163-175`, `apps/web/src/app/[locale]/admin/db-actions.ts:349-358`, `apps/web/src/app/[locale]/admin/db-actions.ts:378-389`
- Severity: Medium
- Confidence: High
- Category: confirmed issue

`dumpDatabase()` creates the backup directory and then calls `connection.getConnection()` before entering the `try/finally` that maps backup lock handling and child-process failures into `{ success: false, error: ... }`. `restoreDatabase()` has the same acquisition gap: it calls `connection.getConnection()` before its lock/releaser `try/finally` begins. If the pool is exhausted, MySQL is restarting, TLS setup fails during acquisition, or `data/backups` cannot be created, these admin server actions reject through the framework instead of returning their documented localized result shape.

Why this is a problem:

- Cycle 16 fixed this exact class for `deleteAdminUser()` and `backfillClipEmbeddings()`, but the DB-maintenance actions still have the same cross-file reliability gap.
- The UI calls these as typed admin actions and expects `{ success: false, error }`; a raw rejection becomes a generic server-action failure during high-stress maintenance, exactly when operators need clear recovery text.
- The cleanup/release discipline after acquisition is careful, but the first acquisition/setup failures sit outside it.

Concrete failure scenario:

- An admin starts a DB backup while uploads/backfill/health checks saturate the 10-connection pool.
- `connection.getConnection()` at line 173 rejects before `dbRestoreLockHeld` and the backup `try/finally` exist.
- The admin sees a generic action crash instead of `backupFailed`/`restoreFailed`; no localized operator hint is returned.

Suggested fix:

- For both actions, move connection acquisition inside a guarded block with nullable `conn`.
- Return `{ success: false, error: t('backupFailed') }` or `{ success: false, error: t('restoreFailed') }` on acquisition/setup failure and log details server-side.
- Guard `releasePooledAdvisoryLocks` / `conn.release()` calls on non-null connection state.
- Add behavior tests that mock `connection.getConnection()` rejection for backup and restore.

### 2. Current-cycle ledger still advertises completed Cycle 16 work as active/pending

- Location: `.context/plans/README.md:36-37`, `.context/plans/cycle-16-2026-07-08-plan.md:3`, `.context/reviews/_aggregate.md:1-35`
- Severity: Medium
- Confidence: High
- Category: confirmed maintainability issue

The repository is at `HEAD == origin/master == fc15b235`, with Cycle 16 implementation commits present (`7a76d6a6`, `5c8aa0da`, `aab5f6db`, `38329ed6`, `fc15b235`). However, the active plan index still points at Cycle 16 as the active ledger, and the Cycle 16 plan still says `COMMIT/PUSH/DEPLOY PENDING`. The latest aggregate file also still presents fixed Cycle 16 findings as current review findings without terminal closure context.

Why this is a problem:

- This repo uses `.context/plans/README.md` as an agent orientation surface; stale active-state text sends later agents toward already-committed work.
- The project policy says every pushed iteration should deploy; stale `DEPLOY PENDING` text makes it unclear whether production was updated or whether only the ledger was missed.

Concrete failure scenario:

- A later cycle agent reads the plan index, assumes Cycle 16 push/deploy is still pending, and spends time re-closing already-shipped work or misreports deployment state.

Suggested fix:

- Move Cycle 16 from active to recently completed once the orchestrator confirms deploy evidence.
- Record terminal commit/push/deploy status for `fc15b235` or explicitly record the deploy gap if deploy did not run.
- Add a lightweight ledger check that flags `COMMIT/PUSH/DEPLOY PENDING` when `HEAD == origin/master` has advanced beyond the plan start HEAD.

## Likely Issues

### 3. A tracked `.omc` runtime artifact remains in source control

- Location: `.omc/plans/plan-cycle12-fixes.md:1`
- Severity: Low
- Confidence: High
- Category: likely maintainability issue

`git ls-files` still shows a tracked `.omc` plan even though runtime state belongs outside source control. The nested `.omc` test-state artifact reported in Cycle 16 appears gone, but the root `.omc` plan remains.

Concrete failure scenario:

- A review/inventory script or future agent includes this stale runtime plan as authoritative current-cycle context, reopening already-fixed work or inflating review scope.

Suggested fix:

- After explicit deletion approval, remove tracked `.omc` artifacts from git and keep `.context/plans` / `.context/reviews` as the committed planning surfaces.
- Add a repository check that fails on tracked paths matching `(^|/)\\.omc/` or `(^|/)\\.omx/`.

## Manual-Validation Risks

### 4. This lane did not rerun the full quality gate suite

- Location: `AGENTS.md` quality-gates section; `apps/web/package.json`
- Severity: Low
- Confidence: High
- Category: manual-validation risk

The three custom guard scripts passed in this lane, and Cycle 16 records full gates green, but this review did not independently rerun full lint/typecheck/build/unit/e2e.

Suggested validation before shipping fixes:

- `npm run lint --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web` when browser-flow coverage is relevant

## Final Sweep Notes

- Auth/API/action coverage: custom guard scripts passed; no new admin API auth, mutating action origin, or public route rate-limit bypass found.
- Data/privacy boundaries: public selectors still explicitly omit sensitive/admin-only fields, and map latitude/longitude remains isolated to `publicMapSelectFields`.
- Advisory locks: pooled release discipline is mostly centralized through `advisory-lock-release.ts`; sidecar raw release sites remain intentionally allowlisted because process exit closes their connections.
- Migrations/schema: no new migration files in this cycle; latest journal entry remains `0029_feed_updated_indexes`. Historical non-monotonic journal timestamps are documented and covered by `migrate.js` postconditions.
- Recent Cycle 16 fixes: admin-delete and semantic-backfill acquisition gaps are closed in current source; color-settings/backfill coordination is present and covered by focused tests.
- Files skipped as behavioral sources: binary fixtures/assets, generated images/fonts/icons, dependency/build outputs, and historical archived plans/reviews.
