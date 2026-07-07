# Cycle 23 Test-Engineer Review

Role: `test-engineer`
Repo: `/Users/hletrd/flash-shared/gallery`
Current HEAD at write: `57c1ae33` (`origin/master`)

## Inventory

Required guidance read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`.

Test/verification inventory built first:

- Commands and gates: root `package.json`, `apps/web/package.json`, `.github/workflows/quality.yml`.
- Test files: 360 Vitest files in `apps/web/src/__tests__`; 9 Playwright specs in `apps/web/e2e`; `apps/web/vitest.config.ts`; `apps/web/playwright.config.ts`.
- New/changed Cycle 22 tests: `check-action-origin.test.ts`, `pending-file-deletions.test.ts`, `pending-session-revocations.test.ts`, `data-timeline-behavior.test.ts`, `data-timeline.test.ts`.
- Test-adjacent implementation under review: `check-action-origin.ts`, `pending-file-deletions.ts`, `maintenance-scheduler.ts`, `db-actions.ts`, `process-image.ts`, `upload-paths.ts`, `data-timeline.ts`.
- Recurring weak-assertion areas: migration/reconcile source contracts, restore child-process source contracts, semantic scan cap source tests, stale client response source tests, browser visual artifacts, hydration timing waits.

## Findings

### TE-C23-01 - Pending file-deletion drain tests do not cover the highest-risk acceptance cases

- Severity: Medium
- Confidence: High
- Status: Confirmed test gap
- Files/regions: `.context/plans/cycle-22-2026-07-08-plan.md:53-61`, `apps/web/src/__tests__/pending-file-deletions.test.ts:111-158`, `apps/web/src/lib/pending-file-deletions.ts:46-71`, `apps/web/src/lib/maintenance-scheduler.ts:26-49`, `apps/web/src/app/[locale]/admin/db-actions.ts:655-678`
- Weakness: the new drain test mocks both strict filesystem helpers and covers only all-success, permanent failure, and limit normalization. It does not test transient failure followed by success, already-missing files through the real strict helpers, restore-active suppression, or post-restore marker ordering as executable behavior.
- Failure scenario: a future change can break the restore guard or leave stale restored rows undrained while the current drain unit test still passes because it never crosses the scheduler/restore boundary.
- Suggested test: add cases for `mockRejectedValueOnce()` then success, real temp-directory missing-file cleanup, mocked `isRestoreMaintenanceActive() === true` preventing scheduler drain, and a small extracted post-restore sequencing helper that asserts `endDurableRestoreMaintenance()` precedes drain.

### TE-C23-02 - Cleanup tests miss the successful-scan debug noise path

- Severity: Low
- Confidence: High
- Status: Confirmed test gap with confirmed behavior
- Files/regions: `apps/web/src/lib/process-image.ts:576-588`, `apps/web/src/lib/process-image.ts:118-127`, `apps/web/src/__tests__/process-image-variant-scan.test.ts:24-84`, `apps/web/src/__tests__/pending-file-deletions.test.ts:73-82`
- Weakness: `process-image-variant-scan.test.ts` asserts files are deleted but does not spy on `console.debug`; `pending-file-deletions.test.ts` mocks `deleteImageVariantsStrict`, so it cannot catch helper-level logging.
- Failure scenario: every successful `sizes=[]` derivative scan can log `ERR_DIR_CLOSED`, and tests still pass because they assert filesystem outcome only.
- Suggested test: add a no-debug assertion around `deleteImageVariantsStrict(tempDir, 'missing-or-existing.jpg', [])`, or add a focused `safeCloseDirHandle`/full-scan test after changing the helper to ignore `ERR_DIR_CLOSED`.

### TE-C23-03 - Safety-critical coverage is still heavily source-contract based

- Severity: Medium
- Confidence: High
- Status: Confirmed recurring gap
- Files/regions: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:28-37`, `apps/web/src/__tests__/db-restore.test.ts:12-136`, `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:19-77`, `apps/web/src/__tests__/search-stale-response.test.ts:13-35`, `apps/web/src/__tests__/pending-file-deletions-source.test.ts:5-45`
- Weakness: repo-wide scan found 167 unit test files using source-read/source-index patterns. Some are useful lint-like tripwires, but several high-risk runtime contracts still lean on string shape rather than behavior.
- Failure scenario: migration reconcile semantics, restore child-process settlement, semantic scan caps, stale response suppression, or delete-ledger wiring can preserve expected imports/strings while changing runtime behavior.
- Suggested test strategy: keep source tripwires, but add behavior harnesses for the highest-risk classes: disposable MySQL/reconcile diff tests, fake `mysqldump`/`mysql` child-process settlement, route-level semantic scan cap tests, and jsdom/RTL stale-search cancellation tests.

### TE-C23-04 - Browser coverage remains Chromium-only with screenshot artifacts rather than visual assertions

- Severity: Medium
- Confidence: High
- Status: Manual-validation risk
- Files/regions: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:75-80`, `apps/web/e2e/nav-visual-check.spec.ts:40-86`, `apps/web/e2e/hydration-photo-page.spec.ts:20-49`
- Weakness: CI installs only Chromium, Playwright defines only a Desktop Chrome project, and nav visual tests write screenshots without comparing them. Hydration readiness still uses `networkidle`.
- Failure scenario: mobile WebKit touch issues, Firefox display-gamut behavior, PWA/offline regressions, visual layout drift, or hydration flakes escape automated gates.
- Suggested test: add tagged smoke projects for mobile WebKit/mobile Chromium/PWA offline and convert stable screenshots to `toHaveScreenshot()`; replace `networkidle` with an app-level readiness condition.

### TE-C23-05 - Cycle 22 quality-gate evidence is not reconciled with the pushed HEAD/deploy requirement

- Severity: Medium
- Confidence: High
- Status: Confirmed evidence gap
- Files/regions: `.context/plans/cycle-22-2026-07-08-plan.md:135-175`, `.context/plans/README.md:34-37`, commit `57c1ae33`
- Weakness: the commit body for `57c1ae33` records all blocking local gates as green, but the committed Cycle 22 plan still lists WP6 open and says commit/push/deploy pending. No deploy/smoke evidence is recorded for the pushed recovery commit.
- Failure scenario: a later test/release lane may assume Cycle 22 is complete from commit history or incomplete from plan history, and production verification remains ambiguous.
- Suggested test/process fix: add a lightweight ledger consistency check for active plans: if HEAD is pushed and gate evidence exists, the plan must either record deploy evidence or explicitly mark deploy superseded/pending with a blocking reason.

## Evidence Commands

```bash
find apps/web/src/__tests__ -maxdepth 1 -name '*.test.ts' | wc -l
find apps/web/e2e -maxdepth 1 -name '*.spec.ts' | wc -l
rg -l "readFileSync|fs\\.readFileSync|extractFunctionBody|source\\.indexOf|source\\.includes" apps/web/src/__tests__ | wc -l
npm run lint:action-origin --workspace=apps/web
npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/pending-file-deletions.test.ts src/__tests__/pending-session-revocations.test.ts src/__tests__/data-timeline-behavior.test.ts
npm test --workspace=apps/web -- --run src/__tests__/process-image-variant-scan.test.ts src/__tests__/upload-paths.test.ts
```

Results: targeted tests and `lint:action-origin` passed. Full gates and live deploy were not rerun in this review lane.

## Final Missed-Issue Sweep / Uninspected

- No `test.only` sweep beyond the targeted `rg` inventory was run.
- Full unit suite, full Playwright suite, build, typecheck, and all lint gates were not rerun.
- Real browser matrix, live production, nginx/proxy topology, and CLIP model preflight remain manual/uninspected here.
