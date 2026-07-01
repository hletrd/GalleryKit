# Cycle 77 Code Reviewer

Reviewed HEAD: `8aefc3659fa8b6c08bff0da62d29b9ceb40029c5`

## Inventory

- Required guidance/context read: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-76-2026-07-01/_aggregate.md`, `.context/plans/cycle-76-2026-07-01-plan.md`, `.context/plans/cycle-76-2026-07-01-deferred.md`.
- Current HEAD changes inspected: Cycle 76 backfill row-absence confirmation in `apps/web/src/lib/admin-backfill-runner.ts` and `apps/web/scripts/backfill-color-pipeline.ts`; per-photo OG validator inputs in `apps/web/src/app/api/og/photo/[id]/route.tsx`; focused regression tests; review/plan ledger updates; `.gitignore` plan allowlist.
- Source areas swept beyond the diff: public/admin image select privacy guards in `apps/web/src/lib/data.ts` and `apps/web/src/__tests__/privacy-fields.test.ts`; OG rate limiting and fallback cache behavior; admin API/auth-origin/public-route guard scripts; image queue delete-during-processing cleanup; sibling `affectedRows` call sites; color/HDR public/admin render gates in `ColorDetailsSection`, `LightboxColorPip`, `InfoBottomSheet`, and `PhotoViewer`.
- Relevant code citations checked:
  - Backfill existence confirmation: `apps/web/src/lib/admin-backfill-runner.ts:462`, `apps/web/src/lib/admin-backfill-runner.ts:468`, `apps/web/src/lib/admin-backfill-runner.ts:612`, `apps/web/src/lib/admin-backfill-runner.ts:650`.
  - Sidecar partition and confirmation: `apps/web/scripts/backfill-color-pipeline.ts:159`, `apps/web/scripts/backfill-color-pipeline.ts:175`, `apps/web/scripts/backfill-color-pipeline.ts:439`, `apps/web/scripts/backfill-color-pipeline.ts:485`.
  - Per-photo OG validator: `apps/web/src/app/api/og/photo/[id]/route.tsx:56`, `apps/web/src/app/api/og/photo/[id]/route.tsx:139`, `apps/web/src/app/api/og/photo/[id]/route.tsx:151`.
  - Privacy/admin-only field guards: `apps/web/src/lib/data.ts:368`, `apps/web/src/lib/data.ts:473`, `apps/web/src/__tests__/privacy-fields.test.ts:7`.

## Findings

No confirmed new findings in this lane.

The Cycle 76 fixes appear internally consistent: zero-row backfill updates now require a row-absence probe before deleting derivatives; detection-failure counters are walked back only for confirmed deleted rows; and per-photo OG ETags now include sorted configured sizes, derivative byte-impact settings hash, and `IMAGE_PIPELINE_VERSION` before the 304 branch.

Verification run:

- `npm test --workspace=apps/web -- --run src/__tests__/admin-backfill-runner-deleted-mid-reencode.test.ts src/__tests__/admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts src/__tests__/og-route-rate-limit-behavior.test.ts` - passed, 4 files / 32 tests.
- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `git diff --check` - passed.

## Deferred/Historical Not Re-raised

- `C76-04` bottom-sheet dropdown portal coverage and `C76-05` `getImageProcessingState` test depth remain deferred by `.context/plans/cycle-76-2026-07-01-deferred.md`; I did not re-open them because this HEAD does not touch those components/helpers beyond the scheduled OG/backfill work.
- Carry-forward deferred items listed in Cycle 76, including `C75-08`, remain unchanged; no new evidence changed their severity or exit criteria.
- I checked sibling `affectedRows === 0` sites after the Cycle 76 backfill fix. The installed mysql2 client flags currently include `FOUND_ROWS`, matching older repo verification that same-value updates report matched rows in this workspace. I did not raise those sibling call sites as current bugs; the new backfill row-existence probe is still defensive if driver flags/configuration ever differ.

## Final Sweep

- Guard sweep: admin API exports still pass `withAdminAuth`; mutating server actions still pass same-origin lint; expensive/mutating public API routes still pass rate-limit lint.
- Privacy sweep: public selects still omit GPS, original/user filenames, admin-only color/HDR internals, upload attribution, processing diagnostics, and pipeline version; map select keeps only the documented latitude/longitude exception.
- Photographer-facing sweep: public HDR badges remain admin-gated; public wide-gamut fields continue to use public-safe primaries and delivered AVIF bit-depth only; OG fallback paths remain no-store for temporary derivative misses.
- Residual risk: this was a review/inspection lane with focused tests and lint guards, not a full `npm run build` / full-suite rerun. No source files were modified.
