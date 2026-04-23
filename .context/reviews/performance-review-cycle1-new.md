# Performance Review — Cycle 1 (New Loop)

**Reviewer:** Performance, Concurrency, CPU/Memory/UI Responsiveness
**Date:** 2026-04-19

## Methodology
- Analyzed all database queries for N+1 patterns, missing indexes, and full table scans
- Reviewed image processing pipeline for concurrency bottlenecks
- Checked React components for unnecessary re-renders and memory leaks
- Examined data layer caching and deduplication
- Reviewed rate limiting Maps for memory growth patterns

## Findings

### C1N-10: `getAdminTags` uses LEFT JOIN + GROUP BY without a WHERE clause on processed images [LOW, Medium Confidence]
**File:** `apps/web/src/app/actions/tags.ts:23-33`
**Problem:** `getAdminTags()` queries all tags with a LEFT JOIN on imageTags, grouping by tag ID. This counts images regardless of their `processed` status. For admin purposes this is intentional (showing all tags), but it means the count includes unprocessed/deleted images. The `getTags` function in data.ts properly filters by `processed=true`.
**Impact:** Admin tag counts may be slightly inaccurate (higher than public-facing counts). Not a performance issue, but a data accuracy issue.
**Suggested fix:** Document this as intentional, or add a `processed` filter if admin should match public counts.

### C1N-11: `searchImages` runs two sequential DB queries when tag results are needed [LOW, Low Confidence]
**File:** `apps/web/src/lib/data.ts:561-593`
**Problem:** The `searchImages` function first runs the main LIKE query, then only if results are insufficient, runs a second tag search query. This is an intentional optimization (saves a connection when main results are sufficient), but when both are needed, they run sequentially. Running them in parallel with `Promise.all` would be faster in the case where both are needed.
**Confidence:** Low — the sequential pattern is intentional to save DB connections when the main query is sufficient. The parallel optimization only helps when both queries are needed.
**Suggested fix:** Consider running both in parallel when the main query returns < effectiveLimit results, then merging. But this increases DB connection usage.

### C1N-12: `flushGroupViewCounts` uses `Promise.all` with individual `.catch()` per update, but `isFlushing` guard may block flush during normal operation [LOW, Low Confidence]
**File:** `apps/web/src/lib/data.ts:25-52`
**Problem:** The `isFlushing` flag prevents concurrent flushes, but if a flush takes a long time (e.g., DB outage), the timer will fire, see `isFlushing=true`, and return without rescheduling. The next flush will only happen when the next `bufferGroupViewCount` call sets a new timer. This means during extended DB outages, view counts may be buffered for much longer than 5 seconds.
**Confidence:** Low — the hard cap of 1000 entries prevents memory issues, and this is a best-effort view count system anyway.
**Suggested fix:** Reschedule the timer if `isFlushing` is true, or use a queue-based approach.

## No-New-Findings Items
- **React cache() deduplication:** Correctly used for `getImage`, `getTopicBySlug`, `getTopicsWithAliases`, `getImageByShareKey`, `getSharedGroup`
- **Promise.all parallel queries:** `getImage` correctly parallelizes tags + prev + next queries
- **Sharp concurrency:** Properly limited to `cpuCount - 1` with env override
- **Masonry grid reorder:** Properly memoized with `useMemo`
- **ImageZoom:** Uses ref-based DOM manipulation to avoid React re-renders on mousemove
- **Histogram:** Canvas capped at 256x256 for fast computation
- **ISR caching:** Photo pages (1 week), topic/home pages (1 hour), admin pages force-dynamic
- **Connection pool:** 10 connections, queue limit 20, keepalive enabled
- **GROUP_CONCAT max_len:** Set to 65535 to prevent silent truncation
