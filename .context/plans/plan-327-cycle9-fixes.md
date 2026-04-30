# Plan — Cycle 9 Fixes

Date: 2026-04-29
Source: `.context/reviews/_aggregate.md` (Cycle 9)
Status: Completed

## Findings to address

| ID | Description | Severity | Confidence | Status |
|---|---|---|---|---|
| AGG9R-01 | Remaining `.length` usages for DoS bounds in `images.ts:139` and `public.ts:116` — inconsistent with `countCodePoints()` adoption | LOW | LOW | Done |
| AGG9R-02 | `withAdminAuth` wrapper lacks `hasTrustedSameOrigin` origin verification | LOW | MEDIUM | Done |
| AGG9R-03 | `createAdminUser` username length uses `.length` — safe due to ASCII regex but undocumented | LOW | LOW | Done |
| AGG9R-04 | `searchImages` could cascade tag→alias queries for marginal perf improvement | LOW | LOW | Deferred |

## Implementation tasks

### Task 1: AGG9R-01 — Use `countCodePoints()` for DoS-prevention bounds in `images.ts` and `public.ts` — DONE

- `apps/web/src/app/actions/images.ts:139` — Changed `tagsString.length > 1000` to `countCodePoints(tagsString) > 1000`
- `apps/web/src/app/actions/public.ts:116` — Changed `sanitizedQuery.length > 200` to `countCodePoints(sanitizedQuery) > 200`
- Added `countCodePoints` import in `public.ts`

### Task 2: AGG9R-02 — Add `hasTrustedSameOrigin` origin check to `withAdminAuth` wrapper — DONE

- `apps/web/src/lib/api-auth.ts` — Added `hasTrustedSameOrigin` check inside `withAdminAuth` wrapper, before `isAdmin()` check. Returns 403 JSON response on failure.
- `apps/web/src/app/api/admin/db/download/route.ts` — Removed the now-redundant inline `hasTrustedSameOriginWithOptions` check and the custom `requestHeaders` adapter. Also removed the now-unused `hasTrustedSameOriginWithOptions` import.
- `apps/web/src/__tests__/backup-download-route.test.ts` — Updated two test assertions that expected plain text `'Unauthorized'` to expect JSON `{"error":"Unauthorized"}` instead, since the origin check is now done by `withAdminAuth` which returns JSON.

### Task 3: AGG9R-03 — Document that `.length` is safe for username validation — DONE

- `apps/web/src/app/actions/admin-users.ts:98-100` — Added comment explaining that `.length` is correct because the regex restricts to ASCII characters.

### Task 4 (Deferred): AGG9R-04 — Search query cascade optimization — DEFERRED

- Micro-optimization at personal-gallery scale. Current parallel execution with short-circuit is already optimal for the documented use case.
- Exit criterion: User-reported search latency issue, or gallery scale exceeds 10k images with frequent searches.

## Gate verification

| Gate | Status |
|------|--------|
| eslint | PASS |
| tsc --noEmit | PASS |
| vitest (549 tests) | PASS |
| lint:api-auth | PASS |
| lint:action-origin | PASS |
| npm run build | PASS |
