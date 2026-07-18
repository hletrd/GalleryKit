# Code Reviewer — Cycle 5 Provenance

Review target: `4926a3e4` (`master == origin/master`), 2026-07-18 KST. Review only.

## Inventory and scope

I enumerated the complete maintained tree before review: 633 files under
`apps/web/src` (81 App Router files, 115 libraries, 61 components, 368 unit-test
files), 15 Playwright files, 29 scripts, 31 migration SQL files plus the Drizzle
journal/reconcile path, package/build/runtime/deploy/PWA assets, and the governing
documentation and review/plan history. I inspected the full Cycle 4-to-HEAD diff,
traced each changed symbol through callers and tests, and swept the wider
auth/rate-limit/barrier, DB/filesystem lifecycle, queue/restore, privacy, color,
image-delivery, cache, and deployment surfaces. Prior aggregates and the
carry-forward register were checked before classifying anything as new.

Evidence: ESLint, API-auth lint, action-origin/mutation-barrier lint, public-route
rate-limit lint, typecheck, production dependency audit, and the full Vitest suite
passed (361 files passed, 2 skipped; 3,409 tests passed, 4 expected CLIP skips).

## New findings

### CR-C5-01 — Responsive `sizes` rules disagree with the inclusive Tailwind column breakpoints

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed** in production for the main gallery; **source-confirmed likely** on archive/share siblings
- Regions: `apps/web/src/components/masonry-card.tsx:21,94-109,126-142`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:229,259-285`; `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:191,218-244`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:187,218-244`

The main, timeline, and year grids switch to 2/3/4/5 columns at inclusive
`sm`/`md`/`xl`/`2xl` minimum widths, but their source-size string uses inclusive
`max-width: 640/768/1280px` branches. At the exact breakpoint, the old wider slot
wins. The shared-group grid drifts over whole ranges: it is three columns from
1,024 px while advertising 50vw through 1,200 px, and four columns from 1,280 px
while advertising 33vw.

Concrete failure: fresh Chromium sessions at DPR 2 rendered the production home
grid at 768 px as three 234.66 px columns, but `sizes` selected the 50vw (384 px)
slot and fetched the 1,536w AVIF. At 769 px, the same three-column/card geometry
selected the 33vw slot and fetched the 640w AVIF. Common 768px tablet viewports
therefore download a materially larger candidate with no visual benefit.

Suggested fix: define shared layout-specific `sizes` constants using the same
minimum-width breakpoints as the Tailwind classes (and a distinct 1/2/3/4-column
constant for shared groups), then reuse them across AVIF/WebP/JPEG and fallback
paths. Add exact-boundary DPR-2 browser coverage at 640, 768, 1,024, 1,280, and
1,536 px.

### CR-C5-02 — The masonry E2E treats partial priority regressions as non-priority

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed test-logic defect; current production attributes are correct**
- Region: `apps/web/e2e/masonry-priority.spec.ts:22-49`

`isPriority` is true only when `loading="eager"` **and**
`fetchpriority="high"` are both present. A later card regressing to eager/auto or
lazy/high is filtered out, so `priorityIndices` can remain `[0]` while the browser
still receives an unintended explicit scheduling instruction.

Concrete failure: a refactor forwards only `fetchPriority` to card 6. The test
reports card 6 as non-priority and passes, although the network scheduler is again
biased toward a non-universal visual leader.

Suggested fix: collect and assert `eagerIndices` and `highPriorityIndices`
independently, each exactly `[0]`, and assert non-first cards are lazy plus
auto/absent. Preserve the geometry and request assertions.

## Final missed-issue sweep

The closing sweep rechecked all recent changes, sibling masonry surfaces, route
and action exports, migration/journal/reconcile invariants, privacy projections,
raw SQL/child processes, upload/delete/restore races, caches, listeners, and
deployment scripts. No further new code defect survived validation. Established
pool-budget, scale-out, restore-generation, and rollback risks remain
carry-forward and are not relabeled here.
