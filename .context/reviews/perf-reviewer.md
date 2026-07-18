# Performance Review — Cycle 13/100

Reviewed HEAD: `8bd8999f`

## Inventory and coverage

Inventoried all tracked application, script, migration, test, workflow, and
operator-documentation files, then traced the Cycle 12 schema/timeline change
surface through `data-timeline.ts`, both archive routes, Drizzle schema,
migrations, legacy reconciliation, convergence CI, tests, and the production
workflow. The final sweep covered request sequencing, query sargability and
covering-index behavior, large-result limits, image delivery, client hydration,
and shared-state/concurrency risks.

## PERF-C13-01 — Timeline year discovery defeats its new covering index

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed issue; representative-cardinality latency remains manual validation**
- Region: `apps/web/src/lib/data-timeline.ts:149-164`; index definition at
  `apps/web/src/db/schema.ts:135` and migration
  `apps/web/drizzle/0033_capture_year_index.sql:4`.
- Evidence: the new index contains only `(processed, capture_year)`, and the
  query selects/order-deduplicates `capture_year`, but its predicate still
  checks `capture_date IS NOT NULL`. MySQL must read that non-index column from
  the clustered row for candidate entries, so the query is no longer covered.
  The generated `capture_year` is null exactly when nullable `capture_date` is
  null, making the base-column predicate unnecessary.
- Concrete failure: on a large gallery, every uncached `/timeline` request does
  row lookups across all processed capture-year entries before it can return a
  handful of distinct years, retaining avoidable MySQL I/O after migration 0033
  was introduced specifically to bound this request-time work.
- Suggested fix: filter on `isNotNull(images.capture_year)` instead, preserving
  the same result set while allowing the `(processed, capture_year)` index to
  cover the query. Pin the generated-column predicate in the query contract test
  and the executable MySQL convergence probe.

## Final sweep

No additional confirmed CPU, memory, network, client-responsiveness,
concurrency, or image-loading regression survived validation. The new explicit
year photo query is correctly started in parallel with other request-time work.
