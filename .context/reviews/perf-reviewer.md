# Performance Reviewer — Cycle 12 Provenance

Review target: `ff6532f4` (`master` / `origin/master` at review start). Review only; no product code or plan was modified.

## Inventory and method

I read the repository guidance and inventoried all request-time and background performance surfaces across 516 source `.ts` files, 113 `.tsx` files, 12 route handlers, 13 action modules, 116 libraries, 61 components, 30 operational scripts, 33 migrations, 371 unit-test/fixture files, and 16 browser files. The pass covered public/admin queries and index alignment, RSC/SSR waterfalls and caching, client hydration/listeners/timers, responsive image selection, Sharp/CLIP CPU and memory, upload/restore buffering, service-worker caching, queue/backfill/maintenance connection ownership, bounded in-memory state, file cleanup concurrency, and the full post-Cycle-11 diff.

Fresh focused validation passed 137/137 tests. A local MySQL server was not available, so the query-plan/latency portion of the finding below remains explicitly manual-validation work.

## PERF-C12-01 — the timeline year scrubber still performs an O(N) expression scan on every uncached page request

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed query shape and uncached call frequency; production `EXPLAIN ANALYZE`/latency requires manual validation**
- Exact regions: `apps/web/src/lib/data-timeline.ts:145-165`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:21,63-96`; related index definitions at `apps/web/src/db/schema.ts:131-138` and `apps/web/drizzle/0032_capture_date_indexes.sql:1-13`.

`getTimelineYears()` selects and sorts `DISTINCT YEAR(capture_date)`. The new capture indexes begin with `(processed, capture_date, ...)`, but no stored/generated `capture_year` key exists. MySQL can constrain the leading `processed=true` range and scan the covering index, but applying `YEAR()` to every qualifying key prevents a direct year-key lookup/loose distinct traversal. The page has `revalidate = 0`, invokes this query on each render, and then performs the bounded year-photo query only after the year list resolves.

Concrete failure scenario: a long-running gallery with 100,000 processed images receives repeated `/timeline` or `/timeline?year=...` requests. Each request scans the full processed capture-date index and builds/sorts the distinct expression result before the bounded 501-row archive query can start. The visitor sees avoidable time-to-first-byte growth and the single MySQL writer spends work proportional to total gallery size even when one year was explicitly requested.

Suggested fix: add a stored `capture_year` generated column and an index shaped for `(processed, capture_year)` (or a deliberate equivalent summary/cache), query that column directly, and start the explicit-year photo query in parallel with the year-list query. Validate with `EXPLAIN ANALYZE` on representative row counts and a regression assertion that the year query contains no `YEAR(capture_date)` expression.

## Revalidated existing performance risks (not counted as new findings)

The documented streaming-ingress memory ceiling, simultaneous queue/backfill DB-pool saturation, bounded linear semantic-vector scan, large GPS-map materialization, and 50K-row in-memory CSV export remain current architectural limits with preserved carry-forward exit criteria. None was re-filed as a new Cycle 12 finding. Search-result `prefetch={false}` correctly removes speculative dynamic photo RSC requests, and the corrected derivative maximum does not expand candidate ladders.

## Final missed-issue sweep

The final sweep revisited listing/count/tag fan-out, timeline/archive/on-this-day query shapes, semantic copy/inference queues, map marker materialization, upload preview memory, Sharp format fan-out, queue/backfill mutual pool pressure, maintenance timers, shared-view buffering, responsive `srcset`/`sizes`, observer/listener cleanup, service-worker cache accounting, and migration-time index work. No second distinct, non-duplicate current performance issue met the evidence threshold.
