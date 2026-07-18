# Critic Review — Cycle 8

Date: 2026-07-18 KST
Review HEAD: `ff8c5f48`

## Inventory and method

I inventoried the full maintained tree: 516 source `.ts` files, 113 source
`.tsx` files, 31 migrations plus journal/reconcile, server actions/routes,
scripts/configuration/deploy assets, 369 unit-test files, 16 Playwright files,
governing docs, review/plan history, and the deferred register. The Cycle 7
diff was an entry point, not the scope boundary. Cross-file traces covered
responsive layout/source selection, auth/rate limits, public/private data,
uploads/deletes/restores, background work, migrations, PWA/cache behavior,
i18n/admin UI, and release provenance.

## Findings

### CRIT-C8-01 — Responsive source policy still belongs to the viewport, not the container

- Severity / confidence / status: **Medium / High / Confirmed new Cycle 8 defect**
- Regions: `apps/web/src/lib/responsive-masonry.ts:1-6,42-57`;
  `apps/web/src/components/masonry-card.tsx:91-110`;
  `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`
- Problem: Cycle 7 made intrinsic layout container-owned but preserved
  viewport-fraction `sizes` values. Above the 1,536 px container cap, source
  selection and rendered geometry again describe different boxes.
- Concrete failure: at 2,560 px and five columns, cards render at 288 px. DPR 2
  needs 576 pixels and should use 640w, but `20vw` advertises 512 CSS px and
  causes the two-entry 640w/1536w `srcset` to select 1536w. A three-column DPR-1
  gallery similarly advertises about 845 px for a 491 px card and selects
  1536w instead of 640w.
- Fix: generate container-capped `sizes` expressions that include container
  padding and column gaps, preferably in a shared helper usable during SSR.

### CRIT-C8-02 — The new ultrawide test uses the one sparse shape that cannot reveal source overstatement

- Severity / confidence / status: **Medium / High / Confirmed test-design gap**
- Regions: `apps/web/e2e/responsive-masonry.spec.ts:11-55,57-95`;
  `apps/web/src/__tests__/responsive-masonry.test.ts:11-77`
- Problem: the only 2,560 px main-gallery case has two cards. Its real card is
  744 px and, with the coarse 640w/1536w ladder, legitimately requires 1536w at
  DPR 2. Therefore the test passes whether `sizes` is accurate or grossly
  viewport-based. Archive cases stop at 1,536 px, exactly where the container
  has not diverged materially from the viewport. Unit tests lock the literal
  `20vw`/`33vw` strings instead of testing their layout-domain accuracy.
- Concrete failure: all focused tests pass 34/34 while the five-column DPR-2
  and three-column DPR-1 counterexamples in CRIT-C8-01 still select 1536w over
  the sufficient 640w derivative.
- Fix: add a 2,560 px normal five-column case at DPR 2 and assert real card
  width plus the 640w candidate. Add a three-item/DPR-1 case if sparse policies
  remain a first-class invariant. Update unit expectations to a capped
  container expression rather than preserving the faulty literal.

### CRIT-C8-03 — Cycle 7 still says signed release pending after its signed push

- Severity / confidence / status: **Low / High / Confirmed current provenance mismatch**
- Regions: `.context/plans/cycle-7-2026-07-18-plan.md:3-5,48-50,73-82`;
  `.context/plans/README.md:34-40`; commits `498e5122`, `90a3bc07`, `ff8c5f48`
- Problem: all three Cycle 7 commits have good GPG signatures and
  `master == origin/master == ff8c5f48`, but the active plan still says
  "signed release pending" and leaves signed commits/push unchecked. Deploy
  completion is not independently established by this review, so it must not
  be invented; the signed/pushed half is nevertheless already false.
- Concrete failure: a recovery agent following the authoritative active plan
  can repeat publication work or select the wrong terminal frontier.
- Fix: reconcile the signed/pushed evidence now, record deploy evidence only
  if independently available, then archive/advance the plan according to the
  established one-cycle-later terminal-evidence pattern.

## Final missed-issue sweep

The final sweep challenged the observer lifecycle, bucket math, effective
columns, source ladder, memoization, behavior tests, route/action guards,
privacy projection, migration convergence, upload/delete/restore ordering,
background consumers, caches, build/deploy config, and every prior finding
class in current history. No fourth current issue had sufficient distinct
evidence to file.
