# Review-Plan-Fix Cycle 17 Performance Review

Role: perf-reviewer
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Output file: `.context/reviews/perf-reviewer.md`

## Inventory

I read the repo guidance first: `AGENTS.md` and `CLAUDE.md`, including the single-writer runtime topology, MySQL pool budget, image queue/backfill notes, Server Action upload limits, CLIP semantic-search runbook, cache/ETag behavior, nginx topology, deploy/disk hygiene, migration runbook, quality gates, and test-surface documentation.

Performance-relevant surfaces inventoried and reviewed:

- Public request paths: `apps/web/src/app/[locale]/(public)/**`, `apps/web/src/app/api/og/**`, `apps/web/src/app/api/search/**`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/sitemap.ts`, public server actions in `apps/web/src/app/actions/public.ts`, and upload-serving routes.
- Admin and mutation paths: `apps/web/src/app/actions/**`, `apps/web/src/app/[locale]/admin/**`, `apps/web/src/app/api/admin/**`, especially uploads, deletes, DB backup/restore, settings, backfill, tokens, and Lightroom upload.
- Data/query layer: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `analytics-data.ts`, `smart-collections.ts`, `gallery-config.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `background-db-writes.ts`, `maintenance-scheduler.ts`, `view-retention.ts`, `session.ts`, `audit.ts`, plus `apps/web/src/db/index.ts` and `apps/web/src/db/schema.ts`.
- Image/media/background work: `process-image.ts`, `process-topic-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, `clip-*`, `og-photo-fetch.ts`, `serve-upload.ts`, `upload-*`, storage helpers, service worker sources, and histogram/map/lightbox media clients.
- Runtime/build/deploy/cache: `apps/web/next.config.ts`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `nginx/default.conf`, `scripts/migrate.js`, backfill scripts, CLIP model scripts, package scripts, Vitest/Playwright config, drizzle migrations and journal.
- Tests/docs/context: performance-relevant tests under `apps/web/src/__tests__/**`, `apps/web/e2e/**`, current `.context/reviews/*perf*`, `.context/plans/**`, `docs/superpowers/**`, and root/app README material were inventoried for coverage and historical context.

Skipped from detailed review: `node_modules`, `.next`, generated/build output, `.git`, local env/secrets, binary screenshots, fixture binaries, and runtime upload/data directories. I did not intentionally skip any source, config, script, migration, test, or doc surface selected into the performance/concurrency lane.

No code fixes, tests, builds, deploys, DB `EXPLAIN`, browser traces, or production profiling were run. Evidence below is static source review with current line references.

## Confirmed Issues

### C17-PERF-01 - Large dashboard uploads and DB restores still materialize multipart bodies before app streaming

Severity: High
Confidence: High
Status: Confirmed issue

File/region:

- `apps/web/src/lib/upload-limits.ts:1-5` allows 200 MiB upload files and 250 MiB restore files.
- `apps/web/next.config.ts:111-119` raises Server Action/proxy body limits to the upload/restore transport cap.
- `apps/web/src/app/actions/images.ts:129-148` receives `FormData` and extracts all `File` entries before app-level validation.
- `apps/web/src/app/actions/images.ts:184-249` checks count and byte limits after `FormData` exists.
- `apps/web/src/app/[locale]/admin/db-actions.ts:369-382` receives restore as a Server Action and takes a DB advisory lock.
- `apps/web/src/app/[locale]/admin/db-actions.ts:610-631` streams the already-created restore `File` to disk.
- `apps/web/src/app/api/admin/lr/upload/route.ts:152-180` limits Lightroom multipart parsing to one in-flight request, but still calls `request.formData()`.

Why this is a problem:

The app streams `File.stream()` to disk, which avoids a second full copy, but Server Actions and `request.formData()` require the framework multipart parser to materialize `File` objects first. The largest accepted bodies can therefore pin hundreds of MiB of RSS before app code reaches disk streaming or final size rejection.

Concrete failure scenario:

An admin uploads multiple 200 MiB photos from the dashboard, or starts a 250 MiB DB restore while public traffic is active. Next parses the multipart payloads into `File` objects first, GC pressure spikes, and the same Node process serving pages, queue jobs, and CLIP inference can stall or OOM.

Suggested fix:

Move large browser upload and restore ingestion to route handlers using a streaming multipart parser with backpressure and byte counters before materialization. Keep Server Actions for small control mutations. Add a process-wide ingress semaphore for all large multipart paths, not just Lightroom.

### C17-PERF-02 - Image queue and in-app backfill can oversubscribe the shared DB pool together

Severity: High
Confidence: High
Status: Confirmed issue

File/region:

- `apps/web/src/db/index.ts:31-41` fixes the MySQL pool at 10 connections and `queueLimit: 20`.
- `apps/web/src/lib/image-queue.ts:121-141` independently caps upload/image queue concurrency.
- `apps/web/src/lib/admin-backfill-runner.ts:97-143` independently caps admin backfill concurrency.
- `apps/web/src/lib/process-image.ts:1433-1440` fans out WebP/AVIF/JPEG generation per image.
- `CLAUDE.md:261-283` documents the exact mutual-overlap risk.

Why this is a problem:

Each subsystem reserves live-traffic headroom as if it were the only background consumer. They use different locks, so active upload processing and an admin-triggered re-encode can overlap. At the shipped pool size, both can run at concurrency 2, consuming most pool slots and leaving little space for SSR/data fan-out.

Concrete failure scenario:

An admin starts color re-encode while uploads are processing. Two queue jobs and two backfill jobs hold advisory-claim connections and transient DB work while Sharp encodes. Public photo pages then run image/tags/prev/next queries and pile up behind the pool; once mysql2's queue reaches 20, requests fail or tail latency spikes.

Suggested fix:

Introduce one shared background DB budget/semaphore used by image queue, in-app backfill, semantic embedding bootstrap, and future maintenance jobs. In the current single-process topology a local semaphore is enough; for horizontal scale, move the token budget to DB leases/advisory tokens.

### C17-PERF-03 - Batch image deletion repeats full derivative-directory scans per image and format

Severity: Medium
Confidence: High
Status: Confirmed issue

File/region:

- `apps/web/src/app/actions/images.ts:759-784` allows batch deletion of up to 100 images.
- `apps/web/src/app/actions/images.ts:860-884` calls strict variant cleanup for WebP/AVIF/JPEG per image with `sizes=[]`.
- `apps/web/src/lib/process-image.ts:575-629` treats `sizes=[]` as a full directory scan for historical variants.
- `apps/web/src/lib/process-image.ts:651-663` unlinks the discovered files.

Why this is a problem:

The scan mode is correct for one image because size settings can change over time, but the batch path scans the same three derivative directories once per selected image. The work is bounded by 100 images, but its cost is still `images * formats * directory_size`.

Concrete failure scenario:

An admin deletes 100 failed imports from a gallery with tens of thousands of derivative files on NAS-backed storage. The app performs up to 300 full directory walks while image serving and queue writes contend for the same filesystem.

Suggested fix:

Add a batch cleanup helper that scans each derivative directory once per batch, indexes entries by selected base filename prefix, and performs strict unlink/error aggregation from that index. Keep the current single-image helper for isolated deletes.

### C17-PERF-04 - Public map first render can serialize and hydrate 10,000 markers plus a duplicate list

Severity: Medium
Confidence: High
Status: Confirmed issue

File/region:

- `apps/web/src/lib/data.ts:1766-1816` returns up to `MAP_MAX_MARKERS = 10000` public GPS rows.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66` fetches all rows and maps all markers into client props.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:89-110` passes every marker to the map and renders every marker again in an accessible list.
- `apps/web/src/components/map/map-client.tsx:77-94` allocates latitude/longitude arrays and spreads them into min/max.
- `apps/web/src/components/map/map-client.tsx:120-139` renders a React Leaflet `Marker`/`Popup` per marker.

Why this is a problem:

The DB cap prevents an unbounded result, but 10,000 is still far beyond a practical first-render budget for mobile. The route ships a large RSC/client payload, creates thousands of Leaflet objects, renders thousands of list links, and does O(n) bounds work on the main thread.

Concrete failure scenario:

A travel archive has 8,000 public GPS photos. Opening `/map` on a phone downloads a large route payload, hydrates thousands of components, and stalls map interaction long enough for the tab to appear hung.

Suggested fix:

Load markers by viewport/zoom, add clustering or a canvas/vector marker layer, lower the initial SSR cap, virtualize or paginate the fallback list, and compute bounds in one pass without array spreads.

### C17-PERF-05 - Semantic and similar APIs do brute-force embedding BLOB scans in request handlers

Severity: Medium
Confidence: High
Status: Confirmed issue

File/region:

- `apps/web/src/lib/clip-embeddings.ts:36-48` permits `SEMANTIC_SCAN_LIMIT` up to 25,000.
- `apps/web/src/app/api/search/semantic/route.ts:173-184` rate-limits per IP, then `:263-311` reads, decodes, scores, and top-k filters scanned embeddings.
- `apps/web/src/app/api/search/similar/[id]/route.ts:98-115` uses the same limiter, then `:177-214` scans and scores production embeddings.
- `apps/web/src/db/schema.ts:80-131` shows `images` indexes; embeddings are stored as BLOB rows without a vector index.

Why this is a problem:

CLIP inference is queued, but the DB fetch, BLOB decode, and vector scoring phase is still per-request work in the web process. With the default 2,000 rows this is bounded but nontrivial; at the hard cap it can move tens of MiB through MySQL and allocate thousands of vectors per request.

Concrete failure scenario:

Production semantic search is enabled and a burst of clients issues semantic/similar queries. Multiple request handlers each pull and score thousands of embeddings while the same process serves public pages and image queues, causing DB bandwidth pressure, event-loop delay, and GC churn.

Suggested fix:

Add a global semantic scan/scoring concurrency limiter separate from per-IP rate limiting. Keep public scan limits conservative, use a min-heap/top-k path that avoids retaining every score if it regresses, and plan a vector index or worker-side cached matrix for production-scale galleries.

### C17-PERF-06 - Color backfill candidate discovery lacks a dedicated stale-pipeline index

Severity: Medium
Confidence: High
Status: Confirmed issue

File/region:

- `apps/web/src/db/schema.ts:123-131` defines image indexes, none involving `pipeline_version`.
- `apps/web/src/lib/admin-backfill-runner.ts:393-431` counts and pages `processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < CURRENT)`.
- `apps/web/scripts/backfill-color-pipeline.ts:409-417` uses the same stale-candidate shape with `id > cursor`.

Why this is a problem:

Backfill candidate discovery must prove which processed rows are stale. Without an index involving `processed`, `pipeline_version`, and the keyset cursor, mostly-current galleries can still require broad scans just to find few or zero stale rows. The `OR pipeline_version IS NULL` branch further reduces index usefulness unless the query is split or indexed deliberately.

Concrete failure scenario:

After a full backfill, an admin opens backfill status or reruns the operation on a large gallery. Candidate count/page queries inspect broad processed ranges during a maintenance window even though almost every row is current.

Suggested fix:

Add a migration and `reconcileLegacySchema` update for a candidate index. Validate with `EXPLAIN ANALYZE`; likely options are split NULL/range queries over `(processed, pipeline_version, id)` or a generated `needs_reencode` column indexed with `(needs_reencode, id)`.

### C17-PERF-07 - Startup temp cleanup uses unbounded stat/unlink fan-out

Severity: Low
Confidence: High
Status: Confirmed issue

File/region:

- `apps/web/src/lib/image-queue.ts:41-97` scans three upload derivative dirs in parallel, then `Promise.all`s every temp-file stat and unlink.
- `apps/web/src/lib/process-topic-image.ts:146-168` does the same pattern for topic temp files.

Why this is a problem:

The age gate is correct, but a crash loop or failed backfill can leave thousands of `.tmp`, `.bak`, or `tmp-*` files. On the next bootstrap the process can launch thousands of filesystem operations concurrently.

Concrete failure scenario:

After an interrupted re-encode on a small host, 5,000 stale temp files remain. Startup fires thousands of `stat` and `unlink` calls, delaying readiness and risking `EMFILE` or storage saturation before the app is healthy.

Suggested fix:

Process temp cleanup through a small bounded-concurrency helper or fixed-size batches. Preserve the age gate and non-fatal logging.

### C17-PERF-08 - Authenticated photo pages duplicate the public image fan-out

Severity: Low
Confidence: High
Status: Confirmed issue

File/region:

- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:148-159` always starts `getImageCached(imageId)`, then calls `getImageForViewerCached(imageId, true)` for admins.
- `apps/web/src/lib/data.ts:1057-1080` performs the primary image lookup.
- `apps/web/src/lib/data.ts:1152-1198` then fans out tags, previous, and next queries.

Why this is a problem:

Admin photo browsing does the public image lookup/fan-out and then repeats the viewer/admin lookup/fan-out. This is not a correctness bug, but it increases DB work on the path most likely to be used for heavy photo inspection.

Concrete failure scenario:

An admin reviews hundreds of photos. Every page view does redundant primary image/tags/prev/next work, consuming pool capacity that could be serving public pages or background queue updates.

Suggested fix:

Resolve `isAdmin()` before starting the image body fetch, then perform exactly one image lookup with the needed select shape. Keep public metadata generation cache behavior separate.

## Likely Issues

### C17-PERF-09 - Public listing queries aggregate tags before applying page limits

Severity: Medium
Confidence: Medium
Status: Likely issue

File/region:

- `apps/web/src/lib/data.ts:786-828` documents and implements `getImagesLite()` as `LEFT JOIN image_tags/tags`, `GROUP BY images.id`, order, then limit/offset.
- `apps/web/src/lib/data.ts:893-940` does the same first-page query and runs exact count in parallel.
- `apps/web/src/app/[locale]/(public)/page.tsx:175-178` uses that dynamic first-page path.

Why this is a problem:

The window-count regression has been fixed, but the row query still groups and aggregates tags in the same query that discovers the ordered page. MySQL can need temp-table/group work over more candidate rows than the 30 returned images, especially on broad home/topic pages.

Concrete failure scenario:

A tag-heavy gallery grows to tens of thousands of photos. Crawlers hit dynamic home/topic pages; each request spends CPU grouping tag joins for rows ultimately discarded by `LIMIT 31`.

Suggested fix:

Use a two-phase listing query: first select ordered image IDs using only image-table predicates and covering indexes, then aggregate tags for those IDs only while preserving order. Keep exact count only where the UX needs it.

### C17-PERF-10 - Homepage always runs a non-sargable On This Day query

Severity: Medium
Confidence: Medium
Status: Likely issue

File/region:

- `apps/web/src/app/[locale]/(public)/page.tsx:155-178` renders the dynamic home page and first listing.
- `apps/web/src/app/[locale]/(public)/page.tsx:232-234` always includes `OnThisDayWidget`.
- `apps/web/src/lib/data-timeline.ts:102-130` filters with `MONTH(capture_date)` and `DAY(capture_date)`.
- `apps/web/src/db/schema.ts:123-131` has processed/date indexes but no generated month/day key.

Why this is a problem:

The source comment correctly states the predicates are not sargable. Because the home page is `revalidate = 0`, every visit can pay this scan even though the result changes only daily.

Concrete failure scenario:

On a large dated archive, normal homepage traffic repeatedly scans processed rows to return at most six photos, competing with the main listing query and background DB work.

Suggested fix:

Add generated `capture_month`/`capture_day` or `capture_month_day` columns and index `(processed, capture_month_day, capture_date, created_at, id)`, or maintain a day-scoped materialized/cache table. Fetch tags only after the six image IDs are selected.

### C17-PERF-11 - Smart collections can publish expensive dynamic predicates to uncached public pages

Severity: Medium
Confidence: Medium
Status: Likely issue

File/region:

- `apps/web/src/lib/smart-collections.ts:142-147` caps AST size/depth.
- `apps/web/src/lib/smart-collections.ts:221-238` compiles direct `contains`, `between`, and `in` predicates.
- `apps/web/src/lib/smart-collections.ts:250-267` compiles tag predicates through a subquery, including tag `contains`.
- `apps/web/src/lib/data.ts:1488-1544` runs grouped listing plus exact count over the compiled predicate.
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17` sets `revalidate = 0`, and `:110-112` invokes the query.

Why this is a problem:

The compiler bounds structure, not cost. Leading-wildcard `contains` predicates and tag subqueries can defeat b-tree indexes. Public smart-collection pages are dynamic and crawler-visible.

Concrete failure scenario:

An admin publishes a smart collection with several OR branches using `contains` on camera/lens/tag fields. Each public visit runs broad scans plus grouped tag aggregation and exact count to render 30 photos.

Suggested fix:

Classify predicates by indexability before publishing. Block or warn on expensive public shapes, add targeted indexes for supported predicates, or materialize collection membership in a join table refreshed on image/tag changes.

### C17-PERF-12 - Public keyword search remains a leading-wildcard DB CPU surface

Severity: Medium
Confidence: Medium
Status: Likely issue

File/region:

- `apps/web/src/lib/sql-like.ts:5-10` implements `containsLike()` as `%term%`.
- `apps/web/src/lib/data.ts:1574-1655` applies it to title, description, camera, lens, topic, and topic label.
- `apps/web/src/lib/data.ts:1693-1737` repeats it for tag and alias branches with grouped joins.
- `apps/web/src/app/actions/public.ts:247-317` exposes this as a public search action with in-memory plus DB-backed rate limiting before `searchImages()`.

Why this is a problem:

Rate limits bound request frequency, but each admitted search can still force non-indexable text scans. The query is carefully bounded by result count and short-circuits when the main query fills the limit, but common terms or low-cardinality metadata can still be expensive.

Concrete failure scenario:

Several users or crawlers search broad terms like camera brands, topic fragments, or common Korean words. MySQL scans processed rows and joined tag/alias tables while public pages and background jobs share the same pool.

Suggested fix:

Move public search to a real full-text/search index appropriate for the supported locales, or restrict contains search to a smaller precomputed searchable document table. Keep the current LIKE path as a fallback/admin-only small-gallery mode.

## Risks Needing Manual Validation

### C17-PERF-13 - Timeline/year pages can render 500 photo cards in one response

Severity: Low
Confidence: Medium
Status: Risk needing manual validation

File/region:

- `apps/web/src/lib/data-timeline.ts:166-215` caps timeline queries at `TIMELINE_PAGE_LIMIT = 500`.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:91-94` loads one year of timeline photos.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:226-270` maps month photos to `GridPicture` cards.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:92-131` loads and flattens year photos.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:189-230` renders those cards.

Why this is a risk:

The query uses an indexable date range and truncation is surfaced, so this is not unbounded. But 500 masonry cards still means a large HTML/RSC response and many `<picture>` candidates for browser layout and image selection.

Concrete failure scenario:

A year with 500 photos is opened on a mobile device. The route avoids client hydration for every card, but parsing/layout/image candidate selection still causes noticeable jank and long first render.

Suggested fix:

Validate with Lighthouse/browser traces on a 500-photo fixture. If it is slow, paginate by month, lazy-render sections, or lower the first response cap with a month/continuation control.

### C17-PERF-14 - Per-IP limiter correctness depends on live proxy topology

Severity: Medium
Confidence: Medium
Status: Risk needing manual validation

File/region:

- `apps/web/nginx/default.conf:20-29` warns nginx `limit_req_zone` keys use `$binary_remote_addr`.
- `apps/web/nginx/default.conf:59-71` documents the X-Forwarded-For topology contract.
- `apps/web/nginx/default.conf:99-203` forwards `$remote_addr` into app-visible headers across admin/API locations.
- `CLAUDE.md` runtime topology notes describe `TRUST_PROXY`/`TRUSTED_PROXY_HOPS` behavior.

Why this is a risk:

The repo template is explicit, but correctness depends on the operator's actual edge/LB chain. If nginx sees only an upstream load balancer address and real-IP is not configured, edge limits collapse all users into one bucket. If app trusted hops are wrong, app-layer per-IP limits collapse similarly.

Concrete failure scenario:

After moving behind a TLS/load-balancer hop, many legitimate visitors share the LB source IP. Public SSR, Next image optimizer, search, OG, and login/admin budgets are all keyed to the LB, causing global throttling or weak per-client abuse control.

Suggested fix:

Validate deployed request headers and nginx real-IP config through the actual edge. Add an operator smoke check that hits a diagnostic endpoint or log line and confirms the derived client IP and nginx limiter key match the real client.

### C17-PERF-15 - Shutdown/drain budgets need host measurement for worst-case image work

Severity: Low
Confidence: Low
Status: Risk needing manual validation

File/region:

- `apps/web/docker-compose.yml:13-15` uses `restart: always` and `stop_grace_period: 30s`.
- `apps/web/Dockerfile:136-148` routes SIGTERM handling to app instrumentation instead of Next's default server drain.
- `apps/web/src/lib/process-image.ts:1433-1440` can run three encoders in parallel per image.
- `apps/web/src/app/[locale]/admin/db-actions.ts:507-520` waits for queue/background/maintenance drains during restore.

Why this is a risk:

The queue retry model likely recovers from interrupted processing, but the deploy/container stop grace may still be shorter than worst-case AVIF/wide-gamut encode plus final DB/update side effects on the production host.

Concrete failure scenario:

A deploy lands while a large wide-gamut photo is encoding. Docker sends SIGTERM and then SIGKILL at 30s. If the encode/update exceeds that window, the row remains pending or partially side-effected until retry/cleanup catches up, creating delayed derivatives and transient admin-visible errors.

Suggested fix:

Measure worst-case encode and graceful shutdown on the deploy host with maximum expected image size/settings. Align Docker grace, app drain timeout, and deploy behavior to those measurements, or make long image jobs explicitly resumable with shorter leases.

## Rechecked Stale Candidates

- Service-worker LRU metadata race: not active. `apps/web/public/sw.template.js:98-104` serializes metadata writes with `metaMutationQueue`, and `:108-120`, `:181-215`, and `:218-220` route record/touch/delete through that queue.
- Sidecar color backfill O(total candidates) memory: not active. `apps/web/scripts/backfill-color-pipeline.ts:409-417` keyset-fetches one `BATCH_SIZE` page at a time, and `apps/web/src/lib/admin-backfill-runner.ts:404-431` mirrors that batch shape.
- Analytics view-table unbounded growth: mitigated. `apps/web/src/lib/view-retention.ts:64-90` purges in bounded chunks, and `apps/web/src/lib/maintenance-scheduler.ts:34-45` includes it in the hourly sweep.
- Per-photo OG fetch chain unbounded wait/bytes: mitigated. `apps/web/src/lib/og-photo-fetch.ts:30-54` caps bytes and total time, and `:64-117` enforces per-attempt timeout and total budget.
- Deploy prune deleting persistent data: not active in source. `apps/web/deploy.sh:79-104` prunes only after health, bind mounts persistent data, and omits `volume prune -a`.

## Final Missed-Issue Sweep

Final searches covered unbounded `Promise.all`, directory scans, `GROUP_CONCAT`/`GROUP BY`, offset pagination, non-sargable date predicates, leading-wildcard LIKE, brute-force vector scans, process-local state, cache invalidation, upload multipart parsing, maintenance sweeps, restore drains, and deploy/nginx rate-limit topology.

No Critical issue was confirmed in this static pass. The main active risk pattern remains bounded subsystems whose bounds compose poorly: large multipart parsing, overlapping image/background DB consumers, brute-force semantic scans, broad public query shapes, map/timeline first-render payloads, and repeated filesystem scans.

No relevant performance/concurrency file selected into this lane was intentionally skipped. Runtime profiling, production `EXPLAIN ANALYZE`, browser traces, load tests, and deployed proxy-header validation remain the main evidence gaps.
