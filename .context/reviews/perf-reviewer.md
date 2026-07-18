# Performance Reviewer — Cycle 7 Provenance

Review target: `ec7fc46f`. Review only.

## Inventory and validation

I inventoried SSR/data queries, route handlers, React components, image/Sharp/color/CLIP work, DB pool/indexes, background consumers, uploads/restores, service-worker caching, and runtime/deploy assets across the full maintained tree. I traced the Cycle 6 masonry change through the public layout container, Tailwind defaults, card containment, source policy, and browser coverage. Fresh ESLint, typecheck, audit, and full Vitest passed.

## New Cycle 7 finding

### PERF-C7-01 — Ultrawide sparse galleries over-reserve virtual card height

- Severity: **Medium**
- Confidence: **High**
- Classification: **Confirmed performance/geometry mismatch; user-visible CLS/scroll effect needs browser validation**
- Regions: `apps/web/src/components/home-client.tsx:21-79,231-249`; `apps/web/src/app/[locale]/(public)/layout.tsx:17-19`; `apps/web/src/components/masonry-card.tsx:58-77`; `apps/web/src/app/[locale]/globals.css:231-235`; `apps/web/e2e/responsive-masonry.spec.ts:11-49`

`estimatedCardWidth` now uses the correct sparse column count, but still divides quantized viewport width rather than the capped grid width. The public `.container` stops growing at Tailwind's default 1,536 px while `window.innerWidth` grows indefinitely.

Concrete failure: at 2,560 px, a two-column sparse gallery estimates 1,264 px cards while rendering about 744 px cards after the container padding and 16 px gap. The intrinsic height is consequently about 70% too large for every aspect ratio. When `content-visibility:auto` skips one of those cards, the virtual scroll extent is over-reserved and contracts on activation; even when the card is immediately relevant, every viewport-width bucket change invalidates all `MasonryCard` props using a value disconnected from actual layout.

Suggested fix: observe and bucket the grid's content width, then derive card width from that single value and effective columns. Add an ultrawide sparse Playwright case; the current 1,536 px case sits exactly where the estimator accidentally agrees with the container and cannot catch the defect.

## Revalidated, not new

The prior raw-five-column sparse under-reservation is fixed at the tested 1,536 px boundary. Shared queue/backfill pool contention, large-map hydration, semantic-vector scanning, upload RSS, and service-worker long-tail items remain explicitly deferred with unchanged exit criteria; none was re-filed.

## Final missed-issue sweep

I rechecked pagination/query/index alignment, N+1/fan-out patterns, connection-hold times, queue overlap, Sharp and CLIP concurrency, image ladders, hydration/memo invalidation, cache accounting, abort/listener cleanup, and current responsive siblings. No second new performance defect survived validation.
