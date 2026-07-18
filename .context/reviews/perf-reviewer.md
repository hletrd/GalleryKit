# Performance Reviewer — Cycle 8 Provenance

Review target: `ff8c5f48`. Review only.

## Inventory and validation

I inventoried SSR/data queries and indexes, public/admin routes and actions,
React rendering and hydration, image/Sharp/color/CLIP paths, DB-pool and
background consumers, upload/restore memory, service-worker caches, build and
runtime configuration, 369 unit-test files, and 16 browser files. I traced the
Cycle 7 width fix through the public container, `ResizeObserver`, width
quantization, effective columns, MasonryCard containment, responsive `sizes`,
the two-candidate grid `srcset`, and all responsive browser cases.

Fresh focused tests passed 34/34, the three route/action security-performance
guard lints passed, the production audit reported zero vulnerabilities, and
`git diff --check ec7fc46f..ff8c5f48` passed.

## New Cycle 8 finding

### PERF-C8-01 — Ultrawide `sizes` still describes the viewport after geometry moved to the capped container

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed current bandwidth/candidate-selection defect; new Cycle 8 finding**
- Regions: `apps/web/src/lib/responsive-masonry.ts:1-6,42-57`;
  `apps/web/src/components/home-client.tsx:257-272,350-360`;
  `apps/web/src/components/masonry-card.tsx:91-110`;
  `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`

Cycle 7 correctly moved intrinsic geometry to the observed, capped grid width,
but image candidate selection still advertises fixed viewport fractions such
as `33vw` and `20vw`. The public container stops at 1,536 px and its horizontal
padding leaves a 1,504 px content box, so those declarations increasingly
overstate actual card width above the cap.

Concrete failure with the default two-candidate masonry ladder (640w/1536w):

- At a 2,560 px viewport with five columns, the real card is
  `(1504 - 4*16) / 5 = 288` CSS px. A DPR-2 display needs 576 source pixels, so
  640w is sufficient. `20vw` instead declares 512 CSS px and asks for about
  1,024 source pixels, selecting 1536w.
- With three columns at DPR 1, the real card is about 491 px and needs 640w;
  `33vw` declares about 845 px and selects 1536w.

Thus the layout/containment fix can be visually correct while each affected
tile downloads the much larger derivative. AVIF/WebP/JPEG byte ratios vary by
photo, but the selected pixel area can be roughly 5.8 times the 640w candidate.

Suggested fix: make `sizes` model the capped/padded container, using a
server-emittable CSS expression such as `calc()`/`min()` for each effective
column count and gap, rather than waiting for the client observer. Reuse that
policy for archives and shared groups where their containers match. Add an
ultrawide full-grid browser assertion that proves the 640w candidate on DPR 2;
the current sparse two-item case legitimately needs 1536w and cannot expose
this defect.

## Revalidated, not new

The Cycle 7 intrinsic-size fix itself is correct: measured width is owned by one
grid observer, quantized once, divided by item-capped effective columns, and
cleaned up on unmount. Shared queue/backfill DB saturation, map scale, semantic
vector scans, upload RSS, and service-worker long-tail items remain explicitly
deferred with unchanged exit criteria and were not re-filed.

## Final missed-issue sweep

The final sweep revisited query/index alignment, N+1 and fan-out shapes,
connection hold time, background-worker overlap, Sharp/CLIP concurrency,
responsive image ladders, hydration/memo invalidation, observer cleanup,
containment/CLS, cache accounting, listener/abort cleanup, and deploy/runtime
assets. No second distinct current performance defect survived history and
source validation.
