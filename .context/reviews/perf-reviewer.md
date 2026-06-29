# Performance Review - Cycle 7/100 - PROMPT 1

Role: perf-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `17124135`
Date: 2026-06-29

## Scope And Method

I read the supplied `AGENTS.md` rules and local `CLAUDE.md` before reviewing. I did not implement fixes.

Review angles covered: performance, concurrency, CPU and memory pressure, database/query shape, image processing, queues, caches, service-worker behavior, and UI responsiveness.

## Review-Relevant Inventory

Inventory was built from `rg --files`, targeted symbol searches, and direct reads of review-relevant source. I examined the relevant surfaces below and their cross-file interactions rather than sampling a narrow subset.

Operating context and prior work:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/`
- `.context/reviews/`

Build/runtime/deploy/cache:
- `package.json`
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/scripts/build-sw.ts`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`

Database, schema, migrations, data access:
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/index.ts`
- `apps/web/drizzle/0000_nappy_madelyne_pryor.sql` through current migration inventory
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/scripts/migrate.js`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/analytics-data.ts`
- `apps/web/src/lib/smart-collections.ts`

Image, upload, serving, queues, and backfills:
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`

Search and CLIP:
- `apps/web/src/components/search.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-inference.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`

Public/admin pages and UI responsiveness:
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/upload-dropzone.tsx`

Tests and static contracts checked by inventory/targeted reads:
- `apps/web/src/__tests__/data-tag-names-sql.test.ts`
- `apps/web/src/__tests__/smart-collection-pagination.test.ts`
- `apps/web/src/__tests__/data-timeline.test.ts`
- `apps/web/src/__tests__/data-timeline-truncation.test.ts`
- `apps/web/src/__tests__/semantic-search-route.test.ts`
- `apps/web/src/__tests__/similar-route.test.ts`
- `apps/web/src/__tests__/search-stale-response.test.ts`
- `apps/web/src/__tests__/sw-template-contract.test.ts`
- `apps/web/src/__tests__/serve-upload.test.ts`
- `apps/web/src/__tests__/process-image-*.test.ts`
- full `apps/web/src/__tests__` filename inventory

## Findings

### PERF-C7-01 - Initial public listing queries still aggregate tags and compute `COUNT(*) OVER()` across the full matched set

Severity: Medium
Confidence: High
Status: Confirmed current HEAD issue

Code region:
- `apps/web/src/lib/data.ts:872-900`
- `apps/web/src/lib/data.ts:1403-1447`
- `apps/web/src/app/[locale]/(public)/page.tsx:149-166`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-176`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`

The home/topic first-page path calls `getImagesLitePage(..., PAGE_SIZE, 0)`. `getImagesLitePage` selects public image fields plus `tag_names: tagNamesAgg` and `total_count: COUNT(*) OVER()`, joins `image_tags` and `tags`, groups by `images.id`, orders by listing order, then applies `LIMIT normalizedPageSize + 1`. The smart-collection initial path repeats the same grouped/window-count shape for broad compiled predicates.

Why this is a problem:
MySQL must build the grouped result and compute the window count for all matching rows before the first 31 cards can be returned. The query also aggregates tag names in the same pass, so even an anonymous first-page render pays tag-join/grouping cost over the entire filtered image set. The load-more cursor path intentionally avoids `COUNT(*) OVER()` at `data.ts:1399-1401`, but the first render still keeps the expensive shape.

Concrete degradation scenario:
A gallery grows to tens of thousands of processed photos with several tags each. A crawler, social link preview, or visitor loads `/`, a topic page, or a broad smart collection. The page only needs 30 cards plus `hasMore`, but MySQL scans/groups the whole matched set and may spill temp work. Concurrent public requests can raise DB CPU and slow initial page response.

Suggested fix:
Split first-page listing into bounded queries:
- Query image IDs for only `pageSize + 1` rows using the listing order/index.
- Aggregate tag names only for those IDs.
- Replace exact public `totalCount` with `hasMore` where possible, or run a separate count over the filtered `images` table without tag aggregation when the UI truly needs an exact number.

If smart collections keep an exact count, compute it as a separate cheap count over the compiled image predicate and keep the card query keyset/bounded.

### PERF-C7-02 - Admin analytics top tables are missing covering bot/time/entity indexes

Severity: Medium
Confidence: High
Status: Likely issue confirmed by query/index mismatch; run `EXPLAIN` before migration sizing

Code region:
- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:26-35`
- `apps/web/src/lib/analytics-data.ts:28-46`
- `apps/web/src/lib/analytics-data.ts:62-79`
- `apps/web/src/lib/analytics-data.ts:161-180`
- `apps/web/src/db/schema.ts:221-254`

The admin analytics page runs all top-table queries in parallel. Each top query filters by `bot = false` and optional `viewed_at >= since`, then groups by an entity:
- `getTopPhotosByViews`: groups by `imageViews.imageId`.
- `getTopTopicsByViews`: groups by `topicViews.topic`.
- `getTopSharedGroupsByViews`: groups by shared group key after joining on `sharedGroupViews.groupId`.

The indexes do not match those access patterns:
- `image_views` has `(image_id, viewed_at)` plus `(bot, viewed_at, country_code)` and `(bot, viewed_at, referrer_host)`, but no `(bot, viewed_at, image_id)`.
- `topic_views` has only `(topic, viewed_at)`.
- `shared_group_views` has only `(group_id, viewed_at)`.

Why this is a problem:
For windowed analytics (`WHERE bot = false AND viewed_at >= ?`), entity-first indexes on topic/group do not help unless that entity is constrained. The country/referrer indexes are correctly shaped for their own breakdowns, but the top photo/topic/share tables still require scanning a time window and doing temp grouping with extra row lookups. These are append-only public-event tables retained for hundreds of days.

Concrete degradation scenario:
After months of traffic, an admin opens `/admin/analytics?window=90d` or a larger window. The server fires five analytics queries concurrently; three of them perform large window scans and group by entity. On the single web/DB topology, this can make the dashboard slow and contend with public reads/writes.

Suggested fix:
Add migration + Drizzle schema indexes matching the analytics filters and grouping keys:
- `image_views(bot, viewed_at, image_id)`
- `topic_views(bot, viewed_at, topic)`
- `shared_group_views(bot, viewed_at, group_id)`

For shared groups, consider grouping by `group_id` first and joining keys afterward if `EXPLAIN` shows the current `GROUP BY sharedGroups.key` prevents using the covering index efficiently. Follow repo migration rules: update `apps/web/drizzle/meta/_journal.json` with a strictly increasing `when`, mirror fresh-schema reconciliation in `apps/web/scripts/migrate.js`, and verify with `EXPLAIN`.

### PERF-C7-03 - Real CLIP inference has no process-wide concurrency governor

Severity: Medium
Confidence: Medium
Status: Likely issue; manual load validation recommended

Code region:
- `apps/web/src/lib/clip-model.ts:76-108`
- `apps/web/src/lib/clip-model.ts:118-140`
- `apps/web/src/lib/clip-model.ts:151-199`
- `apps/web/src/app/api/search/semantic/route.ts:178-189`
- `apps/web/src/app/api/search/semantic/route.ts:232-240`
- `apps/web/src/lib/image-queue.ts:530-589`

`getModelBundle` deduplicates model loading, but inference calls are not serialized or bounded. Public semantic search calls `embedTextReal` after only per-IP rate limiting, and the background image queue calls `embedImageReal` as an async side effect after processing an upload. Both paths share the same lazy-loaded CPU model object, but there is no semaphore/PQueue around the expensive `model(...)` calls at `clip-model.ts:123-126` and `clip-model.ts:184-186`.

Why this is a problem:
Production CLIP inference is CPU and memory intensive. Per-IP request limits are not a global concurrency limit, and background embeddings can overlap with public semantic searches. The repo is explicitly a single web-instance/single-writer deployment, so multiple simultaneous ONNX/Transformers calls can saturate CPU, increase latency for unrelated public routes, and contend with Sharp processing.

Concrete degradation scenario:
An admin uploads a batch while semantic search is in production mode. The image queue begins embedding completed uploads, while several visitors submit semantic searches. Multiple model invocations run at once in the live web process, causing high CPU, event-loop delay, and slow gallery responses even though each individual caller is within rate limits.

Suggested fix:
Add a small process-wide inference limiter in `clip-model.ts` or a dedicated `clip-inference-queue.ts`, defaulting to concurrency `1` and configurable via `CLIP_INFERENCE_CONCURRENCY`. Wrap both `embedTextReal` and `embedImageReal` model invocations in that limiter. Keep model loading as a singleton, but make CPU inference admission explicit. Add a focused test that concurrent calls enter the model body at most once when the default limiter is active, and expose queue depth/logging for production validation.

### PERF-C7-04 - Upload preview renders every selected full-size file at once

Severity: Medium
Confidence: High
Status: Confirmed current HEAD issue

Code region:
- `apps/web/src/components/upload-dropzone.tsx:45-49`
- `apps/web/src/components/upload-dropzone.tsx:95-123`
- `apps/web/src/components/upload-dropzone.tsx:451-489`

The admin upload component defaults to `maxFiles: 100`, `maxFileBytes: 200MB`, and `maxTotalBytes: 2GB`. When files are selected, it creates an object URL for every file, stores all URLs in a `Map`, and renders every selected file in a grid as a raw `<img src={previewUrl}>`. The preview image has no `loading="lazy"`, no `decoding="async"`, no visible-window cap, and no generated thumbnail/downscale layer.

Why this is a problem:
The server upload loop is intentionally serial, but the browser preview work is all-at-once. Selecting a large batch can create many DOM image elements backed by very large local photo files. Browsers may decode multiple full-resolution images for layout/paint, producing memory pressure and main-thread jank before any server queue bottleneck is reached.

Concrete degradation scenario:
A photographer drags 100 large camera exports into the admin uploader. The page creates 100 object URLs and renders 100 preview cards immediately. On a laptop browser, decoding and layout can freeze the dashboard or crash the tab, preventing the upload from starting reliably.

Suggested fix:
Apply a low-risk immediate improvement by adding `loading="lazy"` and `decoding="async"` to preview images. Then bound the preview surface: render only the first N previews plus a count, virtualize the grid, or generate small thumbnail blobs off-main-thread via `createImageBitmap`/canvas/worker and revoke original preview URLs once thumbnails are ready.

## Rechecked Non-Findings / Already Mitigated Areas

- Sized image derivative writes are now same-directory temp-file plus atomic rename in `apps/web/src/lib/process-image.ts:1132-1143` and duplicate-size variants use the same helper at `process-image.ts:1159-1165`; the prior non-atomic derivative race is fixed in current HEAD.
- Sharp global concurrency/cache is explicitly bounded/disabled, and high-bitdepth AVIF probing is process-singleton guarded.
- Image queue bootstrap uses bounded batches and current queue maps are capped; no unbounded bootstrap scan issue found in current HEAD.
- Public semantic and similar search scans are hard-capped and rate-limited; the remaining performance risk is the unbounded CLIP inference concurrency above, not vector scan size.
- Public search has debounce/stale-response guards and result caps. A future FULLTEXT search project may still be warranted at larger scale, but I did not find a new correctness or responsiveness issue beyond known structural tradeoffs.
- Timeline/map queries retain documented personal-gallery caps and truncation behavior; I did not find a current missed cap or unbounded UI render path there.
- Image serving and OG routes use rate limits, ETags/cache headers, byte/time budgets, and streaming; no new serving hot-path issue found.

## Final Missed-Issues Sweep

I repeated a final sweep over DB aggregation patterns, `COUNT(*) OVER()` usage, CLIP/Sharp CPU paths, queue side effects, object URL/image-preview usage, service-worker cache paths, route-level rate limits, and public page data loaders. The four findings above are the remaining current HEAD issues I would schedule from the performance lane. The strongest cross-agent candidate is likely `PERF-C7-01` because it touches public first-page render latency; `PERF-C7-02` and `PERF-C7-03` are the highest operational risk under growth/load; `PERF-C7-04` is the clearest admin UI responsiveness defect.
