# Cycle 6 Aggregate Review (RPF loop)

Date: 2026-04-30
Reviewer: Composite deep review

**HEAD:** `e26eec8` (fix(data): repair photo navigation at dated/undated boundary)

## Source reviews

| Reviewer | File |
|---|---|
| Composite | `.context/reviews/cycle6-composite.md` |

## Deduplicated findings

| Unified ID | Severity | Confidence | Title |
|---|---|---|---|
| **C6F-01** | HIGH | High | `getSharedGroup` returns null when group exists but has no processed images — shared link shows 404 |
| **C6F-02** | MEDIUM | High | Dated-image prev/next conditions lack explicit `isNotNull(capture_date)` guard (defense-in-depth) |
| **C6F-03** | MEDIUM | Medium | `searchImages` tag/alias sub-queries ORDER BY `created_at` without including it in GROUP BY |
| **C6F-05** | LOW | Low | `getSharedGroup` `.limit(100)` undocumented contract with write-path cap |
| **C6F-06** | MEDIUM | Medium | `getImageByShareKey` sequential tag query adds extra DB round-trip on shared photo page |

## Priority remediation order

### Must-fix

1. **C6F-01** (HIGH): `getSharedGroup` returns null when group exists but has no processed images. Fix: return group with empty images array instead of null.

### Should-fix

2. **C6F-02** (MEDIUM): Add `isNotNull(capture_date)` guards to dated-image prev/next conditions.
3. **C6F-03** (MEDIUM): Add `images.created_at` to search SELECT and GROUP BY in tag/alias sub-queries.
4. **C6F-06** (MEDIUM): Wrap `getImageByShareKey` image and tag queries in `Promise.all`.

### Consider-fix (LOW)

5. **C6F-05** (LOW): Document limit(100) invariant. No code change needed.

## Retracted / Not Findings

| ID | Reason |
|---|---|
| C6F-04 | False positive: filename_avif/filename_webp ARE in publicSelectFields |
| C6F-07 | False positive: normalizeStringRecord check ordering is correct |
| C6F-08 | Review coverage gap noted, not a code finding |

## Verified Prior Fixes

| Prior ID | Status | Notes |
|---|---|---|
| C5F-01 | VERIFIED | prev/next boundary conditions correct |
| C4F-11 | VERIFIED | hard link with copyFile fallback |
| C4F-08/09 | VERIFIED | blur_data_url and topic_label in getImageByShareKey |
| C3-AGG-03 | VERIFIED | alias-query limit capped at remainingLimit |

## Carry-forward (unchanged)

All prior deferred items from plan-355-deferred-cycle4.md remain deferred with no change in status.
