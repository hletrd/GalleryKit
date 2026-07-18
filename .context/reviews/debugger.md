# Debugger — Cycle 6 Provenance

Review target: `6e4c25c8`. I debugged recent responsive changes through React state, Tailwind/CSS columns, browser source selection, content visibility, tests, and release state, while checking competing explanations in production.

## NEW Cycle 6 finding

### DBG-C6-01 — Sparse-card intrinsic height is derived from the wrong column-count branch

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed cause and live computed-style mismatch; visible shift manual-validation**
- Regions: `apps/web/src/components/home-client.tsx:27-79,231-274`; `apps/web/src/components/masonry-card.tsx:52-77`; `apps/web/src/app/[locale]/globals.css:231-235`

Causal chain: 1,536 px makes `useColumnCount()` return 5 → two loaded items make the CSS policy render 2 columns → `estimatedCardWidth` still computes `(1536 - 4×16) / 5 ≈ 294` → a 3:2 card gets `contain-intrinsic-size: auto 196px` → actual two-column width is 744 and rendered height is 496. The source-size helper independently uses two columns and correctly emits `50vw`, proving this is not stale deployment or a browser `sizes` interpretation issue.

Concrete failure: when content visibility defers the sparse grid, activation replaces the 196 px stand-in with about 496 px, altering scroll/layout geometry. A normal-height viewport paints the first row immediately, so a visible jump was not claimed without the short-viewport case.

Fix: cap the estimator with the same effective columns as the CSS and sizes, or measure the actual container/card.

## Negative hypotheses and final sweep

The Cycle 5 one-pixel candidate flip is fixed: 768 px DPR-2 now renders three columns and selects 640w. Independent eager/high attributes are correct in production. I also traced stale requests, memo prop identity, image fallback, resize rAF cleanup, route/action guard failures, restore/queue shutdown, cache invalidation, and deploy state. No additional new debugger finding survived.
