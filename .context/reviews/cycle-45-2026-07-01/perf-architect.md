# Cycle 45 Performance / Architecture Review

Scope: perf-reviewer + architect. Reviewed performance, DB query/index assumptions, concurrency, background workers, image/CLIP/backfill resource controls, cache invalidation, deploy/runtime architecture, and layering/coupling.

Baseline read:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-44-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-44-2026-07-01/perf-architect-reviewer.md`
- `.context/plans/cycle-44-2026-07-01-plan.md`
- `.context/plans/cycle-44-2026-07-01-deferred.md`

Current HEAD inspected: `b430cddd` (`docs(cycle-44): record deploy closure`). `git show --stat --name-only HEAD` shows this latest commit changed only `.context/plans/README.md` and `.context/plans/cycle-44-2026-07-01-plan.md`; the preceding source-bearing Cycle 44 commit is the scanner/doc fix, not a runtime performance change.

## Findings

No new performance or architecture finding.

## Inventory Inspected

- Prior-review and deferral state:
  - `.context/reviews/_aggregate.md:1` points at Cycle 44 as the current aggregate and carries forward `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`.
  - `.context/reviews/cycle-44-2026-07-01/_aggregate.md:1` schedules scanner/doc findings only, with no new perf deferred finding.
  - `.context/plans/cycle-44-2026-07-01-deferred.md:7` preserves the deferred perf/architecture backlog and exit criteria.

- Data access and DB index assumptions:
  - Listing public fields omit large/sensitive columns, with compile-time guards at `apps/web/src/lib/data.ts:459` and `apps/web/src/lib/data.ts:491`.
  - Listing paths remain capped: `LISTING_QUERY_LIMIT` at `apps/web/src/lib/data.ts:668`, `getImagesLite()` cap at `apps/web/src/lib/data.ts:806`, `getImagesLitePage()` cap at `apps/web/src/lib/data.ts:910`, `getAdminImagesLite()` cap at `apps/web/src/lib/data.ts:1015`, and smart-collection pagination cap at `apps/web/src/lib/data.ts:1442`.
  - Shared group reads stay bounded at `apps/web/src/lib/data.ts:1307` and batch tags in one query at `apps/web/src/lib/data.ts:1313`.
  - Schema indexes cover the main listing, topic, tag, analytics, and semantic scans at `apps/web/src/db/schema.ts:117`, `apps/web/src/db/schema.ts:131`, `apps/web/src/db/schema.ts:235`, `apps/web/src/db/schema.ts:250`, `apps/web/src/db/schema.ts:263`, and `apps/web/src/db/schema.ts:295`.
  - Legacy reconcile mirrors those current indexes at `apps/web/scripts/migrate.js:663` and `apps/web/scripts/migrate.js:671`.

- Image processing, queueing, and backfills:
  - Sharp thread pressure remains bounded by divided global concurrency and disabled cache at `apps/web/src/lib/process-image.ts:36` and `apps/web/src/lib/process-image.ts:54`.
  - Per-image encoding still settles all format writers before cleanup at `apps/web/src/lib/process-image.ts:1424`.
  - Upload queue concurrency is clamped against the DB pool at `apps/web/src/lib/image-queue.ts:91`, with bootstrapped pending work batched at `apps/web/src/lib/image-queue.ts:80` and `apps/web/src/lib/image-queue.ts:925`.
  - In-app color backfill holds a global advisory lock at `apps/web/src/lib/admin-backfill-runner.ts:316`, uses per-image locks at `apps/web/src/lib/admin-backfill-runner.ts:356`, clamps concurrency at `apps/web/src/lib/admin-backfill-runner.ts:667`, and drains each keyset batch before fetching the next at `apps/web/src/lib/admin-backfill-runner.ts:692`.
  - Sidecar color backfill still uses the known all-candidate snapshot shape at `apps/web/scripts/backfill-color-pipeline.ts:343` and queues one task per row at `apps/web/scripts/backfill-color-pipeline.ts:475`; this is the already-deferred `AGG-C38-08` / `PERF-C39-04` area, with no new severity evidence.

- CLIP / semantic search resource controls:
  - Runtime CLIP inference concurrency, pending queue, and timeout caps remain at `apps/web/src/lib/clip-model.ts:53`, `apps/web/src/lib/clip-model.ts:57`, and `apps/web/src/lib/clip-model.ts:61`.
  - Semantic scan/topK env caps remain bounded at `apps/web/src/lib/clip-embeddings.ts:36`.
  - Public semantic search validates body size, charges before DB-backed mode work, gates production mode, caps the embedding scan, and enriches bounded IDs at `apps/web/src/app/api/search/semantic/route.ts:147`, `apps/web/src/app/api/search/semantic/route.ts:176`, `apps/web/src/app/api/search/semantic/route.ts:186`, `apps/web/src/app/api/search/semantic/route.ts:263`, and `apps/web/src/app/api/search/semantic/route.ts:318`.
  - Similar-image search remains production-only, rate-limited, target-checked, scan-capped, and enrichment-bounded at `apps/web/src/app/api/search/similar/[id]/route.ts:98`, `apps/web/src/app/api/search/similar/[id]/route.ts:121`, `apps/web/src/app/api/search/similar/[id]/route.ts:132`, `apps/web/src/app/api/search/similar/[id]/route.ts:164`, and `apps/web/src/app/api/search/similar/[id]/route.ts:224`.
  - Operator CLIP sidecar uses the semantic advisory lock and keyset/scan budget at `apps/web/scripts/backfill-clip-embeddings.ts:111`, `apps/web/scripts/backfill-clip-embeddings.ts:143`, and `apps/web/scripts/backfill-clip-embeddings.ts:156`.

- Cache invalidation, service worker, deploy/runtime architecture:
  - Upload route serving has module-scoped settings-hash TTL/inflight dedupe, conditional 304 handling, HEAD early return, and abort cleanup at `apps/web/src/lib/serve-upload.ts:45`, `apps/web/src/lib/serve-upload.ts:58`, `apps/web/src/lib/serve-upload.ts:237`, `apps/web/src/lib/serve-upload.ts:252`, and `apps/web/src/lib/serve-upload.ts:291`.
  - Next static upload cache policy is aligned at `apps/web/next.config.ts:56`; nginx mirrors it at `apps/web/nginx/default.conf:176`.
  - Service-worker image cache remains capped and serialized at `apps/web/public/sw.template.js:31`, `apps/web/public/sw.template.js:98`, `apps/web/public/sw.template.js:108`, `apps/web/public/sw.template.js:171`, and `apps/web/public/sw.template.js:273`.
  - Analytics retention is chunked and iteration-capped at `apps/web/src/lib/view-retention.ts:31` and `apps/web/src/lib/view-retention.ts:76`.
  - Deploy still waits for health before pruning unused Docker artifacts at `apps/web/deploy.sh:34` and `apps/web/deploy.sh:76`.
  - Docker runtime keeps CLIP weights on the data bind mount and gives the app signal ownership at `apps/web/Dockerfile:98` and `apps/web/Dockerfile:103`.

## Deferred Items Not Re-Raised

- `PA-42-02`: production-mode web-process CLIP catch-up remains in `bootstrapMissingActiveEmbeddings()` at `apps/web/src/lib/image-queue.ts:395` and is still outside this cycle without new evidence. The production web catch-up can still call `embedImageReal()` from the web process at `apps/web/src/lib/image-queue.ts:427`, but Cycle 42 already deferred the design decision on disabling, capping, or lock-guarding it while preserving recent-upload recovery.
- `PERF-C39-03`: feed/sitemap updated-time indexes remain migration-shaped work. The source still uses `MAX(updated_at)` paths at `apps/web/src/lib/data.ts:509` and `apps/web/src/lib/data.ts:537`; current callers are bounded/cached, and no new unbounded caller was found.
- `PERF-C39-04`: pipeline-version index work remains tied to migration planning and query-plan evidence; no current source change makes it newly scheduled.
- `AGG-C38-08`: sidecar color backfill keyset/memory work remains unchanged at `apps/web/scripts/backfill-color-pipeline.ts:343` and `apps/web/scripts/backfill-color-pipeline.ts:475`.
- `AGG-C38-07` and `TV-40-03`: carried forward by the aggregate, but not re-raised in this perf/architecture lane.

## Validation

Static review only. No lint, typecheck, unit, build, e2e, or deploy commands were run because this was a read-only review artifact lane with no source changes.
