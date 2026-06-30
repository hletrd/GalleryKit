# Cycle 50 Performance / Concurrency Review

Review date: 2026-07-01
Reviewed HEAD: `3a02f7ee`
Scope: read-only source review, except this artifact.
Lane: performance, concurrency, CPU/memory, image processing, DB query/index fit, locks, queueing, client responsiveness, deploy/runtime resource risks.

## Inventory

Context and carry-forward baseline:
- `AGENTS.md` and `CLAUDE.md` for repo contracts, quality gates, deploy/runtime notes, image pipeline, advisory locks, and known deferred work.
- `.context/reviews/cycle-49-2026-07-01/_aggregate.md` and `.context/reviews/cycle-49-2026-07-01/code-security-performance.md`.
- `.context/plans/cycle-49-2026-07-01-deferred.md`.

Current diff since Cycle 49 start `dc4f4acf`:
- Application-source changes are limited to the scheduled Cycle 49 fixes in `apps/web/src/app/actions/topics.ts`, `apps/web/public/sw.template.js`, generated `apps/web/public/sw.js`, and tests/docs.
- `git status --short` was clean before writing this artifact.

Perf/concurrency surfaces inspected:
- Topic route lock: `apps/web/src/app/actions/topics.ts:409`, `apps/web/src/app/actions/topics.ts:433`, `apps/web/src/__tests__/topics-actions.test.ts:552`.
- Service worker routing/cache: `apps/web/public/sw.template.js:59`, `apps/web/public/sw.template.js:108`, `apps/web/public/sw.template.js:243`, `apps/web/public/sw.template.js:360`, `apps/web/public/sw.template.js:458`, `apps/web/src/__tests__/sw-template-contract.test.ts:71`.
- Image queue/backfill: `apps/web/src/lib/image-queue.ts:91`, `apps/web/src/lib/image-queue.ts:330`, `apps/web/src/lib/image-queue.ts:513`, `apps/web/src/lib/image-queue.ts:646`, `apps/web/src/lib/image-queue.ts:901`, `apps/web/src/lib/admin-backfill-runner.ts:383`, `apps/web/src/lib/admin-backfill-runner.ts:400`, `apps/web/src/lib/admin-backfill-runner.ts:681`, `apps/web/scripts/backfill-color-pipeline.ts:365`.
- Image processing: `apps/web/src/lib/process-image.ts:36`, `apps/web/src/lib/process-image.ts:54`, `apps/web/src/lib/process-image.ts:57`, `apps/web/src/lib/process-image.ts:905`, `apps/web/src/lib/process-image.ts:1104`, `apps/web/src/lib/process-image.ts:1112`, `apps/web/src/lib/process-image.ts:1427`.
- CLIP/semantic search: `apps/web/src/lib/clip-model.ts:53`, `apps/web/src/lib/clip-model.ts:117`, `apps/web/src/lib/clip-embeddings.ts:36`, `apps/web/src/app/api/search/semantic/route.ts:173`, `apps/web/src/app/api/search/semantic/route.ts:270`, `apps/web/src/app/api/search/similar/[id]/route.ts:98`, `apps/web/src/app/api/search/similar/[id]/route.ts:168`.
- DB data paths/index fit: `apps/web/src/db/index.ts:23`, `apps/web/src/db/index.ts:31`, `apps/web/src/db/index.ts:60`, `apps/web/src/db/schema.ts:118`, `apps/web/src/db/schema.ts:220`, `apps/web/src/db/schema.ts:236`, `apps/web/src/db/schema.ts:298`, `apps/web/src/lib/data.ts:662`, `apps/web/src/lib/data.ts:785`, `apps/web/src/lib/data.ts:828`, `apps/web/src/lib/data.ts:973`, `apps/web/src/lib/data.ts:1044`, `apps/web/src/lib/data.ts:1271`, `apps/web/src/lib/data.ts:1437`, `apps/web/src/lib/data-timeline.ts:97`.
- Public analytics/background writes: `apps/web/src/app/actions/public.ts:335`, `apps/web/src/app/actions/public.ts:366`, `apps/web/src/app/actions/public.ts:431`, `apps/web/src/lib/background-db-writes.ts:3`, `apps/web/src/lib/background-db-writes.ts:28`.
- Runtime/deploy resource controls: `apps/web/src/instrumentation.ts:3`, `apps/web/src/instrumentation.ts:38`, `apps/web/src/lib/restore-maintenance-durable.ts:36`, `apps/web/src/lib/restore-maintenance.ts:21`, `apps/web/deploy.sh:32`, `apps/web/deploy.sh:34`, `apps/web/deploy.sh:76`, `apps/web/docker-compose.yml:14`, `apps/web/docker-compose.yml:24`, `apps/web/Dockerfile:142`, `apps/web/Dockerfile:158`.

## Findings

No actionable new performance or concurrency findings.

## Evidence

- The Cycle 49 topic concurrency fix is present: `deleteTopic` validates/admin-checks first, then wraps the image-presence check and delete transaction in `withTopicRouteMutationLock` at `apps/web/src/app/actions/topics.ts:433`. The regression test asserts lock acquisition before delete and release after delete at `apps/web/src/__tests__/topics-actions.test.ts:552`.
- The Cycle 49 SW responsiveness/offline fix is present: the revocable HTML classifier covers `/c`, `/s`, `/g`, and `/map` at `apps/web/public/sw.template.js:59`, while normal `/p/<id>` photo pages are not included and remain eligible for `networkFirstHtml` at `apps/web/public/sw.template.js:460`. The contract test pins both sides at `apps/web/src/__tests__/sw-template-contract.test.ts:71` and `:82`.
- Image processing remains bounded: Sharp global concurrency is capped from CPU count at `apps/web/src/lib/process-image.ts:36` and applied at `:54`; libvips cache is disabled at `:57`; original uploads stream to disk instead of heap at `:905`; wide-gamut rgb16 work downscales above the configured pixel cap at `:1112`; format fan-out waits via `Promise.allSettled` at `:1427`.
- Queue/backfill concurrency remains bounded: foreground queue concurrency is clamped against the shared DB pool at `apps/web/src/lib/image-queue.ts:91` and used in PQueue at `:330`; enqueue rejects during shutdown/restore at `:513`; bootstrap is batched/keyseted at `:901`. In-app backfill fetches candidates in batches at `apps/web/src/lib/admin-backfill-runner.ts:400` and clamps worker concurrency at `:681`.
- DB hot paths still match known indexes: listing queries use the shared `tagNamesAgg` at `apps/web/src/lib/data.ts:662` and order by the indexed capture/created tuple at `:785` and `:973`, backed by `idx_images_processed_capture_date` and `idx_images_topic` in `apps/web/src/db/schema.ts:118` and `:120`. Embedding scans filter by model version and order by `updated_at` at `apps/web/src/app/api/search/semantic/route.ts:270`, backed by `idx_image_embeddings_model_version_updated` at `apps/web/src/db/schema.ts:298`.
- Semantic/CLIP work is capped: env scan/top-k limits are clamped to 25,000 at `apps/web/src/lib/clip-embeddings.ts:36`; real inference has bounded concurrency and pending queue at `apps/web/src/lib/clip-model.ts:53`; public semantic routes pre-increment rate limits before DB/vector work at `apps/web/src/app/api/search/semantic/route.ts:173` and `apps/web/src/app/api/search/similar/[id]/route.ts:98`.
- Client/service-worker responsiveness remains bounded: image cache metadata mutations are serialized at `apps/web/public/sw.template.js:98`; image LRU is capped to 50 MB and evicts by recency at `:108`; cached image HEAD revalidation is bounded by `AbortSignal.timeout` at `:311`; HTML cache is capped at 50 entries at `:143`.
- Background analytics writes are tracked and drained for restore at `apps/web/src/lib/background-db-writes.ts:3` and `:28`, and public view writes are rate-limited before inserts via `apps/web/src/app/actions/public.ts:366` before the fire-and-forget insert sites at `:431`, `:463`, and `:499`.
- Runtime resource controls remain intact: MySQL pool is `connectionLimit: 10`, `queueLimit: 20` at `apps/web/src/db/index.ts:31`; deploy waits for health before Docker prune at `apps/web/deploy.sh:34`; pruning runs after `up -d` and only prunes unused artifacts at `apps/web/deploy.sh:76`; persistence is bind-mounted in `apps/web/docker-compose.yml:24`; Docker stop grace is 30s at `apps/web/docker-compose.yml:14`; app shutdown drains queue plus buffered view counts at `apps/web/src/instrumentation.ts:38`.

## Not Re-raised

The Cycle 49 carry-forward deferred items remain unchanged and were not re-filed:
- `PA-42-02`: production CLIP web-process catch-up advisory locking and caps. Current code still gates/caps CLIP work; no new production activation evidence changes severity.
- `TV-40-03`: semantic checking for JS operational scripts. Not a performance/concurrency regression.
- `PERF-C39-03`: feed and sitemap updated-time indexes. Feed/sitemap paths remain bounded/ISR-backed; no new cardinality or EXPLAIN evidence changes priority.
- `PERF-C39-04`: backfill pipeline-version indexes. Candidate predicates remain the same; no new measured evidence changes scheduling.
- `AGG-C38-07`: scanner imported-helper side-effect classification. Not a runtime perf defect.
- `AGG-C38-08`: sidecar keyset pagination. The sidecar still snapshots candidates at `apps/web/scripts/backfill-color-pipeline.ts:365`, but this is the known deferred item and no new evidence changes severity.

## Validation

- `git diff --check` passed.
- No test suite was run in this read-only review lane; evidence is source inspection plus existing Cycle 49 focused test references.

## Finding Count

0
