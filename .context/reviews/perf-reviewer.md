# Cycle 10 Performance Review

Date: 2026-06-29
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `4fd8bf3b docs(review): preserve cycle 10 verifier evidence`
Role: cycle 10 `perf-reviewer`

## Scope And Method

This was a read-only performance, concurrency, CPU, memory, and UI responsiveness review of the current repository. The only file modified by this prompt is this report.

I read `AGENTS.md` and `CLAUDE.md`, built a repository inventory, then reviewed cross-file behavior across request paths, DB access, upload/processing queues, CLIP search, image encoding, admin maintenance, client rendering, and existing tests/review context. Classifications:

- Confirmed: directly present in the current code path.
- Likely: code path is present and failure depends on realistic configuration, traffic, or data size.
- Risk: scale- or operator-dependent issue worth addressing before growth, but not a default-path failure.

## Review-Relevant Inventory

Configuration and runtime: root `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/meta/_journal.json`, current migrations, `apps/web/scripts/migrate.js`, `CLAUDE.md`.

Public pages and API paths: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `c/[slug]/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `map/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, OG routes, feed/sitemap routes, health/live routes.

Data/query layer: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `smart-collections.ts`, `analytics-data.ts`, `view-retention.ts`, `rate-limit.ts`, `bounded-map.ts`, `gallery-config.ts`, `gallery-config-shared.ts`, `tag-records.ts`, `tag-slugs.ts`, `serve-upload.ts`, `og-photo-fetch.ts`.

Upload, image, queue, and CLIP surfaces: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/lib/image-queue.ts`, `admin-backfill-runner.ts`, `process-image.ts`, `upload-limits.ts`, `upload-processing-contract-lock.ts`, `upload-tracker-state.ts`, `clip-model.ts`, `clip-embeddings.ts`, `clip-captions.ts`, `clip-weights.ts`, `upload-paths.ts`, storage helpers, and related scripts under `apps/web/scripts`.

Client/UI responsiveness: `home-client.tsx`, `load-more.tsx`, `search.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `similar-photos.tsx`, `histogram.tsx`, `public/histogram-worker.js`, map components, navigation components, upload/admin components, display-capability hooks, and service worker files.

Tests and static review anchors: searched `apps/web/src/__tests__` for existing performance, queue, privacy, semantic, timeline, smart collection, upload, and lock coverage; reviewed prior `.context/reviews/perf-reviewer.md` to avoid carrying fixed findings blindly.

## Findings

### PERF-C10-01: Image queue jobs can starve the shared DB pool while holding advisory locks across Sharp work

Status: Likely issue
Severity: Medium
Confidence: High

Code regions:

- `apps/web/src/lib/image-queue.ts:86-89`
- `apps/web/src/lib/image-queue.ts:430-447`
- `apps/web/src/lib/image-queue.ts:503-621`
- `apps/web/src/lib/image-queue.ts:797-799`
- `apps/web/src/db/index.ts:23-33`
- `apps/web/src/lib/data.ts:1107-1153`

`QUEUE_CONCURRENCY` is operator-configurable up to 8 (`image-queue.ts:86-89`). Each queue job acquires a pooled MySQL connection with `connection.getConnection()` and `GET_LOCK` (`image-queue.ts:430-447`), then keeps that connection until the `finally` block releases the lock (`image-queue.ts:797-799`). The same critical section includes the expensive Sharp derivative generation (`image-queue.ts:606-621`).

The app's shared pool is only 10 connections with `queueLimit: 20` (`db/index.ts:23-33`). Live public photo pages also fan out three DB reads in parallel for tags, previous image, and next image (`data.ts:1107-1153`). With `QUEUE_CONCURRENCY=8`, long-running encodes can pin most of the shared pool for seconds or minutes, leaving too little headroom for public pages, admin actions, semantic routes, and analytics writes.

Concrete failure scenario:

An operator raises `QUEUE_CONCURRENCY` to speed up backlog processing after a bulk upload. Eight queue jobs start on large originals, each holding one DB pool connection while Sharp encodes AVIF/WebP/JPEG variants. Public users open photo pages or load-more endpoints; those requests need DB connections, queue behind the two remaining pool slots, then hit pool queue pressure or timeouts. Symptoms are slow TTFB, intermittent 500s, and an apparently "CPU-bound" image queue causing DB-facing request stalls.

Concrete fix:

Do not hold shared request-pool connections across CPU/image work. Use a short DB row claim/status transition instead of a connection-bound advisory lock, or use a separate small lock-only pool that cannot consume public request capacity. At minimum, clamp `QUEUE_CONCURRENCY` against shared pool headroom, following the budgeted approach already present in `admin-backfill-runner`, and emit a startup warning when the configured queue concurrency would leave fewer than several request connections available.

### PERF-C10-02: Batch upload resolves the same tag set once per file with serial DB round trips

Status: Confirmed issue
Severity: Medium
Confidence: High

Code regions:

- `apps/web/src/app/actions/images.ts:154-164`
- `apps/web/src/app/actions/images.ts:308-319`
- `apps/web/src/app/actions/images.ts:436-469`
- `apps/web/src/lib/tag-records.ts:66-69`

The upload action parses one batch-level tag list (`images.ts:154-164`), then loops over every selected file (`images.ts:308-319`). Inside that per-file loop, it recomputes the unique tag list and serially calls `ensureTagRecord` for every tag (`images.ts:436-459`). `ensureTagRecord` performs an insert-ignore plus lookup work for each tag (`tag-records.ts:66-69`). Only after that does the action insert `imageTags` rows for the one image (`images.ts:462-469`).

Concrete failure scenario:

An admin uploads 100 files with 10 tags. Before returning from the server action, the code can execute roughly 1000 tag ensure operations plus 100 separate `imageTags` batch inserts, even though the tag set is identical for the whole batch. This increases admin upload latency, ties up the DB pool, and delays queue enqueueing for the actual image processing work.

Concrete fix:

Resolve and validate `uniqueTagNames` once before the file loop, after the batch tag validation and topic/config checks. Reuse the resulting `tagRecords` for each inserted image. Then either insert per-image tag rows using the precomputed records, or collect all `{ imageId, tagId }` rows and insert them in bounded chunks after successful image inserts. Preserve collision warnings, but make collisions a batch-level warning instead of repeating the same work per file.

### PERF-C10-03: GPS stripping reintroduces whole-file heap pressure after the upload path streams originals to disk

Status: Likely issue
Severity: Medium
Confidence: High

Code regions:

- `apps/web/src/lib/upload-limits.ts:1-3`
- `apps/web/src/lib/process-image.ts:862-879`
- `apps/web/src/lib/process-image.ts:1673-1699`
- `apps/web/src/app/actions/images.ts:350-356`
- `apps/web/src/app/api/admin/lr/upload/route.ts:137-145`
- `apps/web/src/app/api/admin/lr/upload/route.ts:344-358`

The upload file cap permits 200 MiB files (`upload-limits.ts:1-3`). `saveOriginalAndGetMetadata` intentionally streams the uploaded file to disk to avoid materializing the whole file in JS heap (`process-image.ts:862-879`). If `stripGpsOnUpload` is enabled, both browser uploads and Lightroom uploads call `stripGpsFromOriginal` (`actions/images.ts:350-356`, `lr/upload/route.ts:344-358`).

`stripGpsFromOriginal` reads the entire saved original into memory (`process-image.ts:1673-1678`) and then writes a scrubbed buffer before renaming it over the original (`process-image.ts:1696-1699`). The Lightroom route also obtains the multipart body through `request.formData()` (`lr/upload/route.ts:137-145`), so the GPS strip can stack with multipart buffering and Sharp metadata work.

Concrete failure scenario:

An admin enables GPS stripping and uploads large JPEG/HEIC/TIFF exports near the 200 MiB cap. Each file can allocate the whole source buffer plus the scrubbed output buffer, while the request already carries multipart/form data and metadata extraction has run. On a disk- or memory-constrained host this can cause long GC pauses, RSS spikes, or worker termination during upload. The public gallery may remain privacy-safe because DB GPS columns are nulled, but the admin upload UX and process stability are at risk.

Concrete fix:

Replace buffer-wide GPS stripping with streaming/container-aware rewriting for the supported formats, especially JPEG APP1/EXIF segment rewriting and ISOBMFF box traversal. If a fully streaming scrubber is not feasible immediately, add an explicit memory budget gate: serialize GPS-strip work globally, reject or defer stripping for files above a safe threshold with a clear admin-facing error, and avoid holding both original and scrubbed buffers at once.

### PERF-C10-04: Stale semantic search requests are ignored in the UI but not aborted on the server

Status: Likely issue
Severity: Medium
Confidence: High

Code regions:

- `apps/web/src/components/search.tsx:143-152`
- `apps/web/src/components/search.tsx:154-238`
- `apps/web/src/components/search.tsx:240-253`
- `apps/web/src/app/api/search/semantic/route.ts:232-251`
- `apps/web/src/app/api/search/semantic/route.ts:264-283`

The search component uses `requestIdRef` to ignore stale responses (`search.tsx:143-152`, `search.tsx:183-199`), and the debounce cleanup only clears pending timers (`search.tsx:240-253`). It does not keep an `AbortController` for the in-flight semantic `fetch` (`search.tsx:177-194`). That means typing a new query or closing the dialog prevents stale UI commits, but the old semantic request can still run to completion.

The semantic route performs production CLIP embedding (`semantic/route.ts:232-235`), selects up to `SEMANTIC_SCAN_LIMIT` embeddings (`semantic/route.ts:242-251`), then decodes and scores the scanned rows in JS (`semantic/route.ts:264-283`). Ignoring a stale response on the client does not recover that server CPU and DB work.

Concrete failure scenario:

A user types several semantic queries with pauses longer than the 300 ms debounce. Each intermediate query starts a server request. The browser eventually shows only the newest result, but previous requests still consume CLIP inference, DB reads, and JS scoring. Under multiple users, this makes final-query latency worse and can fill the CLIP inference wait queue.

Concrete fix:

Add an `AbortController` ref in `Search`, abort the prior semantic fetch before starting a new one, and abort on dialog close/unmount/query clear. Pass `signal` to `fetch` and treat `AbortError` as a silent stale request. On the route side, check `request.signal.aborted` at cheap boundaries before embedding, before DB scan, and before result enrichment; return early where the runtime allows. Consider a longer debounce or explicit submit for production semantic search if CLIP CPU remains a bottleneck.

### PERF-C10-05: CLIP inference has a concurrency cap but no global backlog cap or timeout

Status: Risk
Severity: Medium
Confidence: Medium-High

Code regions:

- `apps/web/src/lib/clip-model.ts:53-70`
- `apps/web/src/app/api/search/semantic/route.ts:181-189`
- `apps/web/src/app/api/search/semantic/route.ts:232-239`
- `apps/web/src/app/actions/embeddings.ts:129-169`
- `apps/web/src/lib/image-queue.ts:333-367`

`withInferenceSlot` limits active CLIP inference to `CLIP_INFERENCE_CONCURRENCY` (max 4), but pending work is stored in an unbounded `inferenceWaiters` array (`clip-model.ts:53-70`). Public semantic search rate limiting is per IP (`semantic/route.ts:181-189`) and then can wait on `embedTextReal` (`semantic/route.ts:232-239`). Admin embedding backfill uses bounded chunks (`actions/embeddings.ts:129-169`), and queue-side image embedding enters the same CLIP path after image processing (`image-queue.ts:333-367`).

Concrete failure scenario:

Production semantic search is enabled and a traffic burst arrives from many IPs, or stale client requests accumulate because they are not aborted. Active inference remains capped, but every excess request still keeps a promise, request/response state, and route work queued in memory. Latency grows without a clear rejection boundary, and the server can run out of memory or spend most of its time completing obsolete requests.

Concrete fix:

Replace the hand-rolled waiter array with a queue that has `concurrency`, `timeout`, and `queueSize` limits. Return `503` or `429` with `Retry-After` once the global CLIP queue is full. Track queue depth in logs/health output so operators can tune `CLIP_INFERENCE_CONCURRENCY`, semantic route rate limits, and scan limits with evidence. Share that same queue for public text search, similar-photo work if it ever needs inference, image embedding side effects, and admin backfill.

### PERF-C10-06: Infinite masonry keeps every loaded card mounted, so long browse sessions can create client jank

Status: Risk
Severity: Low-Medium
Confidence: Medium-High

Code regions:

- `apps/web/src/components/home-client.tsx:127-130`
- `apps/web/src/components/home-client.tsx:195-210`
- `apps/web/src/components/home-client.tsx:286-360`
- `apps/web/src/components/load-more.tsx:41-96`
- `apps/web/src/components/load-more.tsx:122-132`

`HomeClient` stores all loaded images in one state array and appends every load-more page (`home-client.tsx:127-130`). The masonry render maps every item in that accumulated array to a card and picture (`home-client.tsx:286-360`). `LoadMore` automatically fetches more content as the sentinel enters the viewport (`load-more.tsx:122-132`) and appends returned pages (`load-more.tsx:41-96`). The page has useful mitigations such as lazy images, fixed dimensions, and intrinsic size estimates (`home-client.tsx:195-210`, `home-client.tsx:357-359`), but it does not virtualize or prune older cards.

Concrete failure scenario:

A visitor scrolls through a large gallery or public smart collection for many pages. Thousands of card nodes, picture/source/img elements, hover layers, and layout boxes remain mounted. Even with lazy decoding, React updates, browser layout, accessibility tree size, and memory use grow linearly. The visible symptom is scroll jank, delayed taps, and slower search/nav interactions in long sessions.

Concrete fix:

Introduce virtualization/windowing for the masonry list, or switch automatic infinite loading to a hybrid model that requires explicit user action after a threshold. If CSS masonry makes virtualization difficult, keep recent pages mounted and replace far-off pages with stable-height placeholders that can be restored when scrolling back. Validate with a browser trace after loading 1000+ images.

### PERF-C10-07: Public archive and smart-collection predicates are intentionally non-sargable, but growth turns them into CPU scan paths

Status: Risk
Severity: Low-Medium
Confidence: High

Code regions:

- `apps/web/src/lib/data-timeline.ts:88-116`
- `apps/web/src/lib/data-timeline.ts:129-141`
- `apps/web/src/lib/data-timeline.ts:172-207`
- `apps/web/src/lib/smart-collections.ts:217-220`
- `apps/web/src/lib/smart-collections.ts:259-266`
- `apps/web/src/lib/data.ts:1437-1451`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:62-84`

The code already documents that `MONTH()`, `DAY()`, and `YEAR()` filters on `capture_date` are not sargable and are accepted at personal-gallery scale (`data-timeline.ts:88-116`, `data-timeline.ts:172-207`). The timeline year list also uses `YEAR(capture_date)` for distinct years (`data-timeline.ts:129-141`). Smart collections support `%...%` contains predicates on image fields (`smart-collections.ts:217-220`) and tag names (`smart-collections.ts:259-266`), while public first-page smart collections still use aggregation plus `COUNT(*) OVER()` (`data.ts:1437-1451`) from the public route (`c/[slug]/page.tsx:100-101`). Timeline pages are uncached dynamic pages (`timeline/page.tsx:62-84`).

Concrete failure scenario:

The gallery grows beyond personal scale, or public smart collections are promoted and crawled. Repeated `/timeline`, `/year/{year}`, and broad `/c/{slug}` requests evaluate functions or `%LIKE%` predicates over many processed rows before grouping and ordering. This creates DB CPU and temp-table pressure even though each page renders a bounded number of images.

Concrete fix:

For timeline, replace `YEAR(capture_date) = ?` with range predicates (`capture_date >= Y-01-01 AND capture_date < Y+1-01-01`) and add generated/indexed month/day columns if On This Day remains public. For smart collections, either restrict public collection predicates to indexable operations, materialize collection membership/counts after admin edits, or add a search index for contains-style predicates. Keep current comments, but add operational thresholds or tests that make the "personal-gallery scale" assumption explicit.

## Existing Safeguards Observed

- Public load-more paths use bounded page sizes and cursor pagination in `actions/public.ts` and `data.ts`.
- `getMapImages` caps public GPS markers at 10000 and documents the future clustering requirement (`data.ts:1648-1683`).
- Shared group view count buffering is bounded with retry caps and cleanup (`data.ts:17-34`, `data.ts:155-218`).
- Admin color backfill computes a pool-aware concurrency budget (`admin-backfill-runner.ts:129-142`), which is the pattern the image queue should reuse.
- Sharp global concurrency and cache behavior are explicitly controlled (`process-image.ts:36-57`), and derivative generation avoids unbounded configured output sizes through `gallery-config-shared.ts`.
- Histogram work is offloaded to a worker and bounded by a small canvas sample.
- Service worker and rate-limit maps were not re-flagged in this cycle; the searched code showed explicit caps/pruning on the relevant paths.

## Final Missed-Issue Sweep

After drafting findings, I re-searched for `Promise.all`, timers, `readFile`, `toBuffer`, `formData`, `COUNT(*) OVER`, `offset`, advisory locks, unbounded-map comments, and client event/listener patterns across `apps/web/src` and `apps/web/scripts`. I also re-read the current hot files with line numbers for the findings above.

I did not find a new default-path unbounded public result set: home/topic/smart listings cap rendered rows, map caps markers, shared groups cap images, timeline caps year results with a visible truncation notice, and semantic search has default scan/rate limits. The remaining concerns are the seven findings above, with the highest practical risk concentrated in shared DB pool contention, repeated upload tag work, large-file GPS scrubbing memory, and semantic search cancellation/backpressure.
