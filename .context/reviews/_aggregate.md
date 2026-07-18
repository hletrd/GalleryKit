# Cycle 6 Aggregate Review

Date: 2026-07-18 KST
Review HEAD: `6e4c25c8`

## Agent coverage

Completed provenance reviews: code-reviewer, perf-reviewer,
security-reviewer, critic, verifier, test-engineer, tracer, architect,
debugger, document-specialist, and designer. The global thread limit exposed
one child review slot. One review worker therefore covered all eleven named
lenses and wrote the required per-role files; the aggregation pass then
revalidated every candidate against source, Git history, governing docs, and
the worker's production-browser evidence.

The review inventory covered 629 maintained TypeScript/JavaScript files under
`apps/web/src`, 370 unit-test files, 14 Playwright files, public/admin route and
action boundaries, 31 migration SQL files plus journal/reconcile, scripts,
PWA/build/deploy assets, governing documentation, current plans, and the
consolidated deferred register. The Cycle 5 diff was an entry point, not a
scope boundary.

## New deduplicated findings

### C6-01 — Sparse-gallery intrinsic sizing uses the uncapped viewport column count

- Severity / confidence: **Medium / High**
- Status: **Confirmed live geometry mismatch; visible relayout requires a
  deliberately deferred/short-viewport proof**
- Agreement: code-reviewer, perf-reviewer, critic, verifier, tracer,
  architect, debugger, document-specialist, designer
- Regions: `apps/web/src/components/home-client.tsx:27-79,231-274`;
  `apps/web/src/components/masonry-card.tsx:52-77`;
  `apps/web/src/app/[locale]/globals.css:231-235`
- Failure: the CSS classes and `responsiveSizes` cap their effective columns
  by `itemCount`, but `estimatedCardWidth` divides by the raw breakpoint count
  returned by `useColumnCount()`. Production at 1,536 px with two filtered
  photos rendered two 744 x 496 cards and correctly advertised `50vw`, while
  computed `contain-intrinsic-size` was `auto 196px`, derived from a five-column
  estimate. When content visibility defers that grid, activation can replace
  a roughly 196 px stand-in with a 496 px card and alter scroll geometry.
- Fix: derive one item-count-capped effective column count and use it for the
  width estimate as well as layout/source policy. Keep the implementation
  bounded to the existing viewport assumption unless container observation is
  separately justified, and add regression coverage for sparse counts.

### C6-02 — Browser coverage never executes the changed main-gallery item-count policy

- Severity / confidence: **Medium / High**
- Status: **Confirmed test-design gap; current production source sizing is
  correct**
- Agreement: code-reviewer, critic, verifier, test-engineer
- Regions: `apps/web/e2e/responsive-masonry.spec.ts:4-85`;
  `apps/web/src/__tests__/responsive-masonry.test.ts:8-42`;
  `apps/web/src/__tests__/masonry-card-memo.test.ts:99-177`;
  `apps/web/src/components/home-client.tsx:231-274,323-334`
- Failure: the new E2E visits timeline and shared-group routes only. Unit tests
  validate the pure helper and source/replica contracts, but no behavioral
  test proves that `HomeClient` passes its live item count, emits matching CSS
  columns and source sizes, or caps the intrinsic estimator. Hard-coding
  `getMainMasonrySizes(5)` in the home integration could therefore regress
  one-to-four-photo galleries while every new test stays green.
- Fix: extract the main-gallery effective-column/width arithmetic into the
  client-safe responsive policy and cover the actual `HomeClient` wiring with
  behavioral assertions rather than another source replica. Add browser proof
  where the existing deterministic fixture can exercise the main route;
  otherwise keep the unit boundary honest about what it proves.

### C6-03 — Cycle 5 remains active and “signed release pending” after publication

- Severity / confidence: **Low / High**
- Status: **Confirmed signed push; exact deployed SHA remains manual-validation**
- Agreement: critic, verifier, tracer, document-specialist
- Regions: `.context/plans/cycle-5-2026-07-18-plan.md:3-5,47-49,70-78`;
  `.context/plans/README.md:34-40`
- Failure: commits `baec70b5`, `45a9417f`, and `6e4c25c8` have good
  signatures, and `master == origin/master == 6e4c25c8`; production also
  exposes the new responsive policy. The authoritative plan nevertheless
  leaves push/deploy unchecked and remains active, so recovery can repeat
  terminal work or choose the wrong frontier.
- Fix: reconcile the observable signed-push and live-policy evidence without
  claiming an unavailable exact production SHA, archive Cycle 5, and advance
  the plan index.

## Revalidated carry-forward findings

Cycle 5 centralized responsive source-size literals but did not make layout,
effective-column, and intrinsic-geometry ownership singular. C6-01 is the
newly confirmed concrete failure of that residual; the broader ownership
concern remains context rather than a second finding. The shared image-queue /
backfill pool budget, warn-only single-writer topology, failed-deploy rollback,
SQL/file restore generation, large-map rendering, semantic-vector scanning,
and environment/manual browser proofs remain in
`.context/plans/deferred-carry-forward.md` with their original severity,
confidence, reason, and exit criteria. No exit criterion silently fired.

## Baseline evidence and final sweep

The review worker reported green ESLint, API-auth lint, action-origin/mutation-
barrier lint, public-route-rate-limit lint, typecheck, production dependency
audit, focused responsive/memo tests (16/16), and full Vitest (362 files
passed, 2 skipped; 3,415 tests passed, 4 expected skips). Production browser
checks covered 393, 768, 1,024, and 1,536 CSS pixels plus a two-photo sparse
filter, nav/search interaction, accessibility snapshots, computed styles,
responsive `currentSrc`, and console/error state. These are Prompt 1 review
baselines; Prompt 3 must still run every configured gate against the final
implementation tree.

The final aggregate sweep rechecked responsive siblings, memo invalidation,
route/action guards, privacy projections, migration/journal/reconcile,
upload/delete/restore races, background consumers, caches, PWA/build/runtime
configuration, deploy scripts, tests, and release ledgers. No fourth fresh
finding survived validation, and security-reviewer reported zero new security
issues.

## AGENT FAILURES

The second parallel reviewer launch was rejected by the global thread limit;
the required retry was rejected for the same reason. The available worker
completed all eleven required perspectives and separate provenance files, so
no named review perspective was dropped.
