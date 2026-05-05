# Performance Review — Cycle 19

## Method

Analyzed service worker cache efficiency, React cache() deduplication, semantic search CPU profile, image processing pipeline concurrency, and DB query patterns. Verified prior fixes from cycle 18.

---

## Verified Prior Fixes

- C18-PERF-01 (SW cache key mismatch): FIXED — `sw.js` now uses `request.url` (string) consistently for both `put` and `delete`.
- C18-PERF-02 (semantic search CPU): No change — still scans up to 5000 embeddings, but rate-limit and same-origin keep it bounded.

---

## Findings

### C19-PERF-01 (LOW): SW `recordAndEvict` sorts entire metadata array on every image cache update

- **Source**: `apps/web/public/sw.js:79-106`
- **Issue**: Every time a new image is cached, `recordAndEvict` sorts ALL metadata entries by timestamp (`Array.from(entries.values()).sort((a, b) => a.timestamp - b.timestamp)`). For a gallery with hundreds of images viewed in a session, this is O(n log n) on every single image fetch. At n=500, that's ~500*9=4500 comparisons per image. For a page with 30 images, that's 135k comparisons.
- **Mitigation**: At the personal-gallery scale this is imperceptible (~1-2ms per sort in JavaScript). The 50MB cap keeps n bounded (~100-200 images at 250KB each). Not worth fixing unless scaling beyond this range.
- **Confidence**: Low (informational)

### C19-PERF-02 (LOW): `getImagesLite` GROUP BY + LEFT JOIN on tag-heavy galleries

- **Source**: `apps/web/src/lib/data.ts:624-654`
- **Issue**: The masonry listing queries use `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` with `LEFT JOIN imageTags` and `LEFT JOIN tags`, plus `GROUP BY images.id`. For images with many tags, this GROUP BY is expensive. The comment acknowledges this is acceptable at personal-gallery scale.
- **No new finding** — this is documented trade-off, unchanged from prior cycles.

---

## No new performance regressions detected

- Image processing concurrency is capped at `Math.max(1, Math.floor((cpuCount - 1) / 3))`.
- `sharp.cache(false)` prevents libvips buffer accumulation.
- `React.cache()` deduplicates `getImageCached`, `getTopicBySlugCached`, etc.
- Connection pool is capped at 10 with queue limit 20.
