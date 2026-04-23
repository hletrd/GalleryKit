# Performance Review — Cycle 21

**Reviewer:** perf-reviewer
**Date:** 2026-04-19

## Review Scope

Full repository scan focusing on performance, concurrency, CPU/memory/UI responsiveness.

## Findings

### PERF-21-01: `searchImages` runs two sequential DB queries instead of a UNION [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/lib/data.ts` lines 612-652
- **Description:** `searchImages` first queries images directly, then if results are insufficient, queries via tag JOIN. These are two sequential round trips. A `UNION ALL` approach would combine them into a single query, reducing latency from 2 DB round trips to 1. The current approach was likely chosen to avoid the cost of the tag JOIN when the main query returns enough results (the comment says "Only search tags if main results are insufficient; limit to remaining slots"). This is a valid optimization for the common case, but for queries that need tag results, the sequential approach adds latency.
- **Concrete failure scenario:** User searches for a tag name that doesn't appear in image titles/descriptions. The main query returns 0 results, then the tag query runs. Total latency: 2 DB round trips instead of 1.
- **Fix:** Consider a parallel execution (`Promise.all`) of both queries instead of sequential, or a UNION approach when the query term is short. Low priority since search is admin-only.

### PERF-21-02: `processImageFormats` creates separate Sharp instances per format but shares the same input file [LOW] [LOW confidence]
- **File:** `apps/web/src/lib/process-image.ts` lines 337-405
- **Description:** The function creates a single `sharp(inputPath)` instance and uses `clone()` for each format/size combination. This is the recommended pattern per the codebase docs ("Single Sharp instance with clone() avoids triple buffer decode"). The current implementation is already well-optimized. No performance issue found.

### PERF-21-03: `getSharedGroup` fetches tags for ALL images in a single query — good pattern [INFO]
- **File:** `apps/web/src/lib/data.ts` lines 504-520
- **Description:** The batched tag query avoids N+1 and uses `inArray` for efficiency. This is a well-implemented pattern.

## Summary
- 0 CRITICAL findings
- 0 MEDIUM findings
- 1 LOW finding (sequential search queries)
- 1 INFO finding (good pattern noted)
