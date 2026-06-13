# Performance / Concurrency / Memory Review — GalleryKit

**Reviewer:** performance-reviewer
**Cycle:** run-? cycle 3 (review-plan-fix)
**HEAD:** `ada92ba5`
**Scope:** image pipeline, data layer, DB pool, frontend (masonry/photo-viewer/histogram/zoom/load-more), service worker, server actions.

## Verdict

**COMMENT.** No CRITICAL or HIGH performance defects at HIGH confidence. The codebase is unusually well-tuned for perf: Sharp concurrency divided by format fan-out, `sharp.cache(false)`, React `cache()` dedup, keyset pagination with `tagNamesAgg`, rAF-debounced resize, ref-based zoom (no re-render on move), worker-driven histogram with `AbortController`, snapshot-memoized `useSyncExternalStore` (React #185 guarded), and the AGG-R8-05 bounded SW HEAD probe is confirmed CLOSED. Findings below are MEDIUM/LOW efficiency cleanups and re-confirmations of the documented DEFER tradeoffs (AGG-R8-A1/A2/A3) — none regressed.

The prior-cycle closures hold:
- **AGG-R8-05 (CLOSED, not regressed):** `staleWhileRevalidateImage` HEAD ETag probe is bounded with `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS=300)` at `sw.template.js:230`, serving stale on abort via the `catch → startRevalidate(); return cached` fall-through. Verified intact.

---

## Findings

### PERF-1 — Home page issues TWO uncached GROUP_CONCAT listing queries per request (OG metadata + page body)
**Severity:** MEDIUM · **Confidence:** HIGH
**Files:**
- `apps/web/src/app/[locale]/(public)/page.tsx:106` — `generateMetadata` → `await getImagesLite(undefined, …, 1, 0)`
- `apps/web/src/app/[locale]/(public)/page.tsx:154` — `Home` → `await getImagesLitePage(undefined, filterTags, 30, 0)`
- `apps/web/src/lib/data.ts:728` (`getImagesLite`), `:818` (`getImagesLitePage`) — neither is `cache()`-wrapped (confirmed: no `cache(getImagesLite…)` export exists).

**Why it's slow:** Next.js runs `generateMetadata` and the page component in the same request. Both call into the listing layer, but they are *different functions* and *neither is memoized*, so two separate `SELECT … LEFT JOIN imageTags LEFT JOIN tags … GROUP BY images.id ORDER BY capture_date DESC, created_at DESC, id DESC` queries hit MySQL per home-page render. The metadata query fetches **1 row** but still pays the full LEFT JOIN + GROUP BY + filesort over the whole `images` table just to read the latest image's `id`/`title` for the OG card. Contrast with `/p/[id]`, which correctly routes both `generateMetadata` and the body through `getImageCached` (data.ts:1562) so React `cache()` dedupes to one fan-out.

**Scenario + magnitude:** Every home-page SSR (the highest-traffic public surface, `revalidate = 0` so it renders fresh each time). On a gallery of a few thousand images the extra query is a GROUP BY + filesort returning 1 row — order of a few ms of DB + one pool connection held for the round-trip, but it is pure redundancy (the latest image is already the first row of the 30-row page query). At low connection-pool headroom (limit 10) under concurrent home-page load it consumes a connection that the page-body query also needs.

**Fix (pick one):**
- Cheapest: in `generateMetadata`, derive the OG image from a dedicated minimal query (`SELECT id, title FROM images WHERE processed=true ORDER BY capture_date DESC, created_at DESC, id DESC LIMIT 1` — no tag JOIN/GROUP BY needed; the OG card doesn't use tags). This drops the LEFT JOIN + GROUP_CONCAT entirely.
- Or: wrap a shared `getLatestImageForOg = cache(...)` so the metadata path is memoized. (Won't dedupe against the 30-row page query since they differ in shape, but removes the GROUP BY.)
- Note the topic page (`[topic]/page.tsx`) does NOT have this issue — its `generateMetadata` uses `topicData`, not a listing query; only the body calls `getImagesLitePage` once. So this is home-page-specific.

---

### PERF-2 — Service worker fires a synchronous HEAD ETag probe per cached image tile on every warm masonry paint
**Severity:** MEDIUM · **Confidence:** MEDIUM
**File:** `apps/web/public/sw.template.js:198-255` (`staleWhileRevalidateImage`, the `if (cached)` branch with the `fetch(request.url, { method: 'HEAD', … })`)

**Why it's slow:** On a return visit with a warm `IMAGE_CACHE`, every `<img>` request for `/uploads/{avif,webp,jpeg}/…` that has an `ETag` issues a **blocking HEAD request before the cached bytes are returned** (the `await fetch(... HEAD ...)` precedes `return cached`). A masonry grid paints ~30 tiles (plus srcset candidates) at once, so a warm gallery paint dispatches ~30 concurrent HEAD round-trips, each gated to `HEAD_REVALIDATE_TIMEOUT_MS=300ms`. The `respondWith` for each tile cannot resolve from cache until its HEAD resolves or the 300ms abort fires. This is the documented R10-H3 freshness behavior (serve fresh colors immediately after an admin color-setting flip), and AGG-R8-05 already bounded the worst case to 300ms/tile — so this is NOT a regression and NOT a defect. But it is a standing efficiency cost: on a slow/high-latency connection the SWR "instant from cache" property degrades to "up to 300ms per visible tile" on every navigation, and on a fast connection it still adds ~30 HEAD RTTs of server load per warm paint.

**Scenario + magnitude:** Return visitor on mobile/4G scrolling the gallery: each warm tile waits up to one HEAD RTT (capped 300ms) before display; perceived as a brief stall versus a pure-SWR SW that returns cache instantly and revalidates in background. Server sees N HEAD requests per gallery paint per warm client.

**Fix (optional — this is a freshness-vs-latency tradeoff the team has deliberately chosen):** Consider a short client-side TTL on the HEAD probe (e.g. store last-probe timestamp in META_CACHE per URL; skip the synchronous HEAD if probed within the last N seconds and fall straight to background revalidate). That preserves "fresh within N seconds of a color-setting change" while removing the per-tile RTT on rapid re-navigation. Alternatively gate the synchronous HEAD to only the largest/base derivative per photo, not every srcset size. If the team is satisfied with the 300ms bound, this can stay as documented (record-only).

---

### PERF-3 — Bootstrap pending-image query uses `notInArray` over an unbounded-by-content (≤1000) permanently-failed ID list
**Severity:** LOW · **Confidence:** MEDIUM
**File:** `apps/web/src/lib/image-queue.ts:601-627` (`bootstrapImageProcessingQueue`, `notInArray(images.id, [...state.permanentlyFailedIds])`)

**Why it's slow:** When `permanentlyFailedIds` is populated (capped at `MAX_PERMANENTLY_FAILED_IDS=1000`, FIFO), the bootstrap `SELECT … WHERE processed=false AND id > cursor AND id NOT IN (…up to 1000 ids…) ORDER BY id ASC LIMIT 500` inlines up to 1000 literals into the `NOT IN`. MySQL handles a 1000-element `IN`/`NOT IN` fine (it's bounded), but it's run on every bootstrap pass and every bootstrap continuation (`scheduleBootstrapContinuation` re-invokes on `queue.onIdle`). The query planner may also be unable to use `idx_images_processed_created_at` as cleanly with a large `NOT IN` anti-join.

**Scenario + magnitude:** Only matters when ≥hundreds of images have permanently failed (corrupt originals, disk errors) AND there is a continuous backlog driving repeated bootstrap passes. At personal-gallery scale this is rare and the cap keeps it bounded — hence LOW. Normal operation (`permanentlyFailedIds` empty) skips the clause entirely (line 601 guard), so there is zero cost on the happy path.

**Fix (only if a large permanent-failure population is observed in prod):** Persist permanent-failure state to a column (e.g. reuse `processing_error IS NOT NULL` which is already set on permanent failure, image-queue.ts:503) and filter with `AND processing_error IS NULL` instead of the in-memory `NOT IN`. That also survives restarts (the in-memory set is lost on restart, so a restart re-enqueues every permanently-failed row once until it re-fails MAX_RETRIES times — a separate minor inefficiency). LOW priority; the current design is correct, just not restart-optimal.

---

### PERF-4 — `getImageCount` with tag filter runs an independent GROUP BY + HAVING subquery on top of the page query's `COUNT(*) OVER()`
**Severity:** LOW · **Confidence:** MEDIUM
**Files:** `apps/web/src/lib/data.ts:536-560` (`getImageCount`), `:563-576` (`buildTagFilterCondition` — the `inArray(images.id, <grouped subquery with HAVING COUNT(DISTINCT)>)`)

**Why it's slow:** The public listing path (`getImagesLitePage`, data.ts:834) already computes `total_count: COUNT(*) OVER()` as a window function in the same query, so the caller gets pagination + count in one round-trip. But `getImageCount` exists as a separate function and is still called by the admin dashboard (`dashboard/page.tsx:18`, `getImageCount(undefined, undefined, {includeUnprocessed:true})`) in the `Promise.all` alongside `getAdminImagesLite`. For the admin path that's an extra `COUNT(*)` query (no tag filter → cheap, just a count over the PK index). The tag-filtered branch (`buildTagFilterCondition`) builds an `images.id IN (SELECT imageId … GROUP BY imageId HAVING COUNT(DISTINCT slug)=N)` semi-join — fine for AND-of-tags semantics, but if ever called on a hot public path alongside the windowed count it would double the tag-intersection work.

**Scenario + magnitude:** Admin dashboard render: one extra unfiltered `COUNT(*)` (negligible, PK/secondary-index count). The tag-filtered `getImageCount` is NOT on the public hot path (public pages use `COUNT(*) OVER()` from the page query) — confirmed. So this is LOW and mostly informational.

**Fix:** None required. The split is intentional (admin grid wants a total for pagination UI; public uses the windowed count). Just confirm no future public route calls both `getImageCount(topic, tags)` AND `getImagesLitePage(topic, tags)` in the same request — that would duplicate the tag semi-join. Consider a comment on `getImageCount` noting "prefer the `total_count` window column on public paths."

---

## Re-confirmed documented tradeoffs (NOT defects — unchanged since prior cycle)

- **AGG-R8-A2 (decode-once-per-format, ~18 decodes/image):** Confirmed at `process-image.ts:1110-1115` — each format (`webp`/`avif`/`jpeg`) × each size opens a fresh `sharp(processingInputPath, …)` and decodes the source independently (the `lastRendered` hard-link dedup at :1078 only avoids re-encoding *identical resize widths within one format*, not cross-format decode reuse). This is the deliberate WI-14/R8-R8 "fresh instance per format eliminates shared-state contamination" decision. CPU-only, background queue at `QUEUE_CONCURRENCY=1` default, `sharp.concurrency = floor((cores-1)/3)` to keep the foreground responsive. **No change — remains a known CPU/correctness tradeoff.**

- **AGG-R8-A1 (Atom feed orders by `updated_at` with no covering index):** Confirmed at `data.ts:771-794` (`getImagesForFeed` → `ORDER BY updated_at DESC, created_at DESC, id DESC`). No `(processed, updated_at)` composite index exists (schema.ts:113-119 has `processed,capture_date,created_at` and `processed,created_at` but not `updated_at`). Bounded by `FEED_LIMIT`/`LISTING_QUERY_LIMIT_PLUS_ONE` (≤101 rows) + route cache. At gallery scale the filesort over a few thousand rows is sub-ms. **No change — remains record-only.**

- **AGG-R8-A3 (single-pool / single-writer):** Confirmed `db/index.ts:23` `POOL_CONNECTION_LIMIT=10`, `queueLimit=20`. The backfill runner's connection-budget arithmetic (`admin-backfill-runner.ts:105-142`, `resolveBackfillConcurrency`) correctly reserves `max(3, ceil(limit/2))=5` for live traffic and caps backfill at `floor((10-5-1)/2)=2` workers (≤5 connections pinned: 1 lock + 2×2 workers), leaving ≥5 for a full `getImage` fan-out (`data.ts:1015` fires a 3-way `Promise.all`). The NaN-guard at runner :137 (`Number.isFinite(poolLimit) ? poolLimit : 10`) prevents a frozen PQueue. **Sound — inherent topology tradeoff, well-defended.**

---

## Positive observations (perf done right)

- **Sharp thread math (`process-image.ts:36-53`):** `maxConcurrency = floor((cpuCount-1)/3)` divides libvips threads by the AVIF/WebP/JPEG fan-out so one image at `QUEUE_CONCURRENCY>1` can't drown the libuv pool; `sharp.cache(false)` keeps steady RSS since every UUID is a cache miss anyway. Exemplary.
- **Wide-gamut OOM gate (`process-image.ts:1010-1030`):** 50 MP sources downscale to a lossless TIFF intermediate (ICC preserved via `keepIccProfile`) before the rgb16 fan-out, with `autoOrient` so the pixel count is computed post-orientation. Memory-bounded correctly.
- **`useDisplayCapability` (use-display-capability.ts:47-82):** Snapshot memoized by VALUE — `detect()` returns the *same reference* until gamut/HDR actually flips, so `useSyncExternalStore`'s `Object.is` check never trips the React #185 infinite loop. The documented hazard is correctly neutralized.
- **`image-zoom.tsx`:** All pan/pinch/wheel state in refs; `applyTransform` mutates `style.transform` directly — zero React re-renders during a drag/pinch. `wheel` listener `{ passive: false }` (needs preventDefault), touch-end snap listener `{ passive: true }`. Correct passive tuning.
- **`histogram.tsx`:** O(n) histogram offloaded to a Web Worker via transferable `ArrayBuffer` (`postMessage(..., [payload.imageData])`), canvas capped at 256px, `AbortController` cancels the in-flight `<img>` load + worker request on photo change, module-scope `P3_CTX_OPTIONS` avoids per-call allocation, `requestId` matching prevents stale-response races. Clean.
- **`home-client.tsx`:** `useColumnCount` rAF-debounces resize and cancels pending rAF on cleanup; scroll handler uses `setShowBackToTop(prev => prev===shouldShow ? prev : shouldShow)` to skip no-op state updates; `containIntrinsicSize` + `aspectRatio` reserve CLS height with a guarded `width>0 && height>0` fallback. `topicsMap`/`displayTags`/`estimatedCardWidth` all memoized.
- **`load-more.tsx`:** `loadMoreRef` keeps the IntersectionObserver stable across state churn; `queryVersionRef` discards stale in-flight responses on query change; `mountedRef` (AGG-R8-07) guards setState-after-unmount. `rootMargin: '200px'` prefetch. Keyset cursor (not offset) avoids deep-offset cost on infinite scroll.
- **`photo-viewer.tsx`:** Single responsive preload per neighbor (AGG-R4C8-03 fixed the prior double-fetch), idle prefetch of prev/next pages via `requestIdleCallback`, memoized `blurStyle`/`srcSetData`, `/p/[id]` passes `images={[image]}` (single element → `findIndex` is O(1)), and `getImageCached` dedupes the metadata+body fan-out via React `cache()`.
- **Data layer:** `tagNamesAgg` (`GROUP_CONCAT DISTINCT … ORDER BY`) shared across all listing queries (locked by fixture test), `getSharedGroup` batches tags via one `inArray` query (no N+1), `getImage` parallelizes tags+prev+next via `Promise.all`, search short-circuits the tag/alias queries when the title query already fills the limit. Composite indexes match the `(processed, capture_date, created_at)` sort exactly.

---

## Summary of top findings

| ID | Severity | Conf | One-liner |
|----|----------|------|-----------|
| PERF-1 | MEDIUM | HIGH | Home page runs 2 uncached GROUP_CONCAT listing queries/request (OG metadata fetches 1 row via full LEFT JOIN + GROUP BY); use a minimal `id,title LIMIT 1` query for OG. |
| PERF-2 | MEDIUM | MED | SW fires a synchronous (300ms-bounded) HEAD ETag probe per cached tile on every warm masonry paint; optional per-URL probe TTL would cut the per-tile RTT. Documented freshness tradeoff, not a regression. |
| PERF-3 | LOW | MED | Bootstrap `notInArray` over ≤1000 permanently-failed IDs; prefer `processing_error IS NULL` filter (also restart-safe). Happy path (empty set) is zero-cost. |
| PERF-4 | LOW | MED | `getImageCount` is a separate query from the page's `COUNT(*) OVER()`; fine today (admin-only extra count), just don't pair both on a public path. |

No CRITICAL/HIGH at HIGH confidence. All prior-cycle closures (esp. AGG-R8-05 SW HEAD bound) verified intact; AGG-R8-A1/A2/A3 re-confirmed as unchanged documented tradeoffs.
