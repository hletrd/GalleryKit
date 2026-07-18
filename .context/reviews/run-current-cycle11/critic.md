# Cycle 11 Critic Review

Date: 2026-07-18 KST
Reviewed HEAD: `7e40e95c46e09faf5faf6e87989a5586874b02d1`
Lane: critic

## Inventory and coverage

Inventoried all 3,679 tracked files: 266 non-test application source files, 370 unit-test files, 16 E2E files, 29 scripts, 35 migration/journal files, 20 deployment/build configuration files, 8 current documentation files, 515 plan records, 2,392 review records, 4 assets, and 24 remaining tracked files. The 2,907 historical review/plan records were routed through the current plan index, Cycle 10 aggregate/provenance, consolidated carry-forward register, and targeted history searches rather than treated as current truth. Read `AGENTS.md` and `CLAUDE.md`; inspected the last four commits and the complete Cycle 10 change; traced `derivative_max_width` from migration/schema through encoder, queue, both backfills, selects, five responsive consumers, and tests.

Repository-wide checks covered public/admin routes, actions and API guards, database/migration symmetry, image/color pipeline, PWA/service worker, localization, components, deployment config, scripts, tests, and docs. Full blocking evidence run in this review: lint, API-auth lint, action-origin lint, public-route rate-limit lint, typecheck, build, production audit, and Vitest (363 passed files / 3,447 passed tests, expected skips only). Live browser evidence covered the deployed public app at desktop/mobile sizes.

## CRT-C11-01 — Search results eagerly prefetch a burst of dynamic photo pages

- Severity: **Medium**
- Confidence: **High**
- Validation: **Confirmed** (source + isolated deployed-network reproduction)
- Regions: `apps/web/src/components/search.tsx:77-85`; contrast with `apps/web/src/components/masonry-card.tsx:80-83`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:249-251`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:209-211`, and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:200-205`.

`SearchResultItem` renders up to 20 dynamic photo-detail links without `prefetch={false}`. Next therefore viewport-prefetches result routes as soon as the list appears. In a fresh browser session the deployed home page made zero `/en/p/*` requests before search. After entering one query, it made 16 photo-page RSC requests for 10 unique ids, including six ids fetched twice with different `_rsc` keys; 13 results were visible and 20 were mounted. The high-cardinality gallery/archive/share grids already disable this exact prefetch class.

Concrete failure scenario: a visitor types several debounced queries on a mobile or metered connection. Each result refresh can start a burst of dynamic SSR/RSC work for photos the visitor never opens, competing with result thumbnails and the search action, increasing server/database load, and spending bandwidth. Duplicate prefetch keys make the cost larger than one request per likely destination.

Fix: add `prefetch={false}` to the result link. If intentional prefetch is desired, prefetch only the keyboard-active/hovered result after a short dwell and ensure only one route-cache key is used. Add an E2E request counter that proves a populated result list generates no `/p/` RSC requests until activation.

## Final missed-issue sweep

Rechecked the Cycle 10 width fix for below-first, between-size, above-largest, null legacy, WI-15 downscale, alias deduplication, CDN URL, fallback, schema/reconcile, privacy, and both backfill branches; no regression survived. Rechecked open carry-forward findings and did not duplicate any item whose exit criterion remains unmet. No second current correctness, security, data-loss, documentation, or product defect was confirmed.
