# Test Engineer — Cycle 8 Provenance

Review target: `ff8c5f48`, 2026-07-18 KST. Review only.

## Inventory and independent validation

I inventoried the full 671-file maintained TS/JS surface and mapped all 364 Vitest files plus one test stub and 14 Playwright files to the 80 App Router files, 116 library files, 61 component files, 28 scripts, 12 route handlers, 13 server-action modules, and 31 migrations with journal/reconcile. I reviewed the configured gate scripts, responsive fixtures/seeding, main/archive/shared masonry implementations, the Cycle 7 plan/evidence, and the current role findings. Historical coverage findings were checked at HEAD and omitted when the new 320/1,536/2,560 intrinsic-geometry cases had closed them.

Focused responsive Vitest passed 34/34. Independent standalone Chromium selection proofs against the committed 640w/1536w candidate pair confirmed all three uncovered boundaries below: `33vw` at 2,560 px/DPR 1 selects 1536w while a 491 px slot selects 640w; `20vw` at DPR 2 selects 1536w while a 288 px slot selects 640w; and `25vw` at DPR 1.25 selects 1536w while a 356 px slot selects 640w.

## Current finding

### TEST-C8-01 — Candidate coverage never crosses the post-container-cap selection boundaries

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed coverage gap with browser-reproduced counterexamples**
- Regions: `apps/web/e2e/responsive-masonry.spec.ts:4-55,57-133`; `apps/web/src/__tests__/responsive-masonry.test.ts:11-39`; policy at `apps/web/src/lib/responsive-masonry.ts:1-7,37-65`; main source set at `apps/web/src/components/masonry-card.tsx:91-110`; archive source sets at `apps/web/src/app/[locale]/(public)/timeline/page.tsx:230-275` and `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:219-235`; shared source set at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:181-188,219-235`; container boundary at `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`

The suite asserts the literal viewport-based `sizes` strings and samples candidate selection only where the viewport and capped container either still coincide or both sides choose the same coarse candidate. The main test always has two items and DPR 2; archive stops at 1,536 px; shared stops at 1,280 px. Consequently it proves column transitions but never asks whether the advertised slot and rendered slot land on different sides of the 640w/1536w boundary after the public container stops growing.

Concrete failures that all pass the current suite:

- Main, three items, 2,560 px/DPR 1: rendered slot about 491 px -> 640w is sufficient; `33vw` advertises about 845 px -> Chromium selects 1536w.
- Main/archive, five columns, 2,560 px/DPR 2: rendered slot about 288 CSS px / 576 device px -> 640w; `20vw` advertises 512 CSS px / 1,024 device px -> 1536w.
- Shared group, four columns inside the nested padded container, 2,560 px/DPR 1.25: rendered slot about 356 CSS px / 445 device px -> 640w; `25vw` advertises 640 CSS px / 800 device px -> 1536w.

Fix: after the source-size policy is made container-capped, add exact candidate regressions at those three boundaries. Seed or filter the main route to exactly three items for the DPR-1 case; retain the current two-item/DPR-2 geometry tests. Extend archive to 2,560 px/DPR 2 and shared to 2,560 px/DPR 1.25, recording real grid/card widths with `currentSrc`. Unit tests should assert the capped top-breakpoint slots rather than hard-code the current `20vw`/`25vw`/`33vw` defect. These are targeted browser cases, not a request for a combinatorial viewport matrix.

## Final missed-issue sweep

I rechecked candidate boundaries for one, two, three, four, and five columns across DPR 1/1.25/1.5/2, invalid/unmeasured width helpers, observer cleanup, memo invalidation, fallback behavior, action/route/security contracts, migration tests, upload/restore/delete paths, PWA tests, touch targets, and release checks. No second independent current coverage gap survived deduplication; the stale `MasonryCard` comments and Cycle 7 ledger are documentation findings rather than missing executable product assertions.
