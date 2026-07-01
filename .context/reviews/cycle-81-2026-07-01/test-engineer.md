# Cycle 81/100 Test-Engineer Review

Reviewed HEAD: `4733d475be8f19fbddf4b82b589e28d6ca083992`.
Date: 2026-07-01.

## Inventory

- Read `AGENTS.md` and `CLAUDE.md` first, then inventoried the current test surface: 303 Vitest files under `apps/web/src/__tests__/` and 5 Playwright specs under `apps/web/e2e/`.
- Reviewed current and recent ledgers: Cycle 80 aggregate/plan/deferred files, Cycle 79/78 test-verifier artifacts, and the carry-forward deferred register.
- Reviewed coverage contracts for public-route rate-limit scanning, action/API auth gates, i18n key parity, privacy select-field guards, touch-target audit, migration journal/reconcile drift, restore-maintenance sidecar guards, shutdown drains, and map accessible-label regressions.
- Focused validation run: `npm test --workspace=apps/web -- --run src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/touch-target-audit.test.ts src/__tests__/migration-journal.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/background-db-writes.test.ts src/__tests__/instrumentation-sigterm.test.ts src/__tests__/cycle-71-source-contracts.test.ts src/__tests__/map-thumb-wiring.test.ts` passed: 11 files, 224 tests.

## Findings

### C81-TE-01 - Cycle 80 release ledger still has no deploy evidence for the pushed HEAD

- Severity: Medium.
- Confidence: High.
- Citations: `AGENTS.md:17`, `CLAUDE.md:469`, `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/cycle-80-2026-07-01-plan.md:8`, `.context/plans/cycle-80-2026-07-01-plan.md:44`, `.context/plans/cycle-80-2026-07-01-plan.md:53`, `.context/plans/cycle-80-2026-07-01-plan.md:54`, `.context/plans/cycle-80-2026-07-01-plan.md:58`, `.context/plans/cycle-80-2026-07-01-plan.md:66`.
- Problem: Current `HEAD` equals `origin/master` at signed commit `4733d475`, and the commit records local blocking gates, but the committed Cycle 80 plan still lists Cycle 80 as active with commit/push and deploy unchecked. The plan's gate evidence stops at local checks and `git diff --cached --check`; it does not record `npm run deploy` or a later deployed-start baseline for `4733d475`.
- Failure scenario: production can remain at the previous deployed baseline (`8c4999c9`) while reviewers see the Cycle 80 scanner, shutdown-drain, sidecar-guard, and map-label fixes on `master` and assume they are live. A later cycle also cannot distinguish "deploy intentionally skipped" from "deploy ran but the ledger was not updated."
- Suggested fix: run the required root `npm run deploy` for `4733d475` or record the explicit blocker. Then update the Cycle 80 plan/index with terminal commit/push/deploy evidence and move Cycle 80 out of active state.

## Non-Findings / Not Re-Raised

- Public-route scanner coverage is no longer missing the Cycle 80 dynamic-import failure mode: the implementation classifies literal and computed dynamic imports at `apps/web/scripts/check-public-route-rate-limit.ts:320` through `apps/web/scripts/check-public-route-rate-limit.ts:338`, and fixtures cover dynamic `sharp`, dynamic `node:fs/promises`, limiter-after-import ordering, and computed imports at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:513` through `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:565`.
- i18n parity remains covered by a key-set equality gate, not value-shape equality, which preserves the documented English ICU plural / Korean fixed-form convention: `apps/web/src/__tests__/i18n-key-parity.test.ts:47` through `apps/web/src/__tests__/i18n-key-parity.test.ts:65`.
- Privacy guard coverage remains symmetric for public/admin field drift: `apps/web/src/__tests__/privacy-fields.test.ts:86` through `apps/web/src/__tests__/privacy-fields.test.ts:93`, with timeline and search enrichment exclusions at `apps/web/src/__tests__/privacy-fields.test.ts:104` through `apps/web/src/__tests__/privacy-fields.test.ts:130`.
- Touch-target audit coverage still scans shared components, admin routes, public routes, and app-level locale shell files via `apps/web/src/__tests__/touch-target-audit.test.ts:59` through `apps/web/src/__tests__/touch-target-audit.test.ts:83`; stale exemption budgets are checked at `apps/web/src/__tests__/touch-target-audit.test.ts:778` through `apps/web/src/__tests__/touch-target-audit.test.ts:786`.
- Migration/drift tests cover journal monotonicity, tag/file parity, migrate.js silent-skip postconditions, and reconcile schema/index/FK mirrors at `apps/web/src/__tests__/migration-journal.test.ts:75` through `apps/web/src/__tests__/migration-journal.test.ts:130`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:63` through `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:119`, and `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:86` through `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:218`.
- Previously deferred items have not met their recorded exit criteria and are not re-raised: `C80-06`, `C77-ARCH-01`, `C76-04`, `C76-05`, `C75-08`, and historical carry-forward items remain explicitly deferred at `.context/plans/cycle-80-2026-07-01-deferred.md:8` through `.context/plans/cycle-80-2026-07-01-deferred.md:21`.
