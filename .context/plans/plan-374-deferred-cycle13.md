# Plan 374 — Cycle 13: Deferred findings

## Origin

Cycle 13 review findings that are explicitly deferred per the plan directory rules.

## C13-LOW-01-DEFER (Low): `exportImagesCsv` uses `results = [] as typeof results` pattern for GC hint

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:98`
- **Original severity/confidence**: Low / Low
- **Reason for deferral**: Same as C12-LOW-02-DEFER. The pattern is functional — it releases the DB results reference for GC before materializing the CSV string. The type assertion is misleading but has no runtime impact. Refactoring is cosmetic with no functional benefit.
- **Exit criterion**: When the CSV export is refactored to streaming (D1-MED), or when a contributor reports confusion about the pattern.

## Carry-forward of prior deferred items

All prior deferred items from plan-372 (cycle 12) and earlier remain valid and deferred with no change in status:

- C9-TE-03-DEFER: `buildCursorCondition` cursor boundary test coverage
- C7-MED-02: uploadTracker prune/evict duplicates BoundedMap pattern
- C7-MED-04: searchImages GROUP BY lists all columns — fragile under schema changes
- C7-LOW-04: Health route DB probe lacks timing info
- C7-LOW-05: CSP style-src-attr/style-src-elem split
- C7-LOW-06: admin-users.ts deleteAdminUser lock release on error paths
- D1-MED: No CSP header on API route responses
- D1-MED: getImage parallel queries / UNION optimization
- D2-MED: data.ts approaching 1500-line threshold
- D1-MED: CSV streaming
- D2-MED: auth patterns inconsistency
- D3-MED: data.ts god module
- D4-MED: CSP unsafe-inline
- D5-MED: getClientIp "unknown" without TRUST_PROXY
- D6-MED: restore temp file predictability
- D7-LOW: process-local state
- D8-LOW: orphaned files
- D9-LOW: env var docs
- D10-LOW: oversized functions
- D11-LOW: lightbox auto-hide UX
- D12-LOW: photo viewer layout shift
- C5F-02: sort-order condition builder consolidation
- C6F-06: getImageByShareKey parallel tag query
- C11-LOW-01: proxy.ts middleware cookie format check
- C11-LOW-03: bootstrapImageProcessingQueue calls cleanOrphanedTmpFiles on every continuation
- C11-LOW-04: pruneRetryMaps does not check permanentlyFailedIds size
- C11-LOW-05: photo-viewer.tsx info sidebar collapse clips content without fade
- C11-LOW-06: admin-nav.tsx navigation items don't indicate active page
- C11-LOW-07: db-restore.ts re-exports MAX_RESTORE_FILE_BYTES under different name
