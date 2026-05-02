# Verifier — Cycle 3 Review

## Files Reviewed

All source files under `apps/web/src/` and test files under `apps/web/src/__tests__/`.

## Findings

### C3-VF-01 [HIGH]. `load-more.tsx` — error handling gap verified

- **File+line**: `apps/web/src/components/load-more.tsx`
- **Issue**: Confirmed that the component has no try/catch around the server action call. The cycle 2 fix (A2-MED-02) changed `public.ts` to return structured errors instead of re-throwing, but the CLIENT-SIDE component still lacks error handling. When the server action returns an error object, the component does not check for it. When the server action throws an unexpected error, the `startTransition` silently catches it.
- **Impact**: User-facing bug — broken "Load More" after server errors.
- **Confidence**: High
- **Fix**: Add error handling to the client-side component.

### C3-VF-02 [MEDIUM]. Cycle 2 fix A2-MED-02 is incomplete — only server-side error handling was fixed

- **File+line**: `apps/web/src/app/actions/public.ts:105-108`, `apps/web/src/components/load-more.tsx`
- **Issue**: The cycle 2 fix changed `loadMoreImages` to return structured error objects `{ error: string }` instead of re-throwing. However, the client-side `load-more.tsx` component was NOT updated to check for these error objects. The component only checks for the presence of new images (`if (newImages.length > 0)`) but does not check if the result contains an `error` field. This means the server-side fix is incomplete — errors are returned but never displayed to the user.
- **Impact**: The cycle 2 fix is half-complete. The server correctly returns errors, but the client ignores them.
- **Confidence**: High
- **Fix**: Update `load-more.tsx` to check for `error` in the server action result and display an error toast.

### C3-VF-03 [MEDIUM]. `getImage` prev/next for undated images may return NULL rows

- **File+line**: `apps/web/src/lib/data.ts:769-785`
- **Issue**: For undated images, the prev conditions use `and(sql\`${images.capture_date} IS NULL\`, ...)` which is correct for MySQL (NULL comparison must use IS NULL). The `filter(Boolean)` at lines 802 and 814 removes any undefined entries from the `prevConditions`/`nextConditions` arrays before passing to `or()`. If all conditions are undefined (which cannot happen given the structure), `or()` with no arguments would be a no-op. Verified that this is safe — at least one condition is always present for both dated and undated images.
- **Impact**: None — the code is correct.
- **Confidence**: High (dismissed)

### C3-VF-04 [LOW]. `normalizeStringRecord` Unicode rejection is working correctly

- **File+line**: `apps/web/src/lib/sanitize.ts:60-62`
- **Issue**: Verified that the cycle 2 fix (A2-MED-01) is working correctly. The `normalizeStringRecord` function now rejects Unicode formatting characters before trim, matching the `sanitizeAdminString` rejection policy.
- **Impact**: None — already fixed.
- **Confidence**: High (verified)

---

## Summary

| Severity | Count | Categories |
|----------|-------|------------|
| HIGH | 1 | Error handling |
| MEDIUM | 1 | Incomplete prior fix |
| LOW | 2 | Verified correct |

**Verdict: FIX AND SHIP** — The `load-more.tsx` error handling gap is confirmed. Additionally, the cycle 2 fix A2-MED-02 is incomplete — only the server side was fixed, not the client side.
