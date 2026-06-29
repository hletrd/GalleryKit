# Performance Review - Cycle 6/100 - PROMPT 1

Role: perf-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `e6db9241b3b4f2adbedaeeb46eb5d68275b74879`
Date: 2026-06-29

## Scope And Method

I read `AGENTS.md` and `CLAUDE.md` first, then inspected current HEAD only. I did not implement fixes.

Review perspectives covered: performance, concurrency, CPU/memory, DB/query shape, image pipeline, service worker behavior, and UI responsiveness.

## Review-Relevant Inventory

Inventory was built from `git ls-tree -r HEAD`, `rg --files`, targeted `rg` sweeps, and direct reads of the relevant files below. I did not sample only a narrow subset; I mapped the current app surface before writing findings.

Docs and operating context inspected:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/` and `.context/reviews/` inventory, with current review output written to `.context/reviews/perf-reviewer.md`

Build, runtime, deploy, and cache config inspected:
- `package.json`
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/scripts/build-sw.ts`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`

Schema, migrations, and DB access inspected:
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/index.ts`
- `apps/web/drizzle/0000_nappy_madelyne_pryor.sql` through `apps/web/drizzle/0024_drop_reactions.sql` inventory
- `apps/web/drizzle/meta/_journal.json` inventory
- `apps/web/scripts/migrate.js`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/analytics-data.ts`
- `apps/web/src/lib/smart-collections.ts`

Image, upload, queue, and backfill pipeline inspected:
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/storage/local.ts`

Search and CLIP pipeline inspected:
- `apps/web/src/components/search.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-inference.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`

Public pages, routes, and UI surfaces inspected:
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/histogram.tsx`

Tests and static contracts inspected by inventory and targeted source reads:
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

## Confirmed Issues

### 1. Initial public listing queries compute tag aggregation and `COUNT(*) OVER()` across the full matched set

Severity: High
Confidence: High

Code region:
- `apps/web/src/lib/data.ts:872-900`
- `apps/web/src/lib/data.ts:1403-1447`
- `apps/web/src/app/[locale]/(public)/page.tsx:149-166`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-176`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`

The home/topic first page path calls `getImagesLitePage(..., PAGE_SIZE, 0)`. That query selects `tag_names: tagNamesAgg`, joins `imageTags` and `tags`, groups by `images.id`, orders, and also selects `total_count: COUNT(*) OVER()` before applying `LIMIT normalizedPageSize + 1`:

```ts
const baseQuery = db.select({
    ...publicSelectFields,
    tag_names: tagNamesAgg,
    total_count: sql<number>`COUNT(*) OVER()`,
})
    .from(images)
    .leftJoin(imageTags, eq(images.id, imageTags.imageId))
    .leftJoin(tags, eq(imageTags.tagId, tags.id))
    .groupBy(images.id)
    .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id));
```

The smart-collection initial page repeats the same shape at `data.ts:1432-1446`.

Why this is a problem:
MySQL must form the grouped result set and compute the window count for all matching images before the `LIMIT` can return the first 31 rows. Because tag names are also aggregated in the same query, the first anonymous page render can pay for tag joins and grouping over the full topic/tag/smart-collection match set. These pages are dynamic public routes, so traffic can repeatedly trigger this work.

Concrete failure scenario:
A gallery grows to tens of thousands of processed images with several tags each. A public home page or topic page request only needs 30 cards plus a count, but the DB performs a full grouped join and window count over every matching image. Concurrent crawler or social-preview traffic can create large temp tables/filesorts, increase DB CPU, and delay the initial page render. Smart collections are worse when the compiled predicate is broad because the same full-set window count runs before the first page is served.

Suggested fix:
Split the first-page query into two bounded shapes:
- Query 1: a cheap count over the filtered `images` set, avoiding tag joins unless the filter itself requires a tag subquery.
- Query 2: select only the first `pageSize + 1` image IDs using the listing index/order, then join/aggregate tags only for those IDs.

Alternatively, remove exact `totalCount` from public first-page rendering and rely on `hasMore`, especially for smart collections. The existing cursor path for smart collections already avoids `COUNT(*) OVER()` at `data.ts:1399-1401`; the initial path should not keep the expensive shape.

### 2. Topic and shared-group analytics lack indexes matching their time-window queries

Severity: Medium
Confidence: High

Code region:
- `apps/web/src/lib/analytics-data.ts:62-79`
- `apps/web/src/lib/analytics-data.ts:161-180`
- `apps/web/src/db/schema.ts:221-254`

The analytics queries filter by bot and optional time window, then group by topic/share key:

```ts
const whereClause = since
    ? and(eq(topicViews.bot, false), gte(topicViews.viewed_at, since))
    : eq(topicViews.bot, false);
```

and:

```ts
const whereClause = since
    ? and(eq(sharedGroupViews.bot, false), gte(sharedGroupViews.viewed_at, since))
    : eq(sharedGroupViews.bot, false);
```

But the schema only defines:

```ts
idxTopicViewsTopicViewedAt: index('idx_topic_views_topic_viewed_at').on(table.topic, table.viewed_at)
idxSharedGroupViewsGroupIdViewedAt: index('idx_shared_group_views_group_id_viewed_at').on(table.groupId, table.viewed_at)
```

By contrast, `image_views` has indexes shaped for the analytics filters: `(bot, viewed_at, country_code)` and `(bot, viewed_at, referrer_host)` at `schema.ts:228-231`. `analytics-data.ts:93-111` even documents why that shape serves windowed analytics scans.

Why this is a problem:
For `WHERE bot = false AND viewed_at >= ?`, MySQL cannot efficiently use an index whose leading column is `topic` or `group_id` unless that leading column is constrained. The default analytics windows therefore degrade toward scanning retained topic/share view rows and grouping them. Retention is finite, but these are append-only public-event tables.

Concrete failure scenario:
After months of public traffic, `topic_views` and `shared_group_views` contain hundreds of thousands or millions of retained rows. Opening the admin analytics page with the default time window runs the top-topic and top-shared-group aggregations. Because the indexes are ordered by entity first, the DB scans far more rows than the selected time window, increases temp aggregation work, and makes the dashboard slow exactly when the admin needs it for operational visibility.

Suggested fix:
Add migrations and schema entries for analytics-window indexes, for example:
- `topic_views(bot, viewed_at, topic)`
- `shared_group_views(bot, viewed_at, group_id)`

Then verify with `EXPLAIN` for the default analytics windows. Keep the existing entity-first indexes if other routes depend on entity-specific history lookups.

### 3. Sized derivative re-encodes overwrite public image files non-atomically while the service worker can cache the bytes

Severity: Medium
Confidence: High

Code region:
- `apps/web/src/lib/process-image.ts:1133-1275`
- `apps/web/src/lib/process-image.ts:1277-1292`
- `apps/web/public/sw.template.js:176-205`
- `apps/web/public/sw.template.js:237-254`

The sized derivative loop writes each `_640`, `_1536`, etc. file directly to the public path:

```ts
const outputPath = path.join(dir, sizedFilename);
...
.webp({ quality: qualityWebp }).toFile(outputPath);
...
.avif(...).toFile(outputPath);
...
.jpeg(...).toFile(outputPath);
```

The duplicate-size path also writes directly when a hard link fails:

```ts
await fs.link(lastRendered.filePath, outputPath);
...
await fs.copyFile(lastRendered.filePath, outputPath);
```

Only the largest base filename gets the documented tmp/link/rename flow at `process-image.ts:1277-1292`. The already-public sized variants do not.

The service worker caches successful derivative responses by URL:

```js
await imageCache.put(cacheKey, networkResponse.clone());
await recordAndEvict(request.url, size);
```

and does synchronous HEAD revalidation for cached entries using `ETag` before deciding whether to return cached bytes.

Why this is a problem:
Fresh uploads are hidden until processing completes, but backfill and color-pipeline re-encodes operate on already-processed rows. During those re-encodes, a visitor can request a sized derivative while Sharp has truncated and is rewriting the same public file. Static serving or the upload fallback route can stream incomplete bytes. If the response is considered OK, the service worker may cache the partial/corrupt derivative under the stable URL.

Concrete failure scenario:
An admin starts a color-pipeline backfill. A mobile visitor loads a masonry page while `processImageFormats` is rewriting `123_640.avif` in place. The visitor receives a truncated AVIF; the service worker caches it. Subsequent visits can continue showing a broken tile until the cache revalidates to different bytes or the LRU evicts it. The stable filename and one-hour cache policy amplify a short write race into a visible UI defect.

Suggested fix:
Write every sized derivative to a unique temporary file in the same directory, then atomically `rename` to the final `outputPath`. For duplicate-size variants, hard-link or copy from the completed temp/final source into a temp destination and rename that destination. Track temp files for cleanup on failure. Longer term, versioned derivative filenames would also eliminate stale-cache ambiguity during backfills.

## Likely Issues

### 4. Semantic search ignores stale responses in state, but does not abort stale in-flight expensive requests

Severity: Low
Confidence: Medium

Code region:
- `apps/web/src/components/search.tsx:152-180`
- `apps/web/src/components/search.tsx:181-197`
- `apps/web/src/app/api/search/semantic/route.ts:228-247`
- `apps/web/src/app/api/search/semantic/route.ts:260-279`

The client increments `requestIdRef` and ignores stale semantic results after the fetch and JSON parse:

```ts
const requestId = ++requestIdRef.current;
...
const resp = await fetch('/api/search/semantic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: searchQuery, topK: SEMANTIC_TOP_K_DEFAULT }),
});
if (requestId !== requestIdRef.current) return;
```

That protects UI state, but it does not cancel the previous network request. There is no `AbortController` in `Search`, and the route does not check `request.signal.aborted` before or after its expensive operations. The route embeds the query, selects up to `SEMANTIC_SCAN_LIMIT` embeddings, decodes every row, and scores them.

Why this is likely a problem:
Semantic search is CPU/DB-heavy by design. A user typing with pauses longer than the debounce, rapidly toggling semantic mode, or closing the search overlay can leave old POSTs running even though their results will be discarded. Rate limiting bounds abuse, but it does not avoid wasted model inference and brute-force scoring for legitimate stale requests.

Concrete failure scenario:
A visitor types three semantic queries in succession on a slower connection. The first two requests are obsolete from the UI's perspective, but the server still performs embedding inference and scans/scores the embedding rows. Multiple visitors doing this at once can consume CPU that should be reserved for page renders and image serving.

Suggested fix:
Keep an `AbortController` ref in `Search`, abort the previous semantic request before starting a new one, and abort on clear/close/unmount/toggle. Pass `signal` to `fetch`. On the route, check `request.signal.aborted` before query embedding, after embedding, and before the DB scan/scoring loop where practical. This will not cancel every already-started native operation, but it gives the app a chance to stop work at the boundaries it controls.

## Risks Needing Manual Validation

These are not confirmed defects from code inspection alone. They are bounded or already documented, but worth validating with production-scale data or browser traces.

### A. Timeline and on-this-day queries use non-sargable date functions

Severity: Low
Confidence: High that the pattern exists; Low that it is currently harmful

Code region:
- `apps/web/src/lib/data-timeline.ts:92-114`
- `apps/web/src/lib/data-timeline.ts:178-205`

The code explicitly documents that `MONTH()`, `DAY()`, and `YEAR()` predicates are non-sargable and currently acceptable at personal-gallery scale. Validate with production row counts and `EXPLAIN` if timeline or on-this-day pages become slow. I am not counting this as a confirmed issue because the implementation already caps rows and documents the tradeoff.

### B. Warm service-worker image loads still put a synchronous HEAD probe on the display path

Severity: Low
Confidence: Medium

Code region:
- `apps/web/public/sw.template.js:211-254`

The HEAD probe is bounded with `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` and the comments explain the color-freshness requirement. It is still one display-path validation per cached image. Validate on slow mobile networks with DevTools/WebPageTest before changing it, because removing it would regress the documented freshness behavior.

### C. Semantic and similar-photo search remain brute-force scans by design

Severity: Low
Confidence: Medium

Code region:
- `apps/web/src/lib/clip-embeddings.ts:22-44`
- `apps/web/src/db/schema.ts:282-285`
- `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql:1-9`
- `apps/web/src/app/api/search/semantic/route.ts:238-279`
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`

The model-version/updated-at index now bounds the DB access pattern, and `SEMANTIC_SCAN_LIMIT` is env-tunable with a default of 2000. The scoring is still O(scan limit x 512). This is acceptable at current caps, but should be profiled if operators raise `SEMANTIC_SCAN_LIMIT` or the public semantic endpoints become high traffic.

## Final Missed-Issues Sweep

I ran a final static sweep for:
- `COUNT(*) OVER`
- `YEAR(`, `MONTH(`, `DAY(`
- direct `toFile(outputPath)` derivative writes
- semantic fetches and `AbortController`
- broad `Promise.all`, `setTimeout`, `setInterval`
- `groupBy`, `leftJoin`, and public query shapes

The sweep confirmed the issues above and also found several areas that already have explicit tests or comments explaining bounded tradeoffs, including view-count flush serialization, image-queue concurrency caps, SW HEAD timeout contracts, OG fetch timeouts, histogram abort handling, and smart-collection cursor pagination.

## Relevant Files Intentionally Not Inspected

I intentionally did not inspect generated/build/runtime or binary-heavy paths:
- `node_modules/`
- `.next/`
- `apps/web/public/uploads/`
- `apps/web/public/resources/` binary assets
- `apps/web/data/`
- image/font/ICC fixture binaries except where test filenames indicated coverage

I also did not read every historical review artifact under `.context/reviews/**` in full. I used that directory as historical context inventory only. Current HEAD source, config, migration inventory, and targeted tests were sufficient for this performance review.

## Summary

Confirmed issues:
1. Public initial listing and smart-collection queries combine full-set tag aggregation with `COUNT(*) OVER()`.
2. Topic/shared-group analytics indexes do not match their time-window filters.
3. Sized derivative re-encodes overwrite public image files non-atomically and can interact badly with SW caching.

Likely issue:
1. Semantic search drops stale client results but does not abort stale expensive requests.

No fixes were implemented in this review pass.
