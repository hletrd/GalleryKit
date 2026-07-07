# Cycle 10 Performance Review — 2026-07-07

Persona: perf-reviewer  
Repository: `/Users/hletrd/flash-shared/gallery`  
Mode: read-only source review; only this review artifact was written.

## File Inventory

- Inventory command: `rg --files`
- Visible repository files: 909
- `apps/web/src` files: 611
- `apps/web/src/__tests__` files: 350
- `apps/web/drizzle` files: 33

Reviewed surfaces:

- Project guidance and architecture: `AGENTS.md`, `CLAUDE.md`, root/package manifests, deploy/Docker/nginx docs.
- Database and query layer: Drizzle schema, migration journal, migration reconciler, public/admin data helpers, analytics helpers, semantic search helpers.
- Runtime/concurrency: DB pool setup, image queue, CLIP queue, processing pipeline, upload tracking, restore/readiness guards, rate limiters, instrumentation startup/shutdown.
- Public UI performance: home masonry, search, photo viewer, map, timeline/year pages, feeds, sitemap, shared links/groups, route cache settings.
- Build/runtime efficiency: Next config, Dockerfile, scripts, service worker/static serving assumptions.
- Prior context sweep: `.context/reviews`, `.context/plans`, and deferred performance notes.

## Findings

### PERF-C10-01 — Timeline/year routes use non-sargable date expressions on dynamic public pages

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/lib/data-timeline.ts:129-141`, `apps/web/src/lib/data-timeline.ts:186-207`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:77`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:91-94`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:20`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:97`

The timeline query layer applies `YEAR(images.capture_date)` and `MONTH(images.capture_date)` to the indexed `capture_date` column. The inline comment correctly notes that only the `processed` prefix of `idx_images_processed_capture_date` can narrow the scan. Both public consumers are `revalidate = 0`, so each timeline/year request can perform fresh per-row date-function evaluation against all processed dated images.

Failure scenario: after the gallery grows to tens of thousands of processed images, crawlers or users hitting `/timeline`, `/timeline?year=YYYY`, and `/year/YYYY` repeatedly force MySQL to scan and evaluate the processed image set per request, then group/join tags for the capped page result. On the documented single web instance and pool size 10 topology, that extra CPU/DB work can raise latency for unrelated public image/detail requests.

Concrete fix: make the image-page query sargable by replacing the year/month functions with date ranges:

```ts
const start = `${year}-01-01 00:00:00`;
const end = `${year + 1}-01-01 00:00:00`;
conditions.push(gte(images.capture_date, start), lt(images.capture_date, end));
```

For a month filter, compute the first day of the month and the first day of the next month. That lets the existing `(processed, capture_date, created_at)` index seek into the target range. For `getTimelineYears`, either add an indexed generated `capture_year` column or maintain a small year summary table refreshed when image capture dates change; otherwise the year scrubber still requires a full processed-date pass. Add a source/SQL-shape test that rejects `YEAR(${images.capture_date})` and `MONTH(${images.capture_date})` in `getTimelineImages`.

### PERF-C10-02 — Homepage “On This Day” does a non-sargable date scan on every home render

- Severity: Low
- Confidence: High
- Location: `apps/web/src/lib/data-timeline.ts:97-116`, `apps/web/src/components/on-this-day-widget.tsx:15-22`, `apps/web/src/app/[locale]/(public)/page.tsx:19`, `apps/web/src/app/[locale]/(public)/page.tsx:234`

The home page is `revalidate = 0` and includes `OnThisDayWidget`, which calls `getOnThisDayImages()` during SSR. That query filters with `MONTH(images.capture_date)` and `DAY(images.capture_date)` on every processed image with a capture date, then returns only six rows. The result cap controls response size but not the scan cost.

Failure scenario: the homepage is the hottest public route. With a larger archive, each hit adds a full processed-date scan for a small optional widget. Under bot traffic or a burst after publishing, this competes with the main home feed and photo-detail queries for the same MySQL pool and CPU budget.

Concrete fix: store and index the match key instead of deriving it at read time. Options:

- Add generated columns such as `capture_month` and `capture_day`, indexed as `(processed, capture_month, capture_day, capture_date, created_at, id)`.
- Or add a generated `capture_mmdd` column/index and query equality on that value.
- If schema change is not desired, cache the widget result per local day and invalidate it on image metadata changes, but that is a mitigation rather than fixing the scan shape.

Add a regression test or SQL-shape assertion that `getOnThisDayImages` no longer contains `MONTH(` / `DAY(` against `images.capture_date`.

### PERF-C10-03 — Public map remains capped but still has an expensive sparse GPS/query and render shape

- Severity: Medium
- Confidence: Medium
- Location: `apps/web/src/lib/data.ts:1741-1768`, `apps/web/src/lib/data.ts:1780-1781`, `apps/web/src/db/schema.ts:43-44`, `apps/web/src/db/schema.ts:117-125`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-46`, `apps/web/src/app/[locale]/(public)/map/page.tsx:98-109`, `apps/web/src/components/map/map-client.tsx:120-139`

`getMapImages()` limits public map results to 10,001 rows, which prevents the previous unbounded-result failure. The remaining query still filters `images.latitude IS NOT NULL`, `images.longitude IS NOT NULL`, and `topics.map_visible = true` without a supporting GPS/map-visible access path in the image indexes. The same result set can also render up to 10,000 Leaflet markers plus up to 10,000 fallback list links on a `revalidate = 0` public route.

Failure scenario: a gallery has many processed images but only a small or sparse subset with public GPS visibility. Each `/map` hit can walk a large processed-image range to find qualifying GPS rows, then serialize and hydrate thousands of markers/list entries. On mobile this can produce main-thread stalls; on the server it adds DB and serialization pressure to a dynamic public route.

Concrete fix: narrow the DB access path before marker rendering. Practical options:

- Query map-visible topic slugs first and fetch images with `images.topic IN (...)`, using or extending the existing topic index path.
- Add an index designed for the map query, such as `(topic, processed, latitude, longitude, capture_date, created_at, id)`, after checking `EXPLAIN ANALYZE` against production-like cardinality.
- If map-visible topics are numerous or GPS density is high, introduce a generated `has_gps` column and index `(processed, has_gps, capture_date, created_at, id)` or denormalize a `map_visible` image flag maintained when topics change.
- For the client, add clustering or viewport/bounds pagination before the GPS corpus approaches the 10k cap. The existing truncation notice is useful, but it does not prevent DOM/Leaflet work below the cap.

Validate with `EXPLAIN ANALYZE` for sparse and dense GPS datasets, plus a browser trace for marker counts near the current cap.

## Evidence Of Areas Checked Without New Findings

- Image processing concurrency is bounded by the upload queue and explicit Sharp settings; `sharp.concurrency()` and Sharp cache disabling are in place before processing starts.
- The DB pool is bounded (`connectionLimit` 10, `queueLimit` 20), and the connection bootstrap timeout is cleared.
- Public image/feed/sitemap queries use lean select sets and existing updated/cursor indexes; sitemap has an hourly ISR setting and URL budget guard.
- View-count buffering is capped, chunked, and has retry/backoff behavior; retention jobs are chunked.
- Semantic search and similar-photo routes enforce same-origin, body/query caps, public rate limiting, production-mode checks, and a scan cap. The remaining brute-force vector scan is already tracked as deferred in prior plans.
- Public route rate-limit/auth/origin guard linters exist, and expensive public semantic routes are covered by pre-increment helpers.
- Public upload serving avoids opening file descriptors for HEAD/304 responses and uses derivative cache headers consistently.
- UI review did not find obvious duplicate request storms in load-more, search, or photo-viewer flows; request IDs/aborts/stale guards are present where expected.
- Final missed-issues sweep included `rg` searches for non-sargable date functions, map markers/caps, semantic scans, known `LIKE` scans, cache/revalidate settings, queue limits, and prior deferred performance items.

## Prior Deferred Items Not Re-filed As New

- Leading-wildcard keyword and smart-collection `LIKE '%term%'` scans remain known deferred work from prior cycle notes. I did not re-file them because the current code and prior plans already document the tradeoff and no new failure mode was found.
- Brute-force semantic vector scanning remains bounded by `SEMANTIC_SCAN_LIMIT` and is already deferred until corpus size or UX requirements justify vector-index work.
- The broader “10k map markers need clustering/viewport filtering” concern existed in prior deferred notes. `PERF-C10-03` is filed because the current DB access path and dynamic public route still create a concrete server/client pressure point even before exceeding the cap.

## Validation

- Source review only; no tests were run because no source code was changed.
- Review artifact written to `.context/reviews/cycle10-2026-07-07/perf-reviewer.md`.
