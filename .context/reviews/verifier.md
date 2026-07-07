# Cycle 23 Verifier Review

Role: `verifier`
Repo: `/Users/hletrd/flash-shared/gallery`
Current HEAD at write: `57c1ae33` (`origin/master`)
Reviewed scope: Cycle 22 recovery implementation and current verification surface.

## Inventory

Required guidance read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`.

Test/verification inventory built before findings:

- Gate definitions: root `package.json`, `apps/web/package.json`, `.github/workflows/quality.yml`.
- Unit/browser surfaces: 360 Vitest files under `apps/web/src/__tests__`; 9 Playwright specs under `apps/web/e2e`; `apps/web/vitest.config.ts`; `apps/web/playwright.config.ts`.
- Cycle 22 implementation and ledger files: `.context/plans/cycle-22-2026-07-08-plan.md`, `.context/plans/cycle-22-2026-07-08-deferred.md`, `.context/plans/README.md`, `.context/reviews/_aggregate.md`, `CLAUDE.md`.
- Mutation-barrier scanner and fixtures: `apps/web/scripts/check-action-origin.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, current `apps/web/src/app/actions/**` slot shapes.
- Pending deletion drain and restore wiring: `apps/web/src/lib/pending-file-deletions.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, related tests.
- Timeline parser-backed grouping: `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/mysql-datetime.ts`, `apps/web/src/__tests__/data-timeline*.test.ts`.
- Remaining test-infra risks: source-contract-heavy tests, Playwright project matrix, screenshot/manual artifact tests, hydration readiness waits.

## Findings

### VER-C23-01 - Cycle 22 terminal release ledger is still stale after the pushed recovery commit

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Files/regions: `.context/plans/cycle-22-2026-07-08-plan.md:1-6`, `.context/plans/cycle-22-2026-07-08-plan.md:135-163`, `.context/plans/README.md:34-37`, commit `57c1ae33`
- Contract: Project policy requires the per-cycle plan to carry terminal gate, push, and deploy evidence. Cycle 22 WP6 explicitly schedules full gates, signed commit/push, and `npm run deploy`.
- Evidence: current HEAD is `57c1ae33` and is already `origin/master`, and the commit body records all local gates as tested. The Cycle 22 plan still says `Status: IMPLEMENTED - GATES PENDING`, WP6 says `commit/push/deploy pending`, and the WP6 checkbox remains open. No tracked deploy/live-smoke evidence for `57c1ae33` is present in the Cycle 22 ledger.
- Failure scenario: Cycle 23+ agents cannot tell from committed ledgers whether `57c1ae33` was deployed, superseded, or only pushed locally, so production-state assumptions drift from source-state evidence.
- Suggested fix: append terminal Cycle 22 evidence with exact commit hash, push state, deploy result or superseding deploy, and smoke result; then move Cycle 22 out of active plans.

### VER-C23-02 - Successful full-scan derivative cleanup emits a false debug error

- Severity: Low
- Confidence: High
- Status: Confirmed
- Files/regions: `apps/web/src/lib/process-image.ts:576-588`, `apps/web/src/lib/process-image.ts:118-127`, `apps/web/src/lib/pending-file-deletions.ts:82-88`
- Contract: pending deletion cleanup and restored stale rows should quietly treat absent files as already clean unless storage actually refuses cleanup.
- Evidence: `deleteImageVariantsStrict(..., [])` full-scans a directory with `for await (const entry of dirHandle)` and then calls `safeCloseDirHandle(dirHandle)` in `finally`. Node closes the `Dir` handle at iterator completion; the second close throws `ERR_DIR_CLOSED`, which `safeCloseDirHandle()` logs because it ignores only `ENOENT`. A direct probe from `apps/web` showed `deleteImageVariantsStrict missing: resolved` while logging `[safeCloseDirHandle] Failed to close directory handle: Error [ERR_DIR_CLOSED]`.
- Failure scenario: ordinary image deletion or maintenance drains can produce debug noise for successful derivative scans, making real cleanup failures harder to spot.
- Suggested fix: treat `ERR_DIR_CLOSED` as benign or remove the explicit close after `for await`; add a regression test that a successful `sizes=[]` scan does not call `console.debug`.

### VER-C23-03 - Pending deletion recovery is partly behavior-backed, but restore suppression remains source-only

- Severity: Medium
- Confidence: High
- Status: Confirmed test/evidence gap
- Files/regions: `apps/web/src/lib/maintenance-scheduler.ts:26-49`, `apps/web/src/app/[locale]/admin/db-actions.ts:655-678`, `apps/web/src/__tests__/pending-file-deletions.test.ts:111-158`, `apps/web/src/__tests__/pending-session-revocations.test.ts:101-116`
- Contract: Cycle 22 WP2 acceptance requires the drain not to run during restore maintenance and restored rows to retry after the restore marker clears.
- Evidence: implementation wires the drain through `runMaintenanceTask()` and post-restore cleanup. The executable `pending-file-deletions.test.ts` covers success, permanent failure, and limit normalization, but not restore-active suppression or post-marker ordering as behavior. Those claims are currently asserted only by string/index checks in `pending-session-revocations.test.ts`.
- Failure scenario: a future refactor can preserve the strings while moving the drain before marker clear, dropping the scheduler guard, or letting a maintenance sweep delete files mid-import; current behavior tests would stay green.
- Suggested fix: add a mocked `isRestoreMaintenanceActive()` maintenance test that proves the drain is skipped while active, plus a restore-action harness or extracted helper test proving post-restore drains run only after `endDurableRestoreMaintenance()`.

### VER-C23-04 - Browser-flow verification still leaves non-Chromium, PWA, and visual regressions manual

- Severity: Medium
- Confidence: High
- Status: Manual-validation risk
- Files/regions: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:75-80`, `apps/web/e2e/nav-visual-check.spec.ts:40-86`, `apps/web/e2e/hydration-photo-page.spec.ts:20-49`
- Contract: browser-flow verification should prove user-visible behavior, not only produce artifacts.
- Evidence: Playwright defines one `chromium` project and CI installs only Chromium. The nav visual checks write screenshots with `page.screenshot()` but do not compare baselines. The hydration page still waits on `networkidle`, a timing proxy that can be affected by background requests.
- Failure scenario: mobile WebKit touch behavior, Firefox color/display differences, PWA/offline paths, or visual spacing regress while CI remains green.
- Suggested fix: add a small tagged browser matrix for mobile WebKit/mobile Chromium/PWA smoke and convert stable visual checks to `toHaveScreenshot()` or mark current screenshots as manual artifacts.

## Confirmed Closures / No Finding

- The Cycle 22 positive mutation-slot scanner bypass is closed: `apps/web/scripts/check-action-origin.ts:647-675` rejects later sibling mutations after a positive acquired guard, and `apps/web/src/__tests__/check-action-origin.test.ts:657-675` covers the regression.
- Runtime year-in-review grouping now uses `parseMySqlDateTimeParts()` at `apps/web/src/lib/data-timeline.ts:248-266`, with a mocked query-chain behavior test in `apps/web/src/__tests__/data-timeline-behavior.test.ts:65-80`.
- The strict original and derivative helpers treat missing files as success in direct probes, so the `CLAUDE.md:437` missing-file claim is true at runtime; the residual is the noisy close path in VER-C23-02.

## Evidence Commands

```bash
git rev-parse --short HEAD
git log --oneline --decorate -n 12
git diff --name-status 8b795862079b0e5318242a09390b4cdff1dc2058..HEAD
npm run lint:action-origin --workspace=apps/web
npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/pending-file-deletions.test.ts src/__tests__/pending-session-revocations.test.ts src/__tests__/data-timeline-behavior.test.ts
npm test --workspace=apps/web -- --run src/__tests__/process-image-variant-scan.test.ts src/__tests__/upload-paths.test.ts
```

Results: targeted tests passed; `lint:action-origin` passed. I did not rerun the full blocking suite in this review lane.

## Final Missed-Issue Sweep / Uninspected

- Full `lint`, `api-auth`, `public-route-rate-limit`, `typecheck`, `build`, full unit, and full Playwright gates were not rerun; Cycle 22 commit text claims them green.
- Live production deploy, host nginx, proxy topology, and real CLIP model weights were not dynamically inspected.
- I did not inspect every historical plan archive; current active/deferred/index artifacts and recent review aggregates were inspected.
