# Test Engineer — Cycle 5 Provenance

Review target: `4926a3e4`. I inventoried 368 unit-test files, 15 Playwright files,
the scanner fixtures, type/build scripts, and every source area changed since
Cycle 4's review baseline. Full Vitest passed: 361 files passed, 2 skipped;
3,409 tests passed, 4 expected model-weight skips.

## New findings

### TEST-C5-01 — Masonry priority regression test misses eager-only and high-only regressions

- Severity / confidence: **Medium / High**
- Status: **Confirmed coverage defect; current runtime is not broken**
- Region: `apps/web/e2e/masonry-priority.spec.ts:22-49`
- Concrete miss: `isPriority` is the conjunction of `loading=eager` and `fetchpriority=high`. Card 6 can receive one of those explicit signals and remain absent from `priorityIndices`; `[0]` still passes.
- Suggested fix/regression: record `{loading, fetchPriority}` per card, assert eager indices exactly `[0]`, high indices exactly `[0]`, and all other cards lazy plus auto/absent. Keep geometry, no-media-preload, and request checks separate.

### TEST-C5-02 — No test crosses the CSS-column and `sizes` policies at exact breakpoints

- Severity / confidence: **Medium / High**
- Status: **Confirmed missing regression for a live bug**
- Regions: responsive strings in `masonry-card.tsx:21`, `timeline/page.tsx:264-274`, `year/[year]/page.tsx:223-233`, and `g/[key]/page.tsx:223-233`; existing viewport list at `apps/web/e2e/masonry-priority.spec.ts:4-7`
- Concrete miss: the E2E uses 393 and 1536 px only. It cannot detect the 640/768/1280 inclusive-boundary mismatch or the shared grid's missing 1024/1280 slot transitions. Fresh DPR-2 browser proof at 768 versus 769 selected 1536w versus 640w for equivalent three-column geometry.
- Suggested fix/regression: parameterize boundary-minus-one/boundary/boundary-plus-one at DPR 2 and assert column count, card width, advertised source slot, and selected candidate class. Cover the shared-group layout separately.

## Final missed-test sweep

I checked skips/suppressions, scanner reach, source-only contracts, mutation guards,
privacy symmetry, migration fixtures, async cleanup, and recent browser specs. No
other new unsafe suppression or false-green assertion survived.
