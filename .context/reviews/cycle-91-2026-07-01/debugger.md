# Cycle 91 Debugger Review

Assigned lane: debugger plus failure-mode review.
Start HEAD: `c648634b666f59c29cfe40ea5bbd547bc98d1885`.

## Inventory First

- Current commit scope: `c648634` changes only `.context/plans/README.md` and `.context/plans/cycle-90-2026-07-01-plan.md`.
- Recent runtime source delta reviewed from Cycle 89: `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, and `apps/web/src/__tests__/cycle-89-source-contracts.test.ts`.
- Failure-prone categories examined: color backfill sidecar, in-app backfill runner, image pixel-cap parsing, candidate batching, per-image reprocess/update paths, restore/backfill maintenance guards, release-ledger state, focused Vitest coverage, and admin E2E gating.

## Confirmed Findings

No confirmed runtime failure-mode finding in application source.

The only confirmed current-HEAD defect found in this lane is a verification-ledger/process issue, recorded in `test-engineer.md` as `C91-TE-01`. I am not duplicating it here as an application debugger finding because the deployed source/runtime files were not changed by `c648634`.

## Runtime Non-Findings

- Sidecar post-encode color detection uses the exported full-image pixel cap via `MAX_INPUT_PIXELS`, not a hard-coded 256 MiB-pixel literal: `apps/web/scripts/backfill-color-pipeline.ts:50`, `apps/web/scripts/backfill-color-pipeline.ts:276`.
- In-app backfill post-encode color detection uses the same full-image pixel cap: `apps/web/src/lib/admin-backfill-runner.ts:61`, `apps/web/src/lib/admin-backfill-runner.ts:592`.
- The source-contract test pins both sidecar and in-app detection blocks to `limitInputPixels: MAX_INPUT_PIXELS`: `apps/web/src/__tests__/cycle-89-source-contracts.test.ts:8`, `apps/web/src/__tests__/cycle-89-source-contracts.test.ts:17`, `apps/web/src/__tests__/cycle-89-source-contracts.test.ts:21`, `apps/web/src/__tests__/cycle-89-source-contracts.test.ts:29`.
- The full-image pixel cap parser covers scientific notation and invalid fallback cases: `apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts:65`, `apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts:66`, `apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts:80`.
- The in-app runner's batch test documents and verifies SQL-content dispatch so UPDATE calls cannot fabricate later candidate batches: `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:11`, `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:30`, `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:247`.

## Likely / Manual-Validation Risks

- Admin E2E coverage remains opt-in: `apps/web/e2e/admin.spec.ts:7`, `apps/web/e2e/admin.spec.ts:12`, `apps/web/e2e/origin-guard.spec.ts:29`, `apps/web/e2e/origin-guard.spec.ts:56`. I did not classify this as a confirmed bug because the repository intentionally gates admin browser flows on CI credentials.
- GPG signature verification could not be completed from this sandbox because GPG tried to write under `/Users/hletrd/.gnupg`; I did not treat that as a repo finding.

## Validation Evidence

- `npm test --workspace=apps/web -- --run src/__tests__/cycle-89-source-contracts.test.ts src/__tests__/process-image-max-input-pixels-env.test.ts src/__tests__/admin-backfill-runner-batching.test.ts` passed: 3 files, 21 tests.

## Missed-Issue Sweep

- Searched recent cycle artifacts and current plan/review ledgers for stale release state, active/current-cycle drift, and repeated findings.
- Searched source/tests for `MAX_INPUT_PIXELS`, `limitInputPixels`, `processImageFormats`, `detectColorSignals`, `fetchCandidateBatch`, `triggerAdminBackfill`, skipped/only/todo tests, and admin E2E gating.
- Reviewed current HEAD and recent commits `baefb42`, `dcc8055`, and `c648634` by changed-file inventory.
- No source edits, plan edits, aggregate edits, commits, pushes, deploys, network calls, sudo, NFS actions, or destructive actions were performed.
