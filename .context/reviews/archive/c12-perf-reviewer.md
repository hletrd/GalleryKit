# Cycle 12 Performance Review

## Review Scope
Query performance, memory management, concurrency, UI responsiveness, bundle size.

## Findings

### C12-PR-01 (Low/Medium): `searchImages` runs tag and alias queries in parallel even when main query fills the limit

- **File+line**: `apps/web/src/lib/data.ts:1139-1183`
- **Issue**: The code at line 1106-1108 short-circuits when `results.length >= effectiveLimit`, avoiding the tag/alias queries. However, when `results.length < effectiveLimit` but is non-zero, both tag and alias queries run with `notInArray(images.id, mainIds)`. The `notInArray` with a small set of IDs is fine, but when `effectiveLimit` is small (e.g., 5) and the main query returns 4 results, the tag and alias queries each fetch up to `remainingLimit` rows. The parallel execution is already optimized (C3-AGG-03), so this is working as designed. No actionable issue.
- **Fix**: No fix needed.
- **Confidence**: Low — informational.

### C12-PR-02 (Low/Low): `exportImagesCsv` materializes up to 50K rows as a single string

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:36-108`
- **Issue**: Already flagged as D1-MED (CSV streaming) in prior cycles. The in-memory CSV builder creates a large string. The comment at line 37 acknowledges this. Confirming this remains valid and deferred.
- **Fix**: Already deferred.
- **Confidence**: Low — confirming existing deferred item.

### C12-PR-03 (Low/Medium): `getImagesLite` cursor pagination does not leverage covering index efficiently

- **File+line**: `apps/web/src/lib/data.ts:588-615`
- **Issue**: The cursor-based pagination uses `buildCursorCondition` which generates OR conditions across `capture_date`, `created_at`, and `id`. The composite index `(processed, capture_date, created_at)` on the `images` table covers the sort order but the OR conditions in `buildCursorCondition` may cause MySQL to fall back to a range scan. At personal-gallery scale this is not a practical concern, but the cursor condition could benefit from a UNION-based approach (one query per sort tier) to allow better index utilization. This is an optimization, not a correctness issue.
- **Fix**: Consider UNION-based cursor conditions if gallery grows beyond 100K images.
- **Confidence**: Low — speculative optimization for scale.

## Summary
- Total findings: 3
- Low severity: 3
