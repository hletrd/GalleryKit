# Cycle 99 Performance / Concurrency Review

Reviewer: perf-reviewer  
HEAD: `d69125608f352dd04e09093b3885b4fefd471774`  
Scope: performance, concurrency, CPU/memory, DB query cost, image pipeline, cache behavior.  
Mode: read-only source review; no source changes.

## Inventory

Rules/context read:
- `AGENTS.md`
- `CLAUDE.md`
- Prior duplicate-check context: `.context/reviews/run9-cycle8/perf-reviewer.md`

Primary hot-path files inspected:
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/settings-hash.ts`
- `apps/web/src/lib/sw-cache.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/bounded-map.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/background-db-writes.ts`
- `apps/web/src/lib/blur-data-url.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/analytics-data.ts`
- `apps/web/src/lib/view-retention.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/feed.xml/route.ts`
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
- `apps/web/src/app/sitemap.ts`

Search sweeps:
- Route and action DB/query/rate-limit usage.
- Module-level `Map` / `Set` / cache state.
- Sync filesystem calls in `apps/web/src` outside tests.
- Offset/cursor pagination, semantic scan limits, cache-control/ETag use.

## Findings

No confirmed findings.

I did not find a current HEAD defect with enough evidence to file as a performance/concurrency issue. The notable risk areas are either bounded in code, rate-limited, cache-protected, or already documented as measured-tradeoff candidates rather than confirmed regressions.

## Confirmed Controls

- DB pool is fixed at 10 connections with queue limit 20, keepalive, and connection init protection for `group_concat_max_len` (`apps/web/src/db/index.ts:23`, `apps/web/src/db/index.ts:25`, `apps/web/src/db/index.ts:60`, `apps/web/src/db/index.ts:94`).
- Listing queries cap rows at 100/101 and use keyset cursors for load-more paths; legacy offset is capped in public actions (`apps/web/src/lib/data.ts:667`, `apps/web/src/lib/data.ts:784`, `apps/web/src/app/actions/public.ts:121`, `apps/web/src/app/actions/public.ts:135`).
- Tag labels for listings use one aggregate join shape, not per-row tag fetches (`apps/web/src/lib/data.ts:661`, `apps/web/src/lib/data.ts:788`, `apps/web/src/lib/data.ts:1649`).
- Shared-group view counters are buffered with hard caps, chunked DB updates, retry caps, and shutdown drain support (`apps/web/src/lib/data.ts:35`, `apps/web/src/lib/data.ts:73`, `apps/web/src/lib/data.ts:119`, `apps/web/src/lib/data.ts:186`, `apps/web/src/lib/data.ts:222`).
- Image queue concurrency is DB-pool-budgeted; retry maps and permanently failed IDs are bounded and pruned (`apps/web/src/lib/image-queue.ts:102`, `apps/web/src/lib/image-queue.ts:109`, `apps/web/src/lib/image-queue.ts:122`, `apps/web/src/lib/image-queue.ts:216`, `apps/web/src/lib/image-queue.ts:347`).
- Image processing avoids heap-buffering originals, disables Sharp cache, uses `sequentialRead`, gates decompression pixels, caps wide-gamut rgb16 memory with downscale, and cleans downscale temp files (`apps/web/src/lib/process-image.ts:36`, `apps/web/src/lib/process-image.ts:54`, `apps/web/src/lib/process-image.ts:57`, `apps/web/src/lib/process-image.ts:352`, `apps/web/src/lib/process-image.ts:905`, `apps/web/src/lib/process-image.ts:922`, `apps/web/src/lib/process-image.ts:1117`, `apps/web/src/lib/process-image.ts:1476`).
- Derivative serving has ETag-based 304 support and a 5-second stale-while-revalidate settings hash cache, so image floods do not issue one settings query per file (`apps/web/src/lib/serve-upload.ts:46`, `apps/web/src/lib/serve-upload.ts:50`, `apps/web/src/lib/serve-upload.ts:229`, `apps/web/src/lib/serve-upload.ts:239`).
- Semantic/similar search has same-origin checks, request body caps, rate-limit pre-increment, bounded embedding scans, and model-version-indexed query shape (`apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/semantic/route.ts:147`, `apps/web/src/app/api/search/semantic/route.ts:178`, `apps/web/src/app/api/search/semantic/route.ts:270`, `apps/web/src/app/api/search/similar/[id]/route.ts:98`, `apps/web/src/app/api/search/similar/[id]/route.ts:168`, `apps/web/src/db/schema.ts:295`).
- Public OG routes rate-limit CPU-heavy image generation, emit success cache headers, and short-circuit with ETags (`apps/web/src/app/api/og/route.tsx:83`, `apps/web/src/app/api/og/route.tsx:127`, `apps/web/src/app/api/og/photo/[id]/route.tsx:100`, `apps/web/src/app/api/og/photo/[id]/route.tsx:139`, `apps/web/src/app/api/og/photo/[id]/route.tsx:151`).
- Atom feeds are row-capped, ETagged, and cacheable; topic feed adds a public feed rate-limit around topic miss probes (`apps/web/src/app/feed.xml/route.ts:17`, `apps/web/src/app/feed.xml/route.ts:61`, `apps/web/src/app/feed.xml/route.ts:163`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:70`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:99`).
- Rate-limit maps and upload trackers enforce hard caps (`apps/web/src/lib/bounded-map.ts:91`, `apps/web/src/lib/bounded-map.ts:102`, `apps/web/src/lib/upload-tracker-state.ts:23`, `apps/web/src/lib/upload-tracker-state.ts:47`).

## Residual Risks

- Public text search remains `LIKE '%term%'` over several fields (`apps/web/src/lib/data.ts:1593`). It is rate-limited and capped, so I am not filing this without production `EXPLAIN` / latency evidence.
- Feed and sitemap freshness helpers order by `updated_at` without a dedicated `(processed, updated_at, created_at)` index (`apps/web/src/lib/data.ts:827`, `apps/web/src/lib/data.ts:1683`). Both are capped/cached crawler surfaces, so this remains an observation, not a confirmed issue.
- Semantic search is intentionally brute-force over a bounded recent embedding scan (`apps/web/src/lib/clip-embeddings.ts:36`, `apps/web/src/lib/clip-embeddings.ts:44`). That is acceptable at current caps; future production galleries with larger active embedding sets may need vector indexing or prefiltered scans.

## Final Sweep

I found no unbounded public result path, no confirmed N+1 regression, no uncapped CPU-heavy public route, no unbounded module-level cache/map growth, no image-pipeline temp-file leak, and no current DB query/index mismatch severe enough to file without runtime evidence.

Disposition: no confirmed performance findings.
