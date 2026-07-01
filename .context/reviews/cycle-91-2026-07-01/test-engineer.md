# Cycle 91 Test Engineer Review

Assigned lane: test coverage, regression surfaces, flakiness, and TDD opportunities.
Start HEAD: `c648634b666f59c29cfe40ea5bbd547bc98d1885`.

## Inventory First

- Current commit scope: `c648634` changes `.context/plans/README.md` and `.context/plans/cycle-90-2026-07-01-plan.md`.
- Test surfaces examined: `apps/web/src/__tests__/cycle-89-source-contracts.test.ts`, `apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts`, `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts`, and `apps/web/e2e/*.spec.ts`.
- Review/plan evidence examined: `.context/plans/README.md`, `.context/plans/cycle-90-2026-07-01-plan.md`, `.context/plans/cycle-90-2026-07-01-deferred.md`, `.context/reviews/_aggregate.md`, and `.context/reviews/cycle-90-2026-07-01/*`.

## Confirmed Findings

### C91-TE-01 - Cycle 90 plan index still says terminal-evidence sync is in progress after the terminal evidence commit

- Severity: Low.
- Confidence: High.
- Citations: `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/cycle-90-2026-07-01-plan.md:51`, `.context/plans/cycle-90-2026-07-01-plan.md:52`, `.context/plans/cycle-90-2026-07-01-plan.md:57`, `.context/plans/cycle-90-2026-07-01-plan.md:58`, `.context/plans/cycle-90-2026-07-01-plan.md:59`, `.context/plans/cycle-90-2026-07-01-plan.md:69`.
- Problem: The plan itself marks commit/pull-rebase/push and deploy complete and records signed primary commit, deploy, smoke, and gate evidence, but the plan index still lists Cycle 90 under "Active Current-Cycle Plans" and says a "docs-only terminal-evidence sync" is in progress.
- Failure scenario: Cycle 92 or later review agents treat Cycle 90 as still mid-sync, repeat release-ledger forensics, or open another housekeeping finding even though `c648634` was exactly the terminal-evidence sync.
- Concrete fix: Update `.context/plans/README.md` so Cycle 90 is no longer described as an in-progress terminal-evidence sync. Move it to recent/completed state once Cycle 91 artifacts/plan become current, and record `c648634b666f59c29cfe40ea5bbd547bc98d1885` as the terminal evidence commit if that is the intended release baseline.

## Test Coverage Non-Findings

- The Cycle 89 pixel-cap regression has a focused source contract for both sidecar and in-app runner paths: `apps/web/src/__tests__/cycle-89-source-contracts.test.ts:8`, `apps/web/src/__tests__/cycle-89-source-contracts.test.ts:17`, `apps/web/src/__tests__/cycle-89-source-contracts.test.ts:21`, `apps/web/src/__tests__/cycle-89-source-contracts.test.ts:29`.
- The full-image `IMAGE_MAX_INPUT_PIXELS` parser is covered for scientific notation, plain integer, unset default, and invalid/non-positive fallback: `apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts:65`, `apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts:66`, `apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts:72`, `apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts:76`, `apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts:80`.
- The in-app backfill batching regression test guards against the prior false-positive mock shape by dispatching on SQL content, not call order: `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:11`, `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:19`, `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:30`, `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:247`.

## Likely / Manual-Validation Risks

- Admin browser coverage is intentionally credential-gated and mostly skipped outside CI: `apps/web/e2e/admin.spec.ts:7`, `apps/web/e2e/admin.spec.ts:12`, `apps/web/e2e/origin-guard.spec.ts:29`, `apps/web/e2e/origin-guard.spec.ts:56`. This is a manual-validation risk, not a confirmed gap in this cycle, because the repository already documents CI credential gating in those specs.
- `npm run test:e2e --workspace=apps/web` was not run; this lane was bounded to local review and focused unit/source-contract validation.

## Validation Evidence

- Focused command passed: `npm test --workspace=apps/web -- --run src/__tests__/cycle-89-source-contracts.test.ts src/__tests__/process-image-max-input-pixels-env.test.ts src/__tests__/admin-backfill-runner-batching.test.ts`.
- Result: 3 test files passed, 21 tests passed.

## Missed-Issue Sweep

- Searched for skipped/only/todo tests, recent release-ledger drift, current aggregate/plan pointers, pixel-cap source contracts, backfill runner batching tests, and admin E2E gating.
- Reviewed changed-file inventory for `baefb42`, `dcc8055`, and `c648634`.
- Examined categories: release evidence, unit regression coverage, source-contract strength, e2e gating, sidecar/in-app backfill parity, and recent review artifact consistency.
- No source edits, plan edits, aggregate edits, commits, pushes, deploys, network calls, sudo, NFS actions, or destructive actions were performed.
