# Cycle 23 Performance Review

Scope: PROMPT 1 review only. No implementation changes. Reviewed AGENTS.md, CLAUDE.md, `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, upload paths, image processing, queues, public data queries, semantic search, map UI, and service worker caching.

## Inventory

Performance/concurrency/causal-flow relevant files examined:

- Upload and ingest: `apps/web/src/app/actions/images.ts`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-limits.ts`.
- Image pipeline and queues: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`.
- DB/query surfaces: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/pagination.ts`, `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, relevant migrations.
- Public/browser surfaces: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/components/map/map-client.tsx`, search/home/topic/shared public pages.
- Cache/SW: `apps/web/public/sw.template.js`, `apps/web/src/lib/sw-cache.ts`.
- Planning/context: `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`.

## Findings

### PERF-C23-01 - Browser server-action upload still admits request bodies before app-level backpressure

- Severity: High
- Confidence: Medium-high
- Status: Likely; source shape confirmed, requires prod RSS/load validation.
- Evidence: Browser upload server action receives already-materialized `FormData` and enumerates `files` at `apps/web/src/app/actions/images.ts:87-106`; app-level upload lock is acquired only afterward at `apps/web/src/app/actions/images.ts:154-159`; the save path streams the framework-created `File` to disk only after that materialization at `apps/web/src/lib/process-image.ts:882-888`. The client mitigates normal UI use by sending one file at a time at `apps/web/src/components/upload-dropzone.tsx:240-296`, while the Lightroom route has an explicit pre-parse in-process slot and Content-Length gates before `request.formData()` at `apps/web/src/app/api/admin/lr/upload/route.ts:60-74`, `apps/web/src/app/api/admin/lr/upload/route.ts:101-128`, and `apps/web/src/app/api/admin/lr/upload/route.ts:152-187`.
- Failure scenario: Multiple admin tabs, direct server-action clients, or framework retries can cause concurrent multipart bodies to be parsed before `acquireUploadProcessingContractLock()` or cumulative quota enforcement runs. Peak RSS rises with concurrent body size even though later processing is serialized and disk-streamed. For many small files, the sequential client loop also makes uploads feel slow because it avoids self-contention rather than using server-side reader/writer semantics.
- Suggested fix: Move browser ingest to a Node route handler with the same pre-parse slot, declared-size gates, and quota preclaim used by the Lightroom route, ideally backed by a true streaming multipart parser. Keep the server action as a thin caller or remove the multi-file action surface.

### PERF-C23-02 - Background DB/CPU budgets are local, so combined queue/backfill/search load can over-admit work

- Severity: High
- Confidence: High
- Status: Confirmed source shape; latency impact likely, needs load validation.
- Evidence: The MySQL pool is fixed at 10 connections with `queueLimit: 20` at `apps/web/src/db/index.ts:31-41`. The live image queue computes its own pool budget at `apps/web/src/lib/image-queue.ts:121-153`; admin backfill computes a separate budget and owns a separate `PQueue` at `apps/web/src/lib/admin-backfill-runner.ts:97-143` and `apps/web/src/lib/admin-backfill-runner.ts:716-727`; analytics writes have a separate in-memory queue and concurrency 2 at `apps/web/src/lib/background-db-writes.ts:3-10` and `apps/web/src/lib/background-db-writes.ts:42-64`; CLIP inference has a separate pending queue at `apps/web/src/lib/clip-model.ts:53-72` and `apps/web/src/lib/clip-model.ts:156-173`.
- Failure scenario: Image processing, in-app backfill, semantic search, CLIP inference, and analytics can all be individually "within budget" while collectively consuming DB connections and CPU. Foreground gallery/photo requests then queue behind background work, and MySQL's small `queueLimit` can turn a burst into request failures rather than just slower responses.
- Suggested fix: Introduce process-wide background semaphores for DB and CPU work with foreground reserve semantics. Make image queue, backfill, analytics, semantic scans, and embedding work acquire shared tokens, expose token/queue metrics, and keep foreground request DB work outside the background bucket.

### PERF-C23-03 - Public map bounds DB rows but can still render 10k Leaflet markers plus a duplicate list

- Severity: Medium
- Confidence: High
- Status: Likely/manual-validation; DB cap and browser work source shape confirmed.
- Evidence: `getMapImages()` returns up to `MAP_MAX_MARKERS = 10000` plus one sentinel at `apps/web/src/lib/data.ts:1766-1816`. The map page maps every returned row into `markers` and also renders every marker into a below-map list at `apps/web/src/app/[locale]/(public)/map/page.tsx:50-66` and `apps/web/src/app/[locale]/(public)/map/page.tsx:98-110`. The client computes bounds by allocating coordinate arrays and spreading them into `Math.min`/`Math.max` at `apps/web/src/components/map/map-client.tsx:77-94`, then renders one `<Marker>` and popup subtree per marker at `apps/web/src/components/map/map-client.tsx:120-141`.
- Failure scenario: A map-visible topic with thousands of GPS photos produces a large SSR payload, a large DOM/list payload, and thousands of Leaflet marker instances. Mobile or low-power browsers can block the main thread during hydration, bounds fitting, marker layout, and popup setup even though the DB query is capped.
- Suggested fix: Replace all-marker initial render with viewport-bbox fetching and clustering, or at minimum reduce the initial server cap sharply and progressively load markers by zoom/viewport. Virtualize or paginate the below-map list.

### PERF-C23-04 - Semantic search is a bounded brute-force BLOB scan with recency bias

- Severity: Medium
- Confidence: High
- Status: Likely/manual-validation; source shape confirmed.
- Evidence: `SEMANTIC_SCAN_LIMIT` defaults to 2000 and can be raised to a hard max of 25000 at `apps/web/src/lib/clip-embeddings.ts:36-48`. The route scans most-recent embeddings by `modelVersion` and `updatedAt` at `apps/web/src/app/api/search/semantic/route.ts:263-279`, decodes every returned MEDIUMBLOB and computes similarity in JS at `apps/web/src/app/api/search/semantic/route.ts:292-311`. Schema indexing supports the recency scan but not vector distance at `apps/web/src/db/schema.ts:314-326`.
- Failure scenario: Larger galleries or higher semantic traffic make each request O(scan_limit * dimensions) CPU plus BLOB transfer. Raising the scan limit improves recall but directly increases DB and JS work. Keeping the default cap can miss older relevant images because candidates are selected by embedding freshness, not semantic likelihood.
- Suggested fix: Add a vector index/ANN service or precomputed normalized embedding matrix with efficient top-k search. Short term, instrument scanned rows, decode time, scoring time, and result age distribution; consider topic/date filters before vector scoring.

### PERF-C23-05 - On-this-day query remains non-sargable on `capture_date`

- Severity: Low-medium
- Confidence: High
- Status: Confirmed source shape; scale-dependent.
- Evidence: The code explicitly notes `MONTH()` and `DAY()` are not sargable at `apps/web/src/lib/data-timeline.ts:103-110`; the query applies those functions in the predicate at `apps/web/src/lib/data-timeline.ts:121-131`. The `images` table has processed/capture-date indexes, but no generated month/day columns at `apps/web/src/db/schema.ts:123-132`.
- Failure scenario: On larger galleries, every widget render can scan/filter a broad processed capture-date range instead of seeking a narrow `(month, day)` index. This is currently bounded by a small result limit, but the predicate work happens before the limit.
- Suggested fix: Add generated `capture_month` and `capture_day` columns or a compact calendar index table and query those fields directly. Keep the existing `limit(6)` and ordering.

### PERF-C23-06 - HTML service-worker eviction does O(n) cache reads on each over-cap write

- Severity: Low
- Confidence: High
- Status: Confirmed, bounded.
- Evidence: HTML cache size is capped at 50 entries at `apps/web/public/sw.template.js:31-39`. When over cap, eviction reads all cache keys, then `match()`es each cached response to read `sw-cached-at`, sorts, and deletes overflow entries at `apps/web/public/sw.template.js:147-164`.
- Failure scenario: A navigation that writes the 51st HTML entry can trigger up to 51 Cache API reads plus a sort in the service worker. It is bounded and runs from `waitUntil`, but slow mobile storage can make offline-cache maintenance noisy during navigation-heavy sessions.
- Suggested fix: Track HTML recency in a small metadata record like the image LRU path, or maintain insertion order by delete-then-put metadata so eviction is a head-walk rather than cache-body header reads.

## Non-findings and Current Mitigations

- No new public gallery N+1 finding: public image/tag list queries aggregate tags in SQL and split count/page work deliberately in `apps/web/src/lib/data.ts:802-947`.
- Cursor pagination is present for public load-more paths, and legacy offset is capped in `apps/web/src/app/actions/public.ts:132-179`.
- Sharp/libvips pressure is materially mitigated by global `sharp.concurrency()` and `sharp.cache(false)` at `apps/web/src/lib/process-image.ts:36-57`, file-path inputs, and sequential per-size work inside each format. The residual issue is shared CPU admission across independent queues, captured in PERF-C23-02.
- Service-worker image cache races have recent guardrails: a metadata mutation queue and 300 ms HEAD timeout are present at `apps/web/public/sw.template.js:35-39` and `apps/web/public/sw.template.js:99-145`.

## Final Missed-Issues Sweep

Searched for `formData()`, `MAP_MAX_MARKERS`, `MONTH()/DAY()`, `SEMANTIC_SCAN_LIMIT`, `Promise.all`, `PQueue`, `GET_LOCK`, `Cache.keys()/match()`, offsets, grouping, and queue/concurrency patterns across `apps/web/src`, `apps/web/public/sw.template.js`, and `.context/plans`. No additional high-confidence performance issue exceeded the findings above.
