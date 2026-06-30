# Cycle 35 Performance Reviewer Report

Review target: current HEAD `96160854ebadca1606e9f99b2e6f5bc4689e366c`.
Review role: `performance-reviewer`.
Mode: read-only review. Product source, tests, plans, git history, and deploy state were not changed; this file is the only artifact written.

## Inventory

- Required context: `AGENTS.md` and `CLAUDE.md`, with focus on single-instance topology, DB pool limits, image upload/processing, CLIP semantic-search limits, service-worker caching, remote deploy helper, Docker disk hygiene, and prior performance notes.
- Prior-cycle filter: `.context/plans/cycle-33-2026-06-30-deferred.md`, `.context/plans/archive/80-deferred-cycle33.md`, `.context/reviews/performance-reviewer.md`, and the stale cycle-34 `.context/reviews/perf-reviewer.md`. I did not re-raise the cycle-33 deferred grouped count, timeline non-sargability, GPS stripping, grid JPEG fallback, semantic scan-window, Docker CI, process-local limiter, stale derivative byte, or invalid analytics-limiter items without new evidence.
- Data/query coverage: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, analytics data helpers, sitemap/feed accessors, public home/topic/smart-collection/photo/timeline/map/share page paths.
- Pagination/search coverage: public load-more and search actions, `LoadMore`, `Search`, keyset cursor flow, exact-count first-page paths, public route rate limits, semantic and similar search routes.
- Image/queue coverage: `process-image.ts`, `image-queue.ts`, `admin-backfill-runner.ts`, color and CLIP backfill scripts, upload tracker and Lightroom/PAT upload route, upload-serving route twins, derivative cache headers.
- Client/cache coverage: `home-client.tsx`, `grid-picture.tsx`, `load-more.tsx`, `search.tsx`, service-worker template/generated behavior, masonry responsiveness, image priorities, abort/stale response guards.
- Deploy/resource coverage: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, production bind mounts, health check, stop grace period, and post-deploy Docker prune policy.

## Findings

### C35-PERF-01 - Upload HEAD/304 responses leak file descriptors

- Severity: Medium.
- Confidence: High.
- Citations: `apps/web/src/lib/serve-upload.ts:166-184`, `apps/web/src/lib/serve-upload.ts:231-242`, `apps/web/src/lib/serve-upload.ts:245-267`, `apps/web/src/lib/serve-upload.ts:269-314`, `apps/web/src/app/uploads/[...path]/route.ts:17-29`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:17-24`, `apps/web/public/sw.template.js:250-263`.
- Failure scenario: The service worker does a synchronous HEAD ETag probe for every cached derivative tile before serving the cached response. Both upload route twins pass `method='HEAD'` into `serveUploadFile`. `serveUploadFile` opens a `FileHandle` for the resolved derivative and stats it, but the successful non-body branches return before ownership is transferred to `createReadStream({ autoClose: true })`: matching `If-None-Match` returns 304, wildcard returns 304, and all HEAD requests return headers only. The only close-on-success path is the non-file guard; otherwise `fileHandle.close()` runs only in the `catch` block. A warm masonry visit with many cached images can therefore leak one descriptor per HEAD probe, and repeated visits/scrolls can push the Node process toward `EMFILE`, breaking image serving and any other fd-opening work until process restart or GC finalization happens.
- Fix: Close the opened `FileHandle` before every successful non-stream return, or wrap the function with a `finally` that closes `fileHandle` unless it has been nulled after `createReadStream({ autoClose: true })` takes ownership. Add focused coverage that spies/mocks `fs/promises.open().close` for `serveUploadFile(..., etag)`, `serveUploadFile(..., '*')`, and `serveUploadFile(..., null, 'HEAD')`, plus a route/source contract so the HEAD fast path stays non-streaming and closed.

## Verification Notes

- The cycle-34 LR multipart parse-slot finding is fixed at current HEAD: quota checks now occur before `tryAcquireLrMultipartParseSlot()`, and the parse slot is released in a `finally` around `request.formData()` (`apps/web/src/app/api/admin/lr/upload/route.ts:130-185`); the source contract checks that ordering (`apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:267-288`).
- DB pool behavior remains bounded by a 10-connection pool, `queueLimit=20`, and timeout-cleared connection init waits (`apps/web/src/db/index.ts:23-38`, `apps/web/src/db/index.ts:70-134`).
- Image processing remains constrained by queue concurrency resolved against the DB pool and Sharp global concurrency/cache settings (`apps/web/src/lib/image-queue.ts:87-108`, `apps/web/src/lib/process-image.ts:36-57`).
- Semantic search remains rate-limited, body-capped, CLIP-inference-queue-bounded, and scan-window-bounded; the recall/ANN boundary is already cycle-33 deferred (`apps/web/src/app/api/search/semantic/route.ts:94-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:98-201`, `apps/web/src/lib/clip-model.ts:53-172`, `apps/web/src/lib/clip-embeddings.ts:36-44`).
- In-app color backfill is now O(batch) memory via keyset batches drained through PQueue (`apps/web/src/lib/admin-backfill-runner.ts:633-760`). The sidecar script still materializes/enqueues the full candidate set, but that is already recorded as older deferred sidecar/operator work (`apps/web/scripts/backfill-color-pipeline.ts:343-360`, `apps/web/scripts/backfill-color-pipeline.ts:475-512`).
- No test suite was run; this lane was a static read-only review.
