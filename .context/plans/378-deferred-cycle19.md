# Plan 378-Deferred — Deferred Items (Cycle 19)

**Created:** 2026-04-29 (Cycle 19)
**Status:** Deferred

## New Deferred Findings (Cycle 19)

### C19-AGG-03: getImageByShareKey vs getSharedGroup tag-fetch pattern inconsistency — informational only
- **File**: `apps/web/src/lib/data.ts:872-930,936-1022`
- **Original severity/confidence**: LOW / LOW
- **Reason for deferral**: Both patterns are correct for their use cases. Combined GROUP_CONCAT is efficient for single-image queries; batched inArray is efficient for multi-image queries. Inconsistency is cosmetic, not a bug or perf issue.
- **Exit criterion**: If tag-fetch patterns are unified in a future refactor.

### C19-SR-02: adminUsers.updated_at onUpdateNow() — informational only
- **File**: `apps/web/src/db/schema.ts:112`
- **Original severity/confidence**: LOW / LOW
- **Reason for deferral**: The column auto-updates on any row mutation, which is correct MySQL behavior. No code uses this column yet. Informational only.
- **Exit criterion**: When a "last password change" feature reads this column.

### C19-CR-02: updated_at not selected in getCurrentUser or getAdminUserWithHash — informational only
- **File**: `apps/web/src/app/actions/auth.ts:35-39,44-49`
- **Original severity/confidence**: LOW / LOW
- **Reason for deferral**: No code needs the column yet. When a feature needs it, the column will be added to the relevant select.
- **Exit criterion**: When a feature reads adminUsers.updated_at.

## Carry-Forward from Previous Cycles

All previously deferred items from plan 338 (cycle 15) remain deferred with no change in status:

- C15-LOW-04: `flushGroupViewCounts` re-buffers into new buffer; capacity check theoretical
- C15-LOW-05 / C13-03: CSV headers hardcoded in English
- C15-LOW-07: `adminListSelectFields` verbose suppression pattern
- C14-MED-03 / C30-04 / C36-02 / C8-01: `createGroupShareLink` BigInt coercion risk on `insertId`
- C14-LOW-01: `original_file_size` BigInt precision risk
- C14-LOW-02: `lightbox.tsx` showControls callback identity instability
- C14-LOW-03: `searchImages` alias branch over-fetch
- A17-MED-02 / C14-LOW-04: CSP `style-src 'unsafe-inline'` in production
- A17-MED-01 / C14-LOW-05: `data.ts` god module (1273 lines)
- A17-MED-03 / C14-LOW-06: `getImage` parallel DB queries — pool exhaustion risk
- A17-LOW-04 / C14-LOW-07: `permanentlyFailedIds` process-local — lost on restart
- C9-TE-03-DEFER: `buildCursorCondition` cursor boundary test coverage
- C7-MED-04: searchImages GROUP BY lists all columns — fragile under schema changes
- D1-MED: No CSP header on API route responses
- D1-MED: getImage parallel queries / UNION optimization
- D2-MED: data.ts approaching 1500-line threshold
- D1-MED: CSV streaming
- D4-MED: CSP unsafe-inline
- All other items from prior deferred lists
