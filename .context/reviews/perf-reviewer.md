# Performance Reviewer Findings - review-plan-fix cycle 5/100

- **Reviewer:** performance-reviewer lane
- **Date:** 2026-07-07
- **Scope:** performance, concurrency, CPU/memory, image processing, DB/query cost, queues, service worker cache, UI responsiveness, CLS/LCP/INP risks, shared state hazards.
- **Write scope:** source read-only; only this artifact was rewritten.

## Inventory Built First

Review-relevant file groups identified before deep inspection:

- **DB/query and schema:** `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, feed/sitemap routes, public server actions.
- **Image pipeline and queues:** `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/process-topic-image.ts`, advisory/single-writer/contract locks, shutdown and background DB write helpers.
- **Search/embedding:** `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`.
- **Service worker/cache:** `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/scripts/build-sw.ts`, `apps/web/src/components/register-service-worker.tsx`, derivative cache headers in `apps/web/next.config.ts`.
- **Public UI responsiveness:** public home/photo pages, `apps/web/src/components/home-client.tsx`, `masonry-card.tsx`, `grid-picture.tsx`, `load-more.tsx`, `photo-viewer.tsx`, `similar-photos.tsx`, lightbox/zoom components.
- **Analytics/rate limiting:** `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/view-retention.ts`, rate-limit helpers and analytics tables/indexes.

## Confirmed Issues

### PERF-C1 - Feed and sitemap `updated_at` ordering lacks a matching `images` index

- **Code regions:** `apps/web/src/lib/data.ts:845-871` (`getImagesForFeed`), `apps/web/src/lib/data.ts:873-890` (`getFeedUpdatedAt`), `apps/web/src/lib/data.ts:1718-1729` (`getImageIdsForSitemap`), `apps/web/src/lib/data.ts:533-546` (`getTopicsWithLatestUpdate`), indexes at `apps/web/src/db/schema.ts:117-123`.
- **Failure scenario:** public feed or sitemap cache expiry on a larger gallery makes MySQL filter processed rows and sort by `updated_at DESC, created_at DESC, id DESC` without an index that matches that order. Existing indexes cover `processed/capture_date/created_at`, `processed/created_at`, and `topic/processed/capture_date/created_at`, so root feed/sitemap and topic feed freshness can fall back to filesort/temp work. On bursts, those reads compete with normal requests through the 10-connection pool in `apps/web/src/db/index.ts:23-34`.
- **Suggested fix:** add a migration and schema update for an index shaped like `(processed, updated_at, created_at, id)` and a topic variant such as `(topic, processed, updated_at, created_at, id)`. Validate with `EXPLAIN` for root feed, topic feed, sitemap, and per-topic latest-update query at representative row counts.
- **Confidence:** High.

### PERF-C2 - Background analytics writes have no global concurrency or backlog bound

- **Code regions:** `apps/web/src/lib/background-db-writes.ts:3-25`, `apps/web/src/app/actions/public.ts:341-350`, `apps/web/src/app/actions/public.ts:436-461`, `apps/web/src/app/actions/public.ts:464-493`, `apps/web/src/app/actions/public.ts:496-529`, pool limits at `apps/web/src/db/index.ts:23-34`.
- **Failure scenario:** distributed traffic can stay below the per-IP view budget while still admitting many concurrent `recordPhotoView`, `recordTopicView`, or `recordSharedGroupView` calls. Each call immediately starts a DB insert promise and stores it in the global `Set`; there is no process-wide max pending count, worker concurrency, batcher, or drop/coalesce policy. Under crawler or botnet-style traffic, the app can accumulate promises, saturate the MySQL pool/driver queue, log insert failures, and compete with foreground reads before view-retention cleanup ever matters.
- **Suggested fix:** put analytics inserts behind a bounded low-concurrency queue, for example 1-2 workers with a max pending count and explicit dropped/coalesced metrics. A stronger version batches inserts per table. Keep the per-IP limiter, but add global admission before scheduling the write and preferably before target validation when the product semantics allow it.
- **Confidence:** Medium-High.

## Likely Issues

### PERF-L1 - Service worker stale image revalidation is not lifetime-covered

- **Code regions:** `apps/web/public/sw.template.js:290-302` (`extendLifetime` helper), `apps/web/public/sw.template.js:427-430` (`startRevalidate(); return cached;` stale image path), mirrored logic reference `apps/web/src/lib/sw-cache.ts`.
- **Failure scenario:** when a cached image is stale and the service worker returns cached bytes immediately, the background revalidation promise is started but not passed to `event.waitUntil`. Browsers may terminate the service worker after the response settles, which can drop the cache refresh/cache metadata write. Users can keep seeing stale derivative bytes until a later navigation happens to complete the revalidate work.
- **Suggested fix:** wrap the stale-path background work with the existing lifetime helper: `void extendLifetime(event, startRevalidate())`. Add/adjust the service-worker template contract test so the built worker preserves that lifetime coverage.
- **Confidence:** Medium.

### PERF-L2 - Timeline/on-this-day queries use non-sargable date functions on public page paths

- **Code regions:** `apps/web/src/lib/data-timeline.ts:88-116`, `apps/web/src/lib/data-timeline.ts:129-142`, `apps/web/src/lib/data-timeline.ts:178-207`; home page includes `OnThisDayWidget` at `apps/web/src/app/[locale]/(public)/page.tsx:232-235`.
- **Failure scenario:** `YEAR(capture_date)`, `MONTH(capture_date)`, and `DAY(capture_date)` prevent the existing `(processed, capture_date, created_at)` index from being used beyond the processed prefix. At larger gallery sizes, every uncached home render that includes the on-this-day widget can scan processed images, and timeline/year views do the same for calendar slices.
- **Suggested fix:** rewrite year/month queries as range predicates so `idx_images_processed_capture_date` can be used. For on-this-day across years, add generated `capture_month`/`capture_day` columns or an equivalent functional index keyed with `processed`, or cache the daily result with a TTL because it changes at most once per day.
- **Confidence:** Medium.

## Validation-Needed Risks

### PERF-V1 - Cached derivative display path performs a synchronous HEAD probe per cached image tile

- **Code regions:** `apps/web/public/sw.template.js:365-397`, image cache constants at `apps/web/public/sw.template.js:31-39`.
- **Failure scenario:** a warm masonry page with 30 cached derivative images can issue roughly 30 concurrent HEAD requests before returning cached image responses. The timeout is bounded to 300 ms, and the design preserves freshness for same-filename derivative re-encodes, but mobile or high-latency networks may still delay image paint and add server request load.
- **Suggested validation/fix:** measure warm-cache masonry LCP and image completion under throttled latency. If material, add a metadata-based probe cooldown, age gate, or probabilistic HEAD strategy while preserving immediate freshness for admin-visible derivative changes.
- **Confidence:** Medium-Low until measured.

### PERF-V2 - Public LIKE search remains a multi-query leading-wildcard scan

- **Code regions:** `apps/web/src/lib/data.ts:1573-1716`, especially `apps/web/src/lib/data.ts:1628-1646` and `apps/web/src/lib/data.ts:1673-1704`; action limiter at `apps/web/src/app/actions/public.ts:247-329`.
- **Failure scenario:** `%term%` predicates across title, description, camera/lens fields, topic fields, tags, and aliases cannot use normal b-tree indexes. The route is rate-limited and capped, but one admitted search can still scan a large processed image/tag corpus and run up to three query shapes when the first result set underfills.
- **Suggested validation/fix:** keep the current shape for personal-gallery scale, but verify with slow-query logs or `EXPLAIN ANALYZE` on production-like data. If it becomes hot, move to FULLTEXT/generated search rows or a prefix/tokenized search strategy with a minimum query length.
- **Confidence:** Medium.

## Final Sweep / Non-Findings

- **Image queue:** `apps/web/src/lib/image-queue.ts` clamps queue concurrency against DB-pool budget, uses per-image advisory locks, bounded retry maps, embedding scan limits, chunked bootstrap batches, and shutdown drain hooks. No confirmed unbounded worker or retry loop issue found.
- **Sharp/image processing:** `apps/web/src/lib/process-image.ts` disables Sharp cache, derives conservative Sharp concurrency, caps input pixels, verifies only file heads for derivative integrity, and uses atomic writes/backups. The multi-format fan-out is CPU-heavy by design but bounded.
- **Admin backfill:** `apps/web/src/lib/admin-backfill-runner.ts` uses bounded concurrency and advisory locking; no broad queue hazard found in the inspected paths.
- **Semantic/similar search:** embedding scans are explicitly capped by `SEMANTIC_SCAN_LIMIT` and the embedding table has `(model_version, updated_at)` indexing. This remains a scale-sensitive area but no confirmed unbounded scan was found.
- **Client masonry/CLS:** `apps/web/src/components/masonry-card.tsx`, `grid-picture.tsx`, and `home-client.tsx` reserve dimensions/aspect ratio and prioritize above-fold images. No current CLS regression found in the inspected masonry path.
- **Load more/UI loops:** `apps/web/src/components/load-more.tsx` uses `loadingRef`, cursor guards, and intersection observer throttling. No runaway infinite-load loop found.
- **Service worker cache size:** `apps/web/public/sw.template.js` keeps serialized metadata mutations ordered and enforces a 50 MB image cache cap. The main open questions are lifetime coverage and the per-tile HEAD cost above.
- **Analytics retention:** `apps/web/src/lib/view-retention.ts` deletes in indexed, capped chunks. Retention bounds storage growth; it does not bound live write pressure, which is why PERF-C2 remains separate.

## File Groups Examined

- Data access and query construction: `data.ts`, `data-timeline.ts`, smart collection/tag/analytics helpers, public server actions, feed and sitemap routes.
- DB configuration and indexes: `db/index.ts`, `db/schema.ts`, Drizzle schema areas for images, embeddings, analytics, tags, shared groups.
- Image processing and background work: `process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, topic image processing, advisory locks, queue shutdown, background DB writes.
- Search and embeddings: semantic and similar API routes, CLIP model/concurrency helpers, embedding decode/top-K helpers.
- Service worker and derivative caching: SW template/built worker, SW cache model tests/helpers, service-worker registration, Next cache headers.
- Public UI: home page, photo page, masonry card/grid picture, load-more, photo viewer, lightbox/zoom, similar photos.

## Finding Count

- **Confirmed issues:** 2
- **Likely issues:** 2
- **Validation-needed risks:** 2
- **Total findings:** 6
