# Cycle 36 Performance Review

Role: `cycle-36 perf-reviewer`
Scope: whole repository static review from performance, concurrency, CPU, memory, and UI responsiveness angles.
Constraint: review-only. No production code was changed.
Date: 2026-07-08 KST

## Inventory First

Guidance read:

- `AGENTS.md`
- `CLAUDE.md`

Repo and dependency inventory:

- Root scripts and package surface: `package.json`, `apps/web/package.json`
- Current app stack: Next.js 16.2.10, React 19.2.5, TypeScript 6, Sharp 0.34.5, mysql2 3.22.0, p-queue 9.1.2, Transformers.js 3.8.1
- Source inventory: 582 TypeScript/TSX files under `apps/web/src`; 41 script/e2e files under `apps/web/scripts` and `apps/web/e2e`
- Prior review history and project notes under `.context/`

Performance-relevant files inspected:

- Runtime/process: `apps/web/src/instrumentation.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/lib/single-writer-guard.ts`
- DB/query/cache/rate-limit: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/view-retention.ts`, `apps/web/src/lib/audit.ts`
- Image CPU/memory pipeline: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`
- Semantic/ML paths: `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`
- Public UI hot paths: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/masonry-card.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/components/map/map-client.tsx`
- Admin/upload paths: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`, `apps/web/src/components/image-manager.tsx`

Cross-file interactions inspected:

- Upload/action enqueue -> `image-queue.ts` -> `process-image.ts` -> DB update/embedding side effects.
- In-app color backfill -> advisory locks -> `processImageFormats()` -> DB updates.
- Public gallery/photo routes -> `data.ts` query fan-out -> client hydration and image preloading.
- Map page -> `getMapImages()` payload cap -> server-rendered list -> Leaflet marker hydration.
- Semantic routes -> CLIP inference queue -> DB blob scan -> JS vector scoring -> metadata enrichment.
- Background maintenance/audit/analytics queues -> shared MySQL pool.

## Findings

### PERF-C36-01 - Independent image/backfill budgets can saturate the shared DB pool and CPU

Severity: High
Confidence: High
Classification: confirmed

Exact file:line/region:

- `apps/web/src/db/index.ts:31-41` fixes the web-process pool at 10 connections with `queueLimit: 20`.
- `apps/web/src/db/index.ts:127-143` wraps `query` and `execute` by acquiring real pooled connections, so transient DB work competes with advisory-lock holders.
- `apps/web/src/lib/image-queue.ts:121-141` computes image queue concurrency against the full pool and reserves live connections locally.
- `apps/web/src/lib/image-queue.ts:456` creates the queue with that local concurrency.
- `apps/web/src/lib/image-queue.ts:683-700` acquires one pooled advisory-lock connection per image.
- `apps/web/src/lib/image-queue.ts:761-918` holds the image claim while checking the row, running Sharp, verifying files, and updating DB state.
- `apps/web/src/lib/admin-backfill-runner.ts:97-143` computes a separate local backfill concurrency against the same full pool.
- `apps/web/src/lib/admin-backfill-runner.ts:330-358` pins a whole-run backfill advisory-lock connection.
- `apps/web/src/lib/admin-backfill-runner.ts:369-397` acquires one pooled advisory-lock connection per backfilled image.
- `apps/web/src/lib/admin-backfill-runner.ts:526-677` holds the per-image claim across re-encode, color detection, and persistence.
- `apps/web/src/lib/process-image.ts:36-57` sets per-process Sharp concurrency, and `apps/web/src/lib/process-image.ts:1411-1418` runs WebP, AVIF, and JPEG generation in parallel per image.

Failure scenario:

On the default 10-connection pool, an operator raises both `QUEUE_CONCURRENCY` and `ADMIN_BACKFILL_CONCURRENCY` to their effective cap of 2. The live queue can hold two long-lived per-image lock connections while also doing transient DB work. The admin backfill can hold one global lock plus two per-image lock connections while also doing transient DB work. Both modules believe they reserved roughly half the pool for live traffic, but the reservations are independent, so together they can pin most of the pool. At the same time both paths run CPU-heavy Sharp pipelines with three format encoders per image. Foreground routes that fan out DB reads, such as photo detail and gallery rows/count queries, can queue behind background work and hit the pool queue limit.

Suggested fix:

Replace per-subsystem arithmetic with a shared background resource coordinator for the web process. Image queue, in-app backfill, semantic embedding bootstrap/action, analytics drains, and maintenance sweeps should lease from one DB-bearing background budget before starting work that can hold advisory locks or perform transient queries. Model long-lived lock connections separately from short DB operations, and pause or downshift live queue work while an in-app backfill is running. Add a small-pool regression test proving aggregate background leases cannot exceed the foreground reserve.

### PERF-C36-02 - `/map` can hydrate thousands of Leaflet markers and list items in one uncached page

Severity: Medium
Confidence: High
Classification: likely

Exact file:line/region:

- `apps/web/src/lib/data.ts:1766-1775` documents that the map has a hard cap but sets `MAP_MAX_MARKERS = 10000`.
- `apps/web/src/lib/data.ts:1784-1802` queries all map-visible GPS rows up to `MAP_MAX_MARKERS + 1`.
- `apps/web/src/lib/data.ts:1813-1816` returns up to 10,000 image rows to the route.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14` disables revalidation for the map page.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-67` maps every returned row into the client marker payload.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:90-97` passes the full marker array into `MapLoader`.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:99-111` server-renders a full `<ul>` entry for every marker.
- `apps/web/src/components/map/map-client.tsx:78-95` computes bounds by allocating latitude and longitude arrays over every marker.
- `apps/web/src/components/map/map-client.tsx:121-142` renders one Leaflet `<Marker>` and `<Popup>` per marker.

Failure scenario:

A gallery grows to 5,000-10,000 map-visible photos. Every `/map` request queries and serializes thousands of rows because the route is uncached. The server builds a large RSC/HTML payload and a full accessible list; the browser then hydrates thousands of links and Leaflet marker objects, computes bounds over all markers, and keeps the marker set resident in memory. Map pan/zoom and initial input responsiveness degrade, especially on mobile devices, even though the code technically respects the 10k cap.

Suggested fix:

Change the map architecture from "load all markers" to a viewport-bounded or clustered model. A practical path is a public bbox endpoint that returns clusters or markers for the current map bounds, plus a virtualized or paginated accessible list. If the all-marker model must stay for now, lower the initial cap substantially and defer the list or marker layer until after the first map paint. Add a source or e2e performance contract around the maximum markers rendered on initial load.

### PERF-C36-03 - Semantic search does request-path brute-force vector scans in the Node process

Severity: Medium
Confidence: High
Classification: risk

Exact file:line/region:

- `apps/web/src/app/api/search/semantic/route.ts:1-10` documents that each semantic search embeds the query and scans up to `SEMANTIC_SCAN_LIMIT` embeddings.
- `apps/web/src/app/api/search/semantic/route.ts:250-260` performs real CLIP text embedding on the request path in production mode.
- `apps/web/src/app/api/search/semantic/route.ts:263-280` reads up to `SEMANTIC_SCAN_LIMIT` embedding blobs from MySQL.
- `apps/web/src/app/api/search/semantic/route.ts:292-311` decodes/scores every scanned embedding in JS before selecting top K.
- `apps/web/src/app/api/search/similar/[id]/route.ts:177-190` repeats the same capped embedding scan for similar photos.
- `apps/web/src/app/api/search/similar/[id]/route.ts:204-214` scores the scanned rows in JS.
- `apps/web/src/lib/clip-model.ts:53-64` bounds CLIP inference with an in-process queue, not a durable or cross-process budget.
- `apps/web/src/lib/clip-model.ts:156-173` admits inference work through that process-local queue.

Failure scenario:

Production semantic search is enabled on a larger gallery and several visitors use semantic search or open similar-photo panels. Each accepted request performs CLIP inference or target embedding reads, scans a recent slice of embedding blobs, decodes vectors, and runs dot products in the web process. The cap prevents unbounded scans, but the work still consumes Node CPU and DB connections on latency-sensitive request paths. Because the route orders by `updatedAt` and scans only the recent cap, relevance also degrades for older images once the embedding table is larger than the scan limit.

Suggested fix:

Treat the current implementation as a small-gallery fallback and add an explicit scale boundary. Move similarity lookup to a vector index, ANN service, or DB-side vector feature when the gallery exceeds the scan limit. If staying in-process, put scoring in a worker thread or background service, expose scan/latency telemetry, and use a shared semantic budget so public searches cannot compete unchecked with embedding backfill and image processing. Consider precomputed nearest-neighbor rows for the similar-photo panel.

## Positive Controls / Non-Findings

- Public gallery listing and photo detail queries are bounded and generally batch tag lookups instead of doing visible N+1 work.
- Masonry cards preserve aspect ratio and memoize the card component, reducing CLS and unnecessary rerenders.
- The home grid uses a capped initial page size and an intersection-observer load-more path rather than rendering the entire gallery.
- The photo viewer preloads adjacent photos only after the current image is settled, and similar-photo fetches are gated on panel visibility/semantic mode.
- Sharp cache is disabled for steady RSS, source pixel limits exist, and format generation uses atomic final-path writes.
- Maintenance, audit retention, analytics writes, and view-count flushers all have local batching/backpressure controls; the remaining issue is the absence of a shared budget across those local controls.

## Final Missed-Issue Sweep

Sweep methods:

- Re-read `CLAUDE.md` sections on runtime topology, DB pool policy, image processing, semantic search, deploy, and known concurrency caveats.
- Ran a repo-wide search for `TODO`, `FIXME`, `PERF`, `performance`, `concurrency`, `queue`, `cache`, `SEMANTIC_SCAN_LIMIT`, `MAP_MAX_MARKERS`, `publicSelectFields`, and `timelineSelectFields` across `apps/web/src` and `apps/web/scripts`.
- Re-checked the highest-risk cross-file paths: upload queue/backfill/process-image, semantic request/backfill/CLIP model, map server/client payload, public data selectors, background DB writers, and maintenance scheduler.

Missed-issue conclusion:

- No additional confirmed unbounded public list query was found beyond the known `/map` high-cap path.
- No new image file write race was confirmed in the reviewed live queue and in-app backfill paths; advisory locks cover per-image encode/persist windows.
- No new route-level missing rate-limit finding was confirmed from static inspection; public semantic/similar paths have explicit pre-increment rate limiting and syntactic guards.
- The strongest unresolved performance risk remains aggregate admission control across background DB/CPU consumers rather than a single missing local cap.

## Skipped-File Accounting

Reviewed by inventory, not line-by-line:

- Most unit/e2e tests under `apps/web/src/__tests__` and `apps/web/e2e`; I sampled tests relevant to queue, backfill, semantic scan caps, map thumbnails, service worker cache, and privacy guards by search result.
- Historical `.context/reviews/` and `.context/plans/`; I used them as provenance inventory, not as active implementation source.
- Migrations and generated Drizzle metadata; inspected only for architecture context because no schema change was requested.

Skipped intentionally:

- `node_modules/`, `.next/` build output, uploaded media, screenshots, Playwright artifacts, binary assets, and live production data.
- Live MySQL, host Nginx, Docker runtime, browser profiler traces, and real production traffic metrics. Those require environment inspection outside this static review lane.

Validation:

- Review artifact only. No tests/build were run because production code was not changed.
