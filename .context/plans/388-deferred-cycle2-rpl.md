# Plan 388-Deferred — Deferred Items (Cycle 2 RPL)

**Created:** 2026-05-01 (Cycle 2 RPL)
**Status:** Deferred

## Cycle 2 RPL Review Summary

Comprehensive deep review of all 242 TypeScript source files. **Zero new findings**
were identified. This is the fourth consecutive cycle with no new findings,
confirming full convergence.

## New Findings This Cycle

None.

## Deferred Findings (carry-forward, unchanged from Plan 387)

All deferred items from Plan 387 (cycle 25) are carried forward unchanged:

- C22-02: CSV export headers hardcoded in English despite i18n support (LOW)
- A17-MED-01 / C14-LOW-05: data.ts god module (1283 lines) (MED)
- A17-MED-02 / C14-LOW-06: CSP style-src 'unsafe-inline' in production (MED)
- A17-MED-03 / C14-LOW-06: getImage parallel DB queries — pool exhaustion risk (MED)
- A17-LOW-04 / C14-LOW-07: permanentlyFailedIds process-local — lost on restart (LOW)
- C14-LOW-01: original_file_size BigInt precision risk (LOW)
- C14-LOW-02: lightbox.tsx showControls callback identity instability (LOW)
- C14-LOW-03: searchImages alias branch over-fetch (LOW)
- C9-TE-03-DEFER: buildCursorCondition cursor boundary test coverage (LOW)
- C7-MED-04: searchImages GROUP BY lists all columns — fragile under schema changes (MED)
- D1-MED: No CSP header on API route responses (MED)
- D2-MED: data.ts approaching 1500-line threshold (MED)
- D4-MED: CSP unsafe-inline (MED)
- C25-LOW-01: i18n cross-namespace duplicate values (LOW, cosmetic)
- C25-LOW-02: Restore confirmation dialog lost interrogative tone (LOW, cosmetic)
- C25-LOW-03: serverActions.invalidTagName / invalidTagNames identical duplicates (LOW, cosmetic)
