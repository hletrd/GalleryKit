# Critic — Cycle 3 Review

## Files Reviewed

All source files under `apps/web/src/`.

## Findings

### C3-CT-01 [HIGH]. `load-more.tsx` — no error handling on server action call

- **File+line**: `apps/web/src/components/load-more.tsx`
- **Issue**: This is the same finding as C3-CR-01, C3-DB-01, C3-SR-01, C3-AR-02, C3-TE-01. The `load-more.tsx` component calls the `loadMoreImages` server action without error handling. When the server action throws (e.g., DB timeout), the component silently fails and the user sees no feedback. The button may appear stuck in a loading state or become unresponsive.
- **Impact**: 5 agents agree — this is the highest-signal finding this cycle.
- **Confidence**: High
- **Fix**: Wrap the server action call in try/catch with error toast and retry capability.

### C3-CT-02 [MEDIUM]. `searchImages` alias-query limit over-fetch wastes DB resources

- **File+line**: `apps/web/src/lib/data.ts:1071`
- **Issue**: Same as C3-CR-03, C3-PR-01. The alias query calculates its limit without accounting for tag query results, causing over-fetch. 3 agents agree.
- **Impact**: Minor DB resource waste on searches matching both tags and aliases.
- **Confidence**: High
- **Fix**: Adjust the alias-query limit calculation or accept the over-fetch at personal-gallery scale.

### C3-CT-03 [LOW]. Prior cycle fixes verified as correct and complete

- **File+line**: Multiple
- **Issue**: I verified the following cycle 1 and 2 fixes:
  - **A2-HIGH-01 (permanentlyFailedIds cleanup on deletion)**: VERIFIED correct in `images.ts:486,593` — both `deleteImage` and `deleteImages` now remove IDs from `permanentlyFailedIds`.
  - **A2-MED-01 (normalizeStringRecord Unicode rejection)**: VERIFIED correct in `sanitize.ts:60-62` — `normalizeStringRecord` now rejects Unicode formatting characters.
  - **A2-MED-02 (loadMoreImages error handling on server side)**: VERIFIED that `public.ts` now returns structured errors instead of re-throwing. However, the CLIENT-SIDE handling in `load-more.tsx` is still missing (see C3-CT-01).
  - **A2-MED-03 (adminListSelectFields)**: VERIFIED correct in `data.ts:220-271` — the admin listing query omits EXIF columns.
  - **A2-MED-04 (rate-limit documentation)**: VERIFIED correct in `rate-limit.ts:1-31` — the three rollback patterns are documented.
- **Impact**: All prior fixes verified as correct.
- **Confidence**: High

---

## Summary

| Severity | Count | Categories |
|----------|-------|------------|
| HIGH | 1 | Error handling (5-agent consensus) |
| MEDIUM | 1 | Query efficiency (3-agent consensus) |
| LOW | 1 | Verification of prior fixes |

**Verdict: FIX AND SHIP** — The `load-more.tsx` error handling is the clear priority. The search over-fetch is secondary.
