# Run-10 Cycle 27 Verifier Review

Date: 2026-07-08 KST
Role: verifier specialist
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `cff8d59f0301df8f64e030adc0fb2d65e825903a`

## Scope

Read before review: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/cycle-26-2026-07-08-plan.md`, `.context/plans/cycle-26-2026-07-08-deferred.md`, `.context/plans/deferred-carry-forward.md`, and Cycle 26 aggregate/test-verifier artifacts.

I inspected the Cycle 26 implementation diff from `101ebef57ae2a379cce4b5fa04dccd538c438b0c` to `cff8d59f0301df8f64e030adc0fb2d65e825903a`, focusing on restore-maintenance lifecycle correctness, admin maintenance-before-auth ordering, public UI fallback/accessibility fixes, source-contract strength, e2e coverage, and committed release evidence.

Validation run:

- `npm test --workspace=apps/web -- --run src/__tests__/restore-maintenance.test.ts src/__tests__/protected-admin-restore-maintenance-layout.test.tsx src/__tests__/cycle-26-source-contracts.test.ts src/__tests__/map-thumb-wiring.test.ts src/__tests__/shared-link-runtime-contracts.test.ts src/__tests__/map-get-images-behavior.test.ts`
- Result: 6 files passed, 36 tests passed.

I did not re-file the already-deferred Cycle 26 carry-forward items `AGG-C26-06` through `AGG-C26-09`.

## Findings

### C27-VER-01 - Cycle 26 release/deploy evidence is still unclosed in the committed plan

- Severity: Medium
- Confidence: High
- Region: `.context/plans/cycle-26-2026-07-08-plan.md:3`, `:90-107`, `:115-132`; commit `cff8d59f0301df8f64e030adc0fb2d65e825903a` body.
- Failure scenario: the project policy requires signed commit, push, `npm run deploy`, and live smoke after every iteration, but the committed Cycle 26 plan still says `PENDING SIGNED COMMIT/PUSH/DEPLOY` and leaves WP4 unchecked. The commit is present on `origin/master`, but there is no committed deploy transcript or live-smoke result in the plan. A later verifier cannot distinguish "deployed and forgotten to record" from "not deployed", and production state claims remain unverifiable from the repo.
- Recommendation: run or locate the Cycle 26 deploy evidence, then update the ledger with exact commit, `git pull --rebase`/push result, `npm run deploy` result, and live smoke output (`/api/live` plus missing-photo 404). If deploy did not run, schedule it before treating Cycle 26 as closed.

### C27-VER-02 - Restore finalizer fail-closed behavior is mostly source-locked, not behavior-proven

- Severity: Medium
- Confidence: High
- Region: `apps/web/src/app/[locale]/admin/db-actions.ts:674-690`; `apps/web/src/__tests__/cycle-26-source-contracts.test.ts:46-55`; helper-level behavior at `apps/web/src/__tests__/restore-maintenance.test.ts:104-110`.
- Failure scenario: the low-level helper test proves `endDurableRestoreMaintenance()` keeps process maintenance active when marker removal throws. The restore action's higher-level contract is only checked by string assertions: a future refactor can still resume the queue or run post-clear cleanup after a marker-clear failure while preserving the tested literals. That reopens the Cycle 26 split-brain class without a red behavior test.
- Recommendation: extract the restore finalizer branch or add an injectable/mocked `restoreDatabase` behavior test. Force `endDurableRestoreMaintenance()` to throw after a successful restore and assert the action returns `{ success: false, keepMaintenance: true }`, `isRestoreMaintenanceActive()` remains true, `resumeImageProcessingQueueAfterRestore()` is not called, and post-clear cleanup (`flushPendingSessionRevocations`, `drainPendingFileDeletions`) does not run.

### C27-VER-03 - Parent admin maintenance-before-session ordering lacks behavior coverage

- Severity: Low-Medium
- Confidence: High
- Region: `apps/web/src/app/[locale]/admin/layout.tsx:15-18`; `apps/web/src/__tests__/cycle-26-source-contracts.test.ts:38-44`; protected-layout behavior test at `apps/web/src/__tests__/protected-admin-restore-maintenance-layout.test.tsx:48-77`.
- Failure scenario: Cycle 26 added a behavior test for the protected layout skipping `isAdmin()` during restore maintenance, but the parent admin layout's `getCurrentUser()` skip is protected only by a source-order assertion. A future layout refactor could reintroduce a session-table read during restore while leaving `isRestoreMaintenanceActive()` text before `getCurrentUser()` in the file.
- Recommendation: add a parent-layout unit test with mocked `isRestoreMaintenanceActive()` and `getCurrentUser()`. When maintenance is active, assert `getCurrentUser()` is not called and the layout still renders children without admin chrome.

## Verified Non-Findings

- The durable marker helper itself is behavior-tested: `restore-maintenance.test.ts` covers marker-removal failure leaving process maintenance active.
- The protected admin layout behavior is covered: maintenance renders before `isAdmin()` and redirect logic.
- The targeted Cycle 26 test set passed locally during this review.
