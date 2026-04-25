# Perf Reviewer — Cycle 8 (Fresh, broad sweep)

**Scope:** request-time latency, DB pool pressure, image pipeline cost, SSR payload, cache headers.

## File inventory examined

- `app/api/og/route.tsx`, `app/sitemap.ts`, `app/global-error.tsx`
- `lib/{data,image-queue,process-image,rate-limit}.ts`
- `app/actions/{auth,images,public}.ts`
- `app/[locale]/(public)/{page,[topic]/page,p/[id]/page}.tsx`
- `db/index.ts`

## Findings

### P8F-01 — `/api/og` returns `Cache-Control: no-store` (success path)
**Where:** `apps/web/src/app/api/og/route.tsx:38, 140`
**What:** Same finding as `CR8F-01` from a perf lens. OG image generation is one of the most expensive operations the server does (full React tree → SVG → PNG via `next/og`'s WASM resvg). On a typical 4-core box this is 200–400ms per call. With `no-store`, every Twitter/Slack/Discord crawler does a fresh round-trip, AND any direct user-share on a popular item drives 5–10× amplification per click.
**Suggested fix:** `public, max-age=3600, stale-while-revalidate=86400, immutable` on the success path. Add a SHA-256 over `{topic, tagList}` as the `etag` so unchanged input bypasses regeneration entirely.
**Confidence:** High.

### P8F-02 — `app/sitemap.ts` runs `getImageIdsForSitemap(24000)` on every crawler hit despite `revalidate = 3600`
**Where:** `apps/web/src/app/sitemap.ts:7-8, 27`
**What:** `dynamic = 'force-dynamic'` overrides the revalidate. Each crawler hit pulls up to 24k image IDs (`getImageIdsForSitemap` cap = 50k, sitemap budget ≈ 24k after locale doubling). For a multi-thousand-image gallery this is a real DB scan. Bingbot & Googlebot can hit `/sitemap.xml` aggressively while indexing.
**Suggested fix:** Drop `force-dynamic`. Keep `revalidate = 3600`. Confirm `getImageIdsForSitemap` uses the `(processed, created_at)` composite index (it does — see `data.ts:842`).
**Confidence:** High.

### P8F-03 — `getImagesLitePage` SQL uses `COUNT(*) OVER()` window function on every public listing fetch
**Where:** `apps/web/src/lib/data.ts:359-392`
**What:** `COUNT(*) OVER()` is convenient but on MySQL 8 it forces a full window over the result set even when only the first 30 rows are needed. The cost scales with total image count. For galleries with tens of thousands of processed images, the extra cost per home/topic page render is meaningful.
**Suggested fix:** Replace with the existing `getImageCount(...)` call via `Promise.all([getImagesLite, getImageCount])`. The `getImageCount` query already targets the optimized index. Two parallel queries on a 10-connection pool will frequently beat one window-function query on the same path.
**Confidence:** Medium — would need EXPLAIN benchmarks on the specific dataset to confirm magnitude.

### P8F-04 — `image-queue.ts` `gcInterval` runs `purgeExpiredSessions / purgeOldBuckets / purgeOldAuditLog / pruneRetryMaps` sequentially
**Where:** `apps/web/src/lib/image-queue.ts:444-449`
**What:** Three independent DB DELETEs are scheduled `.catch()`-chained but sequential at the syntactic level. They could run in parallel via `Promise.all` to compress a hourly maintenance burst. The current shape costs maybe 10-30ms more per cycle — it just isn't a hot path. Cosmetic.
**Suggested fix:** Wrap them in `Promise.all` if the DB pool can absorb three concurrent DELETEs (it can, pool=10).
**Confidence:** Low (micro-optimization).

### P8F-05 — `app/actions/public.ts` `loadMoreImages` catches generic errors and rolls back rate limit, but lets the error propagate up to the framework which renders a Next-internal error page
**Where:** `apps/web/src/app/actions/public.ts:108-111`
```ts
} catch (err) {
    rollbackLoadMoreAttempt(ip);
    throw err;
}
```
**What:** Throwing into a server action surfaces as an opaque "Something went wrong" toast on the client. The infinite-scroll consumer cannot distinguish a transient DB hiccup from a 500 — it stops loading and the page UX freezes. Compare with `searchImagesAction` which returns `{status: 'rateLimited', results: []}` for soft failures.
**Suggested fix:** Catch DB errors here and return `{status: 'error', images: [], hasMore: true}` (new variant) so the client can retry / display "load more" in error state. This is a UX/resilience win, not strictly perf.
**Confidence:** Medium.

### P8F-06 — `process-image.ts` `cleanString`/`cleanNumber` reject `'undefined'`/`'null'` strings only when `typeof val !== 'string'`
**Where:** `apps/web/src/lib/process-image.ts:464-473`
**What:** Cosmetic but an interesting choice — if EXIF actually says `LensModel: "null"` (some lens databases do), the type guard preserves it. Probably correct but worth a code comment for future maintainers.
**Severity:** Trivial.
**Confidence:** Low.

### P8F-07 — `data.ts` `viewCountFlushTimer` interval starts at 5s (BASE_FLUSH_INTERVAL_MS)
**Where:** `apps/web/src/lib/data.ts:18`
**What:** Each shared-group view triggers an INSERT/UPDATE within 5s of the last buffered increment. For a viral share that gets a sustained 100 req/s, the buffer never accumulates much before flushing — defeating the buffering. Increase to 15-30s to let the buffer actually coalesce, OR pivot to a count-on-flush threshold (size-based, not just time-based).
**Suggested fix:** `BASE_FLUSH_INTERVAL_MS = 15_000` and add `MAX_BUFFER_BEFORE_FORCED_FLUSH = 200`.
**Confidence:** Low — depends on traffic shape.

### P8F-08 — `home-client` and `photo-viewer` JSON-LD blocks include the full image record stringified even when robots index is `false`
**Where:** `apps/web/src/app/[locale]/(public)/{page.tsx,[topic]/page.tsx,p/[id]/page.tsx}`
**What:** When `?tags=...` is present, robots index is `false` but the JSON-LD `<script>` is still emitted. Pure waste of bandwidth on tag-filtered pages that won't be indexed.
**Suggested fix:** Skip JSON-LD blocks on `noindex` page variants.
**Confidence:** Medium.

## Severity distribution

- HIGH: 0
- MEDIUM: 4 (P8F-01 OG cache, P8F-02 sitemap dynamic, P8F-03 window count, P8F-08 JSON-LD on noindex)
- LOW: 4
