# Architect — Cycle 3 Review

## Files Reviewed

All source files under `apps/web/src/lib/`, `apps/web/src/app/actions/`, `apps/web/src/components/`, `apps/web/src/db/`, `apps/web/src/proxy.ts`.

## Findings

### C3-AR-01 [MEDIUM]. `data.ts` is 1190 lines — approaching the 1500-line deferral threshold

- **File+line**: `apps/web/src/lib/data.ts`
- **Issue**: The file has grown from 1136 lines (cycle 17) to 1190 lines. The deferral threshold is 1500 lines. At the current growth rate (~5 lines/cycle), it will reach the threshold in ~60 cycles. The view-count buffer logic (lines 1-175) is the most self-contained module that could be extracted to reduce the file size by ~15%. However, the extraction requires careful handling of the module-level `let` variables and timer references.
- **Impact**: Currently below threshold. The merge-conflict risk is low for a single-developer project.
- **Confidence**: High
- **Fix**: No change this cycle. Continue monitoring. When the file exceeds 1500 lines, extract view-count buffer to `lib/view-count-buffer.ts`.

### C3-AR-02 [MEDIUM]. Server action error propagation is inconsistent

- **File+line**: `apps/web/src/app/actions/public.ts:105-108` and `apps/web/src/components/load-more.tsx`
- **Issue**: Some server actions (e.g., `loadMoreImages` in `public.ts`) re-throw errors, while others (e.g., `searchImages`) return structured error objects. The client-side components have inconsistent error handling patterns. The `load-more.tsx` component has no error boundary around the server action call, making it fragile to server errors. Other components like the search component handle errors gracefully.
- **Impact**: Inconsistent user experience — some components show error feedback, others silently fail.
- **Confidence**: High
- **Fix**: Standardize on a consistent error handling pattern: (1) Server actions should return structured errors rather than throwing, OR (2) Client components should always wrap server action calls in try/catch. The `load-more.tsx` component needs the most urgent fix.

### C3-AR-03 [LOW]. Rate-limit rollback patterns now documented

- **File+line**: `apps/web/src/lib/rate-limit.ts:1-31`
- **Issue**: The three rollback patterns are now documented in a header comment. This was previously flagged as A2-MED-04 and has been addressed. Confirming the documentation is present and correct.
- **Impact**: None — already fixed.
- **Confidence**: High (verified)

### C3-AR-04 [LOW]. `adminListSelectFields` optimization is in place

- **File+line**: `apps/web/src/lib/data.ts:220-271`
- **Issue**: The `adminListSelectFields` optimization (A2-MED-03) has been implemented. It omits EXIF columns from the admin listing query. Confirming this is correct and working.
- **Impact**: None — already fixed.
- **Confidence**: High (verified)

---

## Summary

| Severity | Count | Categories |
|----------|-------|------------|
| MEDIUM | 2 | File size, error handling consistency |
| LOW | 2 | Verified fixes |

**Verdict: FIX AND SHIP** — The `load-more.tsx` error handling is the primary actionable item (overlaps with C3-CR-01, C3-DB-01). The `data.ts` file size is monitored but below threshold.
