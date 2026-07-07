# Cycle 22 Performance / Concurrency / Responsiveness Review

Role lane: perf-reviewer
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `8b795862079b0e5318242a09390b4cdff1dc2058`
Write scope: `.context/reviews/perf-reviewer.md`

Review-only. I did not implement fixes. I read `AGENTS.md`, `CLAUDE.md`, and `.context/plans/README.md`, then checked the current Cycle 21 fixes and the upload/restore/queue/backfill/semantic-search/service-worker/database/admin/public route flows against current source.

## Performance-Relevant Inventory

- Upload and restore ingress: browser upload Server Action, Lightroom/PAT upload route, DB backup/restore actions, upload size caps, Next transport caps, upload tracker and upload-processing contract lock.
- Image processing and backfill: `process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, sidecar backfill scripts, Sharp/libvips concurrency, derivative cleanup, pending file deletion ledger.
- DB/query surfaces: schema/indexes, `data.ts`, `data-timeline.ts`, smart collections, search, map, analytics/view retention, rate-limit buckets, migration/reconcile.
- Public request paths: home/timeline/year/map/topic/photo/share/group/smart collection pages, load-more/search actions, semantic/similar search APIs, OG/feed/sitemap/upload-serving routes.
- Client responsiveness: upload dropzone, map client, search modal, load-more, similar photos, lightbox/photo viewer/histogram, admin image manager and dashboard.
- Service worker/cache: `public/sw.template.js`, generated SW cache reference module, HTML fallback exclusions, derivative LRU/HEAD revalidation behavior.
- Cycle 21 fix surfaces: action-origin mutation scanner, `pending_file_deletions`, `markPermanentlyFailed`, backfill candidate index, MySQL datetime parser, root script syntax coverage, map/a11y/i18n/docs changes.

Generated build output, `node_modules`, runtime upload/data stores, local env/secrets, and binary fixture/media bytes were not inspected as source. This is static review; I did not run production profiling, browser traces, or DB `EXPLAIN`.

## Findings

### C22-PERF-01 - Image queue and admin backfill still budget independently against the same DB/CPU pool

- Severity: High
- Confidence: High
- Status: Confirmed current risk
- File/region: `apps/web/src/db/index.ts:21-45`; `apps/web/src/lib/image-queue.ts:121-153`, `761-800`, `1011-1085`; `apps/web/src/lib/admin-backfill-runner.ts:106-143`, `520-565`, `716-827`; `apps/web/src/lib/process-image.ts:36-57`, `1411-1418`.
- Failure scenario: uploads are processing while an admin starts in-app re-encode. The image queue can run up to two workers and admin backfill can run up to two workers at the default 10-connection pool; backfill also holds a whole-run advisory lock. Each image encode fans out AVIF/WebP/JPEG in parallel. Public SSR, search, analytics, semantic routes, and admin actions can queue behind background connection and native CPU pressure even though each lane is locally capped.
- Concrete fix: introduce a single process-wide background resource budget shared by queue processing, admin backfill, semantic embedding bootstrap, and other heavyweight background work. Acquire budget tokens before per-image advisory locks and Sharp encoding, or make admin backfill pause/refuse while queue workers are active. Add a combined-budget contract test.

### C22-PERF-02 - Large browser upload, PAT upload, and restore bodies are still framework-materialized before app streaming/backpressure

- Severity: High
- Confidence: High for source shape; Medium for live impact without RSS traces
- Status: Confirmed current risk
- File/region: `apps/web/src/lib/upload-limits.ts:1-6`, `19-35`; `apps/web/next.config.ts:111-119`; `apps/web/src/components/upload-dropzone.tsx:243-260`; `apps/web/src/app/actions/images.ts:129-149`; `apps/web/src/app/api/admin/lr/upload/route.ts:152-188`; `apps/web/src/app/[locale]/admin/db-actions.ts:717-739`.
- Failure scenario: an authenticated admin or PAT client submits a near-limit 200-250 MiB upload/restore while Sharp, SSR, queue work, or semantic inference is active. Domain code streams `File` to disk after entry, but the Server Action/`request.formData()` parser has already materialized multipart bodies. On the single small host this can spike RSS, trigger long GC pauses, or OOM before app-level quota and disk handoff can help.
- Concrete fix: move large binary ingress to streaming route handlers with auth/origin/token checks before body consumption, `Content-Length` prechecks, part/total byte limits, a shared large-body semaphore, temp-file handoff to image ingest or restore, and production-like RSS smoke tests.

### C22-PERF-03 - Public map can still serialize, SSR, hydrate, and fit 10,000 markers

- Severity: Medium
- Confidence: High
- Status: Confirmed current risk
- File/region: `apps/web/src/lib/data.ts:1766-1817`; `apps/web/src/db/schema.ts:49-50`, `123-131`; `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`; `apps/web/src/components/map/map-client.tsx:77-140`.
- Failure scenario: a location-rich gallery approaches the 10,000 marker cap. `/map` performs a large dynamic DB query, serializes all markers to the client, SSR-renders a fallback list item for every marker, computes bounds via full-array spreads, and mounts one Leaflet marker per photo. Mobile first interaction and map pan/zoom responsiveness degrade sharply.
- Concrete fix: lower the initial cap, serve map data by viewport/bbox/tile endpoint, add clustering, and virtualize or paginate the accessible list. If the full-map endpoint remains, add a GPS/map-visible query index and verify with `EXPLAIN`.

### C22-PERF-04 - Home on-this-day remains a non-sargable date scan on every dynamic home render

- Severity: Medium
- Confidence: High
- Status: Confirmed current risk
- File/region: `apps/web/src/components/on-this-day-widget.tsx:16-23`; `apps/web/src/lib/data-timeline.ts:103-131`; `apps/web/src/db/schema.ts:123-131`.
- Failure scenario: the home page renders `OnThisDayWidget`, which calls `getOnThisDayImages()`. The query filters with `MONTH(capture_date)` and `DAY(capture_date)`, so the `(processed, capture_date, created_at)` index cannot seek a specific month/day. A large dated corpus plus crawler traffic turns a six-photo widget into repeated scans.
- Concrete fix: add generated/stored `capture_month` and `capture_day` columns with an index such as `(processed, capture_month, capture_day, capture_date, created_at, id)`, or materialize/cache the daily result and invalidate on image metadata changes.

### C22-PERF-05 - Public keyword search and smart-collection contains predicates still use leading-wildcard scans

- Severity: Medium
- Confidence: High
- Status: Confirmed current risk
- File/region: `apps/web/src/app/actions/public.ts:247-329`; `apps/web/src/lib/data.ts:1574-1749`; `apps/web/src/lib/smart-collections.ts:221-223`, `261-267`.
- Failure scenario: accepted searches for common substrings scan title, description, camera/lens, topic, topic label, tag, and alias branches with `%term%` predicates. Smart collection `contains` predicates compile to the same LIKE shape. Rate limits cap abuse, but each allowed request can still spend DB CPU and compete with SSR/background work.
- Concrete fix: move public text search to an indexed search surface such as MySQL FULLTEXT/ngram, a materialized search-document table, or a dedicated search index. Short-term, raise minimum keyword length for keyword mode, cache hot queries briefly, add statement timeouts, and reject/warn on expensive public smart-collection `contains` predicates.

### C22-PERF-06 - Semantic and similar-photo routes score vector scans synchronously in the Node request path

- Severity: Low
- Confidence: High
- Status: Confirmed bounded risk
- File/region: `apps/web/src/lib/clip-embeddings.ts:36-48`, `80-87`, `188-235`; `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`; `apps/web/src/db/schema.ts:299-310`.
- Failure scenario: semantic mode is enabled and users open semantic/similar panels during upload or backfill. Each accepted request loads up to `SEMANTIC_SCAN_LIMIT` embedding blobs, decodes them, and scores them synchronously in the same Node process serving SSR and background queues. The hard cap now prevents accidental million-row scans, but CPU/heap/event-loop cost remains request-local.
- Concrete fix: add a process-wide semantic scoring semaphore and scan latency/count telemetry. For larger galleries, move scoring to an ANN/vector index, worker thread, or process-owned copied matrix with explicit refresh invalidation.

## Cycle 21 Fixes Verified, Not Counted

- Mutation-barrier scanner order proof appears fixed: `check-action-origin.ts:664-709` only accepts a slot whose acquired-state gate is the next statement, and `check-action-origin.test.ts:745-760` covers the check-after-mutation negative case.
- Pipeline backfill candidate index appears fixed: schema defines `idx_images_processed_pipeline_version` at `schema.ts:123-128`, migration creates it at `0030_pending_file_deletions.sql:19`, and reconcile mirrors it at `migrate.js:720-724`.
- MySQL datetime rendering bug appears fixed in production code: `mysql-datetime.ts:33-69`, `data-timeline.ts:248-256`, `timeline/page.tsx:103`, and `on-this-day-widget.tsx:51` now use string parsing rather than `new Date(capture_date)` for rendered/grouped persisted datetimes.
- Queue permanent-failure cap drift appears fixed: `image-queue.ts:374-387` owns `markPermanentlyFailed`, and production add sites now call it at `image-queue.ts:782` and `image-queue.ts:1044`.
- Service-worker stale revocable page caching remains fixed: `sw.template.js:59-64` classifies photo/share/group/smart-collection/map pages as revocable and `sw.template.js:555-558` bypasses HTML offline caching for them.

## Final Missed-Issue Sweep

I rechecked the requested upload, restore, queue, backfill, semantic-search, service-worker, database, admin, and public route flows after the inventory pass. No additional performance findings were confirmed beyond the six above. The main validation gaps are live RSS/CPU profiling, DB query plans on production-scale data, and browser traces on low-end mobile hardware.

Uninspected categories: generated build output, binary fixtures/media bytes, runtime upload/data contents, `node_modules`, live production nginx/proxy state, live MySQL contents, and local secret/env files.

Findings: 6 total.
