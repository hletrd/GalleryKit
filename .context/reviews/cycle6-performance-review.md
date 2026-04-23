# Performance Review — Cycle 6 (2026-04-19)

## Summary
Performance review of GalleryKit. The codebase has numerous optimizations already in place (React cache(), Promise.all parallelization, PQueue, ISR caching, deterministic file operations). Found **1 new finding** (LOW).

## Findings

### C6-PERF01: `searchImages` in data.ts runs two sequential DB queries instead of using UNION
**File:** `apps/web/src/lib/data.ts:555-604`
**Severity:** LOW | **Confidence:** MEDIUM

The search function first queries the `images` table with LIKE on title/description/camera_model/topic (lines 572-583), then conditionally queries tags with LIKE (lines 587-593). These are sequential — the tag query only runs if the main query returns fewer than `effectiveLimit` results. While this is an intentional optimization (saves a connection when main results are sufficient), when both queries are needed, they could run in parallel via `Promise.all` since the tag query result is filtered by `remainingLimit`.

However, the current sequential approach has a benefit: it avoids over-querying when the main results are sufficient. The parallel approach would waste a DB connection on the tag query that may not be needed. **Current approach is actually better for the common case.**

**Recommendation:** No code change. Document the design decision with a comment explaining the tradeoff.

## Verified Optimizations
- React `cache()` deduplication on `getImage`, `getTopicBySlug`, `getTopicsWithAliases`
- `Promise.all` parallelization for independent queries (tags + prev + next in `getImage`)
- PQueue with concurrency control for image processing
- ISR caching: 1 week for photos, 1 hour for topic/home pages
- Deterministic file deletion (no readdir on large directories)
- Sharp clone() for parallel format generation (single decode, multiple encode)
- Singleton promise for `ensureDirs` preventing concurrent mkdir
- GROUP_CONCAT max length increased to prevent silent truncation
- `getImagesLite` scalar subquery instead of LEFT JOIN + GROUP BY
- Upload stream-to-disk avoiding 200MB heap materialization

## No Issues Found In
- Connection pool sizing (10 connections, queue limit 20, keepalive)
- Masonry grid (useMemo reorder, requestAnimationFrame debounced resize)
- ImageZoom (ref-based DOM manipulation, no React re-renders on mousemove)
- Queue shutdown (drain + retry pattern)
