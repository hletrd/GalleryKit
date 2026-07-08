# Run-10 Cycle 27 Test-Engineer Review

Date: 2026-07-08 KST
Role: test-engineer specialist
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `cff8d59f0301df8f64e030adc0fb2d65e825903a`

## Scope

Read before review: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, latest Cycle 26 plan/deferred files, Cycle 26 aggregate, and Cycle 26 test-verifier review.

I reviewed current unit/source-contract/e2e coverage at HEAD with emphasis on flaky-test risks, source-contract brittleness, browser-flow coverage, and whether new Cycle 26 claims are locked by behavior tests.

Validation run:

- `npm test --workspace=apps/web -- --run src/__tests__/restore-maintenance.test.ts src/__tests__/protected-admin-restore-maintenance-layout.test.tsx src/__tests__/cycle-26-source-contracts.test.ts src/__tests__/map-thumb-wiring.test.ts src/__tests__/shared-link-runtime-contracts.test.ts src/__tests__/map-get-images-behavior.test.ts`
- Result: 6 files passed, 36 tests passed.

Skip/focus sweep:

- No `.only` matches found under `apps/web/src/__tests__` or `apps/web/e2e`.
- Expected skips remain in `apps/web/e2e/admin.spec.ts`, `apps/web/e2e/origin-guard.spec.ts`, `apps/web/src/__tests__/clip-offline-load.test.ts`, and `apps/web/src/__tests__/clip-semantic-integration.test.ts`.

Already-deferred Cycle 26 items `AGG-C26-07`, `AGG-C26-08`, and `AGG-C26-09` were not re-filed below. The findings here are current Cycle 26 implementation-evidence gaps.

## Findings

### C27-TEST-01 - Cycle 26 public UI fixes are source-contract-only and not rendered/e2e-proven

- Severity: Low-Medium
- Confidence: High
- Region: implementation at `apps/web/src/components/lightbox-color-pip.tsx:167-204`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:250-253`, `apps/web/src/app/[locale]/(public)/map/page.tsx:55-67` and `:99-108`; tests at `apps/web/src/__tests__/cycle-26-source-contracts.test.ts:57-82`, `apps/web/src/__tests__/map-thumb-wiring.test.ts:61-77`; existing e2e at `apps/web/e2e/public.spec.ts:136-143` and `:169-187`.
- Failure scenario: the tests assert source strings for `aria-controls`, the empty shared-group copy, and map topic-label fallback. They do not render the lightbox color pip and inspect the trigger/panel relationship, do not hit a valid empty shared group route, and do not assert the map fallback list shows an admin label instead of a slug. A JSX/translation/conditional rendering regression can keep the tested strings present while the user-facing DOM regresses.
- Recommendation: add render-level tests or Playwright coverage:
  - open a photo with color metadata, expand the lightbox pip, assert the button `aria-controls` points to a visible named `role="region"`;
  - seed or mock a valid shared group with zero images and assert `sharedGroup.empty` text, not processing text;
  - assert `/en/map` fallback list shows a seeded topic label distinct from the slug.

### C27-TEST-02 - Restore action finalizer has no red-path behavior harness for durable-clear failure

- Severity: Medium
- Confidence: High
- Region: `apps/web/src/app/[locale]/admin/db-actions.ts:674-690`; `apps/web/src/__tests__/cycle-26-source-contracts.test.ts:46-55`; `apps/web/src/__tests__/restore-upload-lock.test.ts:104-126`; behavior helper coverage at `apps/web/src/__tests__/restore-maintenance.test.ts:104-110`.
- Failure scenario: current tests prove the helper throws without clearing process state, but the action-level finalizer is guarded by source assertions. A future change can call `resumeImageProcessingQueueAfterRestore()` or drain post-restore cleanup after `endDurableRestoreMaintenance()` fails, while keeping the strings that satisfy the tests.
- Recommendation: introduce a small extracted finalizer function or injectable restore-action harness. Simulate a successful restore followed by a marker-clear throw and assert no queue resume, no post-clear cleanup, returned `keepMaintenance: true`, and active maintenance state.

### C27-TEST-03 - Cycle 26 release gate is not machine-checkable from committed artifacts

- Severity: Medium
- Confidence: High
- Region: `.context/plans/cycle-26-2026-07-08-plan.md:3`, `:90-107`, `:115-132`; `git show cff8d59f0301df8f64e030adc0fb2d65e825903a`.
- Failure scenario: the plan records lint/typecheck/build/Vitest and says Playwright was skipped, but WP4 remains unchecked and deploy/live-smoke evidence is absent. The commit message says the per-cycle deploy was required, not that it succeeded. Future review cycles may assume production is current even if the deploy failed or never ran.
- Recommendation: add a release-evidence convention test or ledger check for active cycle plans, or at minimum update the Cycle 26 plan with concrete deploy and smoke results. A simple source/markdown check could fail when an active plan contains `PENDING SIGNED COMMIT/PUSH/DEPLOY` after the corresponding fix commit is on `origin/master`.

## Coverage Notes

- `protected-admin-restore-maintenance-layout.test.tsx` is a good behavior test for the protected layout and should be used as the model for the parent admin layout test.
- `map-get-images-behavior.test.ts` proves query/visibility behavior, but it does not render the public route fallback list. The label presentation fix needs a DOM-level assertion.
- The current e2e suite has public map and shared-group smoke coverage, but those tests do not exercise the exact Cycle 26 regressions.
