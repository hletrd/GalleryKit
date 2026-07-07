# Review-Plan-Fix Cycle 18 Performance Review

Role lane: perf-reviewer
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Write scope: `.context/reviews/perf-reviewer.md`

## Scope

Read first, per repo policy:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/plans/cycle-17-2026-07-08-plan.md`
- `.context/plans/cycle-17-2026-07-08-deferred.md`

Inventory built with `rg --files` / `find` before findings:

- 619 TypeScript/TSX/JS/MJS files under `apps/web/src`.
- 80 app route/action/page files, 114 library modules, 61 components.
- 357 unit-test files, 12 e2e files, 28 scripts, 33 Drizzle migration/meta files.
- 443 live performance-relevant files across routes, actions, libraries, components, scripts, public assets, e2e, and migrations.

Reviewed from performance/concurrency angles: public pages and API routes, server actions, upload/restore/LR ingest, image processing and queue bootstrap/shutdown, background DB writes, analytics retention, semantic search, map/timeline/feed/sitemap selectors, service worker/cache behavior, DB pool and migration reconciliation, Docker/deploy/runtime scripts, and performance-relevant tests.

## Validation Evidence

Static guard checks run:

- `npm run lint:api-auth --workspace=apps/web` - PASS.
- `npm run lint:action-origin --workspace=apps/web` - PASS.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - PASS.

Not run: full ESLint, typecheck, build, Vitest, Playwright, DB `EXPLAIN`, browser trace, heap profiling, or production profiling. The findings below are source-confirmed and overlap the active cycle-17 deferred list, but are still present in current code.

## Findings Summary

- Confirmed issues: 3
- Likely issues: 0
- Manual-validation risks: 0

## Confirmed Issues

### C18-PERF-01 - Large multipart ingest still materializes request bodies before app-level streaming

- Severity: High
- Confidence: High
- Status: Confirmed issue, carried forward from active deferred AGG-C17-26
- File/region: `apps/web/src/app/api/admin/lr/upload/route.ts:101-180`; `apps/web/src/app/actions/images.ts:184-260`

Why this is a real problem:

The LR route rejects chunked bodies and checks `Content-Length`, then serializes parsing with `LR_MULTIPART_PARSE_MAX_IN_FLIGHT = 1`; however, the accepted request still reaches `await request.formData()` at line 180. The dashboard upload action receives already-materialized `FormData`/`File` objects before the app-level count and byte checks at lines 184-260. Downstream code streams `File.stream()` to disk, but that happens after framework multipart materialization.

Concrete failure scenario:

An admin uploads a 200 MiB image or starts several dashboard uploads while the same Node process is serving public traffic and queue work. Next/Undici materializes the multipart body into `File` objects before the app can stream to disk, causing RSS/GC pressure and potential request stalls or OOM. The LR path limits this to one parse at a time, but dashboard Server Actions and DB restore still rely on the framework body path.

Suggested fix:

Move large browser upload and DB restore ingestion to route handlers with a streaming multipart parser that enforces byte limits while reading. Keep Server Actions for small control mutations. Add one shared process-wide ingress semaphore for all large multipart surfaces, not only LR upload.

### C18-PERF-02 - Semantic search and similar-photo routes still do per-request vector scans in Node

- Severity: High
- Confidence: High
- Status: Confirmed issue, carried forward from active deferred AGG-C17-30
- File/region: `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`

Why this is a real problem:

Both routes select up to `SEMANTIC_SCAN_LIMIT` embedding blobs from MySQL, decode each row, compute similarity in Node, then rank locally. The hard cap prevents unbounded scans, and rate limiting is present, but the work remains O(scan limit) per request and consumes DB bandwidth, Node CPU, and heap per query.

Concrete failure scenario:

With production semantic search enabled and a populated embedding table, multiple users or crawlers issue semantic/similar requests. Each request pulls a large batch of MEDIUMBLOB vectors and loops over them in the request handler. Public page latency and upload/queue jobs then contend for the same DB pool and Node CPU, especially while CLIP inference or Sharp work is active.

Suggested fix:

Move nearest-neighbor lookup out of request-local brute-force scans: add a vector index/service or maintain a memory-mapped/preloaded matrix with a shared worker and refresh contract. At minimum, add a shared semantic-search concurrency budget and cache hot query/target results with invalidation on embedding model/version changes.

### C18-PERF-03 - Public map page still renders up to 10k Leaflet markers client-side

- Severity: Medium
- Confidence: High
- Status: Confirmed issue, carried forward from active deferred AGG-C17-29
- File/region: `apps/web/src/lib/data.ts:1775-1816`; `apps/web/src/components/map/map-client.tsx:77-140`

Why this is a real problem:

`getMapImages()` intentionally caps the query at `MAP_MAX_MARKERS + 1`, but the cap is still 10,000 rows and the client maps every returned item to a React Leaflet `<Marker>` with a popup. `FitBounds` also creates full latitude and longitude arrays and spreads them into `Math.min` / `Math.max`, adding another O(n) client pass.

Concrete failure scenario:

A gallery grows to thousands of geotagged, map-visible photos. Loading `/map` ships a large marker payload and React mounts thousands of marker components in one render. Mobile devices or older browsers can freeze during initial render, and popups add image work when opened.

Suggested fix:

Replace all-marker rendering with viewport-bounded fetches plus server-side clustering or tile/cluster aggregation. For the current cap, compute bounds in one loop without allocating latitude/longitude arrays, and consider a lower initial marker budget with progressive viewport loading.

## Likely Issues

None found beyond the confirmed current risks above.

## Manual-Validation Risks

None added. DB `EXPLAIN`, heap profiling, and browser trace evidence would quantify the three confirmed issues but is not required to establish them from current source.
