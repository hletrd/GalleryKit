# Performance Reviewer — Cycle 6 Provenance

Review target: `6e4c25c8`. I inventoried SSR/data queries, public/admin routes, components, image/Sharp/color/CLIP work, DB pool/indexes, background jobs, PWA caching, uploads/restores, and deploy/runtime assets. The recent masonry diff was traced into CSS containment and runtime candidate selection, not reviewed in isolation.

## NEW Cycle 6 finding

### PERF-C6-01 — Item-count-capped columns do not cap `contain-intrinsic-size`

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed live hint mismatch; visible shift likely/manual-validation**
- Regions: `apps/web/src/components/home-client.tsx:231-274`; `apps/web/src/components/masonry-card.tsx:52-77`; `apps/web/src/app/[locale]/globals.css:231-235`

The actual classes cap columns to `itemCount`, but `estimatedCardWidth` uses the raw breakpoint count. Live production at 1,536 px with two filtered photos showed `column-count: 2`, 744×496 cards, correct `50vw` source hints, and `contain-intrinsic-size: auto 196px`. The hint is about 60% shorter than the rendered card because it assumes five columns.

Concrete failure: if those cards start beyond the content-visibility relevance window, initial multicolumn/scroll extent is under-reserved and expands as the browser activates them. The normal tall-viewport sparse page renders the first row immediately, so CLS magnitude needs a deliberately short viewport or trace before being called universally user-visible.

Fix: compute width from `min(itemCount, breakpointMaximum)` or observe the grid/card container. Reuse the same effective-column policy for classes, source sizes, and containment hints.

## Revalidated, not new

The Cycle 5 `sizes` breakpoint issue is closed: fresh DPR-2 browser checks selected 640w at 768 px for a 234.66 px three-column home card; DPR-2 at 1,536 px selected 640w for a 288 px five-column card. The shared queue/backfill pool budget, large-map hydration, semantic scan cost, and SW/storage long-tail items remain existing carry-forward work.

## Evidence and final sweep

Full Vitest, typecheck, lint gates, and production audit passed. Browser evidence covered 393/768/1024/1536 plus the two-photo filtered state. I rechecked pagination/query/index alignment, Sharp/CLIP concurrency, pool overlap, image ladders, hydration/memo invalidation, service-worker accounting, timers/listeners, and cleanup paths. No second new performance finding survived.
