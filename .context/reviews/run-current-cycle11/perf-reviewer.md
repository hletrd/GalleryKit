# Cycle 11 — perf-reviewer

Reviewed HEAD: `7e40e95c` (2026-07-18)

## Inventory and coverage

I used the full tracked inventory and classified all request-time and background performance surfaces: 116 library modules, 81 route/action files, 61 client/server components, 29 operational scripts, 16 browser specs, schema/index migrations, and runtime/container/proxy configuration. I covered listing/search/map/semantic queries, image encode and responsive delivery, queue/backfill/maintenance concurrency, DB pool budgets, timers and bounded collections, SSR/RSC payloads, service-worker cache accounting, and the complete Cycle 10 derivative-width change. The historical review/plan index and carry-forward register were cross-checked before triage, so known scale thresholds were not restated as new findings.

## Result

**No new performance finding.**

The confirmed `derivative_max_width` contract defect at `apps/web/src/lib/process-image.ts:1214-1219,1366-1377,1462-1465` does not currently add candidates or transfer bytes: `apps/web/src/lib/image-url.ts:116-130` bounds iteration to the configured alias ladder. It is therefore recorded by the code/architecture/tracer lanes as a data-contract issue rather than inflated into a request-path performance regression.

The encoder still creates configured oversized aliases as hard links, with copy fallback (`apps/web/src/lib/process-image.ts:1222-1234`). That behavior predates Cycle 11 and was part of Cycle 10's reviewed producer evidence. On the shipped same-filesystem bind mount, hard links share bytes; a copy-fallback disk amplification remains a low-probability operational residual, not a newly introduced regression. The Cycle 10 markup fix does remove duplicate actual-width candidates from every public `srcset`.

Validation supporting the pass: full lint/typecheck and 3,447 unit tests passed. No new unindexed query, list-wide synchronous filesystem operation, unbounded collection, concurrency increase, or payload fan-out appeared in the newest implementation diff.

## Final missed-issue sweep

I rechecked first-page listing/count/tag aggregation, semantic vector scan/copy limits, map materialization, upload preview allocation, queue/backfill mutual pool pressure, Sharp thread budgeting, derivative alias disk behavior, service-worker eviction/revalidation, and every responsive caller. Existing thresholds (`C19-04`, semantic/map/search scale rows, streaming-ingress/RSS work, and upload preview virtualization) have not fired from repository evidence and were not duplicated. No new performance issue remained.
