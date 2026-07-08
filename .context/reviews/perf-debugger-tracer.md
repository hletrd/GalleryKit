# Cycle 25 Perf / Debugger / Tracer Review

Date: 2026-07-08 10:08:30 KST  
Reviewed HEAD: `f78c8437ae833d50aa85db8332257f59d923dc60`  
Lane: `perf-reviewer + debugger + tracer`  
Scope: whole-repository static review for performance, concurrency, CPU/memory, DB query shape, UI responsiveness, background jobs, causal failure flows, latent bugs, regressions, race hypotheses, and suspicious state transitions.  
Boundary: review artifact only. No product code, schema, generated assets, database state, services, containers, or deploy scripts were changed.

## Inventory

Read first:

- Project instructions and rules from `AGENTS.md` in the prompt.
- `CLAUDE.md` for architecture, runtime topology, queue/backfill/restore contracts, deploy policy, semantic-search activation, and known operational caveats.
- Code-review skill guidance at `/Users/hletrd/.agents/skills/code-review/SKILL.md`.

Repository inventory built before detailed inspection:

- Runtime and lifecycle: `apps/web/src/instrumentation.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/single-writer-guard.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, shutdown/restore drain helpers, and process-local state modules.
- Large ingest and restore: browser upload server action, Lightroom upload route, upload tracker/limits/paths, image processing, restore DB actions, backup/restore helpers, SQL restore scanner, and child-process watchdogs.
- Background work: image queue, Sharp pipeline, in-app admin backfill runner, sidecar color/CLIP backfills, CLIP model/inference queues, analytics/background DB writers, pending file deletion drains, and retention jobs.
- DB and query shape: schema indexes/migrations, `data.ts`, `data-timeline.ts`, analytics queries, public search/load-more actions, smart collections, semantic/similar APIs, sitemap/feed/OG routes.
- UI responsiveness: masonry cards, infinite load-more, search overlay, similar photos, map page/client, photo viewer/lightbox/navigation, upload dropzone, admin dashboard/settings/analytics clients, and service worker cache logic.
- Deploy/ops surfaces: root/workspace package scripts, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, Docker config, and migration scripts.
- Review history: current and prior `.context/reviews/**` perf/debugger/tracer reports and deferred plan artifacts, checked as hypothesis history only.

## Confirmed Issues

### C25-PDT-01 - Large browser upload and DB restore Server Actions admit multipart bodies before app backpressure

Severity: High  
Confidence: High  
Status: Confirmed source-level failure mode; live RSS/OOM threshold needs load tracing.

Evidence:

- The framework body ceiling is intentionally large: `apps/web/next.config.ts:111-119` sets Server Action and proxy body limits from `NEXT_SERVER_ACTION_BODY_SIZE_LIMIT`, derived from 200-250 MiB upload/restore bodies in `apps/web/src/lib/upload-limits.ts:1-6`, `19-33`.
- Browser upload receives already-materialized `FormData` at `apps/web/src/app/actions/images.ts:87` and reads `formData.getAll('files')` at `apps/web/src/app/actions/images.ts:106`.
- The upload-processing contract lock is later at `apps/web/src/app/actions/images.ts:154-159`; cumulative byte/file claim checks and claim happen later at `apps/web/src/app/actions/images.ts:197-221`; disk and topic checks are later still at `apps/web/src/app/actions/images.ts:229-270`.
- DB restore also receives `FormData` at `apps/web/src/app/[locale]/admin/db-actions.ts:421-427`; only inside `runRestore` does it inspect the `File` and stream the already accepted body to temp disk at `apps/web/src/app/[locale]/admin/db-actions.ts:745-767`.
- The Lightroom route shows the safer shape: it rejects chunked/missing/oversized `Content-Length`, preclaims quota, and acquires a parse slot before `request.formData()` at `apps/web/src/app/api/admin/lr/upload/route.ts:101-187`.
- The browser client serializes files in one tab (`apps/web/src/components/upload-dropzone.tsx:240-297`), so the single-UI path is less risky than a fully parallel batch. Cross-tab/admin/restore submissions still share the pre-action parser boundary.

Failure scenario:

Two admin tabs, a browser retry, or an upload plus restore submit near-limit multipart bodies while a restore or upload lock is already held. Next accepts/parses the bodies before app-level lock, quota, disk, topic, or maintenance checks can refuse. On the single disk-constrained web host, this can create RSS spikes, GC stalls, or OOM before the intended safety gates execute.

Suggested fix:

Move browser upload and DB restore ingestion to Node route handlers with the Lightroom route's admission order: same-origin/admin gate, `Content-Length` requirement, chunked rejection, process-wide parse/body semaphore, quota preclaim, restore/upload lock, then streaming multipart-to-temp/original storage. Keep Server Actions only as thin form shims if needed.

### C25-PDT-02 - Background DB/CPU admission is split across independent producers

Severity: High  
Confidence: High for source shape, medium-high for production impact  
Status: Confirmed architectural risk; exact saturation point needs mixed-load testing.

Evidence:

- MySQL pool is fixed at 10 connections with queue limit 20 in `apps/web/src/db/index.ts:31-41`.
- Image queue resolves its own concurrency from the pool at `apps/web/src/lib/image-queue.ts:121-153` and creates a `PQueue` with that cap at `apps/web/src/lib/image-queue.ts:447-456`.
- Admin backfill independently reserves roughly half the pool and caps its own workers at `apps/web/src/lib/admin-backfill-runner.ts:97-143`, then starts its own `PQueue` at `apps/web/src/lib/admin-backfill-runner.ts:716-727`.
- Analytics/background writes use separate in-process queues and caps at `apps/web/src/lib/background-db-writes.ts:3-10`, `42-64`.
- CLIP inference uses an independent pending queue and concurrency cap at `apps/web/src/lib/clip-model.ts:53-72`, `156-173`.
- Sharp/libvips concurrency is global, but one image job still fans out format work; `apps/web/src/lib/process-image.ts:36-57` sets process-wide Sharp concurrency, while `processImageFormats` performs heavy file/encode work in `apps/web/src/lib/process-image.ts:1027-1123` and format generation later in the same function.
- Queue side effects for caption/embedding run after `processed=true` and are tracked but non-blocking for the main job at `apps/web/src/lib/image-queue.ts:939-1008`.

Failure scenario:

A large upload is processing derivatives, an admin starts color backfill, public traffic records analytics, and semantic embedding generation is enabled. Each subsystem stays under its local cap, but together they can occupy most or all DB pool slots and CPU/libvips/model budget. Foreground pages then wait behind background work, hit pool queue limits, or show transient DB failures even though no single queue is "misconfigured."

Suggested fix:

Introduce one process-wide background resource governor with named DB and CPU tokens. Route image queue, admin backfill, analytics flushes, semantic indexing, retention/maintenance sweeps, and restore drains through it, with explicit foreground reserves and metrics for queue depth, pool wait time, active jobs, and dropped work.

## Likely Issues

### C25-PDT-03 - Public map can hydrate 10,000 markers plus a duplicate list

Severity: Medium  
Confidence: High  
Status: Likely user-visible scale issue; needs browser trace with a GPS-heavy fixture.

Evidence:

- `getMapImages()` intentionally caps at 10,000 plus lookahead in `apps/web/src/lib/data.ts:1766-1816`.
- The map page serializes every marker to the client at `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`.
- It mounts the map and also renders one list item per marker at `apps/web/src/app/[locale]/(public)/map/page.tsx:89-110`.
- `FitBounds` allocates latitude/longitude arrays and spreads them into min/max at `apps/web/src/components/map/map-client.tsx:77-94`.
- `MapClient` renders one Leaflet `Marker`/`Popup` subtree per marker at `apps/web/src/components/map/map-client.tsx:120-141`.

Failure scenario:

A gallery with 8k-10k map-visible photos opens `/map` on mobile. The response carries a large RSC/client payload, creates thousands of list nodes, computes bounds across large arrays, and mounts thousands of Leaflet objects. The result can be long input delay, hydration stalls, memory pressure, or tab termination.

Suggested fix:

Switch to viewport/bounds-based marker loading, clustering or canvas/WebGL rendering, lower initial SSR cap, virtualize or paginate the accessible list, and compute bounds in one pass.

### C25-PDT-04 - Semantic and similar search are recency-capped brute-force vector scans

Severity: Medium  
Confidence: High  
Status: Likely scalability and recall issue; severity depends on production semantic-search activation and corpus size.

Evidence:

- `SEMANTIC_SCAN_LIMIT` defaults to 2,000 and can be raised to a hard max of 25,000 in `apps/web/src/lib/clip-embeddings.ts:36-48`.
- Semantic search scans active-model embedding BLOBs ordered by recency at `apps/web/src/app/api/search/semantic/route.ts:263-279`, then decodes and scores every scanned row in JS at `apps/web/src/app/api/search/semantic/route.ts:292-311`.
- Similar-image search follows the same production scan/score shape at `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`.
- The schema has a `(model_version, updated_at)` index for this scan in `apps/web/src/db/schema.ts:314-326`, but no nearest-neighbor access path.

Failure scenario:

With 20k embedded images, an older event outside the most recent scan window can never be returned even if it is the best semantic match. Raising the scan cap improves recall by transferring more BLOBs and doing more Node scoring per request, competing with upload processing and foreground rendering.

Suggested fix:

Use an ANN/vector index or a resident normalized embedding matrix serviced by a bounded worker. At minimum, instrument scan rows/time, decode+score time, result age distribution, and scan-limit misses; keep public scan caps conservative.

### C25-PDT-05 - Public keyword search uses leading-wildcard scans across metadata and tags

Severity: Medium  
Confidence: High  
Status: Confirmed query-shape risk; impact depends on corpus and traffic.

Evidence:

- The public action is rate-limited at `apps/web/src/app/actions/public.ts:247-329`.
- `searchImages()` bounds query length and return count at `apps/web/src/lib/data.ts:1574-1584`.
- The main query uses `containsLike` over title, description, camera, lens, topic slug, and topic label at `apps/web/src/lib/data.ts:1637-1655`.
- Tag fallback uses an `EXISTS` subquery with `containsLike(tags.name, searchTerm)` at `apps/web/src/lib/data.ts:1693-1701`, and tag/alias fallback queries run in parallel at `apps/web/src/lib/data.ts:1716-1738`.
- Image indexes in `apps/web/src/db/schema.ts:123-132` do not provide full-text/search-document support for these leading-wildcard predicates.

Failure scenario:

At tens or hundreds of thousands of photos/tags, valid public searches inspect large portions of `images`, `topics`, and tag joins to return 20 rows. A rate-limited burst can still burn DB CPU and degrade browsing.

Suggested fix:

Add an indexed search path: MySQL full-text where acceptable, a denormalized search document table, or a local/external search engine. Keep the action rate limit, but make DB work proportional to indexed matches.

### C25-PDT-06 - On-this-day query is non-sargable on `capture_date`

Severity: Low-Medium  
Confidence: High  
Status: Confirmed query-shape issue; likely acceptable at current personal-gallery scale.

Evidence:

- The source documents the limitation in `apps/web/src/lib/data-timeline.ts:103-110`.
- The query filters with `MONTH(capture_date)` and `DAY(capture_date)` at `apps/web/src/lib/data-timeline.ts:121-131`.
- Existing image date indexes are full date/timestamp shapes at `apps/web/src/db/schema.ts:123-132`, which cannot directly serve month/day extraction predicates.
- Timeline archive pages use indexable range predicates instead at `apps/web/src/lib/data-timeline.ts:187-216`; the issue is limited to on-this-day.

Failure scenario:

The homepage or timeline widget evaluates month/day functions across many processed dated rows to return six anniversary photos, adding avoidable work to public rendering.

Suggested fix:

Add generated/stored `capture_month_day` or `(capture_month, capture_day)` columns indexed with `(processed, capture_month_day, capture_date, created_at, id)`, and query equality on that key.

### C25-PDT-07 - Admin CSV export remains bounded but in-memory

Severity: Low-Medium  
Confidence: High  
Status: Bounded admin-only memory risk.

Evidence:

- `exportImagesCsv()` documents the in-memory profile at `apps/web/src/app/[locale]/admin/db-actions.ts:71-76`.
- It queries up to 50,000 grouped rows at `apps/web/src/app/[locale]/admin/db-actions.ts:94-109`.
- It builds `csvLines`, clears the result array, then joins into one string at `apps/web/src/app/[locale]/admin/db-actions.ts:111-145`.

Failure scenario:

An admin exports near the 50k cap while uploads/backfill/semantic scans are active. Large titles/tag sets push heap above the documented estimate, causing GC pauses in the same web process serving traffic.

Suggested fix:

Move CSV export to a streaming admin route with cursor pagination and backpressure. Keep the 50k cap if required, but avoid materializing both row data and final CSV in process memory.

### C25-PDT-08 - Service-worker HTML eviction scans and sorts cached responses

Severity: Low  
Confidence: High  
Status: Bounded client-side performance risk.

Evidence:

- HTML cache cap is 50 entries in `apps/web/public/sw.template.js:31-39`.
- Eviction calls `htmlCache.keys()`, then `htmlCache.match()` for every key at `apps/web/public/sw.template.js:147-157`.
- It sorts all entries and deletes overflow at `apps/web/public/sw.template.js:159-164`.
- The network-first HTML path schedules cache put and eviction in `event.waitUntil`, not on first response, at `apps/web/public/sw.template.js:446-480`.
- Revocable public object pages bypass offline HTML caching at `apps/web/public/sw.template.js:555-563`.

Failure scenario:

A low-end mobile device with many cached navigations crosses the cap. Each new HTML cache write performs repeated Cache API reads and a full sort in the service worker. It should not block the network response, but it can consume background service-worker time and make navigation feel sticky.

Suggested fix:

Track HTML recency metadata separately, mirroring the image-cache metadata path, and evict incrementally without reading every cached response.

## Manual Validation Risks

### C25-PDT-09 - Host nginx protections are config-only unless the operator applied them

Severity: Medium  
Confidence: Medium  
Status: Live-host validation risk, not a source-code defect.

Evidence:

- Rate-limit zones and the `$binary_remote_addr` real-IP caveat are defined at `apps/web/nginx/default.conf:1-29`.
- `/_next/image` has a dedicated limiter at `apps/web/nginx/default.conf:246-272`.
- Public SSR catch-all limiter is configured and explicitly marked config-only at `apps/web/nginx/default.conf:274-311`.
- Deploy builds and starts Docker plus health-checks at `apps/web/deploy.sh:51-77`; pruning follows health at `apps/web/deploy.sh:79-104`.
- Remote deploy dispatch runs SSH command construction and execution at `scripts/deploy-remote.sh:31-53`, `87-93`; it does not install/reload host nginx.

Failure scenario:

The repo contains the intended limiter config, but production host nginx still runs an older config or lacks real-IP setup behind a load balancer. Public SSR or Next image optimization can be under-throttled, or all visitors can share one limiter bucket and receive false 429s.

Suggested fix:

Add an operator/deploy validation step that captures `nginx -T`, confirms expected zones/locations, verifies real-IP topology, and records controlled 429/non-429 evidence after nginx config changes.

### C25-PDT-10 - Restore recovery still depends on process-local state plus operator restart when cleared out-of-process

Severity: Medium  
Confidence: High  
Status: Documented operational risk, not a new correctness bug.

Evidence:

- Restore holds durable/process-local maintenance and drains queues before import at `apps/web/src/app/[locale]/admin/db-actions.ts:545-646`.
- It clears maintenance and resumes queues only through the live process finalizer at `apps/web/src/app/[locale]/admin/db-actions.ts:650-695`.
- Queue pause/resume state is process-local at `apps/web/src/lib/image-queue.ts:1285-1338`.
- Recovery script clears only the durable marker (operator-controlled) in `apps/web/scripts/restore-maintenance-recovery.mjs:55-85`.
- Startup syncs durable marker into process state at `apps/web/src/instrumentation.ts:1-10`.

Failure scenario:

A restore fails, an operator clears the durable marker from a sidecar shell, and does not restart the web process. Durable state looks clear from the file, but the running process can still hold process-local maintenance/queue state until restart.

Suggested fix:

Make recovery output and admin health/status show both durable marker state and live process queue/maintenance state. Keep automatic restart out of the recovery script unless explicitly authorized by an operator.

## Causal Traces And Hypotheses

### Multipart admission trace

Hypothesis A: app-level locks prevent expensive rejected uploads.  
Evidence against: browser upload and restore are Server Actions, so the framework has already parsed a large `FormData` before `uploadImages()` or `restoreDatabase()` code reaches locks (`images.ts:87-106`, `db-actions.ts:421-427`).  
Conclusion: locks protect DB/filesystem state after parser admission; they do not provide memory backpressure.

Hypothesis B: client sequential upload makes this safe.  
Evidence for: `upload-dropzone.tsx:289-297` serializes one tab's files.  
Evidence against: cross-tab, multi-admin, retry, and restore submissions can still overlap, and restore is not serialized by that UI.  
Conclusion: client serialization lowers likelihood, not impact.

### Background resource trace

Hypothesis A: pool-aware caps prevent starvation.  
Evidence for: image queue and backfill each reserve roughly half the pool (`image-queue.ts:121-153`, `admin-backfill-runner.ts:97-143`).  
Evidence against: the caps are independent and can overlap while analytics and CLIP use separate queues.  
Conclusion: each subsystem is locally bounded; the process lacks a composed background budget.

### Semantic search trace

Hypothesis A: model-version index makes semantic search scalable.  
Evidence for: `idx_image_embeddings_model_version_updated` serves the current query order (`schema.ts:323-326`).  
Evidence against: the request still reads/decodes/scores every row in the recency window (`semantic/route.ts:270-311`, `similar/route.ts:181-214`).  
Conclusion: the index bounds the scan, but it is not a nearest-neighbor strategy and it creates recency-biased recall.

## Rechecked Non-Findings

- Queue lock cleanup: image-processing advisory locks use dedicated connections and release helpers that destroy on release failure (`apps/web/src/lib/image-queue.ts:684-710`, `1080-1085`). No new leaked-lock path met the reporting bar.
- Queue retry loops: claim retries, processing retries, permanent failure persistence, retry-map caps, and bootstrap continuation are present at `apps/web/src/lib/image-queue.ts:759-810`, `1011-1079`, `1148-1258`.
- Restore/import race: restore takes upload/backfill/semantic locks and runs the drain checklist before import at `apps/web/src/app/[locale]/admin/db-actions.ts:491-646`.
- Restore session replay: successful restore flushes pending session revocations before reopening maintenance at `apps/web/src/app/[locale]/admin/db-actions.ts:656-688`.
- Public load-more: action validates slugs/cursors, caps legacy offsets, and rate-limits before data access at `apps/web/src/app/actions/public.ts:132-245`.
- Timeline archive: year/month archive queries use capture-date ranges rather than month/day extraction at `apps/web/src/lib/data-timeline.ts:187-216`.
- Image serving: upload routes pass request abort signals, HEAD/304 avoid opening file streams, and ETag hash computation is micro-cached at `apps/web/src/app/uploads/[...path]/route.ts:7-25`, `apps/web/src/lib/serve-upload.ts:162-360`.
- Config freshness: request paths use React cache, while detached background jobs have a TTL micro-cache plus explicit invalidation at `apps/web/src/lib/gallery-config.ts:178-249`.
- Single-writer topology: unsupported multi-instance operation is warned by a dedicated advisory-lock guard at `apps/web/src/lib/single-writer-guard.ts:6-47`, `218-235`; it is warning-only by design.
- Deploy prune safety: deploy health-checks before Docker prune and uses bind-mounted persistent data, not `volume prune -a`, at `apps/web/deploy.sh:73-104`.

## Final Missed-Issue Sweep

Final sweep covered upload/browser+PAT ingestion, DB restore lifecycle, image queue/backfill, CLIP production/stub gates, semantic/similar APIs, public keyword search, map SSR/hydration, timeline/listing paths, analytics/event retention, service-worker caches, upload serving, settings/config caches, nginx/deploy topology, migration/reconcile contracts, and shutdown/restore drains.

No Critical issue was confirmed. The two highest-risk findings are large Server Action multipart pre-admission and split background DB/CPU budgeting. The remaining issues are bounded scale risks or operational validation gaps: map hydration, brute-force semantic scans, leading-wildcard search, non-sargable on-this-day, in-memory CSV export, service-worker HTML eviction, host nginx drift, and out-of-process restore recovery.

Validation not run: no browser trace, production `EXPLAIN`, load test, MySQL fixture, lint/typecheck/test/e2e, deploy, container, or live-host nginx check. Evidence is static source inspection with exact file/line citations plus prior review-history reconciliation.
