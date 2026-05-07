# Performance Reviewer — Cycle 20

## Review Scope
Image processing pipeline, database query patterns, in-memory Maps (rate limiting, upload tracking, view count buffering), React caching, ISR/revalidation, and client-side rendering.

## New Findings

### PERF-20-01: `uploadTracker` negative-count drift can inflate effective rate limit budget [LOW] [HIGH confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 273-278
- **Description**: Same root issue as CR-20-05 / SEC-20-01 from a performance angle. While the direct performance impact is minimal (the Map entries are small), the negative count allows more uploads per window than intended, potentially increasing Sharp processing load and disk I/O beyond configured limits.
- **Fix**: Clamp count to >= 0 after adjustment.

### PERF-20-02: `searchImages` runs two separate DB queries sequentially when tag search is needed [LOW] [LOW confidence]
- **File**: `apps/web/src/lib/data.ts` lines 613-652
- **Description**: The `searchImages` function first queries images by title/description/camera_model/topic, then if results are insufficient, queries by tag name. These run sequentially. They could potentially run in parallel via `Promise.all` with a post-merge dedup. However, the sequential approach saves a DB connection when the first query is sufficient (which is the common case). The current design is intentional and correct — the tag search is a fallback that only runs when needed.
- **Verdict**: Not an issue — intentional design for connection efficiency.

### PERF-20-03: `getAdminTags` and `getTags` both compute `count(imageTags.imageId)` via LEFT JOIN + GROUP BY — redundant query paths [LOW] [LOW confidence]
- **Files**: `apps/web/src/app/actions/tags.ts` lines 23-38; `apps/web/src/lib/data.ts` lines 181-198
- **Description**: Two nearly identical tag-count queries exist. `getAdminTags` in tags.ts and `getTags` in data.ts produce the same result shape (id, name, slug, count) with slightly different WHERE conditions. This is a minor DRY concern, not a performance issue per se. Each is used in different contexts (admin vs public), and the query plans are appropriate for their use cases.
- **Verdict**: Minor DRY concern, not a performance issue. Already covered by ARCH-38-03 (data.ts god module).

## Previously Fixed — Confirmed

No new performance regressions detected. Prior deferred items remain unchanged.
