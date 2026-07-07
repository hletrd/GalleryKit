# Cycle 12 Perf / Debugger / Tracer Review

Date: 2026-07-07 KST
Lane: `perf-reviewer + debugger + tracer`
Scope: whole-repository static review focused on performance, concurrency, CPU/memory, UI responsiveness, latent bugs, failure modes, race conditions, causal tracing, and competing hypotheses.
Write boundary: this review artifact only. No app source, schema, tests, services, containers, deploys, database state, or generated assets were changed.

## Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- Code-review skill instructions at `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Repository inventory built:

- Runtime app routes/actions/APIs: `apps/web/src/app/**`, including public gallery/topic/photo/share/map/smart-collection pages, admin pages, admin DB backup/restore actions, server actions, upload-serving routes, OG/feed/sitemap routes, semantic/similar search APIs, and Lightroom upload API.
- Core data/concurrency libraries: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `image-queue.ts`, `process-image.ts`, `process-topic-image.ts`, `admin-backfill-runner.ts`, `clip-*`, `rate-limit.ts`, `upload-tracker*.ts`, `upload-processing-contract-lock.ts`, `restore-maintenance*.ts`, `admin-mutation-barrier.ts`, `background-db-writes.ts`, `maintenance-scheduler.ts`, `serve-upload.ts`, `settings-hash.ts`, `revalidation.ts`, `smart-collections.ts`, `storage/*`, and validation/sanitize helpers.
- DB/migrations/deploy: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, backfill scripts, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, and root/package workspace commands.
- Frontend responsiveness surfaces: masonry/listing components, lightbox/photo viewer, upload dropzone, map client/loader, search/similar components, service worker, histogram worker, admin dashboard/settings/analytics clients, and UI primitives where they affect hydration or repeated rendering.
- Relevant docs/history: `.context/plans/**` and `.context/reviews/**` current-cycle/prior perf-debug-tracer artifacts, especially prior deferred performance/concurrency items and stale tracer findings.

Final missed-issue sweep searched for: unbounded `Promise.all`, directory scans, expensive `GROUP BY`/`GROUP_CONCAT`, non-sargable predicates, offset pagination, broad `LIKE`, brute-force vector scans, process-local limiters/state, queue/bootstrap continuation, cleanup after delete/re-encode races, cache/ETag mismatches, restore-maintenance fences, background DB writers, and deploy prune/health behavior.

## Findings

### C12-PDT-01 - Batch image deletion repeats full derivative-directory scans per image and format

- Severity: Medium
- Confidence: High
- Validation: confirmed issue
- Files/regions: `apps/web/src/app/actions/images.ts:735-744`, `apps/web/src/app/actions/images.ts:860-884`, `apps/web/src/lib/process-image.ts:575-664`

`deleteImage()` and `deleteImages()` intentionally pass `[]` to `deleteImageVariantsStrict()` so cleanup catches variants from old image-size configs. That mode scans the whole derivative directory. The batch path caps selected IDs at 100 and chunks image cleanup, but each image still launches three full scans (WebP/AVIF/JPEG), so a max batch can perform up to 300 directory walks.

Competing hypothesis rejected: the concurrency cap at `IMAGE_CLEANUP_CONCURRENCY` bounds simultaneous work, but it does not remove the repeated O(images * formats * directory-size) scan cost.

Failure scenario: an admin deletes 100 photos on a gallery with tens of thousands of derivatives on NAS-backed storage. The DB rows are already gone, while cleanup spends a long tail walking the same directories repeatedly, contending with image serving, backfill rename/unlink work, and upload processing.

Suggested fix: add a batch cleanup helper that scans each derivative directory once, indexes entries by selected base filename prefixes, and unlinks all matching variants. Keep strict single-image cleanup as-is; use the indexed path only for `deleteImages()`.

### C12-PDT-02 - Dynamic homepage runs a non-sargable on-this-day query on every render

- Severity: Medium
- Confidence: High
- Validation: confirmed scale issue
- Files/regions: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/app/[locale]/(public)/page.tsx:232-234`, `apps/web/src/lib/data-timeline.ts:102-130`, `apps/web/src/db/schema.ts:123-131`

The homepage is dynamic (`revalidate = 0`) and always renders `OnThisDayWidget`. `getOnThisDayImages()` filters with `MONTH(capture_date)` and `DAY(capture_date)`, which the source comment correctly marks as non-sargable. The current image indexes cover `processed, capture_date, created_at` and related sort paths, but not a generated month/day key.

Failure scenario: as dated image count grows, routine homepage traffic scans/group-sorts all processed rows with non-null `capture_date` to return six photos, while the same request also runs the masonry listing, tag/topic navigation, SEO/config, and count work.

Suggested fix: add generated columns such as `capture_month`/`capture_day` or `capture_month_day`, index `(processed, capture_month_day, capture_date, created_at, id)`, and query that equality key. A day-scoped cache can reduce repeated work, but the DB predicate should be indexable first.

### C12-PDT-03 - Public listing queries aggregate tags before limiting the page

- Severity: Medium
- Confidence: Medium
- Validation: likely risk from query shape
- Files/regions: `apps/web/src/lib/data.ts:786-828`, `apps/web/src/lib/data.ts:893-940`, `apps/web/src/app/[locale]/(public)/page.tsx:175-178`

`getImagesLite()` and `getImagesLitePage()` build the page row query with `LEFT JOIN image_tags`, `LEFT JOIN tags`, `GROUP_CONCAT`, `GROUP BY images.id`, order, then limit. The separate lean count query removed the worst window-count materialization, but the row query can still aggregate tag rows for many candidate images before the page limit is applied.

Failure scenario: a tag-heavy gallery with broad home/topic pages grows to tens of thousands of images. Each uncached listing request can spend MySQL CPU/temp-table work aggregating tags for rows that are discarded by `LIMIT 31`.

Suggested fix: make listing two-phase: first select the ordered page of image IDs using only image-table predicates and covering indexes; then join/aggregate tags for those IDs only, preserving page order.

### C12-PDT-04 - Semantic and similar-photo APIs do per-request brute-force vector scans in the web process

- Severity: Medium
- Confidence: Medium
- Validation: likely production-mode resource risk
- Files/regions: `apps/web/src/lib/clip-embeddings.ts:36-48`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`, `apps/web/src/lib/rate-limit.ts:393-416`

Both semantic APIs read up to `SEMANTIC_SCAN_LIMIT` embedding blobs, decode each vector, and score in Node. The default is 2,000, but the hard cap is 25,000. The semantic limiter is process-local and per-IP.

Failure scenario: with production semantic search enabled and the scan limit raised, concurrent public requests can each pull roughly 50 MB of raw 512-dim float vectors at 25,000 rows before row/object overhead, then score them on the same Node process serving pages and queues. That risks DB bandwidth pressure, GC churn, and event-loop latency.

Suggested fix: move similarity search off the request hot path as data grows: vector index/store, worker-thread scoring over a cached matrix with single-flight refresh, or a lower public scan cap. Consider DB-backed accounting for semantic expensive-work limits if the app ever scales beyond the documented single instance.

### C12-PDT-05 - Public map can hydrate 10,000 markers plus a duplicate accessible list

- Severity: Medium
- Confidence: High
- Validation: confirmed UI responsiveness risk
- Files/regions: `apps/web/src/lib/data.ts:1741-1777`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `apps/web/src/app/[locale]/(public)/map/page.tsx:89-110`, `apps/web/src/components/map/map-client.tsx:77-140`

`getMapImages()` caps public GPS rows at 10,000. The page serializes those markers to the client, hydrates a React Leaflet `<Marker>` and `<Popup>` per marker, and renders a second `<ul>` list for the same array. `FitBounds` also allocates latitude/longitude arrays and spreads them into min/max.

Failure scenario: a travel archive with thousands of map-visible photos ships a large RSC/client payload and asks mobile browsers to hydrate thousands of Leaflet/React objects before the map is responsive.

Suggested fix: load markers by viewport/bounds, add clustering or a canvas/WebGL marker layer, lower the initial SSR cap, virtualize/paginate the accessible list, and compute bounds in one pass without spread arrays.

### C12-PDT-06 - Public smart collections can expose expensive predicates on uncached routes

- Severity: Medium
- Confidence: Medium
- Validation: likely risk from compiler + route behavior
- Files/regions: `apps/web/src/lib/smart-collections.ts:142-147`, `apps/web/src/lib/smart-collections.ts:221-267`, `apps/web/src/lib/sql-like.ts:9-10`, `apps/web/src/lib/data.ts:1488-1544`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:110-120`

Smart-collection AST size/depth is bounded, but `contains` compiles to leading-wildcard `LIKE '%term%'`, tag `contains` compiles through an `IN` subquery, and public collection pages are dynamic. Initial renders run a grouped listing query plus a separate count over the compiled predicate.

Failure scenario: an admin publishes a broad public collection with camera/lens/tag `contains` predicates. Visitors or crawlers can repeatedly force broad scans/subqueries/grouping/count work.

Suggested fix: classify predicates at save/publish time as index-friendly or expensive. Warn/block expensive public shapes, add targeted indexes for supported public predicates, or materialize collection membership and refresh it when image metadata or tags change.

### C12-PDT-07 - Image queue and in-app backfill reserve the same DB-pool headroom independently

- Severity: Medium
- Confidence: High
- Validation: documented concurrency risk still present in source
- Files/regions: `CLAUDE.md:275-283`, `apps/web/src/db/index.ts:31-42`, `apps/web/src/lib/image-queue.ts:120-140`, `apps/web/src/lib/admin-backfill-runner.ts:96-142`, `apps/web/src/lib/admin-backfill-runner.ts:715-721`

The image queue and admin backfill runner each reserve roughly half of the 10-connection pool for live traffic and each clamps to 2 workers, but they do not coordinate with each other. They run under different locks, so active upload processing and an in-app re-encode can overlap.

Failure scenario: queue concurrency 2 plus backfill concurrency 2 can pin about 9 of 10 pool connections (`queue 2x2`, `backfill lock + 2x2`), leaving one connection for live requests despite each resolver independently proving five connections of headroom. A photo page or listing request with DB fan-out queues behind encode-duration holds.

Suggested fix: introduce a shared background DB-connection budget/semaphore used by both queue and admin backfill, or reduce each cap when the other background consumer is active. Surface current background pool budget in admin status/logs.

### C12-PDT-08 - Startup orphan-temp cleanup uses unbounded stat/unlink fan-out

- Severity: Low
- Confidence: High
- Validation: confirmed issue
- Files/regions: `apps/web/src/lib/image-queue.ts:40-96`, `apps/web/src/lib/image-queue.ts:1226-1230`, `apps/web/src/lib/process-topic-image.ts:146-168`

Queue bootstrap starts derivative temp cleanup and topic temp cleanup. Both scan directories, then run `Promise.all` over every matching temp file for `stat`, followed by unbounded unlink fan-out for stale files.

Failure scenario: after a crash, failed backfill, or repeated interrupted deploys, thousands of `.tmp`, `.bak`, or `tmp-*` files can accumulate. The next process start can launch thousands of filesystem operations at once, delaying readiness and risking `EMFILE`/I/O saturation on a small host.

Suggested fix: process stat/unlink through a small bounded-concurrency helper or batches. Keep age-gating and non-fatal cleanup semantics.

### C12-PDT-09 - Authenticated photo page performs duplicate image fan-out

- Severity: Low
- Confidence: High
- Validation: confirmed issue
- Files/regions: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:148-159`, `apps/web/src/lib/data.ts:1057-1080`, `apps/web/src/lib/data.ts:1152-1198`

The photo page always starts `getImageCached(imageId)` and then, if the viewer is admin and the public image exists, calls `getImageForViewerCached(imageId, true)`. Each image helper performs the primary image lookup and then fans out to tags/prev/next.

Failure scenario: an authenticated admin browsing photo pages performs the public fetch plus the admin fetch for every page body, adding redundant DB work and pool fan-out on the most inspection-heavy user path.

Suggested fix: resolve `isAdmin()` first or in parallel with config/translation work, then perform exactly one body image fetch with the required select shape.

### C12-PDT-10 - Byte-impacting setting changes do not invalidate already-served static derivative bytes

- Severity: Low
- Confidence: High
- Validation: confirmed operational/cache risk, documented in source
- Files/regions: `apps/web/next.config.ts:55-73`, `apps/web/src/lib/settings-hash.ts:14-25`, `apps/web/src/lib/serve-upload.ts:114-124`

Existing derivative files under `public/uploads` are served by Next static handling with `Cache-Control: public, max-age=3600, must-revalidate`. The route-handler fallback ETag includes `IMAGE_PIPELINE_VERSION`, mtime, size, and settings hash, but source comments note existing static files normally bypass that route-handler hash. A settings-only change therefore does not change static bytes, mtime, or size until re-encode.

Failure scenario: an admin changes quality/color/size settings and expects the public gallery to reflect the new derivative policy. Existing static derivatives can continue serving old bytes until a backfill rewrites them, while fallback-route clients see hash invalidation sooner.

Suggested fix: make the admin settings UI explicitly require/offer a re-encode for every byte-impacting setting change, or route derivatives through a handler/CDN key that includes the settings hash/version. If static serving remains preferred, keep the warning prominent and make "settings changed but backfill not run" visible in admin health/status.

## Rechecked Stale Candidates

- `logout` racing DB restore: not active. Current `logout` checks restore maintenance and acquires `acquireAdminMutationSlot()` before `verifySessionToken()` and session deletion (`apps/web/src/app/actions/auth.ts:279-289`), while restore drains those slots before import (`apps/web/src/app/[locale]/admin/db-actions.ts:563-574`, `apps/web/src/lib/admin-mutation-barrier.ts:76-129`).
- Upload vs restore: browser upload and Lightroom upload both acquire the upload-processing contract lock before topic/save/insert/enqueue work (`apps/web/src/app/actions/images.ts:198-211`, `apps/web/src/app/api/admin/lr/upload/route.ts:252-279`), and restore takes the same lock before entering maintenance (`apps/web/src/app/[locale]/admin/db-actions.ts:440-454`).
- Deploy prune deleting persistent data: not active in the static pass. `deploy.sh` prunes only after health success and the documented persistence paths are bind mounts, not Docker volumes (`apps/web/deploy.sh:79-104`).

## Reviewed Without New Findings

- Image upload handling: quota claim/settle ordering, disk precheck, topic validation, GPS/HDR handling, settings snapshotting, and enqueue self-healing were inspected across browser and Lightroom paths. No new correctness race met the reporting bar.
- Image processing pipeline: CPU/memory work is heavy by design but bounded by queue concurrency, Sharp concurrency, input-pixel caps, and retry/permanent-failure state. The fresh-per-format Sharp instances trade decode reuse for color correctness; I found no new double-processing path.
- Restore maintenance: foreground admin mutation barrier, background write drains, queue quiesce/resume, backfill locks, and durable marker handling were inspected. The main stale logout gap is fixed.
- Rate limiting: search/load-more have DB-backed accounting; OG/share/feed/semantic are process-local under the documented single-instance topology. Semantic remains reported above because the protected work is unusually expensive.
- DB migrations: journal monotonicity, hash postconditions, DML baseline refusal, pending-tail historical prerequisites, and schema reconcile contracts were reviewed from docs/source. No new migration failure was confirmed.
- Deploy scripts: health-before-prune and no `volume prune -a` contract are present. No deploy command was run.

## Final Missed-Issue Sweep

No Critical or High issue was confirmed in this static pass. The strongest current risks are scale/resource risks: repeated derivative directory scans, non-sargable dynamic homepage work, grouped listing aggregation before page limiting, brute-force semantic scans, large map hydration, expensive public smart-collection predicates, overlapping background DB-pool budgets, and unbounded temp cleanup fan-out.

No browser trace, production `EXPLAIN`, load test, MySQL fixture, container, deploy, or e2e run was used. Evidence is static source inspection, docs/history reconciliation, and exact file/line citations.
