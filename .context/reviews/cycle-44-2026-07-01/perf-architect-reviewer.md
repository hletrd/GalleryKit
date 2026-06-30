# Cycle 44 Performance / Architecture Review

Scope: performance, concurrency, CPU/memory responsiveness, query shape, background workers, cache behavior, service worker behavior, migrations, deploy topology, and architectural coupling.

Review baseline:
- HEAD inspected: `f417d86b` (`fix(cycle-43): harden lint guard provenance`).
- Read required context: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-43-2026-07-01/_aggregate.md`, `.context/plans/cycle-43-2026-07-01-plan.md`, and `.context/plans/cycle-43-2026-07-01-deferred.md`.
- Built inventory first with repository file listing/search, then inspected data access, queues, image processing, semantic routes, service worker/cache surfaces, migrations, and deployment scripts.
- Source code was not edited.

## Findings

No new finding.

## Inventory Inspected

- Data access and query shape:
  - Public select guards keep listing payloads lean and exclude sensitive / large fields in `apps/web/src/lib/data.ts:459`, `apps/web/src/lib/data.ts:491`.
  - Listing and feed paths keep hard caps or pagination: `LISTING_QUERY_LIMIT` in `apps/web/src/lib/data.ts:664`, feed query ordering and limit in `apps/web/src/lib/data.ts:842`, page query limit cap in `apps/web/src/lib/data.ts:910`.
  - Known feed/sitemap updated-time index gap is unchanged: `getTopics()` and `getLatestImageUpdatedAt()` still use `MAX(updated_at)` paths at `apps/web/src/lib/data.ts:509`, `apps/web/src/lib/data.ts:537`; this remains the already-deferred `PERF-C39-03`.
  - Migration reconcile covers current live indexes, including semantic embedding scan and core image listing indexes, at `apps/web/scripts/migrate.js:663`, `apps/web/scripts/migrate.js:671`.

- Image processing, queues, and workers:
  - Sharp global concurrency remains divided by format fan-out and cache is disabled in `apps/web/src/lib/process-image.ts:39`, `apps/web/src/lib/process-image.ts:54`, `apps/web/src/lib/process-image.ts:57`.
  - Queue bootstrap batches pending rows and tracks side effects for shutdown in `apps/web/src/lib/image-queue.ts:930`, `apps/web/src/lib/image-queue.ts:978`.
  - In-app color backfill is lock-protected, keyset/batch drained, and pool-budget clamped in `apps/web/src/lib/admin-backfill-runner.ts:316`, `apps/web/src/lib/admin-backfill-runner.ts:639`, `apps/web/src/lib/admin-backfill-runner.ts:667`, `apps/web/src/lib/admin-backfill-runner.ts:771`.
  - Sidecar color backfill still snapshots all candidate rows before queueing at `apps/web/scripts/backfill-color-pipeline.ts:343`, then stores one promise per row at `apps/web/scripts/backfill-color-pipeline.ts:475`; this is the already-deferred `AGG-C38-08`, with `PERF-C39-04` still covering the missing pipeline-version index migration.

- CLIP semantic search and similar routes:
  - Public semantic search gates mode before body work, enforces an 8 KiB body cap, bounded query length, request abort checks, and `.limit(SEMANTIC_SCAN_LIMIT)` at `apps/web/src/app/api/search/semantic/route.ts:186`, `apps/web/src/app/api/search/semantic/route.ts:213`, `apps/web/src/app/api/search/semantic/route.ts:240`, `apps/web/src/app/api/search/semantic/route.ts:263`.
  - Similar search is production-only, rate-limited, target-checked, and scan-capped with the same semantic index shape at `apps/web/src/app/api/search/similar/[id]/route.ts:98`, `apps/web/src/app/api/search/similar/[id]/route.ts:121`, `apps/web/src/app/api/search/similar/[id]/route.ts:132`, `apps/web/src/app/api/search/similar/[id]/route.ts:164`.
  - Runtime caps are bounded: `SEMANTIC_SCAN_LIMIT` clamps at 25,000 in `apps/web/src/lib/clip-embeddings.ts:36`, and CLIP inference queue/concurrency caps are in `apps/web/src/lib/clip-model.ts:53`, `apps/web/src/lib/clip-model.ts:57`, `apps/web/src/lib/clip-model.ts:61`.
  - Operator CLIP sidecar uses the semantic advisory lock, production env gate, keyset pagination, and scan budget at `apps/web/scripts/backfill-clip-embeddings.ts:106`, `apps/web/scripts/backfill-clip-embeddings.ts:111`, `apps/web/scripts/backfill-clip-embeddings.ts:143`, `apps/web/scripts/backfill-clip-embeddings.ts:156`.

- Service worker and cache headers:
  - SW image cache is capped at 50 MB, HTML fallback is capped to 50 entries and 24 h, and the cached-image HEAD probe is timeout-bounded at `apps/web/public/sw.template.js:31`, `apps/web/public/sw.template.js:33`, `apps/web/public/sw.template.js:38`, `apps/web/public/sw.template.js:143`, `apps/web/public/sw.template.js:276`.
  - SW image metadata mutations are serialized and LRU recency uses delete-then-set in `apps/web/public/sw.template.js:98`, `apps/web/public/sw.template.js:108`, `apps/web/public/sw.template.js:171`.
  - Upload serving uses a 5 s stale-while-revalidate settings hash cache, ETag/304 handling, HEAD fast path, and abort cleanup at `apps/web/src/lib/serve-upload.ts:45`, `apps/web/src/lib/serve-upload.ts:237`, `apps/web/src/lib/serve-upload.ts:252`, `apps/web/src/lib/serve-upload.ts:291`.
  - Cache-header parity is intact across Next, route-handler fallback, and nginx: `apps/web/next.config.ts:56`, `apps/web/src/lib/serve-upload.ts:267`, `apps/web/nginx/default.conf:169`.

- Deployment and runtime topology:
  - Deploy still builds/recreates via compose, waits for health, then prunes stopped/unused Docker artifacts after the live container is healthy at `apps/web/deploy.sh:30`, `apps/web/deploy.sh:34`, `apps/web/deploy.sh:71`, `apps/web/deploy.sh:76`.
  - Docker runtime keeps CLIP weights in the `/app/data` bind mount and sets `NEXT_MANUAL_SIG_HANDLE=true` for app-owned graceful shutdown at `apps/web/Dockerfile:98`, `apps/web/Dockerfile:103`, `apps/web/Dockerfile:115`.

## Deferred Items Not Re-Raised

- `PA-42-02`: production-mode web-process CLIP catch-up still lives in `bootstrapMissingActiveEmbeddings()` and can call `embedImageReal()` from the web process without the sidecar's semantic advisory lock or a per-boot scan cap (`apps/web/src/lib/image-queue.ts:395`, `apps/web/src/lib/image-queue.ts:427`, `apps/web/src/lib/image-queue.ts:978`). This remains deferred pending the design-backed decision from Cycle 42; no new severity evidence was found.
- `PERF-C39-03`: feed/sitemap `updated_at` query indexes are still a migration-shaped deferred item. Current routes are bounded/cached, and no new unbounded caller was found.
- `PERF-C39-04`: pipeline-version indexes for re-encode candidate scans remain deferred. The in-app runner is batch/keyset based, while the operator sidecar's all-candidate snapshot is already captured by `AGG-C38-08`.
- `AGG-C38-08`: color backfill sidecar keyset pagination remains deferred and unchanged.
- `TV-40-03` and `AGG-C38-07`: carried forward from the aggregate, but outside this performance/architecture review lane.

## Validation

- Static review only. No lint, typecheck, test, build, e2e, or deploy commands were run because this was a review-only lane with no source changes.
- `git status --short --branch` showed the workspace already had a staged Cycle 44 document-review artifact from another reviewer before this file was added; I did not modify or unstage that artifact.
