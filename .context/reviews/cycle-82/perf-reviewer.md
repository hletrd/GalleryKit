# Cycle 82 Performance / Concurrency Review

Reviewer: performance/concurrency lane
Date: 2026-07-01
HEAD reviewed: `c272c521`
Scope: CPU/memory/I/O, DB query shape, image processing, queues, batching, client responsiveness, cache/deploy performance.

## Verdict

No confirmed performance or concurrency issue found in this pass.

Severity: n/a
Confidence: medium-high. I inspected the current hot paths, recent cycle-81-to-82 delta, and targeted tests, but did not run a production load test.

## Concise Inventory

- DB/query shape and batching: `apps/web/src/lib/data.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/view-retention.ts`, `apps/web/src/lib/search-enrichment-fields.ts`.
- Image processing and queues: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Semantic/CLIP CPU and memory surfaces: `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-inference.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.
- Cache, uploads, and deploy performance: `apps/web/src/lib/serve-upload.ts`, `apps/web/public/sw.template.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`.
- Client responsiveness: `apps/web/src/components/home-client.tsx`, `apps/web/src/components/histogram.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/components/map/map-client.tsx`, `apps/web/src/app/[locale]/(public)/map/page.tsx`.

## Confirmed Issues

None.

| Severity | Confidence | File:line citations | Failure scenario | Suggested fix |
| --- | --- | --- | --- | --- |
| n/a | medium-high | n/a | No current performance/concurrency failure was confirmed. | No fix recommended. |

## Inspection Evidence

- Current cycle delta is not performance-relevant: the public map page still obtains markers through `getMapImages()` and only derives a display title before handing bounded marker data to the client (`apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`). `getMapImages()` remains capped and ordered (`apps/web/src/lib/data.ts:1707-1734`).
- Listing/search DB paths retain bounded query shapes: shared `tagNamesAgg` avoids per-row tag lookups (`apps/web/src/lib/data.ts:650-662`), gallery listing caps page size and uses keyset cursor predicates (`apps/web/src/lib/data.ts:668-811`), shared-group details batch tag lookups (`apps/web/src/lib/data.ts:1300-1365`), smart collections skip the count window for cursor pages (`apps/web/src/lib/data.ts:1466-1517`), and keyword search runs capped/parallel bounded enrichment only as needed (`apps/web/src/lib/data.ts:1539-1682`).
- Schema support exists for the reviewed hot paths: image listing/upload attribution indexes (`apps/web/src/db/schema.ts:118-122`), analytics/view indexes (`apps/web/src/db/schema.ts:236-240`, `apps/web/src/db/schema.ts:264-266`), and embedding model/update indexes (`apps/web/src/db/schema.ts:296-298`).
- Image processing is bounded by CPU-aware Sharp concurrency and disabled Sharp cache (`apps/web/src/lib/process-image.ts:36-57`), streams uploads to disk instead of buffering whole files (`apps/web/src/lib/process-image.ts:887-914`), caps high-bit-depth intermediate work (`apps/web/src/lib/process-image.ts:1092-1145`), and uses per-format Sharp instances with cleanup/verification around generated outputs (`apps/web/src/lib/process-image.ts:1227-1456`).
- Queue and backfill concurrency are pool-aware and bounded: image queue concurrency reserves DB capacity (`apps/web/src/lib/image-queue.ts:91-108`), retry tracking is pruned (`apps/web/src/lib/image-queue.ts:198-224`), per-image advisory locks guard duplicate processing (`apps/web/src/lib/image-queue.ts:469-496`), bootstrap scans are keyset/batched (`apps/web/src/lib/image-queue.ts:886-1003`), and admin backfill caps worker count against the DB pool (`apps/web/src/lib/admin-backfill-runner.ts:129-142`, `apps/web/src/lib/admin-backfill-runner.ts:390-430`).
- Shutdown now drains background DB work: background writes are tracked in a promise set (`apps/web/src/lib/background-db-writes.ts:3-31`) and graceful shutdown awaits image queue, shared-view flushes, and tracked DB writes with a timeout (`apps/web/src/instrumentation.ts:36-69`).
- Semantic search CPU and memory paths remain guarded: CLIP inference has active/pending caps and timeout handling (`apps/web/src/lib/clip-model.ts:53-64`, `apps/web/src/lib/clip-model.ts:117-173`), model loading is lazy/singleton (`apps/web/src/lib/clip-model.ts:198-230`), image embedding preprocesses to a fixed size (`apps/web/src/lib/clip-model.ts:273-324`), semantic request bodies and query length are capped before parsing/search (`apps/web/src/app/api/search/semantic/route.ts:94-179`), and vector scans are bounded by `SEMANTIC_SCAN_LIMIT` before top-K enrichment (`apps/web/src/app/api/search/semantic/route.ts:263-369`, `apps/web/src/app/api/search/similar/[id]/route.ts:132-264`).
- Upload serving and browser cache paths avoid request-thread body buffering: serving-settings hash has short TTL plus stale refresh (`apps/web/src/lib/serve-upload.ts:50-83`), conditional requests return before body streaming (`apps/web/src/lib/serve-upload.ts:229-274`), GET streams from the file descriptor with abort cleanup (`apps/web/src/lib/serve-upload.ts:280-308`), service-worker image/HTML caches have size/count caps and serialized metadata mutation (`apps/web/public/sw.template.js:31-39`, `apps/web/public/sw.template.js:98-160`), and image revalidation uses a 300 ms HEAD timeout with stale fallback (`apps/web/public/sw.template.js:243-356`).
- Client responsiveness surfaces remain bounded: masonry column tracking is rAF-debounced and cleaned up (`apps/web/src/components/home-client.tsx:30-67`), grid images preserve aspect-ratio/contain-intrinsic sizing and only eager-load above-fold slots (`apps/web/src/components/home-client.tsx:296-365`), histogram computation downsamples to 256 px and transfers raw pixels to a worker (`apps/web/src/components/histogram.tsx:169-228`), histogram resize redraws are rAF-debounced (`apps/web/src/components/histogram.tsx:440-466`), and search debounces requests while aborting stale semantic fetches (`apps/web/src/components/search.tsx:146-316`).
- Deploy/cache behavior matches the workspace contract: native-heavy packages are externalized (`apps/web/next.config.ts:45-50`), upload assets get bounded revalidation cache headers (`apps/web/next.config.ts:55-73`), production image dependencies are installed and smoke-checked during Docker build (`apps/web/Dockerfile:71-80`), app-level signal handling is enabled (`apps/web/Dockerfile:116-128`), and deploy prunes only after a healthy `up -d` while avoiding `volume prune -a` (`apps/web/deploy.sh:55-104`).
- A sync-I/O sweep found only lifecycle/test surfaces, not public hot-path serving. Durable restore-maintenance marker I/O is synchronous by design around restore start/end and startup sync (`apps/web/src/lib/restore-maintenance-durable.ts:36-54`, `apps/web/src/lib/restore-maintenance-durable.ts:65-85`).

## Deferred Items Not Re-Raised

- Historical operator-scale tradeoffs around semantic brute-force scans, first-page count windows, and sidecar backfill candidate materialization remain deferred because this pass found no new corpus-size, latency, memory, or production evidence that changes severity.
- Previously deferred restore-maintenance foreground fencing and site-config runtime/build-time ambiguity were not re-filed from this performance lane; they remain outside the confirmed current performance/concurrency evidence.

## Validation

- Targeted tests passed:

```bash
npm test --workspace=apps/web -- --run src/__tests__/instrumentation-sigterm.test.ts src/__tests__/image-queue-concurrency-cap.test.ts src/__tests__/serve-upload.test.ts src/__tests__/sw-cache.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts src/__tests__/admin-backfill-concurrency-cap.test.ts src/__tests__/deploy-script-contract.test.ts
```

Result: 8 test files passed, 102 tests passed.

- `git diff --check -- .context/reviews/cycle-82/perf-reviewer.md` passed after writing this artifact.

Source changes made by this lane: none. This review artifact is the only file this lane writes.
