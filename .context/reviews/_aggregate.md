# Cycle 8 Aggregate Review

Date: 2026-07-18 KST
Review HEAD: `ff8c5f48`

## Agent coverage

Completed and preserved provenance reviews: code-reviewer, perf-reviewer,
security-reviewer, critic, verifier, test-engineer, tracer, architect,
debugger, document-specialist, and designer. The environment exposed generic
workers rather than named reviewer registrations, and the global four-thread
limit rejected one initial batch launch; the required retry used the existing
review worker and completed successfully. No repository-local custom reviewer
definition was present.

Each lane inventoried the maintained repository before reviewing its specialty:
671 TypeScript/JavaScript files, 31 migrations plus journal/reconcile, 365+
unit-test files, 14+ Playwright files, App Router routes/actions, public/admin
components, scripts, PWA/build/deploy assets, governing documentation, and the
consolidated deferred register. The Cycle 7 diff was an entry point rather than
a scope boundary. The designer read and used the required agent-browser skill
family, then exercised production at 320, 1,536, and 2,560 CSS pixels with DOM,
accessibility, computed-style, candidate-selection, theme, keyboard, and
performance evidence.

## New deduplicated findings

### C8-01 — Responsive image hints remain viewport-owned after geometry became container-owned

- Severity / confidence: **Medium / High**
- Status: **Confirmed live runtime bandwidth defect on main and archive;
  source-confirmed conditional impact on shared groups**
- Agreement: code-reviewer, perf-reviewer, critic, verifier, test-engineer,
  tracer, architect, debugger, document-specialist, designer
- Regions: `apps/web/src/lib/responsive-masonry.ts:1-7,37-65`;
  `apps/web/src/components/home-client.tsx:257-273,349-359`;
  `apps/web/src/components/masonry-card.tsx:91-110`;
  `apps/web/src/app/[locale]/(public)/timeline/page.tsx:230-285`;
  `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:192-245`;
  `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:180-245`;
  `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`
- Failure: Cycle 7 correctly moved intrinsic card geometry to the observed,
  capped masonry container, but `sizes` still advertises `20vw`, `25vw`,
  `33vw`, and related viewport fractions. At 2,560 px/DPR 2 the public grid
  remains 1,504 px wide and a five-column card remains 288 px, so 640w covers
  its 576 device pixels; `20vw` instead advertises 512 CSS px and selects the
  1536w derivative. Production browser evidence reproduced `_640.avif` at
  1,536 px and `_1536.avif` for the same 288 px Timeline cards at 2,560 px;
  main-gallery cards after Load more reproduced the same selection. Three-item
  DPR-1 main galleries and sufficiently wide shared grids cross analogous
  640w/1536w boundaries. The selected pixel area can be roughly 5.8 times
  larger without visible-detail benefit.
- Fix: generate server-emittable source sizes from Tailwind's capped container
  widths, accumulated horizontal padding, column gaps, and effective columns.
  Reuse the policy for main, archive/year, and the nested shared-group variant;
  do not wait for hydration to downgrade an already-started resource.

### C8-02 — Browser coverage samples only candidate-equivalent ultrawide shapes

- Severity / confidence: **Medium / High**
- Status: **Confirmed test-design gap with independent Chromium counterexamples**
- Agreement: critic, verifier, test-engineer, debugger, document-specialist,
  designer
- Regions: `apps/web/e2e/responsive-masonry.spec.ts:4-133`;
  `apps/web/src/__tests__/responsive-masonry.test.ts:11-77`;
  `apps/web/scripts/seed-e2e.ts:31-82,250-304`
- Failure: the only 2,560 px main case has two 744 px cards at DPR 2, where
  both accurate and inflated hints legitimately select the maximum 1536w
  candidate. Archive coverage stops at 1,536 px, and shared coverage stops at
  1,280 px. Unit tests lock the faulty literal viewport strings. Thus all 34
  focused tests pass while a three-item 2,560/DPR-1 main grid, five-column
  2,560/DPR-2 archive grid, and sufficiently wide shared grid each expose a
  1536w-versus-640w mismatch.
- Fix: retain the existing two-item geometry cases, seed/filter an independent
  normal or three-item main shape, and add exact post-cap `currentSrc`, card
  width, column, and `sizes` assertions for main/archive and shared variants.
  Unit expectations must lock the capped container policy rather than the old
  viewport fractions.

### C8-03 — `MasonryCard` comments describe the removed viewport-width bucket

- Severity / confidence: **Low / High**
- Status: **Confirmed source-documentation drift; no current runtime failure**
- Agreement: code-reviewer, document-specialist
- Regions: `apps/web/src/components/masonry-card.tsx:16-25,176-185`;
  replacement ownership at `apps/web/src/components/home-client.tsx:69-105,
  257-273`
- Failure: the nearest prop contract still says `estimatedCardWidth` changes
  with a viewport bucket and implies a width-bucket change may bail out. Cycle
  7 removed that state: a shared `ResizeObserver` owns a container-width
  bucket, and any changed numeric width prop intentionally re-renders all
  existing cards. A maintainer following the stale contract can regress to
  window-only invalidation or expect a shallow-comparison bailout that cannot
  occur.
- Fix: name the observed container-width bucket and state the real memo
  invariant: unchanged bucket observations and unrelated parent state bail
  out; changed `estimatedCardWidth` intentionally re-renders cards.

### C8-04 — Cycle 7's active ledger contradicts its signed remote publication

- Severity / confidence: **Low / High**
- Status: **Confirmed repository-state mismatch; exact deployed SHA remains
  manual-validation**
- Agreement: code-reviewer, critic, verifier, tracer, architect, debugger,
  document-specialist
- Regions: `.context/plans/cycle-7-2026-07-18-plan.md:3-5,35-50,58-66,
  73-93`; `.context/plans/README.md:34-40`; commits `498e5122`, `90a3bc07`,
  `ff8c5f48`
- Failure: all three Cycle 7 commits have good GPG signatures and
  `master == origin/master == ff8c5f48`, but the authoritative plan still says
  signed release pending, leaves publication/deploy unchecked, and overstates
  its 2,560 px proof as matching source-size hints when it proved intrinsic
  geometry only. Recovery can repeat terminal work or select the wrong
  frontier. The review did not establish an exact deployed SHA, so that state
  must not be invented.
- Fix: qualify the Cycle 7 validation as intrinsic-geometry coverage, record
  observable signature/remote equality, archive the plan, and advance the
  index. Record deploy evidence only when independently available; document a
  terminal reconciliation convention so the same drift is not silently
  reconstructed.

## Revalidated carry-forward findings

The shared image-queue/backfill pool budget, warn-only single-writer topology,
failed-deploy rollback, SQL/file restore generation, large-map rendering,
semantic-vector scanning, upload RSS, environment-gated browser proofs, and
other explicit architecture/operator items remain in
`.context/plans/deferred-carry-forward.md` with their original severity,
confidence, reasons, and exit criteria. No exit criterion fired. Security
reviewer reported zero new security issues.

## Baseline evidence and final sweep

Fresh review baselines passed ESLint, API-auth lint, action-origin/mutation-
barrier lint, public-route-rate-limit lint, production dependency audit, 34/34
focused responsive tests, and `git diff --check`. Independent Chromium proofs
and the live designer pass confirmed the source-candidate mismatch rather than
trusting the current tests. Prompt 3 must still run every configured gate,
including build, full Vitest, and full Playwright because browser-flow coverage
is required.

The final aggregate sweep rechecked responsive siblings, memo invalidation,
route/action guards, privacy projections, migration/journal/reconcile,
upload/delete/restore races, background consumers, caches, PWA/build/runtime
configuration, deploy scripts, tests, design states, and release ledgers. No
fifth fresh finding survived validation.

## AGENT FAILURES

None. One initial worker launch was rejected by the global thread limit; the
required retry completed all assigned provenance files.
