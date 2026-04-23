# Performance Review — Cycle 38 (2026-04-19)

## Reviewer: perf-reviewer
## Scope: Performance, concurrency, CPU/memory/UI responsiveness

### Findings

**Finding PERF-38-01: `getImage` performs 4 sequential DB queries without parallelism for the main select**
- **File**: `apps/web/src/lib/data.ts` lines 300-405
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: `getImage` first queries the images table (1 query), then runs `Promise.all` for tags + prev + next (3 queries in parallel). The initial query and the parallel queries could theoretically be combined, but the current design is correct because the prev/next queries depend on the image data (specifically `image.capture_date`, `image.created_at`, `image.id`). This is already well-optimized with `cache()` deduplication and `Promise.all` for the dependent queries. No actionable improvement.

**Finding PERF-38-02: `exportImagesCsv` loads up to 50,000 rows into memory**
- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts` lines 31-86
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: The CSV export loads up to 50K rows with a GROUP_CONCAT into memory, then builds a string array of CSV lines. The code does release the `results` array before joining (line 76: `results = []`), but the CSV lines array itself still holds all data. For very large galleries, this could cause memory pressure. The 50K limit and the fact that this is admin-only make this a low priority.
- **Fix**: Consider streaming the CSV response instead of building it in memory.

**Finding PERF-38-03: `reorderForColumns` runs on every render when `allImages` or `columnCount` changes**
- **File**: `apps/web/src/components/home-client.tsx` line 173
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: `useMemo(() => reorderForColumns(allImages, columnCount), [allImages, columnCount])` re-runs the column reordering algorithm whenever `allImages` changes (which happens on every load-more). The algorithm is O(n) where n is the number of images, so this is not a performance concern for typical gallery sizes. Well-optimized with `useMemo`.

**Finding PERF-38-04: `photo-viewer.tsx` uses `motion.div` with `AnimatePresence` for every image transition**
- **File**: `apps/web/src/components/photo-viewer.tsx` lines 290-305
- **Severity**: LOW | **Confidence**: MEDIUM
- **Description**: Every photo navigation triggers a Framer Motion animation with `AnimatePresence mode="wait"`. This unmounts the previous image component and mounts a new one, causing a brief visual gap. The `prefersReducedMotion` check correctly disables animation for accessibility. No actionable performance issue — the animation is lightweight and the reduced-motion fallback is appropriate.

### Summary
No significant performance issues found. The codebase is well-optimized with:
- React `cache()` for SSR deduplication
- `Promise.all` for parallel DB queries
- `useMemo` for expensive client-side computations
- `requestAnimationFrame` debounced resize handler
- Streaming for file uploads and DB restore
- Hard caps on in-memory Maps
- GC interval for stale data cleanup
