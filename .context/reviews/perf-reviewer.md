# Performance Review — Cycle 2

## Scope and Inventory

I built the review inventory first, then examined the full review-relevant repository from the performance angle.

- Routes/layouts/route handlers reviewed: 34
- Server actions reviewed: 9
- Components reviewed: 44
- Library/data/storage/queue modules reviewed: 33
- DB modules reviewed: 3
- Test files reviewed: 12
- Scripts reviewed: 11
- E2E files reviewed: 5

Reviewed areas included the public SSR/ISR path, admin path, DB access layer, search, image processing, queueing, storage, upload serving, settings, scripts, and test coverage. I also swept low-risk UI wrappers and scaffolding files; they did not produce performance findings.

## Confirmed Issues

### P2-01: Shared-group overview downloads OG-sized images for masonry thumbnails

- Category: Confirmed Issue
- File and region: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` lines 79-80 and 149-155
- Confidence: High

Why it matters:
The page computes `ogImageSize` with `findNearestImageSize(config.imageSizes, 1536)` and then uses that same size for every image card in the shared-group overview grid. The rendered `sizes` hint is only `100vw / 50vw / 33vw`, so the browser is being handed a much larger asset than the layout needs.

Concrete failure scenario:
Open a shared group with 50-100 images on mobile or a mid-width laptop. Every grid tile requests a 1536px WebP even though the visible slot is closer to 360-500px. That increases transfer size, decode time, and memory pressure, and it delays first paint and scrolling.

Suggested fix:
Use a grid-oriented size, not the OG size, for the overview route. Mirror the approach already used in `home-client.tsx`: build a `srcSet` from the smallest two configured sizes, or at minimum use `findNearestImageSize(config.imageSizes, 640)` for the fallback source on the grid.

### P2-02: Public search path does unavoidable full scans on both image and tag queries

- Category: Confirmed Issue
- File and region: `apps/web/src/lib/data.ts` lines 604-651; `apps/web/src/db/schema.ts` lines 16-79
- Confidence: High

Why it matters:
`searchImages()` uses `LIKE '%term%'` against `images.title`, `images.description`, `images.camera_model`, `images.topic`, and then again against `tags.name`. The schema has no full-text index for those fields, and the leading wildcard prevents a normal B-tree index from helping even where an index exists. That makes both branches scan and sort candidate rows on every search.

Concrete failure scenario:
On a gallery with a large `images` table, a user types three or four characters into the search box. Each debounced keystroke triggers `searchImagesAction()`, which then runs one or two `%term%` queries that walk processed rows and sort by `created_at`. Latency climbs with table size, and concurrent users can push DB CPU high enough to affect page loads.

Suggested fix:
Move search off `%term%` scans. The pragmatic options are:
- add a dedicated full-text search path in MySQL,
- maintain a denormalized search document/table for images plus tags,
- or intentionally narrow to prefix search and index for that shape.

As written, rate limiting helps protect the database, but it does not remove the hot query shape.

### P2-03: The admin `queue_concurrency` setting does not control the processing queue

- Category: Confirmed Issue
- File and region: `apps/web/src/lib/image-queue.ts` lines 81-84; `apps/web/src/lib/gallery-config.ts` lines 47-53 and 95-100; `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` lines 141-152
- Confidence: High

Why it matters:
The admin settings surface exposes `queue_concurrency`, and `getGalleryConfig()` loads it, but the actual queue is created from `process.env.QUEUE_CONCURRENCY` only. Operators therefore cannot use the admin setting to reduce or raise processing parallelism at runtime.

Concrete failure scenario:
An operator sees CPU saturation during upload bursts and lowers `queue_concurrency` in the admin settings UI from `2` to `1`. The UI accepts the change, but background processing continues at the old concurrency because `image-queue.ts` never reads the stored value. The performance problem persists and the setting becomes misleading.

Suggested fix:
Pick one control plane and wire it through consistently:
- either initialize and update the queue from `getGalleryConfig().queueConcurrency`,
- or remove the admin setting and document the env var as the real tuning knob.

If runtime tuning is intended, the queue also needs a safe live-update path when the setting changes.

## Likely Issues

### P2-04: Infinite scroll uses offset pagination on a descending sort, so deeper pages get progressively slower

- Category: Likely Issue
- File and region: `apps/web/src/app/actions/public.ts` lines 10-21; `apps/web/src/components/load-more.tsx` lines 29-43; `apps/web/src/lib/data.ts` lines 276-292
- Confidence: High

Why it matters:
The public gallery loads more images by increasing `offset`, and `getImagesLite()` applies that offset to a descending sort on `(capture_date, created_at, id)`. Offset pagination forces MySQL to walk and discard earlier rows before returning the next page.

Concrete failure scenario:
In a gallery with thousands of images, a user scrolls far down the home page or a topic page. The first few loads are fast, but later loads get slower because `OFFSET 1800`, `OFFSET 2100`, and so on keep re-reading earlier rows before returning the next 30.

Suggested fix:
Switch the public gallery to keyset/cursor pagination using the existing sort tuple `(capture_date, created_at, id)`. That removes the linear discard cost and keeps deep scrolling flat. If `tag_names` are still needed, fetch them after the base id page is selected or denormalize them.

### P2-05: Queue bootstrap hydrates the full unprocessed backlog into memory at startup

- Category: Likely Issue
- File and region: `apps/web/src/lib/image-queue.ts` lines 287-312
- Confidence: Medium

Why it matters:
`bootstrapImageProcessingQueue()` runs one unbounded `SELECT ... WHERE processed = false`, materializes the whole result set, and enqueues every pending job immediately. That makes startup cost proportional to backlog size.

Concrete failure scenario:
The service restarts after a DB outage or after many uploads were accepted while processing lagged. On boot, the process pulls every pending row into memory and fills the queue bookkeeping structures before it can settle back into steady-state traffic handling. Startup latency and heap usage spike together.

Suggested fix:
Bootstrap in pages or claims, not one full-table read. Examples:
- page through pending ids in small batches,
- only seed the first N jobs and let workers refill,
- or move to a pull/claim loop where workers ask the DB for the next pending job instead of hydrating the whole backlog.

## Risks Requiring Manual Validation

### P2-06: Upload transcoding probably oversubscribes CPU under sustained upload load

- Category: Risk Requiring Manual Validation
- File and region: `apps/web/src/lib/process-image.ts` lines 15-22 and 342-405; `apps/web/src/lib/image-queue.ts` lines 81-84
- Confidence: Medium

Why it matters:
Sharp is configured to use up to `cpuCount - 1` libvips threads, and each queued job launches three format pipelines in parallel (`webp`, `avif`, `jpeg`). With queue concurrency above 1, the system can easily end up with several heavyweight encodes active at once.

Concrete failure scenario:
On an 8-core host, a burst of uploads arrives while normal page traffic is still present. Two queue workers each start three encodes, and the process spends most CPU time in image conversion. The end-user symptom is slow SSR responses and sluggish admin interactions during upload bursts.

Suggested fix:
Validate with load testing on production-like hardware, then tune based on measurements:
- serialize formats within a job,
- lower queue concurrency,
- lower Sharp concurrency,
- or split image processing into a separate worker process.

This is the kind of issue that needs a profile or load test to size correctly, but the current structure makes the risk credible.

## Final Skipped-File / Missed-Issue Sweep

- No review-relevant runtime files were skipped.
- I swept the remaining low-risk files after the main hot-path pass: UI primitives, basic wrappers, icons/metadata files, validation/sanitize helpers, scripts, and tests.
- I did not run `EXPLAIN`, benchmark scripts, or traffic replay in this pass, so the manual-validation item above remains a measurement task rather than a proven regression.
