# Cycle 7 Critic Review

Date: 2026-07-18 KST
Review HEAD: `ec7fc46f`

## Inventory and method

I inventoried the maintained application surface (549 `.ts`, 113 `.tsx`, 31
migrations, scripts/configuration, 370 test files, 14 Playwright files), the
governing `AGENTS.md`/`CLAUDE.md`, current review and plan ledgers, and the
Cycle 6 implementation diff. I traced the responsive masonry policy through
the public layout, `HomeClient`, `MasonryCard`, CSS containment, unit tests,
browser tests, and deployed DOM. I also swept auth/action/route guards,
migrations, uploads/deletes/restores, PWA, i18n, admin/public UI, and deploy
configuration for adjacent regressions.

## Findings

### CRIT-01 — Intrinsic geometry follows the viewport instead of the capped gallery container

- Severity / confidence / status: **Medium / High / Confirmed**
- Regions: `apps/web/src/components/home-client.tsx:22-79,231-249`;
  `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`;
  `apps/web/src/components/masonry-card.tsx:23-25,52-76`;
  `apps/web/src/app/[locale]/globals.css:231-235`
- Problem: the Cycle 6 divisor fix aligns the column count, but the numerator
  remains a 48 px-quantized `window.innerWidth`. The actual gallery is inside
  `px-4` and, at desktop widths, a centered `container` capped at 1,536 px.
  The estimate therefore misses both the narrow inset and the ultrawide cap.
- Concrete failure: at 320 px, production's grid was 288 px wide while the
  rounded estimate was 336 px; 3:2 cards exposed `auto 224px` for a 192 px
  rendered height and a portrait exposed 504 px for 431.75 px (16.7% high).
  At 2,560 px, a seeded two-photo gallery had a 1,504 px grid and two 744x496
  cards, while the 2,544 px viewport bucket produced `auto 843px` (70% high).
  The full five-column gallery likewise exposed 331 px for 192 px landscape
  cards. These lengths are the cold fallback for `content-visibility:auto`;
  browsers may retain the actual size after rendering because of the `auto`
  keyword, but first-time skipped geometry is still materially wrong.
- Fix: observe or otherwise derive the masonry container's content width,
  preserve the render-throttling bucket on that width, and derive intrinsic
  height from the item-capped column width. Do not encode the current 32 px
  inset as an unexplained magic correction if a container-width boundary can
  be exposed cleanly.

### CRIT-02 — The new browser proof is structurally unable to catch the narrow-width numerator defect

- Severity / confidence / status: **Medium / High / Confirmed test gap**
- Regions: `apps/web/e2e/responsive-masonry.spec.ts:11-49`;
  `apps/web/src/__tests__/responsive-masonry.test.ts:9-53`
- Problem: the only main-gallery intrinsic-geometry browser case is a sparse
  1,536 px viewport, exactly where the container first reaches its cap and the
  padding mismatch is only about 2%; the assertion also allows 15% error. Unit
  tests cover only column and source-size helpers, not the width numerator.
  Neither the 320 px 16.7% error nor the 2,560 px 70% capped-container error is
  exercised.
- Concrete failure: the current estimator passes every focused Cycle 6 test
  despite being materially inaccurate at both ends of the responsive range.
- Fix: add seeded main-gallery cases at 320 px and an ultrawide width above the
  container cap (and retain the 1,536 px sparse case) that compare computed
  intrinsic height with rendered card height. Keep scheduling/source-size
  assertions independent from geometry so one failure identifies the contract.

### CRIT-03 — Cycle 6 remains active after its signed push and successful deploy

- Severity / confidence / status: **Low / High / Confirmed**
- Regions: `.context/plans/cycle-6-2026-07-18-plan.md:3-5,43-45,65-73`;
  `.context/plans/README.md:34-40`
- Problem: `master == origin/master == ec7fc46f`, all three Cycle 6 commits
  have good GPG signatures, and deployed production exposes the Cycle 6
  geometry policy. The plan still says "signed release pending", leaves
  push/deploy unchecked, and remains the active plan.
- Concrete failure: a recovery agent can select the wrong frontier or repeat
  terminal work.
- Fix: reconcile signed-push and production-policy evidence without claiming
  an unavailable exact deployed SHA, mark Cycle 6 complete, archive it, and
  advance the plan index.

## Final sweep

The final sweep found no additional current security, privacy, data-loss, or
migration issue that survived source/test/history validation. Existing open
architecture and operator-only items remain in the consolidated deferred
register; none of their exit criteria fired during this review.
