# Cycle 68 Performance / Concurrency Review

Reviewer: performance/concurrency
Date: 2026-07-01
Scope: queue/backfill behavior, upload/data/API paths, image processing, semantic search, DB/index risk, service worker/cache freshness, deploy/runtime operations, and UI responsiveness.

## Findings

No new confirmed performance or concurrency findings.

Confidence: medium-high. I found no new race, unbounded queue, memory/CPU hotspot, cache freshness regression, deploy/runtime operational risk, or UI responsiveness issue that is not already tracked as deferred/carry-forward work.

## Inventory Reviewed

Required context was read first:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/cycle-67-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-67-2026-07-01/perf-concurrency.md`
- `.context/plans/cycle-67-2026-07-01-deferred.md`

Current source/test inventory covered:

- Foreground image queue and bootstrap: `apps/web/src/lib/image-queue.ts:76-1114`
- Admin/in-app backfill: `apps/web/src/lib/admin-backfill-runner.ts:96-831`
- Operator backfills: `apps/web/scripts/backfill-color-pipeline.ts:302-573`, `apps/web/scripts/backfill-clip-embeddings.ts:88-230`, `apps/web/scripts/backfill-alt-text.ts:34-124`
- Upload paths: `apps/web/src/app/actions/images.ts:128-904`, `apps/web/src/app/api/admin/lr/upload/route.ts:60-555`
- Image processing and cleanup: `apps/web/src/lib/process-image.ts:36-664`
- CLIP inference/search: `apps/web/src/lib/clip-model.ts:53-320`, `apps/web/src/lib/clip-embeddings.ts:36-207`, `apps/web/src/app/api/search/semantic/route.ts:107-367`, `apps/web/src/app/api/search/similar/[id]/route.ts:68-271`
- Data/API hot paths: `apps/web/src/lib/data.ts:13-854`, `apps/web/src/app/actions/public.ts:47-510`, `apps/web/src/lib/rate-limit.ts`
- Restore/maintenance/runtime: `apps/web/src/app/[locale]/admin/db-actions.ts:38-821`, `apps/web/src/instrumentation.ts:1-91`, `apps/web/src/lib/background-db-writes.ts:3-32`
- Service worker/cache freshness: `apps/web/public/sw.template.js:31-468`, `apps/web/src/lib/sw-cache.ts`, `apps/web/scripts/build-sw.ts:27-43`, `apps/web/src/lib/serve-upload.ts:45-329`
- Deploy/runtime config: `apps/web/deploy.sh:57-104`, `apps/web/docker-compose.yml:1-18`, `apps/web/nginx/default.conf:126-194`
- UI responsiveness surfaces: `apps/web/src/components/search.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/components/histogram.tsx`, `apps/web/public/histogram-worker.js`
- Relevant tests and source-lock tests under `apps/web/src/__tests__/`, including queue concurrency, service-worker cache, upload/source contracts, abort behavior, settings/backfill warning, privacy guards, and public-route rate limits.

## Evidence By Area

### Queue / Image Processing

- Foreground queue concurrency is explicitly clamped against the DB pool reserve instead of blindly honoring env values: `apps/web/src/lib/image-queue.ts:76-109`.
- The process-wide queue singleton validates global-state drift and constructs `PQueue` once: `apps/web/src/lib/image-queue.ts:293-344`.
- Each queued image job takes a per-image MySQL advisory lock, rechecks row state before work, conditionally updates only still-unprocessed rows, and cleans derivative outputs if the DB update lost the race: `apps/web/src/lib/image-queue.ts:470-852`.
- Bootstrap uses bounded batch size/keyset cursoring and skips permanent failures while scheduling missing active embeddings as a side effect: `apps/web/src/lib/image-queue.ts:901-1058`.
- Restore quiesce/resume drains queue work, side-effect work, and in-memory cursors before allowing restore to proceed: `apps/web/src/lib/image-queue.ts:1060-1114`.
- Sharp global concurrency/cache settings are capped and cache is disabled; input dimensions are bounded before full decode paths; output directory creation is memoized with failure reset: `apps/web/src/lib/process-image.ts:36-57`, `apps/web/src/lib/process-image.ts:352-456`.

### Backfill / Operator Scripts

- In-app admin backfill reserves live DB headroom and caps worker concurrency from the pool limit: `apps/web/src/lib/admin-backfill-runner.ts:96-142`.
- Admin backfill acquires one global advisory lock and per-image locks, uses keyset candidate paging, and releases the global lock in `finally`: `apps/web/src/lib/admin-backfill-runner.ts:316-345`, `apps/web/src/lib/admin-backfill-runner.ts:383-424`, `apps/web/src/lib/admin-backfill-runner.ts:647-831`.
- The color sidecar uses the same global advisory lock, explicit `BACKFILL_CONCURRENCY` cap, batched DB flushes, and derivative cleanup for rows deleted mid-reencode: `apps/web/scripts/backfill-color-pipeline.ts:302-394`, `apps/web/scripts/backfill-color-pipeline.ts:437-573`.
- The CLIP sidecar now logs when the scan limit is reached even when the final page is short, closing the Cycle 67 notice without adding new queue or memory risk: `apps/web/scripts/backfill-clip-embeddings.ts:147-230`.
- The alt-text backfill is manual-only, keyset-paged, and concurrency is fixed at 1: `apps/web/scripts/backfill-alt-text.ts:34-124`.

### Upload / API / DB Hot Paths

- Browser upload preclaims quota before async file work, holds the upload-processing contract lock around settings/insert/enqueue decisions, checks disk space before writing, and releases quota on per-file failures: `apps/web/src/app/actions/images.ts:128-646`.
- Delete paths clear queue state before deleting rows and cap concurrent filesystem cleanup work: `apps/web/src/app/actions/images.ts:648-904`.
- Lightroom upload has a process-local multipart parse slot of 1, rejects chunked/oversized uploads before parsing, preclaims storage, and rechecks restore maintenance before filesystem writes and DB insert: `apps/web/src/app/api/admin/lr/upload/route.ts:60-176`, `apps/web/src/app/api/admin/lr/upload/route.ts:252-555`.
- Public pagination/search APIs validate bounds and rate-limit before expensive work; search rollback paths release DB rate-limit increments on internal errors: `apps/web/src/app/actions/public.ts:47-318`.
- Shared group view counts are buffered with a hard cap, retry cap, chunked flushes, and shutdown/restore drain hooks: `apps/web/src/lib/data.ts:13-249`, `apps/web/src/instrumentation.ts:20-67`.
- The DB schema has supporting indexes for processed image lists and embedding scans, including `image_embeddings(modelVersion, updatedAt)`: `apps/web/src/db/schema.ts:76-230`.

### Semantic Search / CLIP

- Inference slots are globally capped with pending-queue and timeout bounds: `apps/web/src/lib/clip-model.ts:53-173`.
- Text/image embedding calls acquire the inference slot before model work and release it in `finally`: `apps/web/src/lib/clip-model.ts:240-320`.
- Semantic and similar APIs validate origin/body/rate limits before inference, cap query length and scan window, and use model-version filters before ranking: `apps/web/src/app/api/search/semantic/route.ts:107-367`, `apps/web/src/app/api/search/similar/[id]/route.ts:68-271`.
- Embedding decode/scan env parsing has a hard max of 25,000 rows and validates vector dimensions: `apps/web/src/lib/clip-embeddings.ts:36-153`.

### Cache Freshness / Service Worker

- Upload serving uses pipeline/settings-hash ETags, HEAD handling, and fd-backed streaming with abort cleanup: `apps/web/src/lib/serve-upload.ts:45-329`.
- Service worker derivative cache is capped at 50 MB, serializes metadata mutation, evicts LRU entries, expires stale images after one hour, and uses HEAD revalidation with a short timeout before serving cached derivatives: `apps/web/public/sw.template.js:31-141`, `apps/web/public/sw.template.js:243-358`.
- HTML cache is network-first with a 24-hour offline-only fallback and bypasses admin/share-revocable routes that must stay fresh: `apps/web/public/sw.template.js:360-468`.
- SW versioning includes the pipeline version and template hash, so derivative cache behavior changes rotate cache namespaces: `apps/web/scripts/build-sw.ts:27-43`.

### Restore / Deploy / Runtime

- Restore serializes DB restore, color backfill, semantic backfill, and upload/processing through named advisory locks before entering maintenance: `apps/web/src/app/[locale]/admin/db-actions.ts:374-447`.
- Restore drains buffered view counts, quiesces the image queue, and drains background DB writes before import; failures keep maintenance when the DB may be partially restored: `apps/web/src/app/[locale]/admin/db-actions.ts:492-540`, `apps/web/src/app/[locale]/admin/db-actions.ts:570-756`.
- DB backup/restore child processes have a 30-minute watchdog, SIGTERM/SIGKILL grace, streaming IO, and temp-file cleanup: `apps/web/src/app/[locale]/admin/db-actions.ts:38-79`, `apps/web/src/app/[locale]/admin/db-actions.ts:215-356`, `apps/web/src/app/[locale]/admin/db-actions.ts:668-756`.
- Runtime shutdown races the queue/view-count drain against a 15-second timeout and exits non-zero when work could not drain: `apps/web/src/instrumentation.ts:20-67`.
- Deploy runs health check before pruning and prunes containers/images/build cache/unused volumes after `up -d`; it does not use `volume prune -a`: `apps/web/deploy.sh:57-104`.
- Docker keeps persistent data on bind mounts and has a 30-second stop grace period: `apps/web/docker-compose.yml:1-18`.

### UI Responsiveness

- Search debounces input, aborts in-flight semantic requests, and guards stale responses with request ids.
- Load-more paths use a loading ref/unmount guard/cooldown to prevent overlapping pagination requests.
- Similar-photos fetches only on expansion and aborts when collapsed/unmounted.
- Histogram decoding/downsampling is worker-backed with a 256 px working canvas cap, avoiding main-thread full-resolution pixel scans.

## Missed-Issue Sweep

I performed a broad sweep for queue/backfill/cache/concurrency keywords across `apps/web/src`, `apps/web/scripts`, `apps/web/public`, deploy scripts, nginx config, and Docker config. The review found expected controls and tests around the high-risk areas above, but no new untracked defect.

Items intentionally not re-raised because they are already deferred/carry-forward in `.context/plans/cycle-67-2026-07-01-deferred.md` and I found no new severity evidence:

- C65-02 settings-only re-encode durable marker.
- C61-06 shared-group view-count flush coverage.
- C61-07 Lightroom upload source-contract coverage.
- PA-42-02 production CLIP web-process catch-up advisory locking/caps.
- TV-40-03 JS operational scripts semantic checking.
- PERF-C39-03 feed/sitemap updated-time indexes.
- PERF-C39-04 backfill pipeline-version indexes.
- AGG-C38-07 imported-helper side-effect classification.
- AGG-C38-08 sidecar keyset pagination.

## Validation

This was a read/review artifact task. I did not modify application source or run the full test suite. The only write was this review file.
