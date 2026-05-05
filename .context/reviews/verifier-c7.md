# Verification Review — Cycle 7

## Summary

This review verifies that previously fixed findings remain fixed and that new findings from this cycle are correctly classified.

---

## Previously Fixed Findings — Confirmed Still Fixed

| ID | Description | Verification Method | Status |
|----|-------------|---------------------|--------|
| A1-HIGH-01 | Login rate-limit rollback on infrastructure error | Read `auth.ts` lines 45-90; no rollback after `verifyPassword` | FIXED |
| A1-HIGH-02 | Image queue infinite re-enqueue | Read `image-queue.ts`; `permanentlyFailedIds` capped at 1000 | FIXED |
| C18-MED-01 | searchImagesAction re-throws | Read `data.ts`; returns `{images: [], total: 0}` on error | FIXED |
| C6F-01 | getSharedGroup returns null on empty images | Read `data.ts`; returns `{ images: [] }` | FIXED |
| C6F-02 | isNotNull(capture_date) guards | Read `data.ts` prev/next queries; `capture_date` null-safe | FIXED |
| C6F-03 | searchImages GROUP BY with created_at | Read `data.ts`; GROUP BY includes all columns | FIXED |
| C4F-08/09 | getImageByShareKey blur_data_url and topic_label | Read `data.ts`; fields present in select | FIXED |
| C4F-12 | search ORDER BY matches gallery | Read `data.ts`; ORDER BY matches | FIXED |
| C5F-01 | Undated image prev/next navigation | Read `data.ts`; COALESCE fallback | FIXED |
| C5F-02 | sort-order condition builder consolidation | Read `data.ts`; unified `buildSortOrder` helper | FIXED |

## New Findings Verification

### C7-SEC-01: OG photo route missing rate limit — CONFIRMED
- **File:** `apps/web/src/app/api/og/photo/[id]/route.tsx`
- **Check:** Searched for `preIncrement`, `ogRateLimit`, `rate-limit` imports in the file.
- **Result:** Only imports are `next/og`, `next/server`, `@/lib/data`, `@/lib/gallery-config`, `@/lib/gallery-config-shared`, `@/lib/photo-title`, `@/lib/validation`, `@/site-config.json`. No rate-limit imports.
- **Conclusion:** Confirmed. The route does NOT call any rate-limit helper.

### C7-SEC-02: `withAdminAuth` omits Cache-Control on success — CONFIRMED
- **File:** `apps/web/src/lib/api-auth.ts`
- **Check:** Read lines 100-104. `NO_STORE_HEADERS` is defined but only applied in error paths.
- **Conclusion:** Confirmed.

### C7-HIGH-01: `deleteAdminUser` global advisory lock — CONFIRMED
- **File:** `apps/web/src/app/actions/admin-users.ts`
- **Check:** Read lines 207-215. Lock name is `'gallerykit_admin_delete'` (no user ID suffix).
- **Conclusion:** Confirmed.

### C7-MED-05: `claimRetryCounts` not cleaned on permanent-failure eviction — CONFIRMED
- **File:** `apps/web/src/lib/image-queue.ts`
- **Check:** Lines 341-345 evict from `permanentlyFailedIds` but do NOT touch `claimRetryCounts`.
- **Conclusion:** Confirmed.

## Deferred Items Status Check

All 18 deferred items from prior cycles are correctly deferred per project rules. None have become urgent or blocking.
