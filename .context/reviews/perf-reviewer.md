# Cycle 26 Performance Reviewer Report

Review target: `/Users/hletrd/flash-shared/gallery`
Review role: `cycle-26 perf-reviewer`
HEAD reviewed: `d13d6637`
Mode: review-only. Source code was not changed.

## Inventory

Required context read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Inventory evidence before review:

- `git ls-files`: 2,588 tracked files.
- Main runtime tree: `apps/` with 617 tracked files.
- Review/history tree: `.context/` with 1,773 tracked files; `plan/` with 180 tracked files.
- Dominant tracked file types: 1,827 Markdown, 434 TypeScript, 104 TSX, 81 PNG, 28 SQL, 22 JSON, 6 JS, 6 MJS.
- Focused runtime/script/migration source: 85,385 lines across `apps/web/src`, `apps/web/scripts`, and `apps/web/drizzle`.
- Excluded from runtime review: `.git`, `node_modules`, generated `.next` output, upload/data directories, binary fixtures/screenshots except where route contracts depended on them.

Areas inspected: public data access, first-page gallery rendering, infinite scroll, map route/client, timeline/year routes, CSV export, upload/GPS strip path, upload-processing contract lock, image queue/backfill concurrency, service worker image cache, deploy/runtime cache headers, schema indexes, and prior cycle perf reports. Current HEAD has fixed the cycle-25 image-queue pool-budget finding: `resolveImageQueueConcurrency()` now divides remaining pool budget by two.

## Findings

### PERF26-01 - Public first-page gallery queries still compute exact grouped totals

Severity: Medium
Confidence: High
File/region: `apps/web/src/lib/data.ts:878-907`, `apps/web/src/lib/data.ts:1446-1461`, `apps/web/src/app/[locale]/(public)/page.tsx:165-168`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:175-178`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`

Failure scenario: home/topic/tag/smart-collection first paint needs about 30 cards, but the query joins tags, groups by image, sorts, and computes `COUNT(*) OVER()` for the whole matching set. On a large gallery, repeated dynamic public hits and crawlers force temp-table/window-count work before sending the first page, raising DB CPU and TTFB.

Concrete fix: split first paint from exact totals. Use `limit + 1` keyset listing for `hasMore`, fetch tags only for returned IDs, and move exact totals to cached/async counts, approximate copy, or an explicit secondary endpoint. For smart collections, use the cursor path on the first page unless an exact total is required.

### PERF26-02 - GPS stripping buffers full originals after streaming upload to disk

Severity: Medium
Confidence: High
File/region: `apps/web/src/lib/process-image.ts:905-910`, `apps/web/src/lib/process-image.ts:1737-1763`, `apps/web/src/app/actions/images.ts:388-395`, `apps/web/src/app/api/admin/lr/upload/route.ts:367-378`

Failure scenario: upload saving correctly streams up to 200 MB to disk, but `stripGpsFromOriginal()` then calls `fs.readFile(filePath)` and writes a scrubbed buffer. With `strip_gps_on_upload=true`, one or more 150-200 MB originals can allocate full-file buffers plus scrubber copies while image processing/backfill/CLIP are active, causing GC pressure or OOM on the constrained host.

Concrete fix: implement streaming or bounded-segment scrub paths for JPEG APP1/XMP and ISOBMFF metadata where possible. If whole-file buffering remains necessary, enforce a lower `GPS_STRIP_MAX_BUFFER_BYTES` and reject/quarantine oversized originals with a clear admin error.

### PERF26-03 - Upload-processing contract lock spans slow I/O and CPU work

Severity: Low-Medium
Confidence: High
File/region: `apps/web/src/app/actions/images.ts:175-190`, `apps/web/src/app/actions/images.ts:346-418`, `apps/web/src/app/actions/images.ts:628-630`, `apps/web/src/app/api/admin/lr/upload/route.ts:243-275`, `apps/web/src/app/api/admin/lr/upload/route.ts:307-461`, `apps/web/src/app/api/admin/lr/upload/route.ts:548-551`

Failure scenario: the MySQL advisory lock protects upload-setting consistency, but it is held while saving originals, decoding metadata, extracting EXIF, optionally stripping GPS, and doing file cleanup. A large browser batch or Lightroom upload over slow storage can hold one pool connection and block concurrent uploads/settings changes for seconds to minutes.

Concrete fix: shrink the critical section to settings snapshot, quota reservation, lock-once checks, and DB row creation. Move file streaming, metadata extraction, and GPS stripping outside the advisory lock using the immutable settings snapshot. If full-span serialization is intentional, move it to a dedicated non-pooled connection and document the contention budget.

### PERF26-04 - Infinite masonry keeps every loaded photo mounted

Severity: Medium
Confidence: High
File/region: `apps/web/src/components/home-client.tsx:124-130`, `apps/web/src/components/home-client.tsx:286-424`, `apps/web/src/components/load-more.tsx:41-61`, `apps/web/src/components/load-more.tsx:116-132`

Failure scenario: each load-more page is appended into `allImages`, and every accumulated card remains live DOM/React state. A visitor scrolling thousands of photos on mobile accumulates image elements, layout work, and reconciliation cost until scrolling/taps become janky or the tab is evicted.

Concrete fix: virtualize/window the masonry grid, or cap automatic loading after a fixed number of pages and switch to explicit pagination. Preserve cursor anchors and scroll restoration while recycling offscreen cards.

### PERF26-05 - Public map can serialize and mount 10,000 markers plus 10,000 list rows

Severity: Medium
Confidence: High
File/region: `apps/web/src/lib/data.ts:1649-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:31-50`, `apps/web/src/app/[locale]/(public)/map/page.tsx:68-89`, `apps/web/src/components/map/map-client.tsx:86-90`, `apps/web/src/components/map/map-client.tsx:119-140`

Failure scenario: the cap is finite but too high for one initial route payload and hydration pass. Ten thousand React-Leaflet markers, popups, coordinate array spreads, and accessible list rows can freeze the main thread on mobile or lower-end laptops.

Concrete fix: move to viewport-bounded marker fetches with clustering/canvas rendering. Virtualize or paginate the accessible list. Compute bounds in a single loop rather than allocating latitude/longitude arrays and spreading them into `Math.min`/`Math.max`.

### PERF26-06 - CSV export still duplicates large data in memory

Severity: Medium
Confidence: High
File/region: `apps/web/src/app/[locale]/admin/db-actions.ts:80-160`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:103-124`

Failure scenario: exporting up to 50,000 rows materializes DB rows, a `csvLines` array, a joined CSV string, a server-action response payload, and then a browser `Blob`. A large gallery with long filenames/titles/tags can trigger large Node and browser allocations and GC pauses during admin work.

Concrete fix: move CSV export to an authenticated streaming route or background export file. Stream MySQL rows in batches and write CSV chunks with backpressure instead of returning one server-action string.

### PERF26-07 - Timeline and year routes use non-sargable date predicates on dynamic pages

Severity: Low-Medium
Confidence: High
File/region: `apps/web/src/lib/data-timeline.ts:97-116`, `apps/web/src/lib/data-timeline.ts:129-142`, `apps/web/src/lib/data-timeline.ts:186-207`, `apps/web/src/db/schema.ts:116-120`

Failure scenario: public timeline/year pages use `MONTH(capture_date)`, `DAY(capture_date)`, and `YEAR(capture_date)` while only `(processed, capture_date, created_at)` exists. MySQL can use `processed` but must evaluate date functions per row, so crawler traffic over archive pages grows with the processed image slice.

Concrete fix: rewrite year/month filters as range predicates (`capture_date >= start AND capture_date < end`). For On This Day and distinct years, add generated month/day/year columns with indexes or maintain a small archive rollup. Consider short TTL caching for archive pages if immediate freshness is not required.

### PERF26-08 - Public nav pays for sitemap-only topic timestamps

Severity: Low
Confidence: Medium
File/region: `apps/web/src/lib/data.ts:509-529`, `apps/web/src/components/nav.tsx:8-20`, `apps/web/src/app/sitemap.ts:40-72`, `apps/web/src/db/schema.ts:116-120`

Failure scenario: `getTopics()` computes a correlated `MAX(images.updated_at)` per topic for sitemap `<lastmod>`, but `Nav` calls `getTopicsCached()` on public page layouts where nav only needs slug/label/order/resource fields. More topics and a larger image table make normal public renders pay for sitemap metadata.

Concrete fix: split `getTopicsForNav()` from `getTopicsForSitemap()`. Keep nav lean. For sitemap freshness, add `(topic, processed, updated_at)` or denormalize per-topic latest timestamps if the correlated max becomes measurable.

### PERF26-09 - Cached image display waits on a synchronous HEAD probe per tile

Severity: Low-Medium
Confidence: Medium
File/region: `apps/web/public/sw.template.js:34-38`, `apps/web/public/sw.template.js:250-286`, `apps/web/public/sw.js:34-38`, `apps/web/public/sw.js:250-286`

Failure scenario: the probe is bounded at 300 ms, but a warm masonry page with many cached derivatives still issues one HEAD request per cached tile and waits for that probe before serving the cached response. On high-latency mobile networks, this adds visible placeholder time and origin request load.

Concrete fix: serve stale immediately for normal image loads and revalidate in the background. If immediate post-backfill freshness is mandatory, gate synchronous validation behind one manifest/version endpoint or a per-page freshness token rather than N per-image HEAD probes.

## Final Sweep

Refuted or already fixed in current HEAD:

- Cycle-25 image-queue pool exhaustion: fixed by `resolveImageQueueConcurrency()` budgeting one lock plus one transient DB connection per worker.
- Deploy false-green: fixed by bounded health check before Docker pruning.
- CLIP inference during restore: fixed by an early restore-maintenance check before `embedImageReal()`.
- Unbounded module Maps: reviewed current caps/evictions for queue, upload tracker, rate limits, and shared-group view buffers; no new unbounded map finding.

No tests were run because this was a static review-only artifact change. Evidence is source inspection with exact line references above.
