# Cycle 88 Test Engineer

Start HEAD: `afc2bf5245932fd421d84e8d29ca2e0be01280fb`.

## Inventory

Examined `.context/plans/README.md`, Cycle 85-87 review/plan artifacts, `apps/web/package.json`, `apps/web/src/app/actions/images.ts`, `apps/web/src/__tests__/failed-image-retry.test.ts`, `apps/web/src/__tests__/image-queue-permanent-failure-cleanup.test.ts`, `apps/web/src/__tests__/images-actions.test.ts`, `apps/web/src/__tests__/image-queue-settings-wiring.test.ts`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts`, and `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`.

## Findings

### C88-01 - Cycle 87 release ledger remains open after signed pushed/deployed HEAD

- Severity: Medium.
- Confidence: High.
- Citations: `.context/plans/cycle-87-2026-07-01-plan.md:51`, `.context/plans/cycle-87-2026-07-01-plan.md:52`, `.context/plans/cycle-87-2026-07-01-plan.md:39`, `.context/plans/README.md:7`.
- Problem: The plan requires commit/push/deploy/smoke but leaves terminal release checklist items unchecked after `afc2bf5` reached `origin/master` and this run's deployed baseline.
- Failure scenario: Later cycles rerun expensive release checks because the ledger says Cycle 87 is still active.
- Suggested fix: Close the Cycle 87 ledger and index state.

### C88-02 - Retry enqueue source-contract test can pass from the unrelated upload enqueue block

- Severity: Medium.
- Confidence: High.
- Citations: `apps/web/src/__tests__/failed-image-retry.test.ts:131`, `apps/web/src/__tests__/failed-image-retry.test.ts:132`, `apps/web/src/app/actions/images.ts:520`, `apps/web/src/app/actions/images.ts:551`, `apps/web/src/app/actions/images.ts:1284`.
- Problem: The test named `calls enqueueImageProcessing with the full job payload` scans the entire `actions/images.ts` source. The upload path contains the same processing-settings fields before the actual `retryFailedImage()` enqueue block, so a retry regression can be masked.
- Failure scenario: `retryFailedImage()` drops `forceSrgbDerivatives`, `wideGamutMaxSourcePixels`, or another processing setting, but the test still passes because upload retains those fields.
- Suggested fix: Extract the `retryFailedImage` function body and assert the enqueue payload against that body.

## Non-Findings

Focused verification during review passed: `npm test --workspace=apps/web -- --run src/__tests__/failed-image-retry.test.ts src/__tests__/image-queue-permanent-failure-cleanup.test.ts` (2 files, 26 tests). Privacy and migration guard coverage looked non-vacuous in the inspected tests.
