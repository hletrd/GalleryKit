# Cycle 23 Tracer Review

Scope: PROMPT 1 review only. This trace lane follows suspicious causal flows and records competing hypotheses, evidence, suggested validation, and current status. It does not implement fixes.

## Trace Inventory

- Upload causality: `apps/web/src/app/actions/images.ts`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`.
- Background contention causality: `apps/web/src/db/index.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/app/api/search/semantic/route.ts`.
- Browser responsiveness causality: `apps/web/src/lib/data.ts`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/components/map/map-client.tsx`.
- Query-shape causality: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/db/schema.ts`.
- Cache causality: `apps/web/public/sw.template.js`, `apps/web/src/lib/sw-cache.ts`.
- Context checked: `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`.

## Causal Traces

### TRC-C23-01 - Upload RSS spike or slow ingest

- Linked finding: PERF-C23-01
- Severity: High
- Confidence: Medium-high
- Status: Likely/manual-validation.
- Primary hypothesis: Browser server-action multipart parsing materializes bodies before application-level backpressure. Evidence: the action starts from `FormData` and enumerates `files` at `apps/web/src/app/actions/images.ts:87-106`; upload lock admission happens later at `apps/web/src/app/actions/images.ts:154-159`; only after that does `saveOriginalAndGetMetadata()` stream the already-created `File` to disk at `apps/web/src/lib/process-image.ts:882-888`.
- Competing hypothesis A: Sharp processing causes the RSS spike after enqueue. Counter-evidence: heavy derivative generation is deferred through `enqueueImageProcessing()` at `apps/web/src/app/actions/images.ts:484-510`; global Sharp cache/concurrency controls exist at `apps/web/src/lib/process-image.ts:36-57`. This remains plausible for post-upload CPU/RSS, but not for RSS before DB insert/enqueue.
- Competing hypothesis B: Client intentionally serializes browser uploads, so no real concurrency. Evidence for mitigation: one-file loop at `apps/web/src/components/upload-dropzone.tsx:289-296`. Counter-evidence: this only governs this UI; the server action still accepts multi-file `FormData` and concurrent calls from multiple tabs or non-UI callers.
- Distinguishing validation: Capture process RSS, request count, and DB insert timestamps during concurrent browser uploads. If RSS rises before first insert, parse/materialization is the cause. If RSS rises only after queue starts, derivative processing is the cause. Compare against Lightroom route behavior, which has pre-parse slot/Content-Length gates at `apps/web/src/app/api/admin/lr/upload/route.ts:60-74`, `apps/web/src/app/api/admin/lr/upload/route.ts:101-128`, and `apps/web/src/app/api/admin/lr/upload/route.ts:152-187`.
- Suggested fix: Route browser upload through a Node route handler with pre-parse admission and streaming multipart parsing; keep cumulative quota and upload-processing contract semantics.

### TRC-C23-02 - Foreground latency during background work

- Linked finding: PERF-C23-02
- Severity: High
- Confidence: High
- Status: Confirmed source shape; likely under load.
- Primary hypothesis: Independent background queues over-admit against the same MySQL pool. Evidence: pool has 10 connections and queueLimit 20 at `apps/web/src/db/index.ts:31-41`; image queue reserves live capacity locally at `apps/web/src/lib/image-queue.ts:121-153`; backfill reserves live capacity separately at `apps/web/src/lib/admin-backfill-runner.ts:97-143`; analytics separately permits two writes and up to 1000 pending at `apps/web/src/lib/background-db-writes.ts:3-10` and `apps/web/src/lib/background-db-writes.ts:42-64`.
- Competing hypothesis A: CPU saturation from Sharp/libvips is the dominant cause, not DB waits. Evidence for plausibility: `processImageFormats()` fans WebP/AVIF/JPEG with `Promise.allSettled()` at `apps/web/src/lib/process-image.ts:1411-1418`; wide-gamut rgb16 paths can double resize memory at `apps/web/src/lib/process-image.ts:1236-1262`. Counter-evidence: Sharp has global thread/cache limits at `apps/web/src/lib/process-image.ts:36-57`, so CPU is bounded per process but not shared across all background producers.
- Competing hypothesis B: CLIP inference queue is the main foreground blocker. Evidence for bounded but separate queue: `apps/web/src/lib/clip-model.ts:53-72` and `apps/web/src/lib/clip-model.ts:156-173`. This can add CPU pressure, but it does not explain DB pool waits unless combined with semantic scans.
- Distinguishing validation: Add temporary timing around DB acquire/query duration, image queue active count, backfill active count, analytics active/pending, semantic scan row count, and process CPU. A DB-wait signature will show increased pool wait before query execution; CPU saturation will show high event-loop lag/libvips activity even when DB wait is low.
- Suggested fix: Shared DB/CPU background-budget semaphores plus metrics. Foreground requests should bypass background tokens while background producers share one admission controller.

### TRC-C23-03 - Public map page jank

- Linked finding: PERF-C23-03
- Severity: Medium
- Confidence: High
- Status: Likely/manual-validation.
- Primary hypothesis: Browser marker/list rendering dominates. Evidence: server returns up to 10000 markers at `apps/web/src/lib/data.ts:1766-1816`; the page maps all returned rows into client props and a full fallback list at `apps/web/src/app/[locale]/(public)/map/page.tsx:50-66` and `apps/web/src/app/[locale]/(public)/map/page.tsx:98-110`; the client allocates latitude/longitude arrays and renders one Leaflet `<Marker>` per row at `apps/web/src/components/map/map-client.tsx:77-94` and `apps/web/src/components/map/map-client.tsx:120-141`.
- Competing hypothesis A: DB query latency dominates. Evidence for plausibility: GPS predicates are `IS NOT NULL` and there is no dedicated `(processed, topic/map_visible, latitude, longitude)` index in `apps/web/src/db/schema.ts:123-132`. Counter-evidence: query is capped at 10001 rows and the severe user-visible freeze would align more directly with hydration/Leaflet marker creation.
- Competing hypothesis B: tile-network latency dominates. Counter-evidence: tile loading is independent of marker count, while the code creates marker components synchronously before tile interactions matter.
- Distinguishing validation: Record server timing for `getMapImages()` and a Chrome Performance trace for hydration/marker creation on a seeded 5k/10k GPS dataset. If server timing is small but main-thread tasks are long, the browser-marker hypothesis wins.
- Suggested fix: Cluster or viewport-page markers and virtualize/paginate the list. Add server timing and client marker-count telemetry before choosing thresholds.

### TRC-C23-04 - Semantic search latency or surprising misses

- Linked finding: PERF-C23-04
- Severity: Medium
- Confidence: High
- Status: Likely/manual-validation.
- Primary hypothesis: Candidate selection is recency-capped brute force. Evidence: cap defaults/hard max are at `apps/web/src/lib/clip-embeddings.ts:36-48`; candidates are selected by `modelVersion` and `updatedAt DESC` at `apps/web/src/app/api/search/semantic/route.ts:263-279`; every selected BLOB is decoded and scored in JS at `apps/web/src/app/api/search/semantic/route.ts:292-311`; schema has a recency index but no vector-distance index at `apps/web/src/db/schema.ts:314-326`.
- Competing hypothesis A: Text embedding queue wait dominates latency. Evidence: query embedding calls `embedTextReal()` before DB scan at `apps/web/src/app/api/search/semantic/route.ts:247-254`; CLIP queue limits and timeouts are in `apps/web/src/lib/clip-model.ts:53-72`. This explains latency under concurrent semantic requests, not old-photo misses.
- Competing hypothesis B: Result enrichment query dominates. Evidence: enrichment only runs after top-k IDs are chosen at `apps/web/src/app/api/search/semantic/route.ts:317-330`, so it scales with result count rather than scan limit.
- Distinguishing validation: Log per-request embedding wait, DB scan rows/time, decode+score time, top-k age distribution, and enrichment time. Misses with old relevant photos plus low embedding wait point to recency cap; slow high-concurrency requests point to CLIP queue.
- Suggested fix: Add vector index/ANN or preloaded normalized matrix search; short-term metrics should separate encoder wait from DB scan and JS scoring.

### TRC-C23-05 - On-this-day scale cliff

- Linked finding: PERF-C23-05
- Severity: Low-medium
- Confidence: High
- Status: Confirmed source shape, scale-dependent.
- Primary hypothesis: Function predicates prevent index seek. Evidence: code documents the non-sargable tradeoff at `apps/web/src/lib/data-timeline.ts:103-110`; the predicate uses `MONTH(capture_date)` and `DAY(capture_date)` at `apps/web/src/lib/data-timeline.ts:121-131`; schema indexes include `processed, capture_date, created_at` but no generated date-part index at `apps/web/src/db/schema.ts:123-132`.
- Competing hypothesis: The `limit(6)` prevents meaningful cost. Counter-evidence: MySQL must find matching month/day rows before the limit can terminate efficiently; without date-part index, the limit does not imply a six-row seek.
- Distinguishing validation: `EXPLAIN ANALYZE` with realistic gallery row counts. Watch rows examined for today-like common days versus sparse days.
- Suggested fix: Generated month/day columns or calendar index table.

### TRC-C23-06 - Service-worker navigation stutter from HTML eviction

- Linked finding: PERF-C23-06
- Severity: Low
- Confidence: High
- Status: Confirmed, bounded.
- Primary hypothesis: HTML eviction reads every cached HTML response header when over cap. Evidence: `MAX_HTML_ENTRIES = 50` at `apps/web/public/sw.template.js:31-39`; over-cap path calls `keys()`, `match()` for every key, sorts, and deletes at `apps/web/public/sw.template.js:147-164`.
- Competing hypothesis A: Image HEAD revalidation is the real SW responsiveness problem. Counter-evidence: image stale probe is bounded by 300 ms at `apps/web/public/sw.template.js:35-39`, and image metadata mutations are serialized through `withMetaMutation()` at `apps/web/public/sw.template.js:99-145`.
- Distinguishing validation: On a low-end mobile browser, seed 51+ HTML entries and profile service-worker task duration during navigation. If stutter appears only on over-cap HTML writes, eviction is the cause; if image views stutter, inspect HEAD probe and image LRU instead.
- Suggested fix: Store HTML recency metadata separately, mirroring the image LRU structure, so over-cap eviction does not need per-response `match()` reads.

## Cross-Trace Stop Conditions

- Confirmed implementation bugs: none changed in this review lane.
- Findings needing manual validation before fix priority: upload RSS, combined background pool starvation, map jank, semantic latency/recall.
- Low bounded residuals: on-this-day date-part scan and HTML SW eviction.
- Final missed-issues sweep: repo search covered upload parsing, queue/concurrency, locks, sharp fan-out, cache keys/matches, scan limits, map markers, non-sargable date functions, offsets, grouping, and prior carry-forward plans. No additional higher-severity causal chain was found.
