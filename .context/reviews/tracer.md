# Tracer — Cycle 13

Review target: `8bd8999f`. Review only.

## Inventory and causal method

I read the repository instructions and complete maintained inventory, then traced request authentication to mutations, upload to derivative metadata, delete to durable cleanup, restore to post-import migration, migration journal to real pending upgrade and reconciliation, and capture-date storage to both public archive consumers. Competing hypotheses were checked with source, focused tests, and disposable MySQL 8.4 execution; the temporary container was stopped and removed.

## TRC-C13-01 — the public year validator and archive range disagree at the type boundary

- Severity: **Medium**
- Confidence: **High**
- Label: **Confirmed**
- Exact regions: validator `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:37-43,82-86`; timeline parsing `apps/web/src/app/[locale]/(public)/timeline/page.tsx:68-79`; range construction/use `apps/web/src/lib/data-timeline.ts:97-107,202-209`

Trace: route accepts `9999` → `getYearInReviewImages(9999)` delegates to `getTimelineImages(9999)` → `archiveRange` increments the year → query binds `capture_date < '10000-01-01 00:00:00'` → MySQL 8.4 raises `ER 1525`. The competing hypothesis that MySQL merely returns no rows was disproved by live execution. The competing hypothesis that the route rejects the value is disproved by the explicit `yearNum > 9999` condition. Timeline parsing is looser still and admits `0000`.

Concrete scenario and fix are the same as DBG-C13-01: centralize domain validation and special-case the maximum representable year without constructing an out-of-domain exclusive bound.

## TRC-C13-02 — the new year index is selected, but a redundant predicate defeats its covering shape

- Severity: **Medium**
- Confidence: **High**
- Label: **Confirmed query-plan defect; production-cardinality latency needs manual validation**
- Exact regions: index `apps/web/src/db/schema.ts:133-139`; query `apps/web/src/lib/data-timeline.ts:145-166`; live proof omission `apps/web/scripts/check-schema-convergence.mjs:185-224`; source-only assertion `apps/web/src/__tests__/data-timeline.test.ts:100-106`

Trace: `capture_year` is generated as `YEAR(capture_date)`, so `capture_date IS NOT NULL` and `capture_year IS NOT NULL` are equivalent for this purpose. Nevertheless `getTimelineYears()` filters on the former while the new index contains only `(processed, capture_year)`. A disposable MySQL 8.4 `EXPLAIN FORMAT=JSON` therefore used only the `processed` key part, reported `using_index: false`, included `capture_date` in `used_columns`, and attached a base-row `capture_date is not null` condition. Replacing that predicate with `capture_year IS NOT NULL` used both key parts and reported `using_index: true`.

Concrete scenario: a large gallery still performs base-table reads for every processed year candidate on every uncached `/timeline` request. The migration removes the `YEAR()` expression and filesort, but the redundant predicate leaves avoidable row fetches and weakens the intended scale fix.

Fix: filter on `capture_year IS NOT NULL` (or remove the redundant null predicate and rely on the result filter), then extend the disposable MySQL lane with the real distinct-year query and assert the expected key parts plus covering/index-only access at representative cardinality.

## Final missed-issue sweep

I retraced the real 0031→0033 upgrade, hash recording, same-name definition repair, date semantics, explicit-year parallelism, privacy omissions, restore barriers, and file-cleanup interleavings. No third causal break survived competing-hypothesis checks.
