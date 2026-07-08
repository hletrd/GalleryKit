# Cycle 37 Performance Review

Role: perf-reviewer
Date: 2026-07-08
Scope: /Users/hletrd/flash-shared/gallery

## Guidance Read

- `AGENTS.md` project rules and OMX/user rules from the prompt.
- `CLAUDE.md` full project knowledge base, including queue/backfill DB-pool warnings, deploy constraints, PWA cache behavior, semantic-search activation notes, and operational runbooks.
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`; applied in a performance/concurrency review stance.

No product code was edited. This review adds only this markdown artifact.

## Inventory Built Before Review

Repository inventory:

- `git ls-files`: 3626 tracked files.
- `apps/web/src` TS/TSX inventory: 582 files.
- Focused file inventory was built with `rg --files apps/web/src apps/web/scripts apps/web/drizzle apps/web/public apps/web/e2e`, plus targeted symbol sweeps for `PQueue`, `Promise.all`, `sharp`, `cache`, `revalidate`, `globalThis`, `GET_LOCK`, `formData`, `latitude`, `longitude`, `MAP_MAX_MARKERS`, service-worker cache APIs, and restore/drain/concurrency terms.

Review-relevant files examined:

- Project guidance and history: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, `.context/reviews/perf-reviewer.md`, `.context/reviews/perf-debugger-tracer.md`, `.context/reviews/cycle32-code-perf-security.md`, selected recent cycle directories.
- DB/schema/query layer: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/drizzle/meta/_journal.json`, representative migrations.
- Image processing and background work: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/backfill-alt-text.ts`, `apps/web/src/instrumentation.ts`.
- Upload/restore/concurrency fences: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/collections.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-sweeps.ts`.
- Public routes and UI responsiveness: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/components/map/map-loader.tsx`, `apps/web/src/components/map/map-client.tsx`, `apps/web/src/components/gallery-grid.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/search.tsx`, admin settings/upload/dashboard components.
- Search and semantic CPU paths: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/semantic-search.ts`, `apps/web/src/lib/clip-embeddings.ts`.
- Cache invalidation/PWA/service worker: `apps/web/src/lib/revalidation.ts`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/next.config.ts`, feed/OG/sitemap routes, `apps/web/src/components/pwa-register.tsx`.
- Tests and source-contract coverage relevant to reviewed areas: image queue/backfill/delete race tests, service-worker tests, restore-drain tests, map thumb wiring tests, touch-target audit, privacy field tests, action-origin/public-route-rate-limit lint scripts.

## Findings

### PERF37-01: Upload queue and in-app backfill can exceed the shared DB/CPU budget when both run

Severity: High
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/src/lib/image-queue.ts:121-134` computes the upload queue cap from the DB pool, but only for queue workers.
- `apps/web/src/lib/admin-backfill-runner.ts:23-44` documents that the in-app backfill is invisible to the existing upload `PQueue`.
- `apps/web/src/lib/admin-backfill-runner.ts:130-142` computes a separate backfill cap from the same DB pool.
- `apps/web/src/lib/admin-backfill-runner.ts:722-733` applies the backfill cap independently.
- `apps/web/src/lib/image-queue.ts:883-898` and `apps/web/src/lib/admin-backfill-runner.ts:556-571` both call `processImageFormats`.
- `apps/web/src/lib/process-image.ts:1411-1418` runs WebP, AVIF, and JPEG generation concurrently for each image with `Promise.allSettled`.

Concrete scenario:

On the default 10-connection pool, the queue cap can admit 2 upload workers while the in-app backfill cap can also admit 2 re-encode workers. Each subsystem reserves live traffic independently, so a combined run can approach the pool budget the comments were meant to preserve. The backfill also pins its full-run advisory-lock connection. At the same time, each image worker fans out to three Sharp/libvips encoder pipelines. A burst of uploads while an admin starts "Re-encode existing photos" can therefore create four DB-writing image jobs and up to twelve active encoder pipelines, increasing DB wait time, CPU saturation, and RSS exactly when public pages still need `Promise.all` query fan-out.

Suggested fix:

Introduce a single process-wide background resource budget used by both the live image queue and the in-app backfill. It should account for DB claim/update slots and encode CPU slots, not just per-subsystem `PQueue` concurrency. A simpler fix is to make the in-app backfill pause or serialize behind the live upload queue, with admin status showing "waiting for upload processing"; the stronger fix is a shared weighted semaphore where an image encode consumes one background DB unit plus one encode unit regardless of caller.

### PERF37-02: Lightroom upload holds the foreground admin mutation barrier while parsing multipart body

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/src/app/api/admin/lr/upload/route.ts:85-105` acquires `acquireAdminMutationSlot()` immediately after auth/IP setup.
- `apps/web/src/app/api/admin/lr/upload/route.ts:165-201` then enters the Lightroom multipart parse gate and awaits `request.formData()` while that mutation slot is still held.
- `apps/web/src/lib/admin-mutation-barrier.ts:94-117` gives restore drains a 30-second default budget before returning false.
- `apps/web/src/app/[locale]/admin/db-actions.ts:625-669` aborts restore when the `admin-mutations` drain stage does not settle.

Concrete scenario:

A slow client starts a 200 MiB Lightroom/PAT upload. The route passes auth and content-length checks, acquires the foreground mutation slot, then spends more than 30 seconds in multipart parsing before any DB row insert or upload-processing contract lock. If the admin starts a DB restore during that parse, the restore marker/exclusive side blocks new entrants but the drain sees this upload as an in-flight mutation and aborts after the 30-second budget, even though the request has not begun the write window the barrier is meant to protect.

Suggested fix:

Move `acquireAdminMutationSlot()` to just before the first DB/storage mutation that must be fenced, after content-length checks, rate-limit/tracker checks, `request.formData()`, file validation, and pure filename/topic validation. Re-check `isRestoreMaintenanceActive()` after acquiring the slot so a restore that started during parsing still refuses the upload before mutation. Keep the upload-processing-contract lock around the row insert/enqueue/revalidation window.

### PERF37-03: Public map renders up to 10,000 Leaflet markers and a 10,000-item list in one client pass

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- `apps/web/src/lib/data.ts:1766-1775` sets `MAP_MAX_MARKERS = 10000` and notes that larger galleries need viewport filtering or clustering.
- `apps/web/src/lib/data.ts:1784-1816` returns up to `MAP_MAX_MARKERS` map rows to the public page.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-67` maps every returned row into client marker props.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:90-111` passes all markers into `MapLoader` and also renders all markers into the fallback/list UI.
- `apps/web/src/components/map/map-client.tsx:78-95` allocates latitude/longitude arrays and uses spread `Math.min(...lats)` / `Math.max(...lngs)` across every marker.
- `apps/web/src/components/map/map-client.tsx:109-143` renders every marker as a React Leaflet `<Marker>` and `<Popup>` in one mount.

Concrete scenario:

A gallery with 8,000 to 10,000 GPS-visible photos opens `/map` on a mid-range phone. The server serializes the full marker payload, React builds a 10,000-item list, `FitBounds` allocates two additional 10,000-entry arrays, and Leaflet mounts 10,000 marker/popup trees in one route chunk. The route can produce a long main-thread task, high memory pressure, and delayed input response before the user can pan, zoom, or open a photo. The current cap protects backend unbounded result size, but it does not keep the browser workload interactive.

Suggested fix:

Reduce the initial client-rendered marker count to an interactive budget, then add clustering or viewport/bbox paging. A cluster solution such as `supercluster` or a Leaflet marker-cluster layer would keep total dataset support without mounting every marker. Independently, compute map bounds in a single loop without allocating lat/lng arrays or spreading large arrays.

### PERF37-04: Public map query has GPS predicates without a map-specific index

Severity: Medium
Confidence: Medium
Status: Likely risk, needs `EXPLAIN ANALYZE` on production-sized data

Evidence:

- `apps/web/src/app/[locale]/(public)/map/page.tsx:13-15` disables revalidation so every `/map` request needs fresh map data.
- `apps/web/src/lib/data.ts:1784-1802` filters `images.processed = true`, `topics.map_visible = true`, `images.latitude IS NOT NULL`, and `images.longitude IS NOT NULL`, then orders by capture/created/id and limits to 10,001 rows.
- `apps/web/src/db/schema.ts:49-50` stores latitude/longitude, but `apps/web/src/db/schema.ts:123-132` defines image indexes only for processed/capture, processed/created, processed/updated, processed/pipeline, topic/processed/capture, topic/processed/updated, user filename, and uploaded_by.
- `apps/web/src/db/schema.ts:10-18` stores `topics.map_visible` without an index. The topics table may be small, but the map-visible filter is still part of the joined eligibility predicate.

Concrete scenario:

On a large gallery where most processed images have no public GPS coordinates, MySQL can use an existing processed/order index but still examine many processed rows, join topics, and reject rows on `latitude IS NOT NULL`, `longitude IS NOT NULL`, or `map_visible = true` until it fills the 10,001-row cap or reaches the end. Since `/map` is fresh on every request, repeated map visits can pay this scan repeatedly. The exact cost depends on production cardinality and the optimizer plan, so this is a likely risk rather than a confirmed production regression.

Suggested fix:

Run `EXPLAIN ANALYZE` against production-like row counts. If the scan is material, add a map-specific access path: a generated/materialized "map eligible" flag, a denormalized marker table maintained on image/topic updates, or a composite index that supports the real predicate and sort shape. If the longer-term UI fix adds bbox paging, align the DB shape around viewport queries rather than only the current global newest-first list.

## Final Missed-Issues Sweep

I re-swept the repository after drafting findings for:

- Background concurrency: `PQueue`, `Promise.all`, `Promise.allSettled`, `GET_LOCK`, `drain`, `quiesce`, `globalThis`, `setInterval`.
- Image-processing resources: `sharp`, `processImageFormats`, `MAX_INPUT_PIXELS`, encoder fan-out, sidecar backfills.
- DB/query/cache shape: `cache(`, `unstable_cache`, `revalidatePath`, `revalidateTag`, `revalidate = 0`, `Cache-Control`.
- UI/React responsiveness: map rendering, gallery/lightbox/search components, dynamic imports, large `.map(...)` render paths.
- Service worker behavior: `apps/web/public/sw.template.js` and generated `sw.js` cache versioning, stale-while-revalidate paths, LRU metadata, admin-route bypass, and dynamic HTML cache bypass comments.
- Race/shared-state hazards: restore drains, foreground mutation barrier, upload-processing contract lock, queue/bootstrap globals, background DB write drain, maintenance sweeps.

No additional high-confidence performance or concurrency findings were found beyond the four above. Areas not proven by this static review: production `EXPLAIN ANALYZE`, browser performance traces for `/map` at 10k markers, live memory profiling under concurrent backfill/upload, and service-worker behavior under real browser quota pressure.
