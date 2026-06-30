# Cycle 32 Performance Review

Scope: current HEAD `3d174c96` on `master`. Product code was not edited.

## Inventory

- Project guidance read first: `AGENTS.md`, `CLAUDE.md`.
- Runtime and concurrency paths: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/instrumentation.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/backfill-color-pipeline.ts`.
- Image and file pipeline: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/lib/og-photo-fetch.ts`, upload actions/routes under `apps/web/src/app/actions/images.ts` and `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Public rendering and cache behavior: public pages under `apps/web/src/app/[locale]/(public)/`, API routes under `apps/web/src/app/api/`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, `apps/web/deploy.sh`.
- Database query surfaces: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/db/schema.ts`, analytics/rate-limit modules.
- UI responsiveness surfaces: `apps/web/src/components/home-client.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/image-zoom.tsx`, `apps/web/src/components/histogram.tsx`, `apps/web/src/components/map/*`, `apps/web/src/components/similar-photos.tsx`.
- Tests inspected for performance contracts: queue/backfill concurrency tests, semantic route/rate-limit/scan-limit tests, `clip-model-contract.test.ts`, timeline truncation tests, smart-collection pagination tests, touch-target audit, service-worker cache contract tests.

## Findings

### HIGH - Aborted queued CLIP request can permanently leak an inference slot

- Location: `apps/web/src/lib/clip-model.ts:53-72`, `apps/web/src/lib/clip-model.ts:117-170`.
- Callers affected: `apps/web/src/app/api/search/semantic/route.ts:247-260`, `apps/web/src/lib/image-queue.ts:353-392`, `apps/web/src/lib/image-queue.ts:395-451`, `apps/web/src/lib/image-queue.ts:744-770`.
- Client trigger: `apps/web/src/components/search.tsx:184-193`, `apps/web/src/components/search.tsx:272-275`.
- Current tests are source-shape only here: `apps/web/src/__tests__/clip-model-contract.test.ts:32-58`.
- Severity: High.
- Confidence: High.

The handoff path now preserves the active count while resolving the next waiter, which fixed the previous over-admission race. The remaining abort path can strand that reserved slot. `releaseInferenceSlot()` shifts and resolves `nextWaiter` without decrementing `activeInferenceCount` (`clip-model.ts:148-155`). The waiter then resumes and immediately checks `throwIfInferenceAborted(signal)` (`clip-model.ts:145`) before `withInferenceSlot()` has entered its `try/finally` (`clip-model.ts:157-170`). If the request aborts in that handoff window, `waitForInferenceSlot()` throws, and no `releaseInferenceSlot()` runs for the slot that was reserved for that waiter.

Concrete failure scenario:

1. `CLIP_INFERENCE_CONCURRENCY=1`.
2. Request A is running real CLIP inference.
3. Request B queues in `waitForInferenceSlot()` with a request `AbortSignal`.
4. A completes; `releaseInferenceSlot()` resolves B and keeps `activeInferenceCount === 1` reserved for B.
5. B's HTTP request is aborted before line 145 completes. The public search UI intentionally aborts stale semantic requests when a newer query starts and on unmount (`search.tsx:184-193`, `search.tsx:272-275`).
6. `waitForInferenceSlot()` throws before `withInferenceSlot()` reaches its `try/finally`, so the reserved active slot is never released.

After that, future production text/image embeddings see `activeInferenceCount >= CLIP_INFERENCE_CONCURRENCY`, queue behind a slot that no running inference owns, and eventually time out. The user-visible symptoms are semantic search returning abort/503/timeout behavior and production image/backfill embedding side effects stalling until the Node process restarts.

Fix direction: make queued acquisition return through a path that always owns a release responsibility once a slot has been reserved, including abort-after-handoff. One minimal shape is to catch errors after `await waitForInferenceSlot(...)`, call `releaseInferenceSlot()` if the waiter had already been handed a slot, then rethrow. Add a behavioral regression test with a deferred running inference, one queued waiter, handoff, abort before the queued function body starts, then a third request proving the slot is available.

### MEDIUM - Initial public listing renders pay a full grouped window count on dynamic pages

- Query shape: `apps/web/src/lib/data.ts:898-927`, `apps/web/src/lib/data.ts:1466-1481`.
- Dynamic callers: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/page.tsx:175-178`; `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:20`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:185-188`; `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:110-112`.
- Severity: Medium.
- Confidence: High.

The first page of the home, topic, and smart-collection galleries is rendered with `revalidate = 0`, so each request goes back to the database. The listing helpers select public image fields, left-join tags, group by image, order by the masonry sort key, and add `COUNT(*) OVER()` (`data.ts:910-927`, `data.ts:1466-1481`). In MySQL this window count is evaluated over the grouped result before `LIMIT`, so a request that displays 30 cards still counts the full filtered gallery and performs the tag aggregation shape needed for every candidate row.

Concrete failure scenario: a gallery grows to tens of thousands of processed photos with tags. Every anonymous home-page hit runs the grouped count over all processed images even though the UI only needs 31 rows for `hasMore` and uses `totalCount` only as display metadata. Topic and smart-collection landing pages have the same dynamic first-page shape. Under crawler traffic or a cold CDN, this becomes an O(total matching photos + tag join rows) database cost per request.

Fix direction: split first-page rendering from exact total counting. Use `LIMIT pageSize + 1` for the card query, compute `hasMore` from the lookahead, and either omit/defer `totalCount`, cache it separately, or use a narrower count query that does not join and aggregate tags when no tag filter requires it. The cursor/load-more path already avoids `COUNT(*) OVER()` for smart collections (`data.ts:1428-1458`); the first-page path should follow the same cost profile unless the exact count is required.

### LOW - Timeline and On This Day queries are dynamic and intentionally non-sargable

- Query shape: `apps/web/src/lib/data-timeline.ts:88-117`, `apps/web/src/lib/data-timeline.ts:125-145`, `apps/web/src/lib/data-timeline.ts:172-207`.
- Dynamic callers: `apps/web/src/components/on-this-day-widget.tsx:10-22`, `apps/web/src/app/[locale]/(public)/page.tsx:232-235`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-94`.
- Existing coverage documents behavior, not query scalability: `apps/web/src/__tests__/data-timeline-truncation.test.ts:67-94`.
- Severity: Low.
- Confidence: High.

This is acknowledged in comments, but it remains the main timeline scale limit. `getOnThisDayImages()` filters with `MONTH(capture_date)` and `DAY(capture_date)` (`data-timeline.ts:97-117`), and `getTimelineYears()` / `getTimelineImages()` use `YEAR(capture_date)` and optional `MONTH(capture_date)` (`data-timeline.ts:129-145`, `data-timeline.ts:186-207`). Those functions prevent the `capture_date` portion of `idx_images_processed_capture_date` from being used for range narrowing. The home page includes the On This Day server component in the same dynamic SSR pass (`page.tsx:232-235`, `on-this-day-widget.tsx:18-22`), and `/timeline` is also dynamic (`timeline/page.tsx:19`).

Concrete failure scenario: as the processed image table grows, every home render evaluates the current month/day function predicates over the processed-image prefix to return up to six rows. The timeline page similarly scans the processed prefix to derive years and then scans again for the selected year. This is acceptable for the documented personal-gallery envelope, but it will become CPU-bound DB work before the main keyset listing paths do.

Fix direction: add generated/stored `capture_month`, `capture_day`, and `capture_year` columns with indexes, or rewrite year pages to use date ranges such as `capture_date >= '2024-01-01' AND capture_date < '2025-01-01'`. For On This Day, generated month/day columns are the cleaner fit.

### LOW - Grid JPEG fallback path can download the base JPEG instead of a sized derivative

- Component: `apps/web/src/components/grid-picture.tsx:30-50`.
- Home caller: `apps/web/src/components/home-client.tsx:334-361`.
- Timeline caller: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:225-274`.
- Error fallback: `apps/web/src/components/grid-picture-fallback-boundary.tsx:14-27`.
- Severity: Low.
- Confidence: Medium.

The primary masonry path emits AVIF and WebP `srcSet`s for the two smallest configured sizes, but the `<img src>` fallback is the base JPEG filename (`home-client.tsx:340-354`, `timeline/page.tsx:253-267`). `GridPictureFallbackBoundary` also removes failed `<source>` elements and leaves the same fallback source (`grid-picture-fallback-boundary.tsx:14-27`). The project documentation notes the base JPEG can be the largest configured derivative, defaulting to a multi-megabyte file.

Concrete failure scenario: a client that does not use either typed source, or a photo whose AVIF/WebP sized variants 404 while the base JPEG exists, downloads the largest JPEG for a masonry tile. Above-the-fold cards can mark that fallback as eager/high priority (`home-client.tsx:358-360`, `timeline/page.tsx:271-273`), which increases LCP and mobile bandwidth cost for that edge path.

Fix direction: include a JPEG `srcSet` with the same small/medium sizes, or set the fallback `src` to the nearest small JPEG derivative when derivative existence is guaranteed for processed rows. Keep the base JPEG only as the final error fallback if the project still needs legacy-row safety.

## Final Sweep

- Image queue, admin backfill, restore, and upload paths have bounded queue admission, connection-budget caps, per-image advisory locks, restore/shutdown drains, upload byte preclaims, streaming original writes, Sharp cache/concurrency caps, and delete-mid-processing cleanup. No additional high-confidence performance defect was found there beyond the shared CLIP limiter.
- Semantic and similar-photo search have same-origin checks, rate limits, request-abort checks, scan caps, model-version filtering, and normalized dot-product optimization. The remaining blocking risk is the shared inference-slot leak.
- Public listing, timeline, map, feed, sitemap, OG, and upload-serving routes were checked for query shape, cache behavior, body/file buffering, and descriptor cleanup. Findings above are the only issues that met the reporting bar.
- Client search, load-more, masonry, lightbox/zoom, histogram, map, and similar-photo UI paths were checked for runaway effects, unbounded timers, expensive synchronous work, and layout responsiveness. The only UI/network issue reported is the JPEG fallback path.
