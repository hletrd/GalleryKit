# Cycle 69 Test / Verifier Review

Start HEAD: `87e2b98db76e90985299e37ad90cf2faad12c5c4`.

## Inventory

- Required context: `AGENTS.md`, `CLAUDE.md`, latest aggregate, Cycle 68 plan/deferred files, and current tests under `apps/web/src/__tests__/`.
- Reviewed settings/backfill warning tests, source-contract tests, image queue embedding contracts, Lightroom upload route tests, and service worker template tests.

## Findings

### TV69-01 - Saved settings-only re-encode obligation is still mostly source-contract covered

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:184`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:250`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:262`, `apps/web/src/__tests__/settings-backfill-warning-source.test.ts:10`.
- Evidence: the state machine depends on previous baseline capture, saved pending state, clearing when reverted, and the zero-candidate sidecar toast. The current test pins source substrings rather than helper behavior.
- Failure scenario: a refactor leaves the substrings present but clears `hasSavedBackfillPending` after save, causing the warning and sidecar instruction to disappear for current-version photos.
- Fix direction: extract a pure helper for pending-baseline transitions and test dirty, cleared, and no-existing-images cases.

### TV69-02 - Lightroom upload route behavior remains source-contract heavy

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1`.
- Evidence: GPS-strip failure, HDR rejection cleanup, token actor attribution, DB insert, and enqueue snapshot behavior are complex route branches, but several are currently locked by source text.
- Failure scenario: a refactor could preserve the text contract while still inserting/enqueuing after GPS stripping fails.
- Disposition: this is the existing carry-forward `C61-07` coverage gap. It is deferred under the prior exit criterion rather than re-counted as a new scheduled Cycle 69 source fix.

## Validation

The test/verifier lane did not edit files. Focused implementation tests are required for scheduled `TV69-01`.
