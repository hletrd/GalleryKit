## Cycle 53 Performance / Concurrency Review

Review date: 2026-07-01
Reviewed HEAD: `17db8e385923d70bc2a954d85e67ffa0fa59f73b`
Scope: read-only source review plus this artifact. Focused on performance, CPU/memory/I/O, DB query shape and indexes, cache/freshness, service worker behavior, image processing, backfill, CLIP/semantic search, and race/concurrency risks.

## Inventory

Baseline and carry-forward context read:
- `AGENTS.md` and `CLAUDE.md`, including the single-web-instance topology, process-local queues/rate limits, image pipeline, backfill lock contracts, CLIP runbook, deploy/disk hygiene, and current deferred items.
- `.context/reviews/cycle-50-2026-07-01/perf-reviewer.md`
- `.context/reviews/cycle-51-2026-07-01/perf-reviewer.md`
- `.context/reviews/cycle-52-2026-07-01/_aggregate.md`
- `git diff --name-only d7326789..HEAD`

Current delta reviewed:
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:8` keeps the settings route dynamic.
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:13` loads settings, translations, and image count in one `Promise.all`.
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:31` passes the server-resolved semantic-search mode into the client using `SEMANTIC_SEARCH_ALLOW_PRODUCTION`.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:75` receives the scalar resolved mode.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:295` derives the stored-production and active-production display state without new network work.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:802` binds the select to a valid value, including a disabled production-active item only when operator-enabled production is actually active.
- `apps/web/src/__tests__/cycle-52-source-contracts.test.ts:8` pins the source contract for the production-active Settings display.

Hot route, cache, and service-worker surfaces inspected:
- Semantic search request admission, rate limit, body cap, CLIP encode, scan limit, and enrichment: `apps/web/src/app/api/search/semantic/route.ts:96`, `apps/web/src/app/api/search/semantic/route.ts:173`, `apps/web/src/app/api/search/semantic/route.ts:253`, `apps/web/src/app/api/search/semantic/route.ts:270`, `apps/web/src/app/api/search/semantic/route.ts:311`, `apps/web/src/app/api/search/semantic/route.ts:330`.
- Similar-search production gate, target lookup, scan limit, and enrichment: `apps/web/src/app/api/search/similar/[id]/route.ts:98`, `apps/web/src/app/api/search/similar/[id]/route.ts:121`, `apps/web/src/app/api/search/similar/[id]/route.ts:135`, `apps/web/src/app/api/search/similar/[id]/route.ts:168`, `apps/web/src/app/api/search/similar/[id]/route.ts:201`, `apps/web/src/app/api/search/similar/[id]/route.ts:233`.
- CLIP queue and model load: `apps/web/src/lib/clip-model.ts:53`, `apps/web/src/lib/clip-model.ts:117`, `apps/web/src/lib/clip-model.ts:156`, `apps/web/src/lib/clip-model.ts:200`.
- Embedding scan/top-k caps and decode contract: `apps/web/src/lib/clip-embeddings.ts:36`, `apps/web/src/lib/clip-embeddings.ts:43`, `apps/web/src/lib/clip-embeddings.ts:135`, `apps/web/src/lib/clip-embeddings.ts:164`.
- Service worker cache caps, route classification, serialized metadata writes, bounded HEAD revalidation, and revocable-route bypass: `apps/web/public/sw.template.js:31`, `apps/web/public/sw.template.js:59`, `apps/web/public/sw.template.js:98`, `apps/web/public/sw.template.js:108`, `apps/web/public/sw.template.js:311`, `apps/web/public/sw.template.js:360`, `apps/web/public/sw.template.js:458`.
- Upload derivative serving path validation, settings-hash TTL, ETag/304/HEAD behavior, and file stream abort handling: `apps/web/src/lib/serve-upload.ts:45`, `apps/web/src/lib/serve-upload.ts:49`, `apps/web/src/lib/serve-upload.ts:126`, `apps/web/src/lib/serve-upload.ts:153`, `apps/web/src/lib/serve-upload.ts:181`, `apps/web/src/lib/serve-upload.ts:228`, `apps/web/src/lib/serve-upload.ts:237`, `apps/web/src/lib/serve-upload.ts:252`.
- OG photo fetch byte/time budgets: `apps/web/src/lib/og-photo-fetch.ts:31`, `apps/web/src/lib/og-photo-fetch.ts:41`, `apps/web/src/lib/og-photo-fetch.ts:54`, `apps/web/src/lib/og-photo-fetch.ts:72`, `apps/web/src/lib/og-photo-fetch.ts:85`, `apps/web/src/lib/og-photo-fetch.ts:107`.

Image processing, upload, cleanup, and backfill surfaces inspected:
- Sharp global concurrency/cache controls, upload streaming, wide-gamut downscale, and format fan-out settlement: `apps/web/src/lib/process-image.ts:36`, `apps/web/src/lib/process-image.ts:54`, `apps/web/src/lib/process-image.ts:57`, `apps/web/src/lib/process-image.ts:905`, `apps/web/src/lib/process-image.ts:1104`, `apps/web/src/lib/process-image.ts:1112`, `apps/web/src/lib/process-image.ts:1427`.
- Foreground image queue concurrency, queue state, per-image processing, bootstrap batching, and embedding catch-up: `apps/web/src/lib/image-queue.ts:91`, `apps/web/src/lib/image-queue.ts:330`, `apps/web/src/lib/image-queue.ts:353`, `apps/web/src/lib/image-queue.ts:395`, `apps/web/src/lib/image-queue.ts:513`, `apps/web/src/lib/image-queue.ts:543`, `apps/web/src/lib/image-queue.ts:646`, `apps/web/src/lib/image-queue.ts:901`, `apps/web/src/lib/image-queue.ts:978`.
- In-app color backfill pool budget, keyset batches, worker queue, and lock release: `apps/web/src/lib/admin-backfill-runner.ts:105`, `apps/web/src/lib/admin-backfill-runner.ts:129`, `apps/web/src/lib/admin-backfill-runner.ts:383`, `apps/web/src/lib/admin-backfill-runner.ts:400`, `apps/web/src/lib/admin-backfill-runner.ts:681`, `apps/web/src/lib/admin-backfill-runner.ts:711`, `apps/web/src/lib/admin-backfill-runner.ts:838`.
- Sidecar color backfill lock, candidate snapshot, concurrency cap, and exit code: `apps/web/scripts/backfill-color-pipeline.ts:346`, `apps/web/scripts/backfill-color-pipeline.ts:365`, `apps/web/scripts/backfill-color-pipeline.ts:390`, `apps/web/scripts/backfill-color-pipeline.ts:539`, `apps/web/scripts/backfill-color-pipeline.ts:568`.
- Browser upload quota/check-claim, disk preflight, original streaming path, queue handoff, delete cleanup, and batch cleanup concurrency: `apps/web/src/app/actions/images.ts:191`, `apps/web/src/app/actions/images.ts:252`, `apps/web/src/app/actions/images.ts:264`, `apps/web/src/app/actions/images.ts:371`, `apps/web/src/app/actions/images.ts:520`, `apps/web/src/app/actions/images.ts:725`, `apps/web/src/app/actions/images.ts:841`, `apps/web/src/app/actions/images.ts:850`.
- Lightroom upload body caps, parse slot, tracker claim, upload/settings lock, and disk preflight: `apps/web/src/app/api/admin/lr/upload/route.ts:60`, `apps/web/src/app/api/admin/lr/upload/route.ts:101`, `apps/web/src/app/api/admin/lr/upload/route.ts:130`, `apps/web/src/app/api/admin/lr/upload/route.ts:152`, `apps/web/src/app/api/admin/lr/upload/route.ts:270`, `apps/web/src/app/api/admin/lr/upload/route.ts:310`.

DB, analytics, rate-limit, and runtime controls inspected:
- DB pool cap/queue and connection init timeout contract: `apps/web/src/db/index.ts:23`, `apps/web/src/db/index.ts:31`, `apps/web/src/db/index.ts:33`, `apps/web/src/db/index.ts:60`, `apps/web/src/db/index.ts:80`.
- Hot indexes: `apps/web/src/db/schema.ts:118`, `apps/web/src/db/schema.ts:236`, `apps/web/src/db/schema.ts:298`.
- Listing, feed, OG latest-image, smart-collection, and sitemap query shapes: `apps/web/src/lib/data.ts:662`, `apps/web/src/lib/data.ts:668`, `apps/web/src/lib/data.ts:785`, `apps/web/src/lib/data.ts:828`, `apps/web/src/lib/data.ts:953`, `apps/web/src/lib/data.ts:1044`, `apps/web/src/lib/data.ts:1437`, `apps/web/src/lib/data.ts:1655`.
- Bounded public/admin rate-limit maps and hard-cap enforcement: `apps/web/src/lib/rate-limit.ts:70`, `apps/web/src/lib/rate-limit.ts:84`, `apps/web/src/lib/rate-limit.ts:96`, `apps/web/src/lib/rate-limit.ts:117`, `apps/web/src/lib/rate-limit.ts:245`, `apps/web/src/lib/bounded-map.ts:91`, `apps/web/src/lib/bounded-map.ts:156`.
- Public analytics pre-increment, DB-backed fallback, visible-row checks, and tracked fire-and-forget inserts: `apps/web/src/app/actions/public.ts:335`, `apps/web/src/app/actions/public.ts:366`, `apps/web/src/app/actions/public.ts:417`, `apps/web/src/app/actions/public.ts:431`, `apps/web/src/app/actions/public.ts:445`, `apps/web/src/app/actions/public.ts:463`, `apps/web/src/app/actions/public.ts:477`, `apps/web/src/app/actions/public.ts:499`, `apps/web/src/lib/background-db-writes.ts:3`, `apps/web/src/lib/background-db-writes.ts:28`.
- Startup/shutdown drain controls: `apps/web/src/instrumentation.ts:1`, `apps/web/src/instrumentation.ts:7`, `apps/web/src/instrumentation.ts:20`, `apps/web/src/instrumentation.ts:38`, `apps/web/src/lib/queue-shutdown.ts:16`, `apps/web/src/lib/queue-shutdown.ts:39`, `apps/web/src/lib/queue-shutdown.ts:43`.

## Findings

No actionable new performance, concurrency, CPU/memory/I/O, cache/freshness, service-worker, image-processing, backfill, CLIP/semantic-search, or race-condition defects found at this HEAD.

Severity: none
Confidence: high
Fix: none required

## Evidence and Non-Findings

- The Cycle 52 production-semantic Settings fix does not add a public hot-path cost. The only runtime work added is a scalar `resolveSemanticSearchMode(...)` call on the already dynamic admin Settings page at `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:31`; the client derives display state locally at `settings-client.tsx:295` and does not add polling, fetches, timers, or background work.
- Public semantic routes remain bounded. Text search charges before the DB-backed mode lookup at `apps/web/src/app/api/search/semantic/route.ts:173`, caps body size at `:96`, passes abort signals into real CLIP inference at `:253`, limits the DB scan at `:270`, and only enriches bounded top-K ids at `:330`. Similar search shares the semantic rate-limit budget at `apps/web/src/app/api/search/similar/[id]/route.ts:98`, requires production mode at `:121`, and caps the production scan at `:168`.
- CLIP CPU and memory pressure is still gated. Real inference concurrency defaults to one and is capped at four at `apps/web/src/lib/clip-model.ts:53`; pending inference waiters are bounded at `:57`; abort/timeout cleanup removes waiters at `:99` and `:117`; model loading is a lazy retryable singleton at `:200`. Scan and top-K env caps are hard-clamped to 25,000 at `apps/web/src/lib/clip-embeddings.ts:36`.
- Image processing remains bounded. Sharp concurrency is derived from available CPUs and divided across the AVIF/WebP/JPEG fan-out at `apps/web/src/lib/process-image.ts:36` and applied globally at `:54`; libvips cache is disabled at `:57`; uploads stream originals to disk at `:905`; wide-gamut sources above the pixel cap are downscaled before rgb16 fan-out at `:1112`; parallel format generation uses `Promise.allSettled` at `:1427` before cleanup decisions.
- Queue and backfill concurrency remain pool-aware. The foreground queue clamps requested workers against live DB-pool headroom at `apps/web/src/lib/image-queue.ts:91` and uses that cap in `PQueue` at `:330`. The in-app backfill reserves about half the pool at `apps/web/src/lib/admin-backfill-runner.ts:105`, clamps worker concurrency at `:681`, and fetches candidates in keyset batches at `:400`. The sidecar backfill remains separate from the live pool budget and caps `BACKFILL_CONCURRENCY` to eight at `apps/web/scripts/backfill-color-pipeline.ts:390`.
- Service-worker and derivative caching still have bounded freshness behavior. Image cache is capped at 50 MB at `apps/web/public/sw.template.js:31`, metadata mutation is serialized at `:98`, HEAD revalidation is capped at 300 ms at `:311`, revocable share/map HTML bypasses cache at `:458`, and upload route ETags use a 5 s module-level settings-hash TTL rather than one DB read per derivative request at `apps/web/src/lib/serve-upload.ts:45`.
- DB hot paths still line up with known indexes and caps. Listing queries cap page size at `apps/web/src/lib/data.ts:668` and order by the indexed processed/capture/created tuple at `:785`; the images table exposes that composite index at `apps/web/src/db/schema.ts:118`. Embedding scans use `model_version, updated_at` at `apps/web/src/db/schema.ts:298`. Analytics tables carry view-time indexes at `apps/web/src/db/schema.ts:236`.
- Public write pressure remains bounded. View-record actions pre-increment the memory/DB limit at `apps/web/src/app/actions/public.ts:366`, validate the visible row before inserting at `:424`, `:457`, and `:486`, then track fire-and-forget inserts for restore drain at `:431`, `:463`, and `:499`. The tracking set drains during restore via `apps/web/src/lib/background-db-writes.ts:28`.

Not re-raised without new evidence:
- `PA-42-02` remains the known deferred production CLIP web-process catch-up advisory-lock/cap item. The catch-up still runs from queue bootstrap at `apps/web/src/lib/image-queue.ts:395` and is tracked as a side effect at `apps/web/src/lib/image-queue.ts:978`; no new production activation or failure evidence changes severity.
- `TV-40-03` remains about semantic checking for JS operational scripts, not a fresh runtime performance regression.
- `PERF-C39-03` remains the known feed/sitemap updated-time index item at `apps/web/src/lib/data.ts:828` and `apps/web/src/lib/data.ts:1655`; no new EXPLAIN/cardinality evidence changes severity.
- `PERF-C39-04` remains the known backfill pipeline-version index item at `apps/web/src/lib/admin-backfill-runner.ts:383` and `apps/web/scripts/backfill-color-pipeline.ts:360`; no new measured evidence changes scheduling.
- `AGG-C38-07` remains scanner-helper classification work, not a new runtime finding.
- `AGG-C38-08` remains sidecar backfill keyset pagination. The sidecar still snapshots all candidates at `apps/web/scripts/backfill-color-pipeline.ts:365`, but this is already tracked and no new evidence changes severity.

## Final Sweep

- Checked current delta from Cycle 52 closure through `HEAD`, with special attention to semantic-search Settings freshness and operator-state display.
- Swept public semantic/similar search, CLIP inference, service worker, derivative serving, OG fetches, Sharp processing, browser and Lightroom uploads, delete cleanup, foreground queue, in-app and sidecar backfill, listing/feed/sitemap/smart-collection query shapes, DB indexes, public analytics writes, bounded rate-limit maps, and shutdown drains.
- No tests/build were run for this review artifact; validation is source inspection against current HEAD plus the existing source-contract test introduced in Cycle 52.
- Did not inspect generated/runtime directories or dependency trees (`.next`, `node_modules`) and did not re-open old archived review folders beyond targeted carry-forward context.

Finding count: 0
