# Cycle 11 Test Engineer Review

Date: 2026-07-18 KST
Reviewed HEAD: `7e40e95c`
Lane: test-engineer

## Inventory and coverage

Inventoried 370 tracked unit-test files and 16 E2E/support files, then mapped them to 266 application source files, 29 scripts, 35 migrations, and 20 build/deploy configs. Reviewed the full test command/config surface, recent changed-file tests, source-contract scanners, public search E2E, focus restoration, responsive masonry, migration/privacy fixtures, queue/backfill tests, and carry-forward coverage gaps. Ran the full suite: **363 files passed, 2 expected file skips; 3,447 tests passed, 4 expected CLIP skips**. Lint/typecheck/build/audit also passed.

## TEST-C11-01 — Search E2E covers UI state but cannot detect result-link request amplification

- Severity: **Medium**
- Confidence: **High**
- Validation: **Confirmed coverage gap behind a confirmed product defect**
- Regions: implementation `apps/web/src/components/search.tsx:77-85`; current E2E `apps/web/e2e/public.spec.ts:21-49,52-69`; unit source coverage `apps/web/src/__tests__/search-disclaimer.test.ts:4-28` and `apps/web/src/__tests__/search-status-source.test.ts:1-68`.

The tests prove autofocus, focus trapping/restoration, ARIA expansion, no-results state, and topic/alias matching. None observes route requests, and no source contract requires `prefetch={false}` on `SearchResultItem`. Consequently the suite stays green while one query triggers 16 photo-detail RSC requests for 10 unique results on the deployed app.

Concrete failure: a future Next change or result-count increase multiplies prefetch traffic without any failing test, even though the repository already treats viewport prefetch as harmful on high-cardinality masonry/timeline/year/share grids.

Fix: in `public.spec.ts`, attach a request listener before filling a query, collect URLs matching localized `/p/` RSC requests, and assert zero before an option is clicked. Then click or press Enter and assert exactly the intended navigation. A small source-contract assertion on the result-link body can cheaply pin `prefetch={false}`, but the network behavior test should be authoritative.

## Final missed-issue sweep

Checked false-positive scanners, generated artifact parity, timer/debounce cleanup, fixed ports, test database isolation, real-network dependencies, mutation barriers, source-only tests, and recent width-test edge cases. The full green suite had no unexplained warnings or flakes. Historical deferred coverage gaps were not repeated because their exit criteria did not fire. No second fresh test defect was confirmed.
