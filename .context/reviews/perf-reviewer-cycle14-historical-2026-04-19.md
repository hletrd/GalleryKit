# Performance Review — Cycle 14 (2026-04-20)

**Reviewer:** perf-reviewer
**Scope:** Performance, concurrency, CPU/memory usage, UI responsiveness, unnecessary re-renders, inefficient data structures, N+1 queries, unbounded memory growth

---

## Methodology

Every source file under `apps/web/src/` was examined, including:
- All 7 server action modules (`actions/*.ts`)
- Data layer (`lib/data.ts`), schema (`db/schema.ts`)
- Image processing pipeline (`process-image.ts`, `image-queue.ts`, `process-topic-image.ts`)
- Gallery config (`gallery-config.ts`, `gallery-config-shared.ts`)
- Security modules (`session.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `validation.ts`)
- All React components (home-client, photo-viewer, image-zoom, histogram, lightbox, search, load-more, upload-dropzone, image-manager, tag-filter, nav-client, info-bottom-sheet, optimistic-image)
- Admin pages and client components (dashboard, db-actions, categories, tags, settings, seo)
- API routes (health, og, uploads)

Cycle 13 findings (C13-F01 through C13-F06, C13-01 through C13-03) and all previously deferred items were checked for regressions — none found. Only NEW findings are reported below.

---

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| P14-F01 | Search and admin thumbnails hardcoded to `_640` size — 404s + wasteful OptimisticImage retries when 640 not configured | MEDIUM | High | IMPLEMENT |
| P14-F02 | LoadMore IntersectionObserver fails to re-observe sentinel after remount — infinite scroll silently breaks | MEDIUM | High | IMPLEMENT |

---

### P14-F01: Search and admin thumbnails hardcoded to `_640` size — causes 404s and wasteful retry cascades [MEDIUM]

**Files:**
- `apps/web/src/components/search.tsx:210`
- `apps/web/src/components/image-manager.tsx:335`

**Description:**

C13-03 fixed the histogram's hardcoded `_640.jpg` by using `findNearestImageSize()`, but the same pattern persists in two other components:

1. **Search results** (`search.tsx:210`):
   ```ts
   src={imageUrl(`/uploads/jpeg/${image.filename_jpeg?.replace(/\.jpg$/i, '_640.jpg')}`)}
   ```

2. **Admin dashboard** (`image-manager.tsx:335`):
   ```ts
   src={`/uploads/avif/${image.filename_avif.replace(/\.avif$/i, '_640.avif')}`}
   ```

If 640 is not in the admin-configured `imageSizes`, every thumbnail request returns a 404. The `OptimisticImage` wrapper then retries up to 5 times with exponential backoff (500ms × 2^retry, capped at 15s). For the admin dashboard with 50 images, this produces up to **250 failed HTTP requests** and blocks each image's retry timer for ~23 seconds total (500 + 1000 + 2000 + 4000 + 8000 = 15.5s per image). During this window, the UI shows loading spinners that never resolve.

**Concrete impact:**
- Wasted network bandwidth: 250 failed requests × average response size
- UI lag: OptimisticImage retry timers keep running for ~23s per image
- Visual regression: all admin/search thumbnails show "Image unavailable" fallback
- Only manifests when admin configures custom image sizes that exclude 640

**Fix:** Use `findNearestImageSize(imageSizes, 640)` from `gallery-config-shared.ts` (same pattern as the histogram fix in C13-03):

```ts
// search.tsx
import { findNearestImageSize } from '@/lib/gallery-config-shared';
// ...
src={imageUrl(`/uploads/jpeg/${image.filename_jpeg?.replace(/\.jpg$/i, `_${findNearestImageSize(DEFAULT_IMAGE_SIZES, 640)}.jpg`)}`)}

// image-manager.tsx
import { findNearestImageSize } from '@/lib/gallery-config-shared';
// ...
src={`/uploads/avif/${image.filename_avif.replace(/\.avif$/i, `_${findNearestImageSize(DEFAULT_IMAGE_SIZES, 640)}.avif`)}`}
```

For the admin dashboard, consider passing `imageSizes` as a prop so the configured sizes are used instead of the defaults.

---

### P14-F02: LoadMore IntersectionObserver fails to re-observe sentinel after remount — infinite scroll silently breaks [MEDIUM]

**File:** `apps/web/src/components/load-more.tsx:69-84`

**Description:**

The `IntersectionObserver` is created once on mount with `[]` deps and observes the sentinel `div`:

```ts
useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
        (entries) => {
            if (entries[0].isIntersecting) {
                loadMoreRef.current();
            }
        },
        { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
}, []);
```

The sentinel is conditionally rendered:

```ts
{hasMore && (
    <div ref={sentinelRef} ...>
```

When `hasMore` transitions `true` → `false` → `true` (e.g., user loads all images in a topic, then switches to a different topic with more images), the sentinel `div` is unmounted and then remounted. The observer is still watching the old (now detached) DOM element. The new sentinel element is **never observed**, so `loadMoreRef.current()` is never called again.

**Reproduction:**
1. Navigate to a topic with > 30 images
2. Scroll to load all images until `hasMore` becomes `false`
3. Switch to a different topic via tag filter
4. The new topic loads 30 images with `hasMore=true`, but the sentinel div is not observed
5. Scrolling to the bottom does nothing — no more images load

**Concrete impact:** Infinite scroll silently breaks after the first topic is fully loaded. Users must manually refresh the page to load more images in subsequent topics.

**Fix:** Re-create the observer when `hasMore` changes, or avoid unmounting the sentinel:

Option A — Re-observe on `hasMore` change:
```ts
useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
        (entries) => {
            if (entries[0].isIntersecting) {
                loadMoreRef.current();
            }
        },
        { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
}, [hasMore]); // re-create when sentinel remounts
```

Option B (simpler) — Never unmount the sentinel, just hide it:
```tsx
<div
    ref={sentinelRef}
    className={cn("flex justify-center py-8", !hasMore && "h-0 overflow-hidden py-0")}
>
    {loading && hasMore && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
</div>
```

Option B is preferred because it keeps the observer stable and avoids the overhead of disconnect/reconnect cycles.

---

## Previously Deferred Items (No Change)

All previously deferred performance items from cycles 5–39 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C9-F01: original_file_size bigint `mode: 'number'` precision [MEDIUM]
- C13-F05: batchUpdateImageTags N+1 queries (performance)
- C13-F06: photo-viewer.tsx showLightbox effect re-registration (informational)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-39-02: `processImageFormats` unlink-before-link race window
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory

---

## Areas Reviewed With No New Issues Found

- **React `cache()` deduplication**: `getImage`, `getTopicBySlug`, `getTopicsWithAliases`, `getImageByShareKey`, `getSharedGroup`, `getSeoSettings`, `getGalleryConfig`, `getCurrentUser`, `verifySessionToken` — all correctly deduplicated within SSR request context
- **`getGalleryConfig()` in upload loop**: Called per-file inside `uploadImages` loop at `images.ts:146`, but React `cache()` deduplicates within the single server action context — only one DB query per upload batch
- **`Promise.all` parallelism**: `getImage` (tags + prev + next in parallel), `getSharedGroup` (group + images in parallel), `getTopicsWithAliases` (topics + aliases in parallel), admin dashboard (4 queries in parallel)
- **`useMemo` usage**: `orderedImages` in `home-client.tsx`, `srcSetData` in `photo-viewer.tsx`, `topicsMap` in `home-client.tsx` — all correctly memoized with appropriate deps
- **Ref-based DOM manipulation**: `ImageZoom` avoids re-renders on mousemove/touchmove via refs — well-optimized
- **Histogram Web Worker**: Zero-copy `ArrayBuffer` transfer, 256×256 canvas cap, lazy worker creation — efficient
- **`requestAnimationFrame` debouncing**: `useColumnCount` in `home-client.tsx` correctly debounces resize events
- **Scroll handler optimization**: `showBackToTop` uses functional update form to avoid unnecessary state sets
- **Upload streaming**: `saveOriginalAndGetMetadata` streams to disk via `pipeline()` instead of buffering on heap
- **Sharp pipeline**: `processImageFormats` uses `clone()` to share decoded buffer across formats, `copyFile` optimization for duplicate resize widths
- **ISR caching**: Photo pages (1 week), topic/home pages (1 hour), admin pages force-dynamic — appropriate cache durations
- **Connection pool**: 10 connections, queue limit 20, keepalive enabled
- **Rate limiting**: Hard caps on all in-memory Maps, bounded by `MAX_KEYS` constants, insertion-order eviction with hard cap
- **Image queue**: PQueue with configurable concurrency, MySQL advisory locks for multi-process safety, retry maps with `MAX_RETRY_MAP_SIZE` cap, hourly GC via `pruneRetryMaps`

---

## TOTALS

- **2 MEDIUM** findings requiring implementation
- **0 HIGH/CRITICAL** findings
- **0 LOW** findings
- **2 total** actionable findings
