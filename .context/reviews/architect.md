# Architect — Cycle 7 Provenance

Review target: `ec7fc46f`. Review only.

## Inventory and validation

I inventoried App Router surfaces, data/lib/component ownership, schema/migration/reconcile, jobs/scripts, tests, and build/runtime/deploy assets, then traced configuration lifetime, persistence, concurrency, privacy, cache, and responsive-layout ownership. The full maintained inventory was 671 TS/JS files, 31 migration SQL files, 364 unit-test files, and 13 Playwright specs. Fresh lint/typecheck/audit/full-unit gates passed.

## New Cycle 7 findings

### ARCH-C7-01 — Responsive geometry has a shared column policy but no shared measurement boundary

- Severity: **Medium**
- Confidence: **High**
- Classification: **Confirmed architectural invariant violation; visible symptom manual-validation**
- Regions: `apps/web/src/lib/responsive-masonry.ts:1-48`; `apps/web/src/components/home-client.tsx:21-79,231-275`; `apps/web/src/app/[locale]/(public)/layout.tsx:17-19`; `apps/web/src/components/masonry-card.tsx:58-77`; `apps/web/e2e/responsive-masonry.spec.ts:11-49`

Cycle 6 centralized item-count capping but left measurement ownership in `useColumnCount`: the layout boundary is the `.container`, while the policy consumes `window.innerWidth`. Thus one "effective column" abstraction combines a viewport-domain numerator with a container-domain rendered layout.

Concrete failure: at 2,560 px with two items the policy hands cards a 1,264 px estimated width although the capped grid renders about 744 px. The architecture is internally consistent only at or below the 1,536 px container cap; the new browser test is located exactly at that accidental equality.

Suggested fix: make the masonry grid own its measured content width and expose one responsive-geometry value object (observed width, effective columns, estimated card width, source-size policy). Keep viewport breakpoints only for choosing the maximum columns; do not use viewport width as container width.

This drains the concrete consequence of the prior review's optional container-observation note; it is not a duplicate of the fixed raw-column defect.

### ARCH-C7-02 — Release workflow state is reconstructed one cycle late

- Severity: **Low**
- Confidence: **High**
- Classification: **Confirmed state-model drift; exact production identity manual-validation**
- Regions: `.context/plans/cycle-6-2026-07-18-plan.md:3-5,43-45,65-73`; `.context/plans/README.md:34-41`

The current plan is committed in a pre-publication state, while publication and deployment happen after that commit. The next review must therefore rediscover and repair the terminal state every cycle; Cycle 5 was just archived for the same reason.

Concrete failure: the repository's authoritative recovery state is stale immediately after a successful cycle, despite Git already proving signed remote publication through `ec7fc46f`.

Suggested fix: add a terminal reconciliation artifact or post-push ledger update that can record signature/remote/deploy evidence without rewriting a published commit. At minimum, reconcile and archive Cycle 6 now.

## Revalidated architecture risks and final sweep

I rechecked module boundaries, cache/config lifetime, DB/file dual-write flows, restore fences, process-local coordination, background pool overlap, migration ownership, storage quarantine, and PWA/runtime boundaries. Existing broad risks retain their carry-forward IDs and exit criteria. No third fresh architectural break survived.
