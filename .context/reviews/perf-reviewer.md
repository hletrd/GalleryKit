# Cycle 15 Performance Review

Role: perf-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `e87d1bc2ba75d1ec90704920ea0fa240cdba749c`
Date: 2026-06-30

This is a current-HEAD repository review from the performance, concurrency, CPU/memory, database/query efficiency, image-processing throughput, caching, and UI-responsiveness angles. I read `AGENTS.md` and `CLAUDE.md`, inventoried the relevant files first, then inspected source/docs/tests for this angle. I did not modify application source code.

## Inventory

Relevant runtime/config/script inventory:
- 530 tracked runtime/config/script/doc files were inventoried across `apps/web/src/**/*.ts`, `apps/web/src/**/*.tsx`, `apps/web/scripts/*`, `apps/web/public/*.js`, `apps/web/nginx/*`, package manifests, and `CLAUDE.md`.
- Server surfaces reviewed: public gallery/topic/photo/share/map/timeline/search/feed pages, public actions, admin dashboard/settings/actions, admin APIs, Lightroom upload, OG routes, uploads routes, health/live routes.
- Data/concurrency layers reviewed: `db/index.ts`, `db/schema.ts`, `lib/data.ts`, `data-timeline.ts`, `analytics-data.ts`, rate-limit helpers, bounded maps, view buffers, upload trackers, advisory locks, CLIP helpers, semantic routes.
- Image pipeline reviewed: `process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, color/CICP/CLIP backfill scripts, upload-serving/cache helpers, service worker cache policy.
- Client responsiveness reviewed: masonry/load-more, lightbox/photo viewer, map, search/similar UI, histogram worker integration, upload dropzone, dashboard clients.
- Tests and `.context` plans/reviews were used as contract/history evidence, not runtime hot paths. Generated build output, `node_modules`, runtime upload/data directories, and `.git` were excluded.

## Findings

### PERF-C15-01 - Public map can still serialize and render up to 10k markers and 10k links

Severity: High
Confidence: High
Status: confirmed

Evidence:
- `apps/web/src/lib/data.ts:1640-1676` caps `getMapImages()` at `MAP_MAX_MARKERS = 10000`, joins topics, filters GPS-visible rows, sorts them, and returns the full capped result.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:9-10` makes the map page dynamic with `revalidate = 0`.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:31-50` fetches all map rows and maps every row into a client marker payload.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:59-79` passes the full marker array through the RSC/client boundary and server-renders one accessible link per marker.
- `apps/web/src/components/map/map-client.tsx:76-93` computes bounds over all markers, and `apps/web/src/components/map/map-client.tsx:119-143` renders one Leaflet marker/popup per marker.
- `apps/web/src/db/schema.ts:114-120` has no GPS/map-oriented index.

Failure scenario:
An opted-in map-visible topic reaches thousands of GPS-tagged photos. `/map` then repeats a dynamic DB query, ships a large RSC payload, server-renders thousands of links, and asks React/Leaflet to instantiate thousands of markers/popups on the browser main thread. At the current 10k cap this is a realistic long-task and memory problem, especially on mobile.

Fix:
Use viewport/bounds-based fetching and marker clustering, with a virtualized or paginated accessible list. Add an EXPLAIN-backed index or materialized map table for the chosen query shape. As an interim guard, cap initially rendered markers far below 10k and require zoom/filter refinement.

### PERF-C15-02 - Aborted semantic searches still occupy CLIP inference and scoring work

Severity: Medium
Confidence: High
Status: confirmed

Evidence:
- `apps/web/src/components/search.tsx:181-190` aborts the previous semantic fetch when a new semantic search starts.
- `apps/web/src/app/api/search/semantic/route.ts:248-255` checks `request.signal` before `embedTextReal(query)`, but `embedTextReal` accepts no abort signal.
- `apps/web/src/lib/clip-model.ts:53-71` implements `CLIP_INFERENCE_CONCURRENCY` with a process-local `inferenceWaiters` array; queued waiters have no timeout, max length, or abort removal.
- `apps/web/src/lib/clip-model.ts:138-160` runs text inference through that unabortable slot.
- `apps/web/src/app/api/search/semantic/route.ts:286-305` synchronously decodes/scores all scanned embeddings after the DB read with no abort check inside the loop.
- `apps/web/src/app/api/search/similar/[id]/route.ts:143-176` uses the same scan/decode/score shape for similar photos.
- `apps/web/src/lib/clip-embeddings.ts:36-44` defaults `SEMANTIC_SCAN_LIMIT` to 2000 and allows up to 25000.

Failure scenario:
A user types several semantic queries or navigates away. The browser aborts stale requests, but server requests already waiting for or running CLIP inference remain in `inferenceWaiters` or the model call and still consume CPU. Stale work delays the newest query behind the single default CLIP slot, and a raised scan cap can also burn event-loop time decoding/scoring rows after the client has gone away.

Fix:
Thread `AbortSignal` through `embedTextReal`/`withInferenceSlot`, remove queued waiters on abort, check the signal after acquiring a slot and before model execution, and add a bounded queue/timeout. For scoring, process rows in chunks with abort checks or a worker/off-main-thread path before raising `SEMANTIC_SCAN_LIMIT`.

### PERF-C15-03 - Upload-processing contract lock pins a DB connection across slow file I/O and CPU work

Severity: Medium
Confidence: High
Status: likely

Evidence:
- `apps/web/src/lib/upload-processing-contract-lock.ts:9-30` acquires a MySQL `GET_LOCK` on a dedicated pooled connection; `apps/web/src/lib/upload-processing-contract-lock.ts:44-55` keeps that connection until release.
- Browser upload acquires the lock at `apps/web/src/app/actions/images.ts:175-180` and releases it only in `apps/web/src/app/actions/images.ts:611-613`.
- While holding the lock, browser upload streams/probes each file at `apps/web/src/app/actions/images.ts:339-350`, may GPS-strip at `apps/web/src/app/actions/images.ts:381-388`, inserts rows at `apps/web/src/app/actions/images.ts:455`, and enqueues processing at `apps/web/src/app/actions/images.ts:491-523`.
- The UI serializes sibling uploads because of this server lock (`apps/web/src/components/upload-dropzone.tsx:268-276`).
- Lightroom upload mirrors the same full-window lock at `apps/web/src/app/api/admin/lr/upload/route.ts:240-256`, does save/metadata at `apps/web/src/app/api/admin/lr/upload/route.ts:304-307`, GPS-strip at `apps/web/src/app/api/admin/lr/upload/route.ts:364-378`, inserts at `apps/web/src/app/api/admin/lr/upload/route.ts:454-455`, and releases at `apps/web/src/app/api/admin/lr/upload/route.ts:541-545`.
- Settings changes for `image_sizes` / `strip_gps_on_upload` use the same lock (`apps/web/src/app/actions/settings.ts:68-79`, `apps/web/src/app/actions/settings.ts:164-165`).

Failure scenario:
A large browser batch or Lightroom publish holds one of the 10 shared MySQL pool connections for the entire save/metadata/GPS-strip/insert/enqueue window and globally blocks sibling uploads plus settings updates. Slow disk, large originals, or GPS stripping can turn the correctness lock into minutes of admin UI serialization and reduced DB pool headroom.

Fix:
Narrow the lock to the actual contract-critical section: check/persist the upload-processing settings snapshot and first-image/locked-setting invariant around DB state only, then release before file save, metadata, and GPS stripping. If concurrent uploads must share immutable settings while settings writes are exclusive, replace the single mutex with reader/writer semantics or a short transaction/lease pattern.

### PERF-C15-04 - Image queue can pin most of the shared DB pool while Sharp work runs

Severity: Medium
Confidence: High
Status: likely

Evidence:
- `apps/web/src/db/index.ts:23-33` configures one shared MySQL pool with `connectionLimit = 10` and `queueLimit = 20`.
- `apps/web/src/lib/image-queue.ts:87-90` allows `QUEUE_CONCURRENCY` up to 8.
- `apps/web/src/lib/image-queue.ts:446-463` acquires an advisory processing claim by checking out a pool connection.
- `apps/web/src/lib/image-queue.ts:519-540` keeps the checked-out lock connection once a job starts.
- `apps/web/src/lib/image-queue.ts:622-637` performs Sharp derivative generation while the lock connection remains held.
- `apps/web/src/lib/image-queue.ts:653-657` then writes the processed-row update before `apps/web/src/lib/image-queue.ts:812-815` releases the advisory lock.

Failure scenario:
The default queue concurrency is one, but an operator can raise `QUEUE_CONCURRENCY` to eight. Eight jobs can then hold eight of ten shared DB connections during CPU/disk-heavy Sharp work. Live public/admin requests, analytics writes, and the jobs' own DB updates compete for the remaining two connections and can hit the pool queue limit.

Fix:
Do not hold shared-pool connections across Sharp work. Use a row lease/claim that releases the connection immediately, a tiny dedicated advisory-lock pool, or clamp effective queue concurrency based on shared-pool budget so live traffic always has reserved connections.

### PERF-C15-05 - GPS stripping re-materializes whole originals after the streaming save path

Severity: Medium
Confidence: High
Status: confirmed

Evidence:
- `apps/web/src/lib/process-image.ts:435-439` ties max original size to the advertised upload cap.
- `apps/web/src/lib/process-image.ts:887-910` streams accepted browser uploads to disk to avoid holding large originals on the heap.
- Browser upload calls `stripGpsFromOriginal()` when enabled at `apps/web/src/app/actions/images.ts:381-388`; Lightroom upload does the same at `apps/web/src/app/api/admin/lr/upload/route.ts:364-378`.
- `apps/web/src/lib/process-image.ts:1738-1764` immediately re-reads the entire original with `fs.readFile(filePath)` and may write a full scrubbed buffer.
- `apps/web/src/lib/process-image.ts:1773-1786` can also keep the original buffer while Sharp re-encodes fallback formats.

Failure scenario:
With GPS stripping enabled, a large original can exist as multipart/form state, an on-disk file, a full `fs.readFile` buffer, and a scrubbed or re-encode output at the same time. A Lightroom publish burst or several large browser uploads can create GC churn or process OOM even though the initial browser save path is streaming.

Fix:
Add a process-wide memory semaphore around whole-buffer GPS stripping, and prefer container-aware/range-based or streaming scrubbers where feasible. For Lightroom, evaluate a streaming multipart parser. If whole-buffer scrub remains necessary, consider a lower max original size when GPS stripping is enabled.

### PERF-C15-06 - Public view analytics can consume DB pool/write capacity on every page view

Severity: Medium
Confidence: Medium
Status: likely

Evidence:
- `apps/web/src/app/actions/public.ts:324-342` uses an in-memory per-IP limiter of 120 view-record calls per minute, capped at 2000 keys.
- `recordPhotoView` validates with a DB SELECT at `apps/web/src/app/actions/public.ts:372-375` and inserts `imageViews` at `apps/web/src/app/actions/public.ts:378-385`.
- `recordTopicView` validates with a DB SELECT at `apps/web/src/app/actions/public.ts:404-407` and inserts `topicViews` at `apps/web/src/app/actions/public.ts:409-416`.
- `recordSharedGroupView` validates with a shared-group/images join at `apps/web/src/app/actions/public.ts:432-442` and inserts `sharedGroupViews` at `apps/web/src/app/actions/public.ts:444-451`.
- These recorders are invoked from public render paths: photo pages at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:164-165`, topic pages at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:164`, and shared group pages at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:132-137`.

Failure scenario:
Anonymous page traffic, bots that pass the current limiter, or proxy/IP misclassification can generate up to 120 validation reads plus durable inserts per minute per limiter key. The work is intentionally fire-and-forget from the render perspective, but it still runs in the same Node process and same 10-connection MySQL pool as page queries, image queue updates, and admin actions.

Fix:
Buffer/batch view events with bounded concurrency, bulk insert periodically, and dedupe per target/session/IP bucket when exact raw events are not required. Consider DB-backed or edge/shared rate limiting if more than one process is ever introduced. Cache positive visibility checks briefly or rely on FK/constraint failure where safe to avoid a validation SELECT per view.

### PERF-C15-07 - Sidecar backfill scripts materialize and enqueue the full candidate set

Severity: Medium
Confidence: High
Status: confirmed

Evidence:
- `apps/web/scripts/backfill-color-pipeline.ts:342-357` fetches every candidate image into `rows` before processing.
- `apps/web/scripts/backfill-color-pipeline.ts:474-511` calls `queue.add()` for every row, then waits for `queue.onIdle()`. `BATCH_SIZE` only controls DB update flushing, not candidate fetch or queue residency.
- `apps/web/scripts/backfill-cicp-recheck.ts:57-74` fetches every HEIF/AVIF/HEIC row into memory.
- `apps/web/scripts/backfill-cicp-recheck.ts:81-93` creates a queue and enqueues every row before `apps/web/scripts/backfill-cicp-recheck.ts:144` waits for idle.

Failure scenario:
Running a color re-encode or CICP diagnostic against a large library creates an in-memory array of every candidate plus one queued closure per row before the first batch drains. A 50k-100k photo library spends memory on queued work and closure state instead of processing, increasing RSS and GC pressure in the sidecar container.

Fix:
Use keyset batch loops like the in-app runner: fetch `WHERE id > cursor ORDER BY id LIMIT BATCH_SIZE`, enqueue/drain only that batch, flush, advance the cursor, and repeat. Keep only the current batch resident.

### PERF-C15-08 - Publication-time feed ordering lacks matching indexes

Severity: Medium
Confidence: Medium
Status: likely

Evidence:
- Root feed requests call `getImagesForFeed(FEED_LIMIT)` at `apps/web/src/app/feed.xml/route.ts:29-40`.
- Topic feed requests call `getImagesForFeed(FEED_LIMIT, topicData.slug)` at `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:49-62`.
- `apps/web/src/lib/data.ts:828-853` filters processed images, optionally filters topic, groups tags, and orders by `updated_at DESC, created_at DESC, id DESC`.
- `apps/web/src/db/schema.ts:114-120` indexes processed/capture date, processed/created date, and topic/processed/capture date, but not processed/topic plus `updated_at`.

Failure scenario:
RSS readers and crawlers poll root/topic feeds. On a large gallery, MySQL cannot satisfy `WHERE processed = true ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 50` from the existing processed/created-at or capture-date indexes, so feed hits can scan/sort far more rows than returned.

Fix:
Add feed-shaped indexes such as `(processed, updated_at, created_at, id)` and `(topic, processed, updated_at, created_at, id)` if topic feeds matter. If tag aggregation prevents index use, split feed selection into an indexed ID subquery followed by tag aggregation for those 50 IDs.

### PERF-C15-09 - Dynamic first listing pages still do count-window work on hot requests

Severity: Medium
Confidence: Medium
Status: risk

Evidence:
- `apps/web/src/lib/data.ts:878-907` builds the first-page listing query with `COUNT(*) OVER()`, tag joins, `GROUP BY images.id`, gallery ordering, and `LIMIT pageSize + 1`.
- `apps/web/src/lib/data.ts:1438-1453` uses the same `COUNT(*) OVER()` shape for first-page smart collections.
- `CLAUDE.md:400` documents that public photo, topic, shared, and home gallery pages currently use `revalidate = 0` for immediate freshness.

Failure scenario:
For large galleries, broad topics, or broad smart collections, the initial dynamic page can require MySQL to evaluate/group/count the whole matching set before returning the visible first page. Because these public pages intentionally bypass ISR, repeated anonymous requests repeat the count work.

Fix:
Avoid exact `totalCount` in the hot SSR query. Return `hasMore` from `LIMIT + 1`, load exact counts asynchronously, or cache/precompute counts with short TTL/tag invalidation. Validate rewrites with `EXPLAIN ANALYZE` on production-like data.

## Reviewed With No New Finding

- Upload serving passes `request.signal` to `serveUploadFile`; the obvious fd-transfer abort leak is already addressed.
- Service-worker derivative freshness is bounded by a 300 ms HEAD timeout and a 50 MB LRU cap per `CLAUDE.md` plus `sw.template.js`.
- CLIP embedding scans have a supporting `(model_version, updated_at)` index (`apps/web/src/db/schema.ts:291-295`) and hard scan cap; the remaining issue is cancellation/CPU waste, not an unbounded DB scan.
- The in-app admin backfill runner already uses bounded batches and pool-budget arithmetic; the full-materialization issue is limited to sidecar scripts above.
- Public keyword search and timeline predicates remain scale-sensitive, but they are bounded/rate-limited and already documented as personal-gallery tradeoffs; I did not file them as new issues without slow-query evidence.
- No current repo-wide N+1 query stronger than the items above was found. The main query risks are broad dynamic count/sort scans and per-view analytics writes, not per-row application loops issuing DB calls.

## Final Missed-Issues Sweep

Final sweep command patterns covered `readFile`, `toBuffer`, `arrayBuffer`, broad `Promise.all`, `PQueue`, timers, `GET_LOCK`, `COUNT(*) OVER`, `ORDER BY`, `limit/offset`, dynamic route flags, cache headers, abort signals, `inferenceWaiters`, view-record limits, queue concurrency, and Sharp cache/concurrency across `apps/web/src`, `apps/web/scripts`, `apps/web/public`, `apps/web/nginx`, and `CLAUDE.md`.

Finding count: 9
