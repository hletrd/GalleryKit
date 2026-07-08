# Cycle 35 Performance Review

Role: `perf-reviewer`
Scope: entire repository, static review only, no product-code edits.
Validation evidence: read `AGENTS.md` and `CLAUDE.md`; inventoried and inspected performance-relevant app, DB, image, worker, cache, service-worker, route, and UI files; used existing local build diagnostics in `.next/diagnostics/route-bundle-stats.json`.

## Inventory / Scope Reviewed

Repository guidance:

- `AGENTS.md`
- `CLAUDE.md`

Runtime, deploy, and process surfaces:

- `apps/web/package.json`
- `package.json`
- `apps/web/next.config.ts`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `apps/web/nginx/default.conf`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/lib/maintenance-scheduler.ts`
- `apps/web/src/lib/single-writer-guard.ts`

Database, schema, query, cache, and rate-limit surfaces:

- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/analytics-data.ts`
- `apps/web/src/lib/smart-collections.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/background-db-writes.ts`
- `apps/web/src/lib/view-retention.ts`
- `apps/web/src/lib/pending-file-deletions.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`

Upload, image-processing, queue, backfill, and ML surfaces:

- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`

Public routes, browser responsiveness, and service worker:

- `apps/web/public/sw.template.js`
- `apps/web/src/lib/sw-cache.ts`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/masonry-card.tsx`
- `apps/web/src/components/grid-picture.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/similar-photos.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/color-details-section.tsx`
- `apps/web/src/components/map/map-client.tsx`
- `apps/web/src/components/map/map-loader.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/search.tsx`

Review-relevant tests and diagnostics considered:

- `apps/web/src/__tests__/image-queue-concurrency-cap.test.ts`
- `apps/web/src/__tests__/admin-backfill-concurrency-cap.test.ts`
- `apps/web/src/__tests__/background-db-writes.test.ts`
- `apps/web/src/__tests__/sw-cache.test.ts`
- `apps/web/src/__tests__/sw-template-contract.test.ts`
- `apps/web/src/__tests__/data-timeline.test.ts`
- `apps/web/src/__tests__/semantic-scan-limit-source.test.ts`
- `apps/web/src/__tests__/touch-target-audit.test.ts`
- `apps/web/.next/diagnostics/route-bundle-stats.json`

Skipped:

- `node_modules/`, binary upload data, and generated `.next/` build output except the route bundle diagnostics file listed above.
- Historical review/plan markdown was not re-reviewed as implementation surface, except this report target.

## Findings

### PERF-C35-01: Image queue and in-app backfill reserve the same DB pool headroom independently

Severity: High
Confidence: High
Classification: Confirmed

Code region:

- `apps/web/src/db/index.ts:31-42` fixes the web-process MySQL pool at `connectionLimit: 10` with `queueLimit: 20`.
- `apps/web/src/db/index.ts:127-143` wraps `query` and `execute` by acquiring real pool connections, so every transient DB operation competes with advisory-lock holders.
- `apps/web/src/lib/image-queue.ts:121-153` calculates image-queue concurrency against the full pool and reserves half the pool for live traffic locally.
- `apps/web/src/lib/image-queue.ts:683-700` acquires one pooled advisory-lock connection per image claim.
- `apps/web/src/lib/image-queue.ts:761-918` holds that image claim while doing row checks, Sharp processing, file verification, and the final DB update.
- `apps/web/src/lib/admin-backfill-runner.ts:97-143` separately calculates admin-backfill concurrency against the same full pool and separately reserves half for live traffic.
- `apps/web/src/lib/admin-backfill-runner.ts:330-358` pins a whole-run advisory-lock connection.
- `apps/web/src/lib/admin-backfill-runner.ts:369-397` acquires one pooled advisory-lock connection per backfilled image.
- `apps/web/src/lib/admin-backfill-runner.ts:526-622` holds the per-image claim through re-encode, detection, and DB persistence.

Concrete failure scenario:

With the shipped 10-connection pool, `QUEUE_CONCURRENCY=2` can consume two long-lived claim connections plus transient DB connections, while an in-app color backfill can consume one run lock plus two per-image claim connections plus transient update connections. The two modules each believe they preserved live headroom, but together they can leave only one or two connections for foreground traffic. A public photo request then runs multiple DB reads in parallel (`apps/web/src/lib/data.ts:1152-1198`), and a gallery page runs rows plus count concurrently (`apps/web/src/lib/data.ts:937-940`), so foreground requests queue behind background work and can hit the pool queue limit or timeout under normal traffic.

Suggested fix:

Replace per-subsystem pool arithmetic with a shared web-process background DB budget. Image queue, in-app backfill, analytics flushes, maintenance jobs, and embedding jobs should acquire shared DB tokens before starting work that can hold advisory locks or perform transient queries. The budget should model long-lived lock connections separately from transient query connections, pause or downshift the image queue while an in-app backfill is running, and expose current token usage in logs/metrics.

### PERF-C35-02: The color-pipeline sidecar bypasses live DB and CPU admission controls

Severity: Medium
Confidence: High
Classification: Confirmed

Code region:

- `apps/web/scripts/backfill-color-pipeline.ts:416-420` accepts `BACKFILL_CONCURRENCY` directly with fallback `2` and maximum `8`, creating a `PQueue` without the live pool-budget clamp used by the in-app runner.
- `apps/web/scripts/backfill-color-pipeline.ts:557-623` runs concurrent tasks that acquire per-image processing claims, reprocess rows, and flush DB updates while the claim is held.
- `apps/web/src/lib/process-image.ts:36-57` sets process-global Sharp concurrency and disables cache for steady RSS, but this only applies inside each Node process; a sidecar process has its own libvips workers and its own DB pool.
- `apps/web/src/lib/process-image.ts:1087-1123` can create wide-gamut TIFF intermediates before derivative generation.
- `apps/web/src/lib/process-image.ts:1205-1418` generates WebP, AVIF, and JPEG variants in parallel per image.

Concrete failure scenario:

An operator runs the sidecar with `BACKFILL_CONCURRENCY=8` while the web process is serving uploads or processing its live queue. The sidecar is a separate Node process with its own MySQL pool and its own libvips worker allocation, so it can add up to eight image-processing lanes and extra DB sessions on top of the live web process. The result is server-level MySQL connection/IO pressure, CPU saturation from parallel AVIF/WebP/JPEG encodes, and temporary-file disk pressure from wide-gamut intermediates, even though the in-app runner would have clamped itself to the live pool budget.

Suggested fix:

Give the sidecar the same admission model as the in-app runner: default to concurrency `1` when live traffic may be present, clamp against an explicit DB/CPU budget, and log the effective resource budget at startup. Add an operator mode such as `LIVE_TRAFFIC_SAFE=1` that acquires a global maintenance/admission lock honored by the live image queue, or document and enforce that high-concurrency sidecar runs require pausing live queue processing.

### PERF-C35-03: Cached image responses still wait on a synchronous HEAD probe per tile

Severity: Medium
Confidence: High
Classification: Likely

Code region:

- `apps/web/public/sw.template.js:31-39` defines a 300 ms synchronous HEAD revalidation timeout for cached images.
- `apps/web/public/sw.template.js:312-348` starts image stale-while-revalidate handling and lazily creates the GET revalidation only when needed.
- `apps/web/public/sw.template.js:350-383` documents that the HEAD probe is on the display path for cached images.
- `apps/web/public/sw.template.js:384-430` awaits a `HEAD` request with `If-None-Match` before returning a cached response when an ETag exists.
- `apps/web/public/sw.template.js:431-438` only serves the cached response immediately after the HEAD path is skipped, fails, or completes.

Concrete failure scenario:

A returning visitor opens a warm gallery page with 30 cached masonry derivatives. Each cached tile with an ETag waits on its own HEAD request before the service worker returns cached bytes, with a worst-case 300 ms cap per request and a burst of extra server requests. On mobile or high-latency networks, the browser can have image paints and LCP-adjacent content delayed even though all image bodies are already cached. On the server side, one gallery paint can fan out into dozens of validation requests before any background GET revalidation is needed.

Suggested fix:

Move most freshness checks off the display path. Serve cached images immediately when their SW metadata is younger than a short freshness window, then run validation in `event.waitUntil`. Keep synchronous HEAD only for entries known to be stale, for a single page-level color-pipeline/settings version mismatch, or behind a small per-service-worker concurrency limiter. A route-level derivative-version manifest would avoid per-tile HEAD probes after admin color-setting changes.

### PERF-C35-04: Photo and share viewer routes ship heavyweight optional panels in the initial client bundle

Severity: Medium
Confidence: Medium
Classification: Likely

Code region:

- `apps/web/src/components/photo-viewer.tsx:15-29` statically imports `framer-motion`, `Lightbox`, `InfoBottomSheet`, `Histogram`, `ColorDetailsSection`, `WideGamutHint`, and `SimilarPhotos`.
- `apps/web/src/components/photo-viewer.tsx:521-561` correctly prioritizes the primary photo image, but the same client component owns optional viewer UI.
- `apps/web/src/components/photo-viewer.tsx:807-810` renders color details, wide-gamut UI, and similar photos inside the metadata panel.
- `apps/web/src/components/photo-viewer.tsx:944-956` renders the histogram panel.
- `apps/web/src/components/photo-viewer.tsx:1027-1055` conditionally renders lightbox and bottom-sheet UI that is still statically imported.
- `apps/web/.next/diagnostics/route-bundle-stats.json:3-30` reports `/[locale]/p/[id]` at `1,105,534` first-load uncompressed JS bytes.
- `apps/web/.next/diagnostics/route-bundle-stats.json:34-60` and `apps/web/.next/diagnostics/route-bundle-stats.json:64-90` report share routes just above `1,102,000` first-load uncompressed JS bytes.

Concrete failure scenario:

A mobile visitor opens a single shared photo. The main image is marked eager/high-priority, but hydration also has to parse and execute the viewer shell plus optional lightbox, histogram, color-detail, similar-photo, animation, and bottom-sheet modules before those controls are used. The existing build diagnostics show the photo/share routes are about 1.1 MB uncompressed on first load. On lower-end phones, this increases main-thread parse/compile time and raises INP risk when the user immediately taps navigation, share, info, or lightbox controls.

Suggested fix:

Split the viewer into a small initial shell and on-demand panels. Dynamically import the lightbox when first opened, the bottom sheet only on mobile info-open, histogram/color-details when the metadata panel is expanded or intersects, and similar photos only when `semanticSearchMode === 'production'` and the section is opened. Keep the primary `<picture>`, navigation, and share affordance in the initial bundle; measure route diagnostics again after the split.

## Final Sweep

Race conditions and shared-state hazards:

- Advisory-lock release paths now use guarded helpers that destroy bad lock connections rather than returning lock-holding sessions to the pool (`apps/web/src/lib/image-queue.ts:702-710`, `apps/web/src/lib/admin-backfill-runner.ts:351-358`).
- The main remaining race/performance hazard is resource-level, not file-corruption correctness: independent background consumers share the same DB pool and CPU budget without a global governor (PERF-C35-01 and PERF-C35-02).

DB query and pool pressure:

- Public list/detail queries are generally bounded and indexed, with explicit privacy guards and split count/data reads.
- Foreground query fan-out is intentional in `getImagesLitePage` and detail fetches, but it makes pool headroom important during background processing.
- No new N+1 issue was confirmed in the reviewed public list/detail paths.

Image pipeline CPU/memory:

- Positive controls observed: Sharp cache is disabled, per-process Sharp concurrency is reduced for three-format fan-out, source pixel limits exist, wide-gamut sources can be downscaled before expensive processing, and derivative writes are mostly atomic (`apps/web/src/lib/process-image.ts:36-57`, `apps/web/src/lib/process-image.ts:1087-1123`, `apps/web/src/lib/process-image.ts:1205-1418`).
- The remaining risk is admission across processes and subsystems rather than one missing per-image limit.

Caching and service worker:

- HTML offline caching avoids revocable routes, and image cache metadata has bounded LRU behavior.
- The synchronous cached-image HEAD probe is still on the paint path and is the main service-worker performance concern found.

Browser responsiveness, LCP, CLS, and INP:

- Masonry cards reserve aspect ratio and intrinsic size, which reduces CLS risk in the gallery grid.
- The photo viewer prioritizes the primary image, which helps LCP for photo pages.
- Initial JS size and optional panel bundling remain the main INP/main-thread concern for photo and share viewer routes.

Tests:

- No tests or builds were run because this was a review-only subagent task with an explicit no-product-code-edit constraint. Findings are based on static inspection plus existing local route bundle diagnostics.
