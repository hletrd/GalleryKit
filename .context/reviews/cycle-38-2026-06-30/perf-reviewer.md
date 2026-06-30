# Cycle 38 Performance/Concurrency Review

Cycle: 38/100
Date: 2026-06-30 KST
Reviewed HEAD: `564a7679`

## Inventory

Reviewed image processing, foreground queue, admin and sidecar backfills, CLIP/semantic search routes, CLIP inference queue, DB listing/search/shared/timeline/analytics queries, public server actions, Lightroom upload route, OG routes/fetch budgets, service worker caching, and upload client responsiveness.

## Findings

### C38-PERF-01 - Sidecar color backfill can crash on unhandled queued task rejection

Severity: Medium
Confidence: High

File/line:

- `apps/web/scripts/backfill-color-pipeline.ts:476`
- `apps/web/scripts/backfill-color-pipeline.ts:496`
- `apps/web/scripts/backfill-color-pipeline.ts:512`

The sidecar enqueues `queue.add(async () => { ... await flushBatch(); })` and ignores the returned promise. With the installed `p-queue` behavior, `queue.onIdle()` can resolve while an individual task rejection still becomes an unhandled rejection.

Failure scenario: a transient DB failure, deadlock, or connection drop inside `flushBatch()` aborts the operator sidecar without the script's own summary/error accounting. Rows remain retryable, but the run has poor diagnostics and can terminate mid-maintenance.

Suggested fix: retain and await the task promises with `Promise.allSettled()` and count/log rejected tasks before the summary and exit-code calculation.

### C38-PERF-02 - Sidecar color backfill still materializes and enqueues the full candidate set

Severity: Low
Confidence: High

File/line:

- `apps/web/scripts/backfill-color-pipeline.ts:343`
- `apps/web/scripts/backfill-color-pipeline.ts:475`
- `apps/web/src/lib/admin-backfill-runner.ts:692`

The sidecar fetches every candidate row in one query and enqueues one closure per row. The in-app runner uses keyset-paginated batch/drain loops for the same class of work.

Failure scenario: a large gallery or `--force-reencode` sidecar run keeps all candidate rows plus all queued closures in heap. This is operator-only/offline, but it is unnecessary memory pressure and diverges from the safer in-app runner pattern.

Suggested fix: defer a keyset-paginated sidecar loop until sidecar throughput/memory work is scheduled.

## No Current Finding

No actionable current findings were found in foreground image queue locking/retry cleanup, Sharp concurrency cap, admin in-app backfill budget, semantic route admission limits/inference queue, similar-photo scan cap, service-worker cache/HEAD timeout behavior, public load-more/search/view rate limiting, LR multipart parse gate, or OG internal fetch byte/time budgets.
