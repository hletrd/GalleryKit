# Plan 377 — Cycle 19 Fixes

**Created:** 2026-04-29 (Cycle 19)
**Status:** Done

## Findings to Address

### C19-AGG-02: Duplicated topic-slug validation regex in data.ts

- **File**: `apps/web/src/lib/data.ts:404,441`
- **Severity**: LOW / MEDIUM
- **Issue**: Both `getImageCount` and `buildImageConditions` have inline `/^[a-z0-9_-]+$/.test(topic) || topic.length > 100` instead of using the existing `isValidSlug()` from validation.ts. Duplicated regex is fragile.
- **Fix**: Replace both inline regex checks with `!isValidSlug(topic)` from `@/lib/validation`.
- **Steps**:
  1. Add `isValidSlug` to the import list at the top of data.ts (it's already imported via `@/lib/validation` — `isValidTagSlug` is imported, need to add `isValidSlug`)
  2. Replace inline regex at line 404 in `getImageCount` with `!isValidSlug(topic)`
  3. Replace inline regex at line 441 in `buildImageConditions` with `!isValidSlug(topic)`
  4. Run tests to verify

### C19-AGG-01: `getImageByShareKeyCached` wraps function with side effects

- **File**: `apps/web/src/lib/data.ts:1231`
- **Severity**: LOW / MEDIUM
- **Issue**: `cache()` wraps `getImageByShareKey` which has a conditional side effect (view-count increment). React's `cache()` deduplicates by arguments, so the side effect runs only once per unique argument set per request. Currently safe but the API contract is misleading.
- **Fix**: Add a documentation comment at the `getImageByShareKeyCached` definition site explaining the caching caveat. Do NOT remove `cache()` since it provides SSR deduplication benefit for the single-call-site pattern.
- **Steps**:
  1. Add a comment above `getImageByShareKeyCached` at line 1231 explaining that the cached wrapper is safe only because there's a single call site per page render that passes `incrementViewCount: true`. If a future call site needs a different `incrementViewCount` value, a non-cached variant should be used.

### Uncommitted changes: commit schema.ts and api-auth.ts

- The two uncommitted changes (adminUsers.updated_at and X-Content-Type-Options nosniff) from C16-LOW-14 and C16-LOW-08 need to be committed.
- **Steps**:
  1. Stage and commit `apps/web/src/db/schema.ts` (C16-LOW-14)
  2. Stage and commit `apps/web/src/lib/api-auth.ts` (C16-LOW-08)

## Progress

- [x] C19-AGG-02: Replace duplicated regex with isValidSlug() — DONE (commit a4f1587)
- [x] C19-AGG-01: Add caching caveat documentation — DONE (commit a4f1587)
- [x] Commit uncommitted schema.ts and api-auth.ts changes — DONE (commits 3b36eb1, 547b486)
- [x] Run all gates (eslint, tsc, build, vitest, lint:api-auth, lint:action-origin) — ALL GREEN
