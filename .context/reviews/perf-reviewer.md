# Cycle 11 Performance Review

Date: 2026-06-29
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `d5d79e17 fix(cycle-10): 🐛 close review findings`
Role: cycle 11 `perf-reviewer`

## Scope And Method

Read-only performance, concurrency, CPU, memory, and UI-responsiveness review. I did not edit production code. The only intended change from this prompt is this review artifact.

I read `AGENTS.md` and `CLAUDE.md`, built a source inventory excluding generated `.next` output, reviewed prior perf reports as hypotheses rather than conclusions, then re-inspected the current code paths after the cycle-10 fix commit. I specifically re-checked the cycle-10 findings and found these already fixed in current HEAD:

- Batch upload tag resolution is now batch-level, not per-file: `apps/web/src/app/actions/images.ts:295-319` resolves tags once and `apps/web/src/app/actions/images.ts:467-479` reuses the records.
- Semantic search client requests now abort stale in-flight fetches: `apps/web/src/components/search.tsx:145-190`, `apps/web/src/components/search.tsx:237-261`.
- The semantic route now checks `request.signal.aborted` at several request boundaries: `apps/web/src/app/api/search/semantic/route.ts:98-104`, `apps/web/src/app/api/search/semantic/route.ts:198-200`, `apps/web/src/app/api/search/semantic/route.ts:246-249`, `apps/web/src/app/api/search/semantic/route.ts:260-263`, `apps/web/src/app/api/search/semantic/route.ts:307-309`.

Classification:

- Confirmed: directly present in the current code path.
- Likely: code path is present and failure depends on realistic configuration, traffic, or data size.
- Risk: scale- or operator-dependent issue worth addressing before growth, but not a default-path failure.

## Review-Relevant Inventory

Configuration/runtime: `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/proxy.ts`, `apps/web/drizzle/*`, `apps/web/scripts/*`.

Public pages/API: home/topic/smart-collection/timeline/year/map/photo/share pages under `apps/web/src/app/[locale]/(public)/`, public actions in `apps/web/src/app/actions/public.ts`, semantic/similar/OG/feed/sitemap/upload-serving routes under `apps/web/src/app/api` and `apps/web/src/app/uploads`.

Data/query layer: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `smart-collections.ts`, `analytics-data.ts`, `analytics.ts`, `view-retention.ts`, `rate-limit.ts`, `bounded-map.ts`, `gallery-config.ts`, `gallery-config-shared.ts`, `serve-upload.ts`, `og-photo-fetch.ts`.

Upload/image/queue/CLIP: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/lib/image-queue.ts`, `admin-backfill-runner.ts`, `process-image.ts`, `gps-exif-strip.ts`, `upload-limits.ts`, `upload-paths.ts`, `upload-tracker*.ts`, `clip-model.ts`, `clip-embeddings.ts`, `clip-inference.ts`, `scripts/backfill-clip-embeddings.ts`, `scripts/backfill-color-pipeline.ts`.

Client/UI responsiveness: `home-client.tsx`, `load-more.tsx`, `search.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `similar-photos.tsx`, `histogram.tsx`, `public/histogram-worker.js`, map components, upload/admin managers, navigation, service worker files.

Tests/static anchors: reviewed relevant tests for queue, semantic search, upload, source contracts, bounded maps, timeline, smart collections, service worker, and privacy fields under `apps/web/src/__tests__`.

## Findings

### PERF-C11-01: Image queue jobs can starve the shared DB pool while holding advisory locks across Sharp work

Status: Likely issue
Severity: Medium
Confidence: High

Code regions:

- `apps/web/src/lib/image-queue.ts:86-89`
- `apps/web/src/lib/image-queue.ts:440-456`
- `apps/web/src/lib/image-queue.ts:507-540`
- `apps/web/src/lib/image-queue.ts:616-631`
- `apps/web/src/lib/image-queue.ts:806-809`
- `apps/web/src/db/index.ts:23-33`
- `apps/web/src/lib/data.ts:1107-1153`

`QUEUE_CONCURRENCY` is operator-configurable up to 8 (`image-queue.ts:86-89`). Each queue worker acquires a pooled MySQL connection and a connection-bound `GET_LOCK` (`image-queue.ts:440-456`), then keeps that connection until the `finally` block releases it (`image-queue.ts:806-809`). The critical section includes the expensive Sharp derivative fan-out (`image-queue.ts:616-631`).

The app's shared pool is only 10 connections with `queueLimit: 20` (`db/index.ts:23-33`). Live photo pages fan out DB reads for tags, prev, and next in one `Promise.all` (`data.ts:1107-1153`), so they need pool headroom while image encoding is running.

Concrete failure scenario:

An operator raises `QUEUE_CONCURRENCY=8` after a bulk upload. Eight large-image jobs each pin one shared DB connection for the duration of AVIF/WebP/JPEG encoding. Public photo pages, admin actions, search routes, analytics writes, and queue DB updates compete for the two remaining pool slots, queue behind the pool limit, and start returning slow TTFB or intermittent DB acquisition failures even though the visible bottleneck appears to be image CPU.

Suggested fix:

Do not hold shared request-pool connections across CPU/image work. Prefer a short DB row claim/status transition over a connection-bound advisory lock, or move image-processing locks to a separate tiny lock-only pool that cannot consume live request capacity. At minimum, clamp `QUEUE_CONCURRENCY` with the same pool-budget pattern used by `admin-backfill-runner.ts:129-142` and log a startup warning when the configured value leaves too little live-traffic headroom.

### PERF-C11-02: GPS stripping reintroduces whole-file heap pressure after the upload path streams originals to disk

Status: Likely issue
Severity: Medium
Confidence: High

Code regions:

- `apps/web/src/lib/process-image.ts:887-910`
- `apps/web/src/lib/process-image.ts:1738-1764`
- `apps/web/src/lib/process-image.ts:1773-1786`
- `apps/web/src/app/actions/images.ts:381-388`
- `apps/web/src/app/api/admin/lr/upload/route.ts:139-145`
- `apps/web/src/app/api/admin/lr/upload/route.ts:346-360`

The normal upload path intentionally streams the original to disk to avoid materializing large files in JS heap (`process-image.ts:905-910`). When `strip_gps_on_upload` is enabled, both browser uploads and Lightroom uploads call `stripGpsFromOriginal` (`images.ts:381-388`, `lr/upload/route.ts:346-360`). That function immediately reads the entire saved original with `fs.readFile(filePath)` (`process-image.ts:1741-1743`) and, when GPS is stripped, writes a second full buffer before rename (`process-image.ts:1761-1764`). The WebP fallback path also uses the full `input` buffer to classify lossless/lossy (`process-image.ts:1773-1786`). The Lightroom route additionally enters through `request.formData()` (`lr/upload/route.ts:139-145`), which can already buffer multipart body state.

Concrete failure scenario:

An admin enables GPS stripping and uploads large JPEG/HEIC/TIFF/WebP exports near the 200 MB per-file cap. The request first streams the file safely, then GPS stripping allocates the whole source buffer and may allocate a scrubbed output buffer as well. Under concurrent uploads or a memory-constrained host, this causes RSS spikes, long GC pauses, or process termination during upload. Public DB GPS fields are nulled, but the admin upload path and process stability are at risk.

Suggested fix:

Replace whole-buffer GPS scrubbing with streaming/container-aware rewriting for the common formats, especially JPEG APP1/EXIF segment rewriting and ISOBMFF box traversal. If that is too large for one pass, add a memory-budget gate: serialize GPS-strip work globally, reject/defer stripping above a safe threshold with a clear admin-facing error, and avoid simultaneously retaining original and scrubbed buffers.

### PERF-C11-03: CLIP inference has a concurrency cap but no global backlog cap or timeout

Status: Risk
Severity: Medium
Confidence: Medium-High

Code regions:

- `apps/web/src/lib/clip-model.ts:53-70`
- `apps/web/src/lib/clip-model.ts:138-146`
- `apps/web/src/lib/clip-model.ts:171-188`
- `apps/web/src/app/api/search/semantic/route.ts:243-300`
- `apps/web/src/app/actions/embeddings.ts:129-169`
- `apps/web/scripts/backfill-clip-embeddings.ts:149-175`

`withInferenceSlot` caps active model calls to `CLIP_INFERENCE_CONCURRENCY` (max 4), but pending callers are stored in an unbounded `inferenceWaiters` array (`clip-model.ts:53-70`). Public semantic search enters this path through `embedTextReal` (`semantic/route.ts:243-250`) and then scans/scores up to `SEMANTIC_SCAN_LIMIT` rows (`semantic/route.ts:256-300`). Admin and sidecar embedding backfills also use the same `embedImageReal` path in bounded local chunks (`actions/embeddings.ts:129-169`, `scripts/backfill-clip-embeddings.ts:149-175`), but those chunks still wait on the same global unbounded waiter list.

Concrete failure scenario:

Production semantic search is enabled and a burst of requests arrives from many IPs, while an operator also runs a production image-embedding backfill. Active inference stays capped, but every excess request/backfill item retains a promise and request/task state in `inferenceWaiters` with no max queue size or timeout. Latency grows without a rejection boundary, old requests can wait behind work that is no longer useful, and memory pressure grows until the process has to recover by failure rather than by graceful backpressure.

Suggested fix:

Replace the hand-rolled waiter array with a queue that has explicit `concurrency`, `queueSize`, and per-task timeout. Return `503` or `429` with `Retry-After` when the global CLIP queue is full. Log queue depth and time-in-queue so operators can tune `CLIP_INFERENCE_CONCURRENCY`, semantic route limits, and backfill chunk sizes with evidence. Share the same queue across public text search, queue-side image embedding, admin action backfill, and the sidecar script when it runs in-process.

### PERF-C11-04: Infinite masonry keeps every loaded card mounted, so long browse sessions can create client jank

Status: Risk
Severity: Low-Medium
Confidence: Medium-High

Code regions:

- `apps/web/src/components/home-client.tsx:124-130`
- `apps/web/src/components/home-client.tsx:195-210`
- `apps/web/src/components/home-client.tsx:286-360`
- `apps/web/src/components/load-more.tsx:41-96`
- `apps/web/src/components/load-more.tsx:122-132`

`HomeClient` stores all loaded images in a single state array and appends each load-more result (`home-client.tsx:124-130`). The masonry render maps the entire accumulated array to card/picture nodes (`home-client.tsx:286-360`). `LoadMore` automatically fetches more pages when the sentinel intersects (`load-more.tsx:122-132`) and appends them via `onLoadMore` (`load-more.tsx:41-96`). The code has good mitigations, including lazy decoding and intrinsic-size reservations (`home-client.tsx:195-210`, `home-client.tsx:357-359`), but it never virtualizes or prunes offscreen cards.

Concrete failure scenario:

A visitor scrolls through a large gallery or smart collection for many pages. Thousands of `picture/source/img`, link, badge, and wrapper nodes remain mounted. Browser layout, accessibility tree size, image decode bookkeeping, and React updates grow linearly with browsing depth. The visible symptom is scroll jank, delayed taps, and slower search/nav interactions after a long session.

Suggested fix:

Introduce virtualization/windowing for masonry, or switch automatic infinite loading to a hybrid model that requires explicit user action after a threshold. If CSS masonry makes full virtualization impractical, keep nearby pages mounted and replace far-off pages with stable-height placeholders that can restore content when scrolling back. Validate with a browser trace after loading 1000+ images.

### PERF-C11-05: Public archive and smart-collection predicates are intentionally non-sargable, but growth turns them into CPU scan paths

Status: Risk
Severity: Low-Medium
Confidence: High

Code regions:

- `apps/web/src/lib/data-timeline.ts:92-116`
- `apps/web/src/lib/data-timeline.ts:129-141`
- `apps/web/src/lib/data-timeline.ts:178-207`
- `apps/web/src/lib/smart-collections.ts:217-220`
- `apps/web/src/lib/smart-collections.ts:259-266`
- `apps/web/src/lib/data.ts:1437-1451`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:62-90`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:103-104`

Timeline queries use `MONTH(capture_date)`, `DAY(capture_date)`, and `YEAR(capture_date)` filters (`data-timeline.ts:92-116`, `data-timeline.ts:178-207`) plus distinct/order by `YEAR(capture_date)` (`data-timeline.ts:129-141`). The comments correctly call out that these are not sargable and only acceptable at personal-gallery scale. Smart collections support `%...%` contains predicates on image columns and tag names (`smart-collections.ts:217-220`, `smart-collections.ts:259-266`). The public first-page smart-collection query also carries aggregation and `COUNT(*) OVER()` (`data.ts:1437-1451`). Public archive pages are dynamic (`timeline/page.tsx:62-90`), and smart-collection pages call this query on page render (`c/[slug]/page.tsx:103-104`).

Concrete failure scenario:

The gallery grows substantially, or public archive/smart-collection URLs are crawled. Repeated `/timeline`, `/year/{year}`, and broad `/c/{slug}` requests evaluate date functions or `%LIKE%` predicates across many processed rows before grouping, counting, and ordering. Each page still returns bounded rows, but the database work before the limit can become CPU/temp-table heavy and compete with live gallery traffic.

Suggested fix:

For timeline, replace `YEAR(capture_date)=?` with range predicates and add generated/indexed month/day columns if On This Day remains public. For smart collections, either restrict public predicates to indexable operations, materialize membership/counts after admin edits, or add a real search index for contains-style predicates. Keep the existing comments, but add an operational threshold or test fixture that makes the "personal-gallery scale" assumption explicit.

## Existing Safeguards Observed

- Source files under `apps/web/src` do not use sync filesystem APIs on request paths; sync file IO hits are confined to scripts/build helpers.
- Public listing/load-more paths cap page sizes and now prefer cursor pagination after the first page.
- Maps/rate-limit stores use bounded helpers or explicit caps; `BoundedMap.set()` enforces the hard cap on write.
- `getMapImages` caps public markers at 10,000 and keeps the future clustering requirement documented.
- `process-image.ts` controls Sharp global concurrency and disables Sharp cache to limit steady RSS.
- Admin color backfill already has pool-aware concurrency budgeting; that pattern should be reused for the image queue.
- Histogram work is worker-driven and small-canvas bounded.
- Semantic search now has client aborts and server-side abort checks at several coarse boundaries.

## Final Missed-Issue Sweep

After drafting the findings, I re-searched current source for `readFile`, `toBuffer`, `arrayBuffer`, `formData`, `getConnection`, `GET_LOCK`, `inferenceWaiters`, `COUNT(*) OVER`, `YEAR(`, `MONTH(`, `offset(`, global `Map`/`Set`, `Promise.all`, dynamic/revalidate declarations, and request-path sync IO. I re-read the hot files with line numbers before citing them.

I did not find a current-code regression in the fixed cycle-10 areas: upload tags are no longer resolved once per file, semantic client fetches are abortable, and the semantic route checks abort state before the major async phases. I also did not find a new unbounded default-path public result set: home/topic/smart listing rows are capped, map markers are capped, shared groups are bounded by their membership, and timeline truncation is visible. The remaining performance concerns are the five findings above, concentrated in shared DB pool contention, large-file GPS strip memory, global CLIP backpressure, long-session masonry DOM growth, and scale-dependent non-sargable archive/search predicates.
