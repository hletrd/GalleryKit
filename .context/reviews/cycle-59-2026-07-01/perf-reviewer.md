# Cycle 59 Performance / Concurrency Review

Reviewed HEAD: `a4bb267043341eb600286e2aa2cbda7c6858c86f`.

Read-only lane. No files edited.

## Findings

No new actionable performance, concurrency, caching, DB-shape, image-pipeline, CLIP/backfill, service-worker freshness, or deploy/runtime findings were confirmed.

## Evidence

The current runtime delta since Cycle 58 is limited to behavior tests and the histogram tooltip touch-target class. The prior photo-page performance regression remains fixed: public image fetch starts before admin/config work and anonymous renders reuse `getImageCached`; admin fields are fetched only after `isAdmin()` and a public row exist.

Queue, backfill, and CLIP work remain bounded by pool/concurrency caps, advisory locks, scan limits, and rate-limit pre-increments. Service-worker image freshness still has a 300 ms bounded HEAD probe, 50 MB image LRU, and revocable-route HTML bypass. Deploy still waits for health before pruning, with bind-mounted mutable data and non-`-a` volume prune.

Known deferred items were not re-raised without new severity-changing evidence: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`.

## Inspected

- Photo page cache/admin split: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- DB query shapes/index fit: `apps/web/src/lib/data.ts`, `apps/web/src/db/schema.ts`
- DB pool and bounded rate-limit state: `apps/web/src/db/index.ts`, `apps/web/src/lib/bounded-map.ts`, `apps/web/src/lib/rate-limit.ts`
- Image queue/advisory locks: `apps/web/src/lib/image-queue.ts`
- Sharp/image pipeline: `apps/web/src/lib/process-image.ts`
- Color backfill: `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`
- CLIP/search: `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, semantic/similar search routes
- Cache/service worker/upload serving: `apps/web/src/lib/serve-upload.ts`, `apps/web/public/sw.template.js`
- Runtime/deploy: `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`
