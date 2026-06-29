# Perf Reviewer Report - Cycle 16/100

Review lane: `perf-reviewer`
Scope: current `HEAD` only (`3da74946a7e7a198041bf6067a0192411d61a860`)
Angles: performance, concurrency, CPU, memory, DB/query shape, upload/processing throughput, and UI responsiveness.

## Inventory Summary

I built the review inventory from the repository file list and repo-wide source sweeps, then inspected the performance-relevant paths and their cross-file interactions rather than sampling a subset.

- Repository size excluding `.git`: 45,128 files.
- TypeScript/TSX under `apps/web/src`: 499 files.
- App route/page/API surface under `apps/web/src/app`: 77 files.
- Client/server components under `apps/web/src/components`: 57 files.
- Shared libraries under `apps/web/src/lib`: 96 files.
- Operational scripts, e2e, and drizzle files: 66 files.
- Public route inventory inspected: home, topic, smart collection, photo, shared photo, shared group, timeline, year, map, upload serving routes, root/topic feeds, sitemap, OG routes, semantic/similar search APIs, health/live.
- Admin and background inventory inspected: upload actions, LR upload route, image queue, image processing, CLIP model/inference helpers, admin color backfill runner, analytics data, DB restore/download paths, settings/client polling, service-worker/cache support, rate limits, and relevant scripts/tests/source-contracts.

No critical/high confirmed performance issue was found. The remaining actionable findings are medium/low and concentrated in admin cleanup, upload memory pressure, map rendering scale, and semantic-search scan cost.

## Confirmed Issues

### 1. Batch image deletion repeats full derivative-directory scans per image and format

Severity: Medium
Confidence: High
Files/regions:
- `apps/web/src/app/actions/images.ts:807-845`
- `apps/web/src/lib/process-image.ts:575-664`

`deleteImages()` processes up to 100 selected images, chunks them by `IMAGE_CLEANUP_CONCURRENCY`, and for each image calls:

- `deleteImageVariantsStrict(UPLOAD_DIR_WEBP, ..., [])`
- `deleteImageVariantsStrict(UPLOAD_DIR_AVIF, ..., [])`
- `deleteImageVariantsStrict(UPLOAD_DIR_JPEG, ..., [])`

Passing `[]` intentionally triggers `collectImageVariantFilenames()`'s full directory scan path. That means a 100-image admin delete can perform up to 300 full derivative-directory scans, each walking every file in the corresponding upload directory before unlinking the selected image's variants. The code comments acknowledge the scan cost, but the cross-file interaction means bounded concurrency does not change the total I/O complexity: it is still `selected_images * formats * directory_size`.

Failure scenario: on a disk-constrained/NAS-backed host with a large derivative directory, a photographer batch-deletes 100 images. The DB transaction completes first, then cleanup spends a long time rescanning the same directories, producing high disk I/O, slow admin response, and possible server-action timeout or process pressure. Cleanup failures are surfaced, but the user-facing operation can still become unresponsive after the rows are already gone.

Suggested fix: add a batch cleanup helper that scans each derivative directory once per `deleteImages()` call, builds a basename/prefix match set for all selected images, and unlinks matched files with bounded concurrency. Preserve strict failure aggregation. A smaller alternative is to pass current configured sizes for the synchronous path and move historical-orphan cleanup to a separate sweep, but that changes the current "delete every old size variant immediately" contract.

### 2. GPS stripping loads and rewrites entire originals in memory on the upload path

Severity: Medium
Confidence: High
Files/regions:
- `apps/web/src/lib/process-image.ts:1738-1822`
- `apps/web/src/app/actions/images.ts:381-388`
- `apps/web/src/app/api/admin/lr/upload/route.ts:364-378`

`stripGpsFromOriginal()` does `await fs.readFile(filePath)` before dispatching to the lossless GPS scrubbers, then writes `scrubbed.buffer` to a temp file. The upload paths call this after the original has already been streamed to disk. For large allowed originals, this creates a large external-memory spike that can include the input buffer, an output/copy buffer from the scrubber, and any re-encode buffers/pipeline state on fallback.

Failure scenario: with `strip_gps_on_upload` enabled, a 150-200 MB JPEG/HEIF/WebP upload can transiently allocate hundreds of MB in the Node process even though the earlier save path avoids heap materialization. On a memory-constrained deploy host, that can cause GC pauses, upload latency spikes, or process restart. Browser and LR upload paths both share this helper, so the risk applies to both ingestion surfaces.

Suggested fix: make the lossless scrubbers stream or segment-write where possible instead of whole-file copying. At minimum, add a separate size threshold/backpressure guard for the GPS-strip path and surface a clear admin warning/rejection when an original is too large to scrub safely in-process. If the full-buffer approach must stay, route GPS stripping through a process-wide limiter so it cannot overlap with other high-memory image work.

## Likely Issues

### 3. The map page can hydrate/render up to 10,000 markers plus 10,000 fallback list items

Severity: Medium
Confidence: Medium-High
Files/regions:
- `apps/web/src/lib/data.ts:1640-1676`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`
- `apps/web/src/components/map/map-client.tsx:76-144`

`getMapImages()` caps public map rows at `MAP_MAX_MARKERS = 10000`. The server page maps all returned rows into client props and also renders a full fallback `<ul>` of every marker. The client then computes all marker bounds via `markers.map(...)` and renders one Leaflet `<Marker>` per item.

Failure scenario: a gallery with thousands of GPS-visible images loads `/map`. Even at the documented cap, the route ships a large serialized marker payload, hydrates a large accessible fallback list, and asks Leaflet/React to instantiate thousands of marker layers. Desktop may tolerate this at lower counts, but mobile and older devices are likely to stall during hydration or marker creation.

Suggested fix: move the map to a viewport/bbox or paged API and cluster markers server-side or client-side. If the all-markers design is retained, lower the initial cap substantially, virtualize or collapse the fallback list, and provide a "show more/list view" path for accessibility rather than rendering all 10,000 links in the initial page.

### 4. Semantic/similar search still does full decode + full sort for every scanned embedding

Severity: Low
Confidence: Medium
Files/regions:
- `apps/web/src/lib/clip-embeddings.ts:36-44` and `135-168`
- `apps/web/src/app/api/search/semantic/route.ts:261-305`
- `apps/web/src/app/api/search/similar/[id]/route.ts:145-177`

The semantic routes correctly cap scans with `SEMANTIC_SCAN_LIMIT` and default to 2,000 rows, but the hard cap is 25,000. Each request decodes every scanned row into a `Float32Array`, scores it, builds a full `scored` array, then `topK()` filters and sorts the entire match list before slicing.

Failure scenario: if an operator raises `SEMANTIC_SCAN_LIMIT` toward 25,000 on a larger library, public semantic queries can create repeated CPU and GC bursts. Rate limits reduce abuse, and the current production scale may be well below the cap, so this is not a current outage-class issue.

Suggested fix: avoid materializing all decoded embeddings and avoid full-list sort. Decode and score one row at a time, maintain a min-heap of size `K`, and only sort the final heap. A later vector-index backend would be better, but a heap-based top-k keeps the current SQL scan architecture while reducing CPU and allocation pressure.

## Manual-Validation Risks

### A. Timeline/year queries use non-sargable date functions by design

Severity: Low
Confidence: High that the shape exists; impact depends on data size
Files/regions:
- `apps/web/src/lib/data-timeline.ts:125-145`
- `apps/web/src/lib/data-timeline.ts:152-214`

`getTimelineYears()` and `getTimelineImages()` use `YEAR(capture_date)` and `MONTH(capture_date)`. The source comments explicitly document that only the `processed = true` prefix can narrow the scan and that this is acceptable at personal-gallery scale. Validate with production `EXPLAIN`/slow logs if the table grows materially; if it becomes visible, switch year/month filters to range predicates or generated indexed columns.

### B. Feed conditional GETs still build the feed before returning 304

Severity: Low
Confidence: Medium
Files/regions:
- `apps/web/src/app/feed.xml/route.ts:29-167`
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:49-167`

Both feed routes load settings/config/feed rows and compose XML before checking `If-Modified-Since`. The row limit is only 50 and cache headers are present, so this is probably acceptable. If feed-reader traffic grows, validate with request logs and consider a cheap `MAX(updated_at)`/etag precheck before composing the full feed body.

### C. Photo page metadata/body may duplicate the same image lookup depending on Next render caching boundaries

Severity: Low
Confidence: Low-Medium
Files/regions:
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:54-59`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:142-149`
- `apps/web/src/lib/data.ts:1690`

Both `generateMetadata()` and the page body call `getImageCached(imageId)`. The accessor is React `cache()` wrapped, which should dedupe within a render context, but the metadata/body boundary is worth validating with query logging after framework upgrades. If duplicate queries appear, introduce a lighter metadata accessor or a shared request-scoped fetch path.

## Final Missed-Issues Sweep

- Public list/search pagination is capped: list limit normalizes to 100, initial pages use limit+1/cursor paths, and smart collections have parser/limit bounds.
- Shared-group view-count buffering is bounded, chunked, retry-capped, and flushed on shutdown where possible.
- Image queue concurrency is bounded, retry maps are capped/pruned, side effects are tracked for shutdown, and bootstrap embedding work is batched.
- Sharp/libvips concurrency is capped by CPU count, `sharp.cache(false)` is set, and AVIF/WebP/JPEG fan-out is deliberate and bounded.
- Admin color backfill is keyset-paginated, advisory-lock serialized, DB-pool budget capped, and runs at O(batch) memory.
- Search UI uses debounce, request IDs, and `AbortController` for semantic fetches; stale results should not overwrite newer ones.
- Lightbox and histogram hot paths use refs, timers, worker offload, and resize rAF debounce; I did not find listener churn or unbounded client work there.
- Public mutating routes/actions have rate-limit/source-contract coverage in the scanned files and tests.
- Service-worker cache logic has tests/source comments guarding against the previously flagged O(n log n) cache eviction shape.

No additional confirmed performance/concurrency/CPU/memory/UI responsiveness issues were found in the final sweep beyond the items above.
