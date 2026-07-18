# Debugger — Cycle 7 Provenance

Review target: `ec7fc46f`. Review only.

## Inventory and validation

I debugged the current responsive change through React state, width bucketing, Tailwind layout, CSS containment, aspect-ratio conversion, source selection, Playwright coverage, and release state. I also swept request guards, restore/queue failure paths, caches, listeners, and recent regression surfaces across the full inventory. Fresh lint/typecheck/audit/full Vitest passed.

## New Cycle 7 findings

### DBG-C7-01 — The fix is correct at the test width and wrong immediately above the container cap

- Severity: **Medium**
- Confidence: **High**
- Classification: **Confirmed root cause; user-visible activation shift manual-validation**
- Regions: `apps/web/src/components/home-client.tsx:21-79,231-249`; `apps/web/src/app/[locale]/(public)/layout.tsx:17-19`; `apps/web/src/components/masonry-card.tsx:58-77`; `apps/web/src/app/[locale]/globals.css:231-235`; `apps/web/e2e/responsive-masonry.spec.ts:11-49`

Root cause: Cycle 6 fixed the denominator but not the numerator. `effectiveColumnCount` belongs to the rendered grid, while `viewportWidth` belongs to the browser window. Tailwind's parent container stops at 1,536 px, so those values diverge on ultrawide displays.

Reproduction by deterministic source math: at 2,560 px, width buckets to 2,544; two items produce two columns; estimate is `(2544 - 16) / 2 = 1264`. The container content is about 1,504 px, so the real card is `(1504 - 16) / 2 = 744`. `MasonryCard` multiplies each by the same `height / width`, so the hint is 70% too tall. This is not breakpoint ordering, invalid dimensions, or stale memoization.

Concrete failure: `content-visibility:auto` can reserve the oversized height and collapse it when the card becomes relevant. The regression test uses 1,536 px, where its `±15%` assertion passes because the parent has not diverged from the viewport.

Suggested fix: measure the grid with `ResizeObserver`, bucket the observed width, and add a 2,560 px sparse regression. A hard `Math.min(viewportWidth, 1536) - padding` clamp is less robust because it duplicates container configuration.

### DBG-C7-02 — Release recovery flags are stale after successful signed publication

- Severity: **Low**
- Confidence: **High**
- Classification: **Confirmed repository-state bug; deploy completion manual-validation**
- Regions: `.context/plans/cycle-6-2026-07-18-plan.md:5,43-45,65-73`; `.context/plans/README.md:34-41`

`git log --show-signature` reports good signatures for `fcbce386`, `03a96a3d`, and `ec7fc46f`, and both local and remote refs equal `ec7fc46f`. The plan nevertheless says signed release pending and leaves signed push/deploy unchecked.

Concrete failure: a resumed agent follows the authoritative unchecked instructions and can rerun terminal actions that already occurred.

Suggested fix: mark the proven signed push complete, keep deploy status qualified by actual evidence, archive the plan, and update the active index.

## Negative hypotheses and final missed-issue sweep

I ruled out the 48 px bucket alone (it contributes at most 24 px error), invalid image dimensions (guarded), source-candidate selection, and stale React memo props as causes of the 520 px width discrepancy. I also reviewed abort/cleanup paths, retry loops, queue shutdown, restore marker finalization, route/action error handling, and cache invalidation. No third new latent bug survived.
