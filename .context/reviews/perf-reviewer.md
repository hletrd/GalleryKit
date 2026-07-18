# Performance Reviewer — Cycle 5 Provenance

Review target: `4926a3e4`, 2026-07-18 KST. Review only.

## Inventory and method

The complete performance surface was inventoried: SSR/data queries, public and
admin routes, 61 components, image/Sharp/color/CLIP pipelines, queue/backfill and
maintenance writers, DB pool/indexes, pagination/cardinality, PWA caching,
uploads/restores, and deploy/runtime assets. I reviewed all recent changes and
swept CPU, memory, DB occupancy, I/O, hydration, layout, image selection, and
listener/timer lifecycles. Prior performance findings and the consolidated
deferred register were used for deduplication.

## New finding

### PERF-C5-01 — Breakpoint-misaligned `sizes` fetches oversized masonry derivatives

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed live** for the main gallery; **likely/source-confirmed** for duplicated archive/share rules
- Regions: `apps/web/src/components/masonry-card.tsx:21,94-109`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:229,259-285`; `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:191,218-244`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:187,218-244`

The CSS columns use inclusive min-width Tailwind breakpoints, while the responsive
image hints use inclusive max-width ranges that assign the previous, wider slot
at 640/768/1280 px. The shared-group rules also miss its `lg` and four-column
`xl` widths over broad ranges.

Concrete failure: on a fresh DPR-2 Chromium load at exactly 768 px, production
rendered a 234.66 px three-column card but advertised a 384 px slot and selected
the 1,536w AVIF. A fresh 769 px load with the same card geometry selected 640w.
This wastes transfer, decode memory, and image work at a common tablet width.

Suggested fix: align `sizes` to the exact min-width column policy, centralize the
main/archive and shared-grid variants, and browser-test candidate selection at
every boundary with a high-DPR context.

## Revalidated, not new

The shared image-queue/admin-backfill DB-pool budget, large-map hydration, and
repeated semantic-vector scan costs remain authoritative carry-forward items.
Their exit criteria did not fire in this review.

## Final sweep

Query/index alignment, pagination bounds, Sharp/CLIP concurrency, combined pool
occupancy, service-worker accounting, currentSrc selection, state growth, and
cleanup paths were rechecked. No other new performance issue survived.
