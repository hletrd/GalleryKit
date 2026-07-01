# Cycle 68 Test / Verifier Review

Current HEAD: `e221b01a` (`fix(cycle-67): 🐛 align backfill warnings and controls`).

## Inventory

- Read required context: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/reviews/cycle-67-2026-07-01/_aggregate.md`, and the Cycle 67 test-verifier artifact.
- Inventoried `apps/web/src/__tests__/` (3193 test declarations across the current Vitest surface), `apps/web/scripts/`, `apps/web/e2e/`, public/admin API routes, mutating server-action gates, settings/backfill warning contracts, CLIP semantic backfill contracts, and Cycle 67 source changes.
- Source-level Cycle 67 verification:
  - C67-01/C67-04: `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` now lives in `apps/web/src/lib/gallery-config-shared.ts:72-85`; the Settings warning derives from it while excluding locked `image_sizes` in `apps/web/src/lib/settings-backfill-warning.ts:8-11`; helper behavior is covered in `apps/web/src/__tests__/settings-backfill-warning.test.ts:14-43`.
  - C67-02: the sidecar now logs immediately when `processed + failed >= SEMANTIC_SCAN_LIMIT` in `apps/web/scripts/backfill-clip-embeddings.ts:227-230`, after limiting the query by remaining budget in `apps/web/scripts/backfill-clip-embeddings.ts:147-179`.
  - C67-03: the lightbox key handler now exits on repeated keydown before Space/arrow handling in `apps/web/src/components/lightbox.tsx:309-343`, pinned by `apps/web/src/__tests__/lightbox-controls-contract.test.ts:80-90`.
  - C67-05: the Similar Photos fetch-signal assertion is now whitespace-tolerant in `apps/web/src/__tests__/similar-photos-abort-source.test.ts:16`.
  - C67-06: plan/aggregate pointers were updated in the Cycle 67 commit; I did not re-raise ledger state.
- Focused verification run: `npm test --workspace=apps/web -- --run src/__tests__/cycle-6-source-contracts.test.ts src/__tests__/settings-backfill-warning.test.ts src/__tests__/settings-backfill-warning-source.test.ts src/__tests__/lightbox-controls-contract.test.ts src/__tests__/similar-photos-abort-source.test.ts` passed 5 files / 21 tests.

## Findings

### C68-TV-01 - CLIP scan-limit notice can regress while its source contract stays green

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/__tests__/cycle-6-source-contracts.test.ts:12-15`, `apps/web/scripts/backfill-clip-embeddings.ts:88-90`, `apps/web/scripts/backfill-clip-embeddings.ts:227-230`.
- Evidence: Cycle 67 fixed the operator-visible rerun notice by calling `logScanLimitReached()` when the loop exhausts `SEMANTIC_SCAN_LIMIT`, and the current source does that correctly. The test, however, only checks that a function named `logScanLimitReached` exists and is called before the short-batch break; it does not assert that the function still emits the documented `Reached SEMANTIC_SCAN_LIMIT (...)` message. A future edit could leave `function logScanLimitReached() {}` or change it to a debug-only/no-op path, and `cycle-6-source-contracts.test.ts` would still pass.
- Failure scenario: an operator runs `scripts/backfill-clip-embeddings.ts` with a non-default scan limit, the run stops exactly at the cap, but the console no longer prints the rerun instruction. The documented multi-run backfill flow in `CLAUDE.md` then silently leaves older embeddings unfilled.
- Fix direction: strengthen the regression test to pin the notice body, not just the call site. A small source contract can assert `logScanLimitReached` contains `console.log` plus `Reached SEMANTIC_SCAN_LIMIT`; a better fix is to extract a tiny pure `formatScanLimitReachedMessage(limit)` helper and test its exact operator-facing content while keeping the loop-order assertion.

## Missed-Issue Sweep

- I did not find a current source-level failure in the Cycle 67 behavior itself.
- No `.only` tests were present. Skipped suites are environment-gated CLIP/model-weight or admin E2E credential checks, not accidental disabled unit coverage.
- I did not re-raise carry-forward deferred items from `.context/plans/cycle-67-2026-07-01-deferred.md`; none gained new severity in this pass.
