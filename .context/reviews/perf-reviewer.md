# Cycle 9 Performance Review

Date: 2026-06-29
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `adb1ae67 build(pwa): refresh service worker version`
Role: cycle 9 `perf-reviewer`

## Scope And Method

I read `AGENTS.md` and `CLAUDE.md` first, then reviewed the repository performance surface directly rather than sampling only a subset. The review covered public and admin request paths, database access shape and indexes, upload and image processing, queues and async side effects, service worker caching, client rendering, network payloads, memory pressure, and concurrency/race hazards.

Review evidence came from direct source inspection with line-numbered reads across `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/public`, `apps/web/deploy.sh`, package/config files, and prior review/plan context under `.context/reviews` and `.context/plans`.

## Review-Relevant Inventory

### Public read paths

- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/image/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
- `apps/web/src/app/[locale]/(public)/rss.xml/route.ts`
- `apps/web/src/app/api/images/route.ts`
- `apps/web/src/app/api/topic-images/[topic]/route.ts`
- `apps/web/src/app/api/smart-collections/[slug]/images/route.ts`
- `apps/web/src/app/api/search/route.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/images/[id]/view/route.ts`
- `apps/web/src/app/api/topics/[topic]/view/route.ts`
- `apps/web/src/app/api/shared-groups/[key]/view/route.ts`

### Database and query modules

- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/analytics-data.ts`
- `apps/web/src/lib/view-retention.ts`
- `apps/web/src/lib/view-tracker.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/index.ts`
- `apps/web/drizzle/*.sql`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/scripts/migrate.js`

### Upload, image processing, queues, and CPU-heavy work

- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/app/api/admin/upload/route.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/blur-placeholder.ts`
- `apps/web/src/lib/server-action-throttle.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-captions.ts`
- `apps/web/src/lib/clip-weights.ts`

### Client rendering, payload, and perceived performance

- `apps/web/src/components/grid-picture.tsx`
- `apps/web/src/components/infinite-grid.tsx`
- `apps/web/src/components/admin/image-manager.tsx`
- `apps/web/src/components/site-header.tsx`
- `apps/web/src/components/service-worker-register.tsx`
- `apps/web/src/components/share-actions.tsx`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`
- `apps/web/scripts/generate-sw.mjs`

### Configuration and operational files

- `apps/web/next.config.ts`
- `apps/web/package.json`
- root `package.json`
- `apps/web/deploy.sh`
- `apps/web/Dockerfile`
- `apps/web/src/middleware.ts`
- `apps/web/src/lib/runtime-config.ts`

## Findings

### PERF-C9-01: First-page public listing queries still aggregate and count the full matched set

Status: Confirmed issue
Severity: High
Confidence: High

Code regions:

- `apps/web/src/lib/data.ts:877-905` in `getImagesLitePage`
- `apps/web/src/lib/data.ts:1437-1452` in `getImagesForSmartCollection`
- `apps/web/src/app/[locale]/(public)/page.tsx:149-166`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-176`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`

The first-page public listing query still joins `images` to `imageTags` and `tags`, selects `tag_names: tagNamesAgg`, groups by `images.id`, and computes `total_count: COUNT(*) OVER()` before applying `limit(normalizedPageSize + 1).offset(offset)` in `getImagesLitePage` (`apps/web/src/lib/data.ts:877-905`). The smart collection initial path repeats the same query shape with `COUNT(*) OVER()` and tag aggregation in `getImagesForSmartCollection` (`apps/web/src/lib/data.ts:1437-1452`).

The later cursor-based load-more APIs are bounded and avoid the exact count, but the initial public home, topic, and smart collection routes call these first-page functions (`page.tsx:149-166`, `[topic]/page.tsx:163-176`, `c/[slug]/page.tsx:100-101`). That means a visitor or crawler hitting the first page of a broad listing can force MySQL to join and group the whole matched image set, aggregate tag names, and calculate an exact count even though only 31 cards are rendered.

Concrete failure scenario:

A gallery grows to tens of thousands of processed images with several tags per image. A crawler or several users request `/`, a popular topic, or a broad smart collection. MySQL must build a grouped joined result and exact window count for the whole matching set before returning the first page. The expected symptoms are elevated DB CPU, temp table/filesort pressure, slower public TTFB, and queue/API contention against uploads or analytics writes.

Suggested fix:

Split the initial listing into two bounded phases. First select only the page of image IDs with the relevant filters and ordering using image-side indexes. Then aggregate tags for just those IDs. Replace exact `totalCount` with the already available `hasMore` behavior where the UI does not need an exact count, or run a separate cheap count over `images` only when an exact count is truly displayed. Apply the same two-phase pattern to smart collection first pages. Validate with `EXPLAIN ANALYZE` on home, topic, and broad smart collection queries before and after the change.

### PERF-C9-02: Analytics retention deletes do not have viewed_at-leading indexes

Status: Likely issue
Severity: Medium
Confidence: Medium-High

Code regions:

- `apps/web/src/lib/view-retention.ts:56-81`
- `apps/web/src/db/schema.ts:231-233`
- `apps/web/src/db/schema.ts:244-246`
- `apps/web/src/db/schema.ts:257-259`

The retention worker deletes old analytics rows with predicates of the form `viewed_at < cutoff` and a 5000-row batch limit in `pruneTable` (`apps/web/src/lib/view-retention.ts:64-81`). The nearby comment says deletes use existing `(image_id/topic/group_id/bot, viewed_at)` indexes (`apps/web/src/lib/view-retention.ts:56-59`).

The current indexes are not led by `viewed_at`: `image_views` has `(image_id, viewed_at)`, `(bot, viewed_at, country_code)`, `(bot, viewed_at, referrer_host)`, and `(bot, viewed_at, image_id)` (`apps/web/src/db/schema.ts:231-233`); `topic_views` has `(topic, viewed_at)` and `(bot, viewed_at, topic)` (`apps/web/src/db/schema.ts:244-246`); `shared_group_views` has `(group_id, viewed_at)` and `(bot, viewed_at, group_id)` (`apps/web/src/db/schema.ts:257-259`). For a predicate on `viewed_at` alone, MySQL generally cannot use the second column of a composite index as an efficient range access path unless the leading column is constrained. Even when an optimizer can attempt skip-scan-like behavior, delete workload can still degrade into large index/table scans.

Concrete failure scenario:

After a traffic spike or bot crawl, old analytics rows accumulate. The hourly retention job starts deleting old rows and has to scan a large append-only table to find `viewed_at < cutoff`. It repeats up to 200 batches per table, causing sustained IO and lock pressure while public view endpoints continue inserting into the same tables. On a small host this can show up as periodic latency spikes, slow analytics pages, and delayed upload/image processing.

Suggested fix:

Add dedicated purge indexes led by `viewed_at`, ideally `(viewed_at, id)` or equivalent primary-key suffixes for stable chunking, on `image_views`, `topic_views`, and `shared_group_views`. Consider deleting in `ORDER BY viewed_at, id LIMIT ?` batches if the dialect/runtime supports it cleanly. Add the migration journal entry with a strictly increasing `when`, mirror the schema in `reconcileLegacySchema`, then validate using `EXPLAIN DELETE` or a transaction-safe equivalent on production-sized data.

### PERF-C9-03: Upload preview still renders and object-URLs every selected file at once

Status: Confirmed issue
Severity: Medium
Confidence: High

Code regions:

- `apps/web/src/components/upload-dropzone.tsx:45-49`
- `apps/web/src/components/upload-dropzone.tsx:95-123`
- `apps/web/src/components/upload-dropzone.tsx:458-490`

The upload dropzone still allows large local selections by default: `maxFiles: 100`, `maxFileBytes: 200 * 1024 * 1024`, and `maxTotalBytes: 2 * 1024 * 1024 * 1024` (`apps/web/src/components/upload-dropzone.tsx:45-49`). For every file in `files`, it creates a browser object URL and stores it in state (`apps/web/src/components/upload-dropzone.tsx:95-123`). The preview area then maps every file to a card and `img` element (`apps/web/src/components/upload-dropzone.tsx:458-490`).

The current code has useful mitigations: preview images now use `loading="lazy"` and `decoding="async"` (`apps/web/src/components/upload-dropzone.tsx:484-489`). That reduces immediate decode pressure, but it does not avoid creating all object URLs, rendering all preview cards, or exposing the browser to many huge local image resources in a single React render.

Concrete failure scenario:

An admin selects 100 large camera exports. Before upload starts, the browser creates 100 object URLs, React renders 100 preview cards, and the browser may still inspect or decode enough image metadata/content to create severe main-thread jank and memory pressure. On memory-constrained laptops or mobile admin sessions, the page can stall, discard tabs, or become unresponsive before the server-side queue becomes the bottleneck.

Suggested fix:

Bound preview work independently from upload capacity. Render only the first small preview window plus a count for the remaining files, or virtualize the preview list. Generate small preview thumbnails off the main rendering path with `createImageBitmap`/canvas or a worker, then release original object URLs promptly. Keep the existing `loading="lazy"` and `decoding="async"` attributes as a secondary mitigation.

### PERF-C9-04: Semantic search scan limit has an unsafe hard maximum if misconfigured

Status: Risk needing manual validation
Severity: Medium
Confidence: Medium

Code regions:

- `apps/web/src/lib/clip-embeddings.ts:36-44`
- `apps/web/src/app/api/search/semantic/route.ts:242-280`
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`

`SEMANTIC_SCAN_LIMIT` defaults to 2000, which is reasonable for the current brute-force SQL-plus-JS scoring design. However, the environment parser accepts values up to `ENV_INT_MAX = 1_000_000` (`apps/web/src/lib/clip-embeddings.ts:36-44`). Both semantic search and similar-image search select up to that many rows with embeddings and then decode/score them in-process (`apps/web/src/app/api/search/semantic/route.ts:242-280`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`).

At 512 float32 dimensions, each stored embedding is roughly 2048 bytes before row/object overhead. A misconfigured scan limit of 1,000,000 can request roughly 2 GB of embedding bytes from MySQL, then allocate JS arrays/objects and scoring buffers around that payload. This is not a default-path failure, but the allowed maximum is high enough to turn one public search request into an out-of-memory or long CPU event.

Concrete failure scenario:

An operator increases `SEMANTIC_SCAN_LIMIT` to improve recall after enabling CLIP search on a larger library. A public semantic request or similar-image request pulls a huge embedding result set into the Next.js process, causing long event-loop stalls, memory pressure, or worker termination. Repeated requests can create a denial-of-service condition even without high request volume.

Suggested fix:

Lower the hard maximum to an operationally bounded value that matches the host memory budget, such as 10k or 25k until a vector index/ANN path exists. Add a startup warning or failure when the configured limit exceeds the validated safe threshold. Longer term, stream batches or move nearest-neighbor search to a vector index instead of materializing the candidate set in one request.

## False Positives And Already Fixed Items

### FP-C9-01: Admin top analytics indexes from cycle 7 are now present

Status: Already fixed
Confidence: High

Prior review flagged top image/topic/group analytics queries that grouped by image/topic/group over a `bot + viewed_at` range without matching composite indexes. Current schema includes `idx_image_views_bot_viewed_at_image_id`, `idx_topic_views_bot_viewed_at_topic`, and `idx_shared_group_views_bot_viewed_at_group_id` (`apps/web/src/db/schema.ts:231-232`, `apps/web/src/db/schema.ts:244-245`, `apps/web/src/db/schema.ts:257-258`). Migration `apps/web/drizzle/0026_analytics_top_view_indexes.sql:1-3` adds them, and `apps/web/scripts/migrate.js:579-612` reconciles them for legacy databases.

The hot analytics query shapes in `apps/web/src/lib/analytics-data.ts:28-46`, `apps/web/src/lib/analytics-data.ts:62-79`, and `apps/web/src/lib/analytics-data.ts:161-180` now have matching indexes for the bot/date/grouping dimensions. I am not carrying the cycle 7 finding forward.

### FP-C9-02: CLIP inference and image preprocessing now share a process-wide limiter

Status: Already fixed
Confidence: High

Prior reviews flagged CLIP inference and image preprocessing as fire-and-forget work without a process-wide CPU/memory admission gate. Current `apps/web/src/lib/clip-model.ts:53-71` defines `CLIP_INFERENCE_CONCURRENCY` and `withInferenceSlot`. Text embedding wraps the model call in that slot (`apps/web/src/lib/clip-model.ts:143-146`), and image embedding wraps the Sharp preprocessing plus model inference inside the slot (`apps/web/src/lib/clip-model.ts:171-222`).

`apps/web/src/lib/image-queue.ts:623-683` still starts semantic side effects after the processed image is marked complete, but the expensive preprocessing and inference admission is now gated in `embedImageReal`. I am treating the prior C7/C8 CLIP limiter findings as fixed.

### FP-C9-03: Grid card hydration fallback from cycle 8 is fixed

Status: Already fixed
Confidence: High

Prior review flagged the `GridPicture` fallback as hydrating every archive/share card. Current `apps/web/src/components/grid-picture.tsx:1-52` is a server-rendered static picture component with no client state or per-card timer. It renders AVIF/WebP/JPEG sources directly and no longer creates a client component per image. I am not carrying the cycle 8 hydration finding forward.

### FP-C9-04: Service worker cache growth is bounded

Status: No current finding
Confidence: Medium-High

The service worker uses explicit caps: image cache max bytes is 50 MB and HTML entries are capped at 50 (`apps/web/public/sw.template.js:31-33`). Image LRU cleanup sums entries and deletes oldest items until under budget (`apps/web/public/sw.template.js:99-130`). HTML cleanup enforces the entry cap (`apps/web/public/sw.template.js:132-149`). Runtime navigation handling also keeps network timeout low for `HEAD` checks (`apps/web/public/sw.template.js:237-260`). I did not find an unbounded service-worker cache or obvious UI responsiveness bug in the current generated worker.

### FP-C9-05: In-memory rate-limit and queue maps are bounded or pruned

Status: No current finding
Confidence: Medium

The shared bounded map implementation evicts oldest entries when it exceeds its configured size (`apps/web/src/lib/rate-limit.ts:91-99`). Queue status maps are periodically pruned (`apps/web/src/lib/image-queue.ts:178-204`), and the permanent failure tracker is capped (`apps/web/src/lib/image-queue.ts:706-718`). I did not find an unbounded Map growth issue that warrants a current finding.

### FP-C9-06: Timeline date extraction remains bounded by documented limits

Status: Accepted risk / no current finding
Confidence: Medium

The timeline aggregation still uses year/month extraction rather than a dedicated generated column, but the path has a documented scan cap and defaults (`apps/web/src/lib/data-timeline.ts:159`, `apps/web/src/lib/data-timeline.ts:178-184`). This may remain a future scaling target, but it is not a fresh cycle 9 finding because the implementation intentionally bounds the archive scope.

## Final Missed-Issue Sweep

I did a final pass over the reviewed hot surfaces after drafting findings:

- Public cursor load-more APIs are bounded and do not repeat the exact total-count behavior from first pages.
- Map marker loading has an explicit marker cap and bounded payload path.
- Search APIs apply pagination/rate-limit controls; the main current concern is the semantic scan limit maximum, not the default path.
- Sharp processing is controlled through configured concurrency and output-size limits; no new image-processing CPU finding was confirmed.
- Upload server-side work is queue-mediated; the remaining confirmed issue is the client preview fanout before queue submission.
- Deployment disk pruning is intentional and outside this review's performance source-change scope.
- No source code or plan files were edited for this review.

## Summary

Current cycle 9 findings:

- `PERF-C9-01` High: first-page public listing and smart collection queries still aggregate tags and count the full matched set.
- `PERF-C9-02` Medium: analytics retention deletes need `viewed_at`-leading purge indexes.
- `PERF-C9-03` Medium: upload preview still creates and renders every selected file at once.
- `PERF-C9-04` Medium risk: semantic scan hard maximum is unsafe if misconfigured.

Already fixed or not carried forward:

- `FP-C9-01`: admin top analytics indexes are present.
- `FP-C9-02`: CLIP preprocessing and inference are process-limited.
- `FP-C9-03`: grid card hydration fallback is fixed.
- `FP-C9-04`: service worker caches are bounded.
- `FP-C9-05`: in-memory rate-limit and queue maps are bounded or pruned.
- `FP-C9-06`: timeline extraction is bounded and treated as accepted risk.
