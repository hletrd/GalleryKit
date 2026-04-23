# GalleryKit Performance Review -- Round 5

**Date:** 2026-04-11
**Reviewer:** Systems Performance Veteran
**Target:** aarch64 (ARM64), 3 CPUs, 6 GB RAM, Docker standalone, MySQL 8.0+, behind nginx
**Previous rounds:** R1 (32), R2 (22), R3 (19 issues: 0 P0 / 4 P1 / 8 P2 / 7 P3), R4 (19 issues: 0 P0 / 4 P1 / 8 P2 / 7 P3)
**Scope:** Full source read of all 40+ source files. Focused verification of Round 4 changes and four caller-specified diagnostic questions.

---

## Round 4 Fix Verification

### R4: PQueue concurrency = 2 (persists from R2)
**File:** `apps/web/src/lib/image-queue.ts:33`
**Status: VERIFIED -- FIXED (Round 2, confirmed stable)**
`new PQueue({ concurrency: Number(process.env.QUEUE_CONCURRENCY) || 2 })`. Configurable via env var. Two images process simultaneously. Correct for 3-CPU target.

### R4: Histogram moved to Web Worker
**File:** `apps/web/src/components/histogram.tsx:155-159`, `apps/web/public/histogram-worker.js`
**Status: VERIFIED -- IMPLEMENTED**
Worker created per component mount, terminated on unmount. Pixel buffer transferred via `Transferable` (zero-copy). See Targeted Answer #2 for detailed analysis.

### R4: content-visibility on masonry cards
**File:** `apps/web/src/app/[locale]/globals.css:136-139`
**Status: VERIFIED -- IMPLEMENTED**
`.masonry-card { content-visibility: auto; contain-intrinsic-size: auto 300px; }`. See Targeted Answer #1 for detailed analysis.

### R4: Sitemap capped at 24K images
**File:** `apps/web/src/app/sitemap.ts:13`
**Status: VERIFIED -- IMPLEMENTED**
`MAX_SITEMAP_IMAGES = 24000`. With 2 locales, produces up to 48K URLs. Under Google's 50K limit. Improvement from unbounded.

### R4: Admin dashboard paginated to 50
**File:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:6-12`
**Status: VERIFIED -- FIXED**
`PAGE_SIZE = 50` with page parameter from searchParams. This resolves R3-P1-002 (formerly "200 images with full GROUP BY"). The query now fetches 50 images per page. However, `getImages()` (the heavy JOIN+GROUP BY variant) is still used instead of `getImagesLite()`. See P1-002.

### R4: Back-to-top with passive scroll listener
**File:** `apps/web/src/components/home-client.tsx:302-318`
**Status: VERIFIED -- IMPLEMENTED**
Uses `{ passive: true }` on the scroll listener. See Targeted Answer #4 for detailed analysis including a correctness concern.

### R4: Search keyboard navigation
**File:** `apps/web/src/components/search.tsx:121-129`
**Status: VERIFIED -- IMPLEMENTED**
ArrowDown/ArrowUp/Enter handling with `activeIndex` state and `resultRefs` for focus management. Correct implementation.

### R4: Upload streaming to disk
**File:** `apps/web/src/lib/process-image.ts:252-261`
**Status: VERIFIED -- CONFIRMED (present since earlier rounds)**
`pipeline(nodeStream, createWriteStream(originalPath))` streams the upload to disk. Sharp then operates via file path (mmap). This avoids materializing up to 200 MB on the Node.js heap.

### R4: Sharp cpuCount - 1
**File:** `apps/web/src/lib/process-image.ts:12-17`
**Status: VERIFIED -- IMPLEMENTED**
`const maxConcurrency = Math.max(1, cpuCount - 1)`. On 3-CPU target, Sharp gets 2 libvips threads, leaving 1 CPU for the Node.js event loop. Correct.

### R3-P1-003: Sequential tag operations in ImageManager
**File:** `apps/web/src/components/image-manager.tsx:328-352`
**Status: NOT FIXED -- PERSISTS**
Tag add/remove still uses sequential `for` loops with individual `await addTagToImage()` / `await removeTagFromImage()` calls. Each is a full server action round-trip. See P1-001.

### R3-P2-005: Upload dedup title fallback
**File:** `apps/web/src/app/actions/images.ts:72-86`
**Status: NOT FIXED -- PERSISTS**
Still matches on `or(eq(images.user_filename, originalFilename), and(isNull(images.user_filename), eq(images.title, originalFilename)))`. See P2-005.

### R3-P2-006: revalidatePath scatter / cache thrashing
**File:** `apps/web/src/app/actions/tags.ts:57,80,113,186` and `apps/web/src/app/actions/images.ts:247,310,394,424`
**Status: NOT FIXED -- PERSISTS**
Tag and image operations still call `revalidatePath('/')` and `revalidatePath('/admin/dashboard')`. See P2-004.

### R3-P3-005: ImageZoom transition lag during pan
**File:** `apps/web/src/components/image-zoom.tsx:137`
**Status: NOT FIXED -- PERSISTS**
Inner div still has `transition-transform duration-300 ease-out` unconditionally. See P3-004.

### R3-P3-007: External font CDN
**File:** `apps/web/src/app/[locale]/layout.tsx:99-103`
**Status: NOT FIXED -- PERSISTS**
Pretendard still loaded from `cdn.jsdelivr.net`. See P2-006.

---

## Targeted Answers to Caller Questions

### 1. Does `content-visibility: auto` actually help?

**Yes, but with a caveat that partially undermines it.**

`globals.css:136-139` applies `content-visibility: auto; contain-intrinsic-size: auto 300px;` to `.masonry-card`. This is textbook correct for a vertically-scrolled list. The browser skips layout and paint for offscreen cards, which on a gallery page with 60-100+ images is a meaningful win: fewer layout passes, less paint, faster initial render.

**The caveat:** CSS `columns` layout (used in `home-client.tsx:177`: `columns-1 sm:columns-2 md:columns-3 xl:columns-4`) distributes items top-to-bottom within each column. The browser must know or estimate the height of every item to decide where column breaks fall. `content-visibility: auto` with `contain-intrinsic-size` provides that estimate (300px), but actual heights vary significantly: portrait photos may be 600px, landscapes 200px. The `auto` keyword in `contain-intrinsic-size: auto 300px` means "use the last-rendered height if available, otherwise 300px." On first load, all cards use 300px, causing the browser to miscalculate column break positions. As the user scrolls and actual heights resolve, the column layout may shift.

Each masonry card already has explicit `width` and `height` on the `<img>`, and the card div uses inline `style={{ aspectRatio }}` or `backgroundImage` blur placeholders. This reduces but does not eliminate the estimation error because the card also contains an overlay div with text.

**Verdict:** Net positive. Keep it. The initial column break estimation error is minor because CSS `columns` recalculates as heights resolve, and the visual shift is masked by the scroll position. The performance win (skipping layout/paint for 50+ offscreen cards) outweighs the minor CLS. For further improvement, set `contain-intrinsic-size` per card via inline style computed from the actual aspect ratio.

### 2. Is the Worker overhead worth it for 256x256 canvas?

**Marginal, but acceptable. The Worker is solving a problem that barely exists at this canvas size.**

The histogram computation in `histogram-worker.js` iterates `256 * 256 * 4 = 262,144` bytes. On an aarch64 core, this completes in under 1ms. The Worker overhead:

- **Worker creation:** ~5ms (one-time per component mount; amortized across all histograms during that mount).
- **`postMessage` + buffer transfer:** Near-zero because the 256KB ArrayBuffer is `Transferable` via `[buffer]` transfer list (`histogram.tsx:68`). Zero-copy. Good.
- **Message round-trip latency:** ~0.5ms per message.

Total per histogram: ~1.5ms (round-trip + computation), versus ~1ms inline on the main thread. The Worker adds ~0.5ms of overhead.

The histogram is computed once per photo view (when the sidebar is open), only on the 640px JPEG variant, and is not on the critical render path. The main-thread blocking would be <1ms -- well within a single frame budget (16ms).

**Verdict:** Keep it. It is not hurting anything, the Transferable buffer usage is correct, and it future-proofs against larger canvas sizes. But the real performance win was capping the canvas at 256x256, not the Worker.

### 3. Does the MySQL rate limiting add latency to every search?

**No. The search rate limiter is entirely in-memory.**

`public.ts:29-47` uses the in-memory `searchRateLimit` Map (`Map<string, { count: number; resetAt: number }>`), not the MySQL-backed `checkRateLimit`/`incrementRateLimit` functions from `rate-limit.ts`. The MySQL `rateLimitBuckets` table is infrastructure that exists in the schema but is not called from any hot path. Both search and login rate limiting use in-memory Maps.

A Map lookup is O(1) in nanoseconds. The pruning at `public.ts:33-36` fires when `searchRateLimit.size > 50`, iterating and deleting expired entries. For a self-hosted gallery, the number of unique IPs with active search windows is unlikely to exceed a few hundred. Cost: microseconds.

**Verdict:** Zero latency added to search. The in-memory approach is correct. The `rateLimitBuckets` MySQL table appears to be unused infrastructure -- it adds no overhead, but it is dead weight in the schema.

### 4. Is the back-to-top scroll listener performant?

**The performance is good. There is a correctness issue with the ref callback pattern.**

**Performance analysis:** The `{ passive: true }` option prevents the listener from blocking scroll compositing. The handler does a single `classList.toggle('scrolled', window.scrollY > 600)` -- an O(1) DOM operation with no forced reflow. The CSS `[.scrolled_&]:opacity-100` in the button's Tailwind classes means the browser only toggles opacity and pointer-events, which are compositor-friendly properties. No `requestAnimationFrame` throttle is needed because `classList.toggle` is idempotent. This is about as efficient as a scroll listener can be.

**Correctness concern:** The scroll listener is attached via an inline ref callback:

```tsx
ref={(el) => {
    if (!el) return;
    const handleScroll = () => {
        document.documentElement.classList.toggle('scrolled', window.scrollY > 600);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
}}
```

In React 19 (which this project uses), ref callbacks CAN return a cleanup function. However, this is an inline arrow function, which means React sees a new function identity on every render. React 19 will call the previous ref's cleanup, then call the new ref. This means on every re-render of `HomeClient` (state changes from `setAllImages`, column count changes, tag filter changes), the scroll listener is detached and reattached. The reattach is fast (microseconds), but there is a brief window where the listener is absent, and the pattern creates unnecessary garbage (new closure per render).

**Verdict:** Performant, but should use `useEffect` for correctness. See P2-001.

---

## Issues Found

### P0-CRITICAL (0 issues)

No critical issues. Race conditions remain properly addressed (claim-check pattern in queue, conditional UPDATE on completion, transactional deletes). Memory safety is guaranteed by the TypeScript/Node.js runtime. Authentication uses timing-safe comparison and Argon2id. No undefined behavior paths.

---

### P1-HIGH (3 issues)

```
[P1-001] UI Responsiveness -- image-manager.tsx:328-352
Sequential tag add/remove issues N serial server action round-trips.

File: apps/web/src/components/image-manager.tsx:328-352
```

**Description:** The `onTagsChange` handler processes tag additions and removals sequentially:

```typescript
for (const tag of added) {
    const res = await addTagToImage(image.id, tag);  // full round-trip
}
for (const tag of removed) {
    const res = await removeTagFromImage(image.id, tag);  // full round-trip
}
```

Each iteration is a full server action round-trip: Next.js RSC protocol -> auth verification (`getCurrentUser` -> `getSession` -> `verifySessionToken` -> DB lookup) -> DB insert/delete -> `revalidatePath` -> response. Adding 3 tags and removing 1 tag = 4 sequential round-trips at ~50-100ms each.

**Impact:** Tag editing feels sluggish. 4 tag changes = 200-400ms of blocking UI. The admin cannot interact with other rows during the awaits. On higher-latency connections, this compounds to seconds.

**Fix:** Create a single `batchUpdateImageTags(imageId, addTags[], removeTags[])` server action that handles all changes in one request with one auth check. The existing `batchAddTags` in `actions/tags.ts` demonstrates the pattern.

---

```
[P1-002] Database -- dashboard/page.tsx:13 + data.ts:189-209
Admin dashboard still uses getImages() (heavy JOIN + GROUP BY), not getImagesLite().

File: apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:13
      apps/web/src/lib/data.ts:189-209
```

**Description:** The admin dashboard calls `getImages(undefined, undefined, PAGE_SIZE, offset, true)` which performs `LEFT JOIN imageTags + LEFT JOIN tags + GROUP BY images.id + GROUP_CONCAT`. The pagination to 50 rows (Round 4 fix) helps, but the GROUP BY still forces MySQL to materialize the full intermediate join (50 images x N tags) before grouping and sorting. The `selectFields` object includes `blur_data_url` (TEXT, 200-500 bytes/row), `description` (TEXT), and 15 EXIF columns that the `ImageManager` component never displays.

`getImagesLite()` exists and uses a scalar subquery pattern that avoids the JOIN+GROUP BY entirely. The admin dashboard should use it.

**Impact:** Admin dashboard load time degrades as gallery grows. The GROUP_CONCAT forces a temporary table. EXIF columns bloat the RSC payload with ~50 KB of unused data for 50 images.

**Fix:** Switch admin dashboard to `getImagesLite()` with `includeUnprocessed=true`, or create a dedicated `getImagesAdmin()` selecting only the 8 columns used by ImageManager.

---

```
[P1-003] Memory -- sitemap.ts:42-49
Sitemap materializes up to 48K objects in memory per request.

File: apps/web/src/app/sitemap.ts:40-49
```

**Description:** `cappedImages.flatMap()` with 2 locales creates up to `24000 * 2 = 48000` objects plus topic entries. Each object has a `url` string (~60 chars), `lastModified` (Date object), `changeFrequency`, and `priority`. The sitemap is `force-dynamic`, so this allocation occurs on every `/sitemap.xml` request.

On a 6 GB machine running Next.js + Sharp + MySQL, this is ~30-50 MB of heap per sitemap request. Next.js then serializes this array to XML, holding both representations simultaneously during serialization.

**Impact:** If multiple crawlers hit `/sitemap.xml` concurrently, each request allocates ~50 MB. On a 6 GB machine, 3 concurrent crawlers consume ~150 MB for sitemaps alone, causing GC pressure.

**Fix:** Split into a sitemap index with per-topic child sitemaps. Each child sitemap would contain ~2-5K URLs, capping per-request allocation at ~5 MB. Alternatively, reduce `MAX_SITEMAP_IMAGES` to 10K (20K URLs with 2 locales).

---

### P2-MEDIUM (6 issues)

```
[P2-001] Correctness -- home-client.tsx:306-314
Back-to-top scroll listener attached via inline ref callback re-registers on every render.

File: apps/web/src/components/home-client.tsx:306-314
```

**Description:** As detailed in Targeted Answer #4. The inline arrow function creates a new function identity each render. In React 19, the previous ref's cleanup fires and the new ref is called, detaching and reattaching the scroll listener on every `HomeClient` re-render. This creates brief windows where the listener is absent and generates unnecessary closures.

**Impact:** Minor. The detach/reattach is microseconds. The brief absence window is imperceptible. But it is incorrect usage of the ref callback pattern.

**Fix:** Move to a `useEffect`:
```typescript
useEffect(() => {
    const handleScroll = () => {
        document.documentElement.classList.toggle('scrolled', window.scrollY > 600);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
}, []);
```

---

```
[P2-002] CLS -- globals.css:138
contain-intrinsic-size uses fixed 300px instead of per-card aspect ratio.

File: apps/web/src/app/[locale]/globals.css:138
```

**Description:** As detailed in Targeted Answer #1. `contain-intrinsic-size: auto 300px` uses 300px as the height estimate for all masonry cards. Portrait photos (~600px rendered height) and wide landscapes (~180px) both get 300px, causing the CSS columns algorithm to miscalculate column breaks on initial render. As the user scrolls and actual heights resolve, layout shifts occur.

Each card already has width/height data in the props. The estimated height could be computed per card.

**Impact:** Minor cumulative layout shift (CLS) on scroll, affecting Core Web Vitals. The shift is masked by scroll position for below-fold content, but above-fold cards with very different aspect ratios may visibly jump.

**Fix:** Set `contain-intrinsic-size` via inline style on each `.masonry-card` div, computed from the image aspect ratio. Keep the CSS class as a fallback.

---

```
[P2-003] DB Pool -- db/index.ts:18-19
connectionLimit: 8 is undersized for concurrent Sharp + SSR + admin workload.

File: apps/web/src/db/index.ts:18-19
```

**Description:** The pool has `connectionLimit: 8, queueLimit: 20`. With PQueue concurrency 2, each queue job does a claim-check SELECT and a conditional UPDATE. SSR pages do multiple parallel queries (e.g., `getImage` fires 4 concurrent queries via `Promise.all`). The admin dashboard does 4 parallel queries. Upload actions do inserts. Under sustained load (uploading 50 images while users browse), 8 connections can be exhausted.

CLAUDE.md states "Connection pool: 20 connections, queue limit 50" but the actual code has 8/20. Either the documentation is stale or this was an intentional reduction that is now too aggressive.

**Impact:** Under moderate concurrent load (admin uploading + public browsing), queries queue in the MySQL pool. In the worst case, `queueLimit: 20` overflow causes 500 errors.

**Fix:** Increase `connectionLimit` to 12-15. For MySQL 8 on a 6 GB machine, each connection consumes ~1 MB server-side, so 15 connections = 15 MB -- negligible. Update CLAUDE.md to match.

---

```
[P2-004] Cache Thrashing -- actions/tags.ts, actions/images.ts
revalidatePath('/') called by tag and metadata operations.

File: apps/web/src/app/actions/tags.ts:57,113,186
      apps/web/src/app/actions/images.ts:247,310,424
```

**Description:** `addTagToImage`, `removeTagFromImage`, `batchAddTags`, and `updateImageMetadata` call `revalidatePath('/admin/dashboard')` and various combinations of `revalidatePath('/')`. The homepage and topic pages have `revalidate = 3600` (1 hour ISR). Every tag operation invalidates the entire site cache.

A busy admin editing tags on 20 images triggers 20+ full-site cache invalidations. The 1-hour ISR becomes meaningless.

**Impact:** ISR cache thrashing. Every admin tag operation forces the next visitor to trigger a full SSR of the homepage and all topic pages.

**Fix:** Use targeted revalidation. Tag operations: `revalidatePath('/admin/dashboard')` only. Image metadata: `revalidatePath(\`/p/${id}\`)`. Reserve `revalidatePath('/')` for upload, delete, and topic changes.

---

```
[P2-005] Correctness -- actions/images.ts:72-86
Upload deduplication matches on title as fallback, risking silent overwrite.

File: apps/web/src/app/actions/images.ts:72-86
```

**Description:** The existing-image lookup uses:
```typescript
.where(or(
    eq(images.user_filename, originalFilename),
    and(isNull(images.user_filename), eq(images.title, originalFilename))
))
```

The title fallback means uploading "sunset.jpg" will match and silently REPLACE any image whose title was manually set to "sunset.jpg", even if it is a different image with different content and topic.

**Impact:** Silent data loss. An admin who titled an image with a common filename could have it overwritten. The original file is deleted before the replacement is saved.

**Fix:** Remove the title fallback. Match only on `user_filename`:
```typescript
.where(eq(images.user_filename, originalFilename))
```

---

```
[P2-006] Responsiveness -- layout.tsx:99-103
Pretendard font loaded twice (preload + stylesheet) and is render-blocking.

File: apps/web/src/app/[locale]/layout.tsx:99-103
```

**Description:** Two adjacent `<link>` tags: `rel="preload" as="style"` and `rel="stylesheet"` for the same Pretendard CSS URL from `cdn.jsdelivr.net`. The `rel="preload"` fetches the resource but does not apply it; the immediately-following `rel="stylesheet"` triggers the same fetch (cache hit) and applies it. The preload adds parser overhead with no benefit when the stylesheet link is adjacent. More importantly, the external `<link rel="stylesheet">` is render-blocking: FCP is delayed by CDN round-trip latency (100-500ms).

**Impact:** FCP delayed by CDN latency. CDN outage causes FOIT. The preload+stylesheet duplication is a minor parser inefficiency.

**Fix:** Self-host Pretendard WOFF2 files in `public/fonts/`. Use `@font-face` with `font-display: swap` in globals.css. Remove both CDN links and tighten the CSP `font-src` directive.

---

### P3-LOW (5 issues)

```
[P3-001] Bundle -- lightbox.tsx:6
useReducedMotion imported from framer-motion for a single boolean.

File: apps/web/src/components/lightbox.tsx:6
```

**Description:** `lightbox.tsx` imports `useReducedMotion` from framer-motion solely to conditionally skip CSS transitions. Since PhotoViewer is dynamically imported, this does not affect homepage/topic bundles. Impact is limited to the photo detail page chunk.

**Fix:** Replace with `window.matchMedia('(prefers-reduced-motion: reduce)')` in a `useEffect`. This eliminates framer-motion from lightbox.tsx (photo-viewer.tsx still needs it for AnimatePresence).

---

```
[P3-002] Memory -- db-actions.ts:38-52
CSV export materializes all images with GROUP_CONCAT into a single string.

File: apps/web/src/app/[locale]/admin/db-actions.ts:38-52, 67-71
```

**Description:** `exportImagesCsv()` runs a query with no LIMIT, materializes all rows, then builds the entire CSV as a single string. For 10K+ images, peak memory is ~10-50 MB.

**Impact:** Memory spike during admin CSV export. Tolerable on 6 GB but could cause GC pauses.

**Fix:** Stream the CSV. Fetch in pages of 1000, write each chunk to a ReadableStream.

---

```
[P3-003] Histogram Worker lifecycle
Worker created on every Histogram component mount.

File: apps/web/src/components/histogram.tsx:155-159
```

**Description:** A new `Worker('/histogram-worker.js')` is created in `useEffect([], ...)` and terminated on unmount. Rapid photo navigation creates and destroys Workers in quick succession. Worker creation is ~5ms each.

**Impact:** Minor. Users do not navigate fast enough to create more than 1-2 Workers per second.

**Fix:** Consider a module-level singleton Worker that persists across mounts. Or accept as-is (the current pattern is correct, just not optimal).

---

```
[P3-004] UX -- image-zoom.tsx:137
CSS transition-transform during mouse-move pan causes 300ms lag.

File: apps/web/src/components/image-zoom.tsx:137
```

**Description:** The inner div has `transition-transform duration-300 ease-out` unconditionally. When zoomed, `applyTransform` updates the transform via direct DOM manipulation, but the CSS transition makes it animate over 300ms instead of tracking the mouse instantly. The image "floats" behind the cursor.

**Fix:** Disable transition when zoomed:
```typescript
innerRef.current.style.transition = zoomed ? 'none' : 'transform 0.3s ease-out';
```

---

```
[P3-005] Rate Limit -- public.ts:33
Search rate limit map pruning threshold is low; hard cap not enforced.

File: apps/web/src/app/actions/public.ts:33
```

**Description:** Pruning triggers at `searchRateLimit.size > 50`. The `SEARCH_RATE_LIMIT_MAX_KEYS = 2000` constant is defined in `rate-limit.ts` but not enforced in `public.ts`. Under bot traffic, the map can grow to thousands of entries between prune cycles.

**Impact:** Negligible. Map iteration of 2000 entries is microseconds. But the defined cap is not enforced.

**Fix:** Add a hard cap after pruning: evict oldest entries when `searchRateLimit.size > SEARCH_RATE_LIMIT_MAX_KEYS`.

---

## Architecture Observations (Positive Patterns)

1. **Stream-to-disk upload** (`process-image.ts:252-261`): `pipeline(nodeStream, createWriteStream(originalPath))` avoids 200 MB heap buffers. Sharp operates via file path (native mmap). Textbook correct.

2. **Sharp clone() for parallel format generation** (`process-image.ts:406`): Single decode, three format pipelines via `Promise.all`. Decoded pixel buffer shared across AVIF/WebP/JPEG. Optimal Sharp API usage.

3. **Claim-check pattern for delete-during-processing** (`image-queue.ts:57-58, 85-98`): SELECT with `WHERE processed = false` before processing; conditional UPDATE after. Orphaned files cleaned on `affectedRows === 0`. Solid concurrency design.

4. **ISR revalidation strategy**: Photo pages at 604800s (1 week), topic/home at 3600s (1 hour), admin `force-dynamic`. Well-tuned for content that changes infrequently.

5. **Dynamic import of PhotoViewer** (`p/[id]/page.tsx:10`): `next/dynamic` removes framer-motion (~40 KB gzipped) from homepage/topic bundles. Loading spinner as fallback.

6. **Timing-safe authentication** (`auth.ts:55-62, 115-116`): Pre-computed Argon2id dummy hash equalizes timing between "user exists" and "user does not exist" branches. `timingSafeEqual` for session signature verification. Prevents user enumeration.

7. **Deterministic file deletion** (`process-image.ts:180-189`): Uses known `OUTPUT_SIZES` to construct paths. O(1) per image, not O(n) readdir. Correct for directories with thousands of files.

8. **Graceful shutdown** (`instrumentation.ts:6-28`): SIGTERM handler pauses the PQueue and waits for `onIdle()` before exit. Prevents orphaned files from interrupted Sharp operations.

9. **Scalar subquery in getImagesLite** (`data.ts:172`): Correlated subquery for `tag_names` avoids JOIN+GROUP BY on the outer query. MySQL evaluates the subquery per result row (at most 30-50 after LIMIT), each hitting the covering index. Correct for paginated listings.

10. **IntersectionObserver infinite scroll** (`load-more.tsx:55-66`): Stable observer via `loadMoreRef.current` pattern avoids re-creating the observer on every state change. `rootMargin: '200px'` prefetches before the sentinel is visible.

---

## Summary Table

| Severity | Count | Categories |
|----------|-------|------------|
| P0       | 0     | -- |
| P1       | 3     | Sequential tag ops (UI), admin GROUP BY query (DB), sitemap memory (Memory) |
| P2       | 6     | Scroll ref bug, CLS from fixed contain-intrinsic-size, DB pool size, ISR cache thrashing, upload dedup correctness, render-blocking CDN font |
| P3       | 5     | framer-motion in lightbox, CSV materialization, worker lifecycle, zoom pan lag, rate limit cap |

**Total: 14 issues** (down from 19 in Round 4)

---

## Delta from Round 4

### Fixed since Round 4
- **R3-P1-002** (admin 200-image query): Paginated to 50. GROUP BY still used but scope reduced 4x. Downgraded from P1 to P1-002 (the GROUP BY pattern persists but the 200-row materialization is resolved).
- **Sitemap**: Capped at 24K (was unbounded). Remaining concern is per-request memory, downgraded to P1-003.
- **Histogram**: Moved to Web Worker with Transferable buffer. Marginal win at 256x256 but correct pattern.
- **content-visibility**: Applied to masonry cards. Net positive. Minor CLS concern (P2-002).
- **Back-to-top**: Passive scroll listener. Good performance. Ref callback issue (P2-001).
- **Search keyboard nav**: Implemented correctly. No issues.
- **Upload streaming**: Confirmed stable. No issues.
- **Sharp cpuCount-1**: Implemented correctly. Leaves 1 CPU for event loop.

### Persists from Round 4 (inherited from R3)
- **P1-001** (R3-P1-003): Sequential tag operations -- no batch action created
- **P2-004** (R3-P2-006): revalidatePath cache thrashing -- still scatters invalidation
- **P2-005** (R3-P2-005): Upload dedup title fallback -- still risks silent overwrite
- **P2-006** (R3-P3-007): External font CDN -- still render-blocking
- **P3-001** (R3-P3-001): framer-motion in lightbox -- still imported for useReducedMotion
- **P3-004** (R3-P3-005): ImageZoom transition lag -- still unconditional 300ms

### New issues in Round 5
- **P1-003**: Sitemap 48K-object per-request allocation (refined from R4 sitemap cap)
- **P2-001**: Back-to-top ref callback correctness (new: inline ref on every render)
- **P2-002**: Fixed contain-intrinsic-size CLS (new: interaction between content-visibility and CSS columns)
- **P2-003**: DB connection pool undersized at 8 (refined: CLAUDE.md says 20, code says 8)
- **P3-003**: Histogram Worker lifecycle (new: per-mount creation)
- **P3-005**: Search rate limit cap not enforced (new)

### Removed from prior rounds (resolved or acceptable)
- R3-P1-001 (Sharp CPU contention): Acceptable tradeoff with cpuCount-1. Removed.
- R3-P1-004 (upload concurrency 3): Client sends 1 file per call, so server-side concurrency is controlled by the client's UPLOAD_CONCURRENCY. Streaming to disk caps heap usage. Removed as separate P1.
- R3-P2-001 (PQueue tuning): Already configurable via env var. Removed as issue.
- R3-P2-002 (default limit 500): Latent risk only. Removed.
- R3-P2-003 (getTags not cached): Only called once per page. Minor. Removed.
- R3-P2-004 (OptimisticImage key remount): Keys are stable (src does not change on re-render). Not a real issue. Removed.
- R3-P2-007 (hard link syscalls): Negligible on SSD. Removed.
- R3-P3-002 (stale docs): Documentation, not performance. Removed from perf review.
- R3-P3-003 (tag filter duplication): Code quality, not performance. Removed.
- R3-P3-004 (histogram spread): 256 elements, microseconds. Not actionable. Removed.
- R3-P3-006 (metadata double query): Once per hour via ISR. Negligible. Removed.

---

## Recommended Fix Priority

1. **P1-001** (sequential tag ops) -- Create batch server action. Highest user-facing impact. Moderate effort.
2. **P1-002** (admin GROUP BY) -- Switch to `getImagesLite` in dashboard. 10 minutes.
3. **P2-001** (scroll ref) -- Move to `useEffect`. 2 minutes.
4. **P2-003** (DB pool) -- Increase `connectionLimit` to 12-15. 1 minute.
5. **P2-004** (revalidatePath) -- Targeted invalidation. Biggest cache-efficiency win.
6. **P2-005** (upload dedup) -- Remove title fallback. Prevents silent data loss.
7. **P2-006** (CDN font) -- Self-host Pretendard. Eliminates render-blocking external dependency.

---

## Verdict: **FIX AND SHIP**

Zero P0 issues. Security is thorough (Argon2id, HMAC-SHA256, timing-safe comparison, path traversal prevention, symlink rejection, parameterized queries, LIKE escaping, CSV formula injection escaping, CSP/HSTS headers). The image pipeline is well-architected (streaming upload, mmap, clone-based parallel encoding, race condition protection, graceful shutdown). Client-side performance is solid (passive listeners, IntersectionObserver, ref-based DOM manipulation, dynamic imports, lazy loading).

The Round 4 changes are all correct and beneficial. The issue count dropped from 19 to 14. The remaining P1 items are:
1. Sequential tag ops: batch action (architecture exists, needs one new endpoint)
2. Admin GROUP BY: use the existing lighter query
3. Sitemap memory: split into index+children or reduce cap

The application ships today for a self-hosted photo gallery on a 3-CPU/6 GB machine. Address P1 items in the next sprint for scaling beyond 5K images.
