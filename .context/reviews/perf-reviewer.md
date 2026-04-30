# Performance Reviewer — Cycle 19

## Review method
Direct review of all performance-critical modules: data.ts (1273 lines),
image-queue.ts, bounded-map.ts, rate-limit.ts, upload-tracker-state.ts,
public.ts actions.

## Previously identified items (still deferred)
- UNION query optimization for getImage (plan 336)
- searchImages GROUP BY fragility (C7-MED-04)
- data.ts approaching line threshold (D2-MED/D3-MED)

## New Findings

### C19-PR-01 (Low / Low): `getImageByShareKey` uses single combined GROUP_CONCAT query but `getSharedGroup` uses separate tag-fetch query — inconsistent patterns

- **Source**: Direct code review of `apps/web/src/lib/data.ts:872-930,936-1022`
- **Location**: `getImageByShareKey` vs `getSharedGroup`
- **Issue**: `getImageByShareKey` was refactored (C14-MED-01, C16-MED-02) to use a combined GROUP_CONCAT with null-byte delimiter in a single query. `getSharedGroup` still uses a separate `inArray` query for tags after fetching images. The inconsistency is minor — `getSharedGroup` handles up to 100 images and the batched tag query is efficient. The combined approach for `getImageByShareKey` saves one round-trip for a single image. No performance regression, just an architectural inconsistency for future maintenance.
- **Fix**: No action needed this cycle. If the tag-fetch pattern is ever unified, prefer the batched `inArray` approach for multi-image queries (scales better) and the combined GROUP_CONCAT for single-image queries.
- **Confidence**: Low

### C19-PR-02 (Low / Low): `searchImages` runs 3 sequential DB queries in the worst case — short-circuit optimization already mitigates

- **Source**: Direct code review of `apps/web/src/lib/data.ts:1078-1211`
- **Location**: `searchImages()` function
- **Issue**: The search function runs a main query, then if results are insufficient, runs tag and alias queries in parallel (2 rounds total worst case). The short-circuit at line 1146 (`if results.length >= effectiveLimit`) avoids the 2nd round for popular searches. This is already well-optimized. The only remaining optimization would be to UNION the three queries, but MySQL UNION with FULL_GROUP_BY and JOIN differences makes this fragile. No action needed.
- **Fix**: No action needed — already well-optimized for personal-gallery scale.
- **Confidence**: Low

## Summary
No new actionable performance findings. The codebase uses appropriate performance patterns: `Promise.all` for parallel queries, `React.cache()` for deduplication, chunked flush for view counts, bounded maps for rate limiting, and short-circuit evaluation for search. All previously deferred items remain deferred.
