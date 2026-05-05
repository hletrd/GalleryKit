# Quality Reviewer — Cycle 3

## Findings

### F1: `check-public-route-rate-limit.ts` regex detection lacks string-stripping
- **File**: `apps/web/scripts/check-public-route-rate-limit.ts`, lines 131-134
- **Severity**: Medium
- **Quality issue**: Inconsistent with the exempt-tag logic right above it (lines 121-124). A developer reading the file will see the string-stripping pattern used once but not reused, suggesting oversight.
- **Fix**: Extract a `stripStringsAndComments` helper and use it for both checks.

### F2: `sw.js` LRU tracking is actually FIFO by timestamp
- **File**: `apps/web/public/sw.js`, lines 83-106
- **Severity**: Low
- **Quality issue**: The sort is ascending (`a.timestamp - b.timestamp`), evicting oldest first. This is FIFO, not LRU. The comment says "LRU tracking" but the eviction is time-based, not access-based.
- **Fix**: Rename to `recordAndEvictOldest` or implement true LRU by updating timestamp on each cache hit.

### F3: `og/photo/[id]/route.tsx` hardcodes `nearestSize = 1536` but `findNearestImageSize` might return a different size
- **File**: `apps/web/src/app/api/og/photo/[id]/route.tsx`, line 64
- **Severity**: Low
- **Quality issue**: The constant is named `OG_PHOTO_TARGET_SIZE = 1536`. The function `findNearestImageSize` finds the nearest configured size. If the admin changes image sizes to not include 1536, a different size is used. The code handles this fine, but the naming is slightly off.
