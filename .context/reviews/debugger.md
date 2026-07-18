# Debugger — Cycle 8 Provenance

Review target: `ff8c5f48`. Review only.

## Inventory and debugging scope

I inventoried the complete maintained source/test/script/runtime surface (671 TS/JS files, 31 migrations, 364 Vitest files plus one test stub, 14 Playwright files) before debugging the current responsive path through React state, `ResizeObserver`, Tailwind containment, CSS columns, intrinsic sizing, HTML candidate selection, fallback handling, and coverage. I also swept request guards, restore/queue failures, caches, listeners/timers, schema promotion, and release state. Focused responsive tests passed 34/34. A standalone Chromium proof at 2,560 px/DPR 1 selected 1536w for `33vw` and 640w for a `491px` slot against the same `srcset`.

## Current findings

### DBG-C8-01 — The observer fixes card height but the browser still sees the old ultrawide width

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed root cause and deterministic candidate outcome; network-byte measurement manual-validation**
- Regions: `apps/web/src/components/home-client.tsx:69-105,257-273,349-359`; `apps/web/src/lib/responsive-masonry.ts:1-7,37-54`; `apps/web/src/components/masonry-card.tsx:91-110`; `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`; `apps/web/e2e/responsive-masonry.spec.ts:11-55`

Root cause: `ResizeObserver` updates only `estimatedCardWidth`. The `<source sizes>` string is still memoized solely from `itemCount` and is built from `vw`, so it never receives the observed container measurement.

Deterministic reproduction: use three items, a 2,560 px viewport, and DPR 1. The capped/padded grid renders roughly 491 px cards and the observer produces a matching intrinsic estimate. `sizes="... 33vw"` tells the image selection algorithm the slot is roughly 845 px. Against the only masonry candidates, 640w and 1536w, 491 chooses 640 while 845 chooses 1536. The current regression uses two items at DPR 2; both the right and wrong slot widths choose the maximum 1536w candidate, so its `currentSrc` assertion cannot expose the bug.

Concrete failure: filtered/topic galleries with exactly three visible results fetch materially larger thumbnails on common DPR-1 ultrawide monitors.

Fix: cap the top-breakpoint source slot to the actual public-container geometry, then add a 2,560 px/DPR-1, three-item selection regression. Do not loosen the existing two-item geometry assertions; they test a different failure.

### DBG-C8-02 — Recovery flags remain stale after successful signed publication

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed repository-state bug; deploy completion manual-validation**
- Regions: `.context/plans/cycle-7-2026-07-18-plan.md:5,48-50,73-82`; `.context/plans/README.md:34-40`

`git log --show-signature` reports good signatures for `498e5122`, `90a3bc07`, and `ff8c5f48`; `master` and `origin/master` both resolve to `ff8c5f48`. The plan nevertheless says signed release pending and leaves the terminal checkboxes open.

Concrete failure: a resumed agent can rerun already-completed publication work or debug from the wrong start SHA.

Fix: mark the proven signed push complete, keep deploy state qualified by actual evidence, archive Cycle 7, and update the active index.

## Negative hypotheses and final missed-issue sweep

I ruled out width quantization, the 16 px gaps, invalid dimensions, `React.memo`, fallback-source removal, and DPR 2 as the root cause; DPR 2 masks rather than creates the candidate mismatch. Abort/cleanup paths, retries, queue shutdown, restore finalization, action/route error handling, and cache invalidation produced no third current actionable bug.
