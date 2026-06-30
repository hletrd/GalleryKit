## summary

Review date: 2026-07-01
Reviewed HEAD: `11c4337f`
Scope: performance, concurrency, CPU/memory, DB/index fit, public-route cost controls, image processing/backfill queues, CLIP/search, service-worker/cache behavior, upload/delete cleanup I/O, and deploy/runtime resource controls.

No actionable new performance, concurrency, or resource defects found at this HEAD. The only runtime-relevant delta since the Cycle 50 start is the service-worker contract-test hardening; application runtime code is unchanged from the Cycle 50 performance pass, and the new test now evaluates concrete route classification against both `sw.template.js` and generated `sw.js`.

I did not re-raise carry-forward deferred items without new evidence: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`.

## inventory

Required context read first:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-50-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-50-2026-07-01/perf-reviewer.md`
- `.context/reviews/cycle-50-2026-07-01/verifier-test-debugger.md`
- `.context/plans/cycle-50-2026-07-01-plan.md`
- `.context/plans/cycle-50-2026-07-01-deferred.md`

Current-head / delta checks:
- Verified `git rev-parse HEAD` is `11c4337fce35e3fcab789228a445960d6f573261`.
- `git diff --name-only 3a02f7ee..HEAD` shows runtime source unchanged since Cycle 50 start except `apps/web/src/__tests__/sw-template-contract.test.ts`; other deltas are review/plan docs and `.gitignore`.
- `git status --short` was clean before writing this artifact.

Hot public routes and cache/service-worker surfaces inspected:
- Service-worker cache classifiers and bounded caches: `apps/web/public/sw.template.js:31`, `apps/web/public/sw.template.js:34`, `apps/web/public/sw.template.js:39`, `apps/web/public/sw.template.js:59`, `apps/web/public/sw.template.js:98`, `apps/web/public/sw.template.js:108`, `apps/web/public/sw.template.js:311`, `apps/web/public/sw.template.js:360`, `apps/web/public/sw.template.js:458`.
- Cycle 50 test closure: `apps/web/src/__tests__/sw-template-contract.test.ts:124` evaluates concrete revocable/photo routes in both template and generated worker.
- Semantic search: `apps/web/src/app/api/search/semantic/route.ts:96`, `apps/web/src/app/api/search/semantic/route.ts:173`, `apps/web/src/app/api/search/semantic/route.ts:253`, `apps/web/src/app/api/search/semantic/route.ts:270`, `apps/web/src/app/api/search/semantic/route.ts:311`.
- Similar search: `apps/web/src/app/api/search/similar/[id]/route.ts:98`, `apps/web/src/app/api/search/similar/[id]/route.ts:121`, `apps/web/src/app/api/search/similar/[id]/route.ts:168`, `apps/web/src/app/api/search/similar/[id]/route.ts:201`.
- OG routes and photo fetch caps: `apps/web/src/app/api/og/route.tsx:80`, `apps/web/src/app/api/og/route.tsx:121`, `apps/web/src/app/api/og/photo/[id]/route.tsx:47`, `apps/web/src/app/api/og/photo/[id]/route.tsx:118`, `apps/web/src/lib/og-photo-fetch.ts:31`, `apps/web/src/lib/og-photo-fetch.ts:41`, `apps/web/src/lib/og-photo-fetch.ts:54`.
- Upload derivative serving: `apps/web/src/lib/serve-upload.ts:45`, `apps/web/src/lib/serve-upload.ts:126`, `apps/web/src/lib/serve-upload.ts:228`, `apps/web/src/lib/serve-upload.ts:252`, `apps/web/src/app/uploads/[...path]/route.ts:18`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:18`.

Image processing, backfill, upload, and cleanup surfaces inspected:
- Sharp/global processing controls: `apps/web/src/lib/process-image.ts:36`, `apps/web/src/lib/process-image.ts:54`, `apps/web/src/lib/process-image.ts:57`, `apps/web/src/lib/process-image.ts:905`, `apps/web/src/lib/process-image.ts:1104`, `apps/web/src/lib/process-image.ts:1112`, `apps/web/src/lib/process-image.ts:1427`.
- Foreground image queue: `apps/web/src/lib/image-queue.ts:91`, `apps/web/src/lib/image-queue.ts:330`, `apps/web/src/lib/image-queue.ts:395`, `apps/web/src/lib/image-queue.ts:513`, `apps/web/src/lib/image-queue.ts:646`, `apps/web/src/lib/image-queue.ts:901`.
- In-app color backfill: `apps/web/src/lib/admin-backfill-runner.ts:105`, `apps/web/src/lib/admin-backfill-runner.ts:383`, `apps/web/src/lib/admin-backfill-runner.ts:398`, `apps/web/src/lib/admin-backfill-runner.ts:681`, `apps/web/src/lib/admin-backfill-runner.ts:711`, `apps/web/src/lib/admin-backfill-runner.ts:838`.
- Sidecar color backfill: `apps/web/scripts/backfill-color-pipeline.ts:365`, `apps/web/scripts/backfill-color-pipeline.ts:390`, `apps/web/scripts/backfill-color-pipeline.ts:539`, `apps/web/scripts/backfill-color-pipeline.ts:568`.
- CLIP model and embedding backfills: `apps/web/src/lib/clip-model.ts:53`, `apps/web/src/lib/clip-model.ts:117`, `apps/web/src/lib/clip-model.ts:156`, `apps/web/src/lib/clip-embeddings.ts:36`, `apps/web/scripts/backfill-clip-embeddings.ts:111`, `apps/web/scripts/backfill-clip-embeddings.ts:143`, `apps/web/scripts/backfill-clip-embeddings.ts:180`, `apps/web/src/app/actions/embeddings.ts:105`, `apps/web/src/app/actions/embeddings.ts:140`.
- Browser and Lightroom uploads: `apps/web/src/app/actions/images.ts:191`, `apps/web/src/app/actions/images.ts:252`, `apps/web/src/app/actions/images.ts:264`, `apps/web/src/app/actions/images.ts:360`, `apps/web/src/app/actions/images.ts:520`, `apps/web/src/app/api/admin/lr/upload/route.ts:60`, `apps/web/src/app/api/admin/lr/upload/route.ts:152`, `apps/web/src/app/api/admin/lr/upload/route.ts:279`, `apps/web/src/app/api/admin/lr/upload/route.ts:310`.
- Delete cleanup: `apps/web/src/app/actions/images.ts:70`, `apps/web/src/app/actions/images.ts:725`, `apps/web/src/app/actions/images.ts:850`, `apps/web/src/app/actions/images.ts:857`.

DB/index, rate-limit, analytics, and runtime/deploy surfaces inspected:
- DB pool and indexes: `apps/web/src/db/index.ts:23`, `apps/web/src/db/index.ts:31`, `apps/web/src/db/index.ts:33`, `apps/web/src/db/schema.ts:118`, `apps/web/src/db/schema.ts:236`, `apps/web/src/db/schema.ts:298`.
- Listing/feed/sitemap query shapes: `apps/web/src/lib/data.ts:662`, `apps/web/src/lib/data.ts:785`, `apps/web/src/lib/data.ts:828`, `apps/web/src/lib/data.ts:953`, `apps/web/src/lib/data.ts:1044`, `apps/web/src/lib/data.ts:1437`, `apps/web/src/lib/data.ts:1655`, `apps/web/src/app/sitemap.ts:24`.
- Timeline and analytics queries: `apps/web/src/lib/data-timeline.ts:97`, `apps/web/src/lib/data-timeline.ts:129`, `apps/web/src/lib/data-timeline.ts:186`, `apps/web/src/lib/analytics-data.ts:28`, `apps/web/src/lib/analytics-data.ts:93`, `apps/web/src/lib/analytics-data.ts:161`.
- Rate-limit and bounded-map state: `apps/web/src/lib/rate-limit.ts:70`, `apps/web/src/lib/rate-limit.ts:87`, `apps/web/src/lib/rate-limit.ts:117`, `apps/web/src/lib/rate-limit.ts:119`, `apps/web/src/lib/rate-limit.ts:245`, `apps/web/src/lib/bounded-map.ts:91`, `apps/web/src/lib/bounded-map.ts:156`, `apps/web/src/lib/upload-tracker-state.ts:8`, `apps/web/src/lib/upload-tracker-state.ts:24`.
- Public analytics writes and drains: `apps/web/src/app/actions/public.ts:335`, `apps/web/src/app/actions/public.ts:366`, `apps/web/src/app/actions/public.ts:417`, `apps/web/src/app/actions/public.ts:463`, `apps/web/src/app/actions/public.ts:499`, `apps/web/src/lib/background-db-writes.ts:3`, `apps/web/src/lib/background-db-writes.ts:28`.
- Shutdown/deploy resource controls: `apps/web/src/instrumentation.ts:20`, `apps/web/src/instrumentation.ts:38`, `apps/web/src/lib/queue-shutdown.ts:39`, `apps/web/deploy.sh:32`, `apps/web/deploy.sh:34`, `apps/web/deploy.sh:76`, `apps/web/docker-compose.yml:14`, `apps/web/docker-compose.yml:24`, `apps/web/Dockerfile:142`, `apps/web/Dockerfile:158`.

## findings

No actionable new defects found.

Non-defect observations:
- Cycle 50's only finding is now closed in source form: the test evaluates `/p/123`, localized photo pages, `/s`, `/g`, `/c`, `/map`, and localized variants against both worker copies at `apps/web/src/__tests__/sw-template-contract.test.ts:124`.
- Public expensive routes are still admitted behind pre-increment or documented no-rate-limit exemptions: semantic search charges before config/embedding work at `apps/web/src/app/api/search/semantic/route.ts:173`, similar search charges before DB mode/scan work at `apps/web/src/app/api/search/similar/[id]/route.ts:98`, OG routes charge before CPU-heavy rendering at `apps/web/src/app/api/og/route.tsx:80` and `apps/web/src/app/api/og/photo/[id]/route.tsx:47`, while upload derivative serving is explicitly exempted because delivery relies on path containment, validators, and cache headers at `apps/web/src/app/uploads/[...path]/route.ts:4`.
- Image and CLIP CPU work remains bounded by queue/concurrency gates: foreground image queue concurrency is DB-pool-capped at `apps/web/src/lib/image-queue.ts:91`, Sharp concurrency is globally capped at `apps/web/src/lib/process-image.ts:54`, real CLIP inference slots and pending queue are capped at `apps/web/src/lib/clip-model.ts:53`, and semantic scans are hard-capped at `apps/web/src/lib/clip-embeddings.ts:36`.
- Known deferred `PA-42-02` remains unchanged: web-process embedding catch-up still runs from queue bootstrap without the semantic backfill advisory lock at `apps/web/src/lib/image-queue.ts:395` and is tracked from bootstrap at `apps/web/src/lib/image-queue.ts:978`. No new evidence at this HEAD changes severity or scheduling.
- Known deferred `PERF-C39-03` / `PERF-C39-04` remain unchanged: feed/sitemap updated-time ordering and backfill pipeline-version predicates are still present at `apps/web/src/lib/data.ts:828`, `apps/web/src/lib/data.ts:1655`, `apps/web/src/app/sitemap.ts:24`, `apps/web/src/lib/admin-backfill-runner.ts:383`, and `apps/web/scripts/backfill-color-pipeline.ts:360`; I did not re-file them without EXPLAIN/cardinality evidence.

Final sweep:
- Checked public routes, service worker and generated-worker parity, image serving, upload and Lightroom ingest, delete cleanup, foreground image queue, color backfills, CLIP/search routes and backfills, DB indexes/query shapes, rate-limit memory maps, analytics writes, shutdown, Dockerfile, compose, and deploy cleanup.
- Intentionally skipped full test/build execution in this read-only review lane; Cycle 50 plan already records the relevant service-worker focused test plus full gate pass at that cycle, and this lane's task was source review plus artifact writing.
- Intentionally skipped generated/runtime directories and dependency trees (`.next`, `node_modules`) and did not inspect historical archived review folders beyond targeted Cycle 50/carry-forward context.
