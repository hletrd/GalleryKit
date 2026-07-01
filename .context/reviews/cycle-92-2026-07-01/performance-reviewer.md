# Cycle 92 Performance Reviewer Report

Reviewer lane: performance-reviewer
Scope: whole repository review for performance, concurrency, CPU/memory, DB query shape, background queues, image processing, caching, UI responsiveness, and scalability risks.
Constraints honored: read `AGENTS.md` and `CLAUDE.md`; wrote only this report file; no code changes.

## Method and inventory first

Read/reviewed the repo guidance first, then built the inventory below before inspecting findings. This was a static/code-shape review; I did not run production traffic, MySQL `EXPLAIN`, browser traces, or image-processing benchmarks.

### Relevant file inventory

- **DB/pool/schema/query layer**
  - `apps/web/src/db/index.ts`
  - `apps/web/src/db/schema.ts`
  - `apps/web/src/lib/data.ts`
  - `apps/web/src/lib/data-timeline.ts`
  - `apps/web/src/lib/analytics-data.ts`
  - `apps/web/src/lib/smart-collections.ts`
  - `apps/web/src/lib/sql-like.ts`
- **Public pages, API routes, and cache-sensitive surfaces**
  - `apps/web/src/app/[locale]/(public)/page.tsx`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
  - `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/map/page.tsx`
  - `apps/web/src/app/feed.xml/route.ts`
  - `apps/web/src/app/[topic]/feed.xml/route.ts`
  - `apps/web/src/app/sitemap.ts`
  - `apps/web/src/app/api/search/semantic/route.ts`
  - `apps/web/src/app/api/search/similar/[id]/route.ts`
  - `apps/web/src/app/api/og/route.tsx`
  - `apps/web/src/app/api/og/photo/[id]/route.tsx`
  - `apps/web/next.config.ts`
  - `apps/web/public/sw.template.js`
  - `apps/web/public/sw.js`
  - `apps/web/src/lib/serve-upload.ts`
  - `apps/web/src/lib/og-photo-fetch.ts`
- **Upload, image processing, queues, and background work**
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/app/api/admin/lr/upload/route.ts`
  - `apps/web/src/lib/image-queue.ts`
  - `apps/web/src/lib/process-image.ts`
  - `apps/web/src/lib/process-topic-image.ts`
  - `apps/web/src/lib/admin-backfill-runner.ts`
  - `apps/web/scripts/backfill-color-pipeline.ts`
  - `apps/web/scripts/backfill-cicp-recheck.ts`
  - `apps/web/scripts/backfill-clip-embeddings.ts`
  - `apps/web/scripts/backfill-alt-text.ts`
  - `apps/web/src/app/actions/embeddings.ts`
  - `apps/web/src/lib/background-db-writes.ts`
  - `apps/web/src/lib/view-retention.ts`
  - `apps/web/src/instrumentation.ts`
- **Semantic/CLIP**
  - `apps/web/src/lib/clip-model.ts`
  - `apps/web/src/lib/clip-embeddings.ts`
  - `apps/web/src/components/similar-photos.tsx`
- **Client/UI responsiveness**
  - `apps/web/src/components/home-client.tsx`
  - `apps/web/src/components/load-more.tsx`
  - `apps/web/src/components/search.tsx`
  - `apps/web/src/components/photo-viewer.tsx`
  - `apps/web/src/components/lightbox.tsx`
  - `apps/web/src/components/histogram.tsx`
  - `apps/web/src/components/image-zoom.tsx`
  - `apps/web/src/components/map/map-loader.tsx`
  - `apps/web/src/components/map/map-client.tsx`
  - `apps/web/src/components/upload-dropzone.tsx`

## Severity and confidence rubric

- **Critical**: likely outage, runaway resource exhaustion, or data-loss risk under ordinary use.
- **High**: severe degradation or resource exhaustion at plausible production scale.
- **Medium**: scalable bottleneck or tail-latency risk; likely to matter as gallery/traffic grows.
- **Low**: bounded or operator/admin-only issue; worth tracking but not urgent.

Confidence means confidence in the finding from code evidence, not measured production impact.

## Executive summary

No new critical performance defect was confirmed in static review. The strongest confirmed risks are DB indexes missing for freshness-ordered public/feed/sitemap queries and sidecar backfill scripts that still materialize whole candidate sets. The highest likely runtime risks are public listing first-page counts over joined/grouped result sets, full-scan text/search collection predicates, and brute-force semantic/vector scans when semantic search is enabled.

Positive controls already present: the DB pool is bounded, image-processing concurrency is clamped, Sharp cache is disabled on the server processing path, upload originals stream to disk, public load-more/search/OG/semantic surfaces have rate limits, map/feed/listing outputs have explicit caps, and the in-app admin backfill runner is already batched.

---

# Confirmed issues

## C1. Freshness-ordered feed/sitemap queries do not have matching `updated_at` indexes

- **Category**: DB query shape / crawler surfaces
- **Severity**: Medium
- **Confidence**: High
- **Status**: Confirmed code/index mismatch; runtime cost should be verified with `EXPLAIN`.

### Evidence

- `images.updated_at` exists and is updated on row changes: `apps/web/src/db/schema.ts:97-103`.
- Current `images` indexes cover processed/capture-date, processed/created-at, topic/processed/capture-date/created-at, user filename, and uploader, but not `updated_at`: `apps/web/src/db/schema.ts:117-122`.
- Root/topic feed queries group tag rows and order by freshness: `apps/web/src/lib/data.ts:828-853`.
- Feed updated timestamp reads the most recent `updated_at` row with the same ordering: `apps/web/src/lib/data.ts:856-873`.
- Sitemap homepage/image freshness uses `MAX(updated_at)` and a freshness-ordered image list: `apps/web/src/lib/data.ts:537-542`, `apps/web/src/lib/data.ts:1685-1695`.
- Sitemap generation runs these freshness queries during ISR revalidation: `apps/web/src/app/sitemap.ts:12`, `apps/web/src/app/sitemap.ts:39-49`.
- Root feed cache is only 10/30 minutes, so crawlers can repeatedly hit this shape: `apps/web/src/app/feed.xml/route.ts:16-18`, `apps/web/src/app/feed.xml/route.ts:46-50`.

### Why this matters

On a larger `images` table, MySQL cannot satisfy `WHERE processed = true ORDER BY updated_at DESC, created_at DESC, id DESC` or `MAX(updated_at)` from the existing capture-date/created-at indexes. The result is likely filesort/range scanning on crawler-facing routes.

### Recommendation

Add a migration with covering order indexes for freshness paths, then verify with `EXPLAIN`:

- `images(processed, updated_at, created_at, id)` for root feed/sitemap/latest update.
- `images(topic, processed, updated_at, created_at, id)` for topic feeds and topic freshness.

If write amplification is a concern, first run `EXPLAIN` against production-sized data to choose the smallest index set.

---

## C2. Topic navigation freshness uses a correlated `MAX(updated_at)` subquery without a matching topic/freshness index

- **Category**: DB query shape / navigation
- **Severity**: Medium
- **Confidence**: High
- **Status**: Confirmed query/index mismatch; runtime impact depends on number of topics and images per topic.

### Evidence

- `getTopics()` computes `last_image_updated_at` with a correlated subquery per topic: `apps/web/src/lib/data.ts:520-529`.
- Existing `idx_images_topic` orders by `(topic, processed, capture_date, created_at)`, not `updated_at`: `apps/web/src/db/schema.ts:117-122`.
- Home page loads `getTopicsCached()` on every dynamic render request scope: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/page.tsx:161-168`.
- Sitemap also calls `getTopics()` while computing localized URLs and lastmod values: `apps/web/src/app/sitemap.ts:39-49`.

### Why this matters

The correlated subquery may be acceptable for a small topic count, but it scales as repeated per-topic probes that cannot directly seek to the latest updated image for that topic. This also compounds with C1.

### Recommendation

The topic freshness index proposed in C1, `images(topic, processed, updated_at, created_at, id)`, should be tested against this subquery. If `getTopics()` remains hot, consider precomputing per-topic freshness or rewriting to a single grouped derived table.

---

## C3. Sidecar backfill/diagnostic scripts still materialize all candidate rows and enqueue the whole run in memory

- **Category**: Background jobs / memory / operator scalability
- **Severity**: Medium
- **Confidence**: High
- **Status**: Confirmed in sidecar scripts. The in-app runner already demonstrates the safer pattern.

### Evidence

- `backfill-color-pipeline.ts` fetches all candidate images in one unbounded query: `apps/web/scripts/backfill-color-pipeline.ts:383-400`.
- It then creates one queued promise per row and waits on the whole promise array: `apps/web/scripts/backfill-color-pipeline.ts:525-568`.
- `backfill-cicp-recheck.ts` also fetches every HEIF/AVIF/HEIC candidate at once: `apps/web/scripts/backfill-cicp-recheck.ts:55-75`.
- `backfill-cicp-recheck.ts` adds every row to a single `PQueue` before draining: `apps/web/scripts/backfill-cicp-recheck.ts:92-144`.
- The in-app admin backfill runner already uses keyset batches and documents O(batch) memory: `apps/web/src/lib/admin-backfill-runner.ts:401-430`, `apps/web/src/lib/admin-backfill-runner.ts:672-820`.

### Why this matters

A large gallery or `--force-reencode` run can allocate a full row snapshot plus a queued task/promise per image. That raises RSS, increases GC pressure, and creates a stale candidate snapshot for long jobs. The risk is operator-triggered, not public traffic-triggered, but this is exactly the kind of task that runs during upgrades and recovery windows.

### Recommendation

Port the sidecar scripts to the same keyset-batched pattern used by `admin-backfill-runner.ts`: fetch at most `BATCH_SIZE`, enqueue/drain that batch, advance by `id`, and re-evaluate candidates each batch.

---

# Likely issues

## L1. Dynamic public first-page listing queries compute exact totals with `COUNT(*) OVER()` over joined/grouped rows

- **Category**: DB query shape / public pages
- **Severity**: Medium
- **Confidence**: Medium-high
- **Status**: Likely performance issue; needs `EXPLAIN` and p95 timing on production-sized data.

### Evidence

- Home page is dynamic (`revalidate = 0`) and calls `getImagesLitePage(..., PAGE_SIZE, 0)`: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/page.tsx:175-177`.
- Topic page is dynamic and calls the same exact-total first-page query: `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:20`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:185-187`.
- Smart collection page is dynamic and calls `getImagesForSmartCollection(..., PAGE_SIZE, 0)`: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:110-111`.
- `getImagesLitePage()` joins tags, groups by image, computes `COUNT(*) OVER()`, sorts, then limits/offsets: `apps/web/src/lib/data.ts:898-927`.
- Smart collection initial-page path uses the same window-count/join/group shape: `apps/web/src/lib/data.ts:1495-1510`.
- Load-more calls prefer cursor pagination and cap legacy offsets, so the main repeated cost is the first page/exact total: `apps/web/src/app/actions/public.ts:122-152`.

### Why this matters

The page only renders ~30 images, but `COUNT(*) OVER()` generally forces the database to evaluate the full matching grouped set to return an exact `totalCount`. This is most expensive with tag filters or smart collection predicates. It also runs on `revalidate = 0` pages, so server/CDN cache cannot hide the cost.

### Recommendation

Avoid exact counts on public first-page requests unless the UI truly needs them. Options:

- Return `hasMore` via `LIMIT + 1` only and omit `totalCount` from public grid chrome.
- Compute counts in a separate cached query with short TTL.
- Two-step query: fetch ordered image IDs first using an index, then aggregate tags for only those IDs.

---

## L2. Public smart collections can compile to full-scan `LIKE '%term%'` predicates

- **Category**: DB query shape / public dynamic pages
- **Severity**: Medium
- **Confidence**: Medium
- **Status**: Likely issue for public collections using `contains`; manual validation depends on collection definitions.

### Evidence

- Smart collection column allowlist includes fields such as camera/lens/topic/tag: `apps/web/src/lib/smart-collections.ts:21-30`.
- `contains` predicates compile to `containsLike(...)`: `apps/web/src/lib/smart-collections.ts:221-223`.
- `containsLike` emits a leading-wildcard `LIKE '%value%'`: `apps/web/src/lib/sql-like.ts:9-10`.
- Tag `contains` compiles to an `IN (SELECT ... WHERE tags.name LIKE '%...%')` subquery: `apps/web/src/lib/smart-collections.ts:250-267`.
- Smart collection AST shape is bounded, but still allows up to 512 nodes and 64 group children: `apps/web/src/lib/smart-collections.ts:142-147`.
- Admin create/update validates parseability only; it does not appear to estimate or reject expensive public predicates: `apps/web/src/app/actions/collections.ts:32-51`, `apps/web/src/app/actions/collections.ts:83-98`.
- Public smart collection pages compile and execute the condition dynamically: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:96-111`.

### Why this matters

A public smart collection with one or more `contains` predicates can make every request scan large portions of `images` or `tags`, then still pay the first-page `COUNT(*) OVER()` cost from L1.

### Recommendation

Add an admin-side cost warning or validation for public smart collections. For public collections, prefer equality/range predicates over `contains`, or add a proper search strategy such as full-text/generator columns depending on desired semantics. At minimum, document and surface an operator warning before publishing a `contains` collection.

---

## L3. Public keyword search is rate-limited but still uses leading-wildcard `LIKE` scans

- **Category**: DB query shape / public search
- **Severity**: Low-medium
- **Confidence**: Medium
- **Status**: Likely scaling risk under large galleries or distributed traffic.

### Evidence

- Public search validates length and rate-limits before hitting the DB: `apps/web/src/app/actions/public.ts:236-307`.
- The main image search uses `containsLike` on title, description, camera, lens, topic slug, and topic label: `apps/web/src/lib/data.ts:1539-1612`.
- If more results are needed, tag and alias branches run in parallel with joins/grouping: `apps/web/src/lib/data.ts:1650-1670`.
- `containsLike` is a leading-wildcard `LIKE`: `apps/web/src/lib/sql-like.ts:9-10`.

### Why this matters

The per-IP search limiter reduces abuse, but each accepted search can still be a full scan over public text columns and joined tag/alias tables. Distributed crawlers or legitimate high search traffic can therefore drive DB CPU even when individual IPs stay under quota.

### Recommendation

Measure search p95 and slow-query logs. If search becomes hot, move to full-text indexes, a sidecar index, or prefix/token tables; keep the existing rate limit as defense-in-depth.

---

## L4. Timeline/year/on-this-day pages use non-sargable date functions on dynamic public routes

- **Category**: DB query shape / public archive pages
- **Severity**: Low-medium
- **Confidence**: Medium-high
- **Status**: Likely issue at larger table sizes; code comments already acknowledge the tradeoff.

### Evidence

- Timeline page is dynamic and calls `getTimelineYears()` plus `getTimelineImages()`: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-94`.
- Year-in-review page is dynamic and calls `getYearInReviewImages()`: `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:20`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:90-101`.
- On-this-day uses `MONTH(capture_date)` and `DAY(capture_date)`: `apps/web/src/lib/data-timeline.ts:88-116`.
- Timeline year index uses `YEAR(capture_date)`: `apps/web/src/lib/data-timeline.ts:125-142`.
- Year photo queries use `YEAR(capture_date)` and optional `MONTH(capture_date)`, with comments noting the predicates are not sargable: `apps/web/src/lib/data-timeline.ts:172-207`.
- The page result cap is 500 + lookahead, which bounds output but not necessarily scanned rows: `apps/web/src/lib/data-timeline.ts:152-159`, `apps/web/src/lib/data-timeline.ts:196-207`.

### Why this matters

The existing `(processed, capture_date, created_at)` index can narrow to processed rows, but function predicates on `capture_date` prevent direct range seeks by year/month/day. The cap limits returned rows and DOM size, but MySQL may still evaluate many processed rows.

### Recommendation

Rewrite year/month filters to range predicates where possible, e.g. `capture_date >= '2026-01-01' AND capture_date < '2027-01-01'`. For On This Day, consider generated month/day columns plus an index if the widget is used on large installations.

---

## L5. Semantic and similar search perform brute-force vector scans and full in-memory sort per request

- **Category**: CPU / DB bandwidth / semantic search scalability
- **Severity**: Medium when production semantic mode is enabled; Low otherwise
- **Confidence**: High for code shape, Medium for production impact
- **Status**: Manual benchmarking needed before raising scan caps.

### Evidence

- Semantic route embeds the query before scanning rows: `apps/web/src/app/api/search/semantic/route.ts:253-260`.
- It then reads up to `SEMANTIC_SCAN_LIMIT` embeddings from MySQL and joins processed images: `apps/web/src/app/api/search/semantic/route.ts:263-279`.
- It decodes/scores every scanned embedding and calls `topK`: `apps/web/src/app/api/search/semantic/route.ts:292-311`.
- Similar-photo route scans the same limit and scores every row against the target: `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`.
- Default scan limit is 2,000 and env hard cap is 25,000: `apps/web/src/lib/clip-embeddings.ts:36-44`.
- `topK()` filters, sorts all matches, then slices: `apps/web/src/lib/clip-embeddings.ts:164-168`.
- The embedding table has an index for `modelVersion, updatedAt`, which helps the scan order but does not make vector search sublinear: `apps/web/src/db/schema.ts:284-299`.
- Semantic request body and per-IP rates are bounded: `apps/web/src/app/api/search/semantic/route.ts:94-97`, `apps/web/src/app/api/search/semantic/route.ts:173-184`, `apps/web/src/lib/rate-limit.ts:354-356`.

### Why this matters

At the default 2,000 rows this may be acceptable. At the 25,000 cap, each request can pull tens of MB from MySQL, allocate/score thousands of vectors, and full-sort matches. The route is properly opt-in/rate-limited, but it is not an ANN/vector-index design.

### Recommendation

Keep scan limits conservative until production p95 and DB bandwidth are measured. Replace full sort with a bounded min-heap if scan limits increase. For larger galleries, plan a vector index or precomputed candidate set instead of scanning MySQL blobs per request.

---

## L6. Map route is capped, but it still scans/returns/renders up to 10k markers without clustering

- **Category**: DB query shape / UI responsiveness
- **Severity**: Low-medium
- **Confidence**: Medium
- **Status**: Manual browser/DB validation risk for GPS-heavy galleries.

### Evidence

- Public map page is dynamic and loads `getMapImages()`: `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-46`.
- `getMapImages()` explicitly caps the result to 10,000 markers but filters by processed, topic map visibility, and non-null latitude/longitude: `apps/web/src/lib/data.ts:1698-1734`.
- Existing `images` indexes do not include latitude/longitude predicates: `apps/web/src/db/schema.ts:117-122`.
- The server page maps every returned row into a client marker payload: `apps/web/src/app/[locale]/(public)/map/page.tsx:50-66`.
- The client computes bounds over all markers and renders one Leaflet `<Marker>` per marker: `apps/web/src/components/map/map-client.tsx:77-94`, `apps/web/src/components/map/map-client.tsx:120-139`.

### Why this matters

The 10k cap prevents an unbounded result, but 10k Leaflet markers can still cause slow hydration, heavy JS work, and sluggish interaction. The DB also may need to scan processed rows to find GPS-bearing images.

### Recommendation

If GPS-bearing image counts approach thousands, add clustering or viewport/bbox loading. Consider an index that matches map filtering/order if `EXPLAIN` shows scans are material.

---

# Manual-validation risks

## M1. CLIP image embedding decode path does not use the app-level Sharp pixel/read caps used by the main image pipeline

- **Category**: CPU/memory / image processing
- **Severity**: Low-medium
- **Confidence**: Medium
- **Status**: Manual validation risk; Sharp has its own default safeguards, but this path does not reuse the app's explicit cap.

### Evidence

- Main upload metadata path passes `limitInputPixels`, `failOn`, `sequentialRead`, and `autoOrient`: `apps/web/src/lib/process-image.ts:916-984`.
- Main derivative processing also passes `limitInputPixels` and `sequentialRead`: `apps/web/src/lib/process-image.ts:1109-1131`, `apps/web/src/lib/process-image.ts:1280-1283`.
- CLIP image embedding uses `sharp(imagePath, { autoOrient: true })` without `limitInputPixels` or `sequentialRead`: `apps/web/src/lib/clip-model.ts:273-290`.
- It allocates a `Float32Array` for CLIP input after decode/resize: `apps/web/src/lib/clip-model.ts:296-310`.
- Inference queue concurrency/pending are bounded, which mitigates but does not align decode caps: `apps/web/src/lib/clip-model.ts:53-64`.

### Risk

Production embedding/backfill usually handles images already accepted by the upload pipeline, but legacy/operator-restored originals may not have gone through current caps. If an operator lowers the app max pixel setting, CLIP embedding will not inherit that policy.

### Recommendation

Share/export the image pixel cap and pass it to `embedImageReal()` with `sequentialRead: true`. Then run a memory smoke test on the largest accepted original.

---

## M2. Fire-and-forget analytics DB writes are tracked in an unbounded in-process `Set`

- **Category**: Concurrency / memory / graceful shutdown
- **Severity**: Low-medium
- **Confidence**: Medium-low
- **Status**: Manual validation risk; per-IP rate limits and DB pool queue limits mitigate public abuse.

### Evidence

- Background writes are stored in a module-level `Set<Promise<void>>` with no explicit max: `apps/web/src/lib/background-db-writes.ts:1-25`.
- Shutdown drain loops until the set is empty: `apps/web/src/lib/background-db-writes.ts:28-37`.
- View-recording rate limits are per-IP with a 2,000-key in-memory map: `apps/web/src/app/actions/public.ts:330-339`.
- Photo/topic/group view actions buffer DB writes without blocking the response: `apps/web/src/app/actions/public.ts:417-438`, `apps/web/src/app/actions/public.ts:445-470`, `apps/web/src/app/actions/public.ts:477-506`.
- The DB pool itself is bounded to 10 connections and queue limit 20: `apps/web/src/db/index.ts:23-38`.

### Risk

Under many distinct IPs or bursts near the pool queue limit, pending promises can accumulate until MySQL rejects/settles them. Normal operation is probably fine, but there is no global backpressure/drop counter for analytics writes.

### Recommendation

Add a small bounded queue or global max pending count for analytics writes. Drop/aggregate excess view events with a metric/log instead of growing the set indefinitely.

---

## M3. Gallery and map client surfaces accumulate/render all loaded items; no virtualization/windowing

- **Category**: UI responsiveness / memory
- **Severity**: Low
- **Confidence**: Medium
- **Status**: Manual browser trace risk for long sessions or large GPS galleries.

### Evidence

- Home grid state appends every load-more page into `allImages`: `apps/web/src/components/home-client.tsx:124-130`.
- The grid renders every loaded image card via `orderedImages.map(...)`: `apps/web/src/components/home-client.tsx:286-427`.
- Load-more keeps loading additional pages while `hasMore` remains true: `apps/web/src/components/home-client.tsx:418-427`.
- Map rendering similarly creates one Leaflet marker per returned marker: `apps/web/src/components/map/map-client.tsx:120-139`.

### Risk

The server page size is controlled and images use lazy/async decoding, but a long browsing session can still accumulate hundreds/thousands of DOM nodes. The map can render up to 10k marker components.

### Recommendation

If field testing shows scroll or map interaction jank, add virtualization/windowing to the masonry grid and marker clustering/viewport loading to the map.

---

## M4. Dynamic freshness policy intentionally shifts work to the server on many public pages

- **Category**: caching / scalability
- **Severity**: Low-medium
- **Confidence**: Medium
- **Status**: Manual capacity validation risk; this may be product-correct.

### Evidence

- Home, topic, smart collection, timeline, year, map, photo, share, and group pages use `revalidate = 0` or force-dynamic behavior: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:20`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:20`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`.
- Request-scoped React `cache()` wrappers dedupe only within a render/request, not across users/requests: `apps/web/src/lib/data.ts:1748-1763`, `apps/web/src/lib/data.ts:1780-1804`.
- The service worker uses network-first HTML with offline fallback, not an origin-wide SSR cache: `apps/web/public/sw.template.js:359-363`, `apps/web/public/sw.template.js:454-460`.

### Risk

The policy is intentional for freshness after background processing and privacy/share revocation. It does mean DB/query efficiency matters more because public HTML is not broadly cached at the server layer.

### Recommendation

Keep the freshness policy, but load-test dynamic public routes after fixing the query-shape issues above. If needed, add route-specific short TTLs only where product correctness allows.

---

# Positive controls and no-finding areas

These areas were checked and look deliberately bounded or already hardened:

- DB pool is bounded with `connectionLimit: 10`, `queueLimit: 20`, and connection init timeout handling: `apps/web/src/db/index.ts:23-38`, `apps/web/src/db/index.ts:60-86`.
- Image queue concurrency is clamped against the shared DB pool: `apps/web/src/lib/image-queue.ts:91-108`, `apps/web/src/lib/image-queue.ts:320-329`.
- Image queue bootstrap is capped per pass and continuations drain the queue between batches: `apps/web/src/lib/image-queue.ts:76-84`, `apps/web/src/lib/image-queue.ts:895-931`, `apps/web/src/lib/image-queue.ts:960-990`.
- Server-side Sharp concurrency is reduced for AVIF/WebP/JPEG fan-out, and Sharp cache is disabled for steady RSS: `apps/web/src/lib/process-image.ts:36-57`.
- Upload originals stream to disk before heavy processing: `apps/web/src/lib/process-image.ts:887-910`.
- Main image processing verifies metadata with explicit pixel/read caps and generates formats with settled sibling cleanup: `apps/web/src/lib/process-image.ts:916-984`, `apps/web/src/lib/process-image.ts:1433-1456`.
- Browser/admin upload path enforces file/count/byte quotas and queues heavy processing asynchronously: `apps/web/src/lib/upload-limits.ts:1-33`, `apps/web/src/app/actions/images.ts:230-320`, `apps/web/src/app/actions/images.ts:519-551`.
- Admin in-app color backfill is batched O(batch) and pool-clamped: `apps/web/src/lib/admin-backfill-runner.ts:401-430`, `apps/web/src/lib/admin-backfill-runner.ts:706-718`, `apps/web/src/lib/admin-backfill-runner.ts:731-820`.
- CLIP inference itself has concurrency, pending, and timeout caps: `apps/web/src/lib/clip-model.ts:53-64`.
- Public load-more and search actions have pre-increment rate limits and input caps: `apps/web/src/app/actions/public.ts:47-64`, `apps/web/src/app/actions/public.ts:236-307`.
- Tag query count is capped to 20, limiting tag-filter predicate width: `apps/web/src/lib/tag-slugs.ts:3-35`.
- Shared group reads cap image count to 100 and batch tag lookup avoids N+1: `apps/web/src/lib/data.ts:1323-1354`.
- Map results are capped at 10k even though further clustering may be needed: `apps/web/src/lib/data.ts:1698-1734`.
- View/analytics retention purges rows in bounded chunks: `apps/web/src/lib/view-retention.ts:31-37`, `apps/web/src/lib/view-retention.ts:70-89`.
- Rate-limit bucket retention also deletes in bounded batches: `apps/web/src/lib/rate-limit.ts:526-540`.
- Derivative upload caching is explicitly set and SW caches are bounded/SWR: `apps/web/next.config.ts:55-73`, `apps/web/public/sw.template.js:31-35`, `apps/web/public/sw.template.js:143-160`, `apps/web/public/sw.template.js:348-356`, `apps/web/public/sw.template.js:448-460`.
- Image serving avoids pulling Sharp into the hot path and dedupes settings-hash refreshes: `apps/web/src/lib/serve-upload.ts:6-13`, `apps/web/src/lib/serve-upload.ts:19-80`.
- OG routes are rate-limited, ETagged, cached, and the per-photo internal fetch chain has byte/time budgets: `apps/web/src/app/api/og/route.tsx:83-99`, `apps/web/src/app/api/og/route.tsx:127-145`, `apps/web/src/app/api/og/photo/[id]/route.tsx:100-159`, `apps/web/src/lib/og-photo-fetch.ts:30-54`, `apps/web/src/lib/og-photo-fetch.ts:64-118`.

# Final missed-issue sweep

Performed a final static sweep for these risk patterns across `apps/web/src`, `apps/web/scripts`, `apps/web/public`, and `apps/web/next.config.ts`: `COUNT(*) OVER`, `GROUP BY`, `ORDER BY`, `OFFSET`, `LIMIT`, `sharp(`, `PQueue`, `Promise.all`/`allSettled`, `setInterval`, `unstable_cache`/`cache`, `revalidate`, `Cache-Control`, `rateLimit`, `backgroundDbWrites`, `SEMANTIC_SCAN_LIMIT`, `topK`, `containsLike`, and raw `db.execute(sql...)` usages.

No additional critical/high issues were confirmed beyond the items above. Remaining uncertainty is measurement-based: the DB findings need `EXPLAIN` on production-like data, semantic search needs p95/DB-bandwidth measurement before raising scan limits, and UI/map risks need browser traces with hundreds-to-thousands of rendered items.
