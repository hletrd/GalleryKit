# Gallery repository debugger review

I reviewed the repo inventory first, then walked the relevant app, lib, component, route, and test files end-to-end before doing a final missed-issues sweep.

## Confirmed issues

### 1) Info bottom sheet opens in the wrong state
- **File:** `apps/web/src/components/info-bottom-sheet.tsx:34-42`
- **Severity:** medium
- **Confidence:** high
- **Failure scenario:** when the mobile info panel is opened from a closed state, the effect forces `sheetState` to `expanded` instead of the documented `peek` state. That means the first tap opens the full sheet with backdrop/focus-trap behavior, which is a different interaction than the surrounding logic and comments describe.
- **Fix:** make the open-transition state match the intended peek behavior, or update the comments/tests if expanded is now the desired UX. Keep the open-state reset in one place so the trigger/backdrop logic stays aligned.

### 2) Admin backup download auth can emit cacheable 401s
- **File:** `apps/web/src/lib/api-auth.ts:12-18` and `apps/web/src/app/api/admin/db/download/route.ts:13-32`
- **Severity:** medium
- **Confidence:** high
- **Failure scenario:** the `withAdminAuth()` wrapper returns a plain JSON 401 before the route body runs, so the route-level no-store headers never execute for unauthenticated requests. A proxy or browser cache can therefore retain the denial response for `/api/admin/db/download?...`, causing later authenticated download attempts to receive a stale unauthorized response.
- **Fix:** have `withAdminAuth()` return a response with `Cache-Control: no-store, no-cache, must-revalidate` (and ideally `Pragma: no-cache`) on the unauthenticated path, or move the auth check into a shared helper that always attaches anti-cache headers.

## Likely risks

### 3) Infinite scroll uses offset pagination against a live, mutable sort order
- **File:** `apps/web/src/lib/data.ts:318-335` and `359-391`; `apps/web/src/components/load-more.tsx:29-51`
- **Severity:** medium
- **Confidence:** high
- **Failure scenario:** the gallery feed is sorted by `(capture_date, created_at, id)` but paged by `offset`. If uploads or deletions happen while a user is paging, rows can shift above the current offset. The next fetch can then duplicate already-shown photos or skip unseen ones, which is very hard to reason about from the client side.
- **Fix:** switch the load-more flow to cursor pagination keyed off the last seen sort tuple, or introduce a snapshot token so paging is stable even as the underlying table changes.

### 4) CSV export is fully materialized in memory and returned through a server action
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:50-98`
- **Severity:** medium
- **Confidence:** medium
- **Failure scenario:** for large galleries, the export path allocates the DB result array, then a full `csvLines` array, then the final `csvContent` string, and finally ships that string through the server-action response. Near the 50k-row cap, this can become slow or fail with memory/transport limits before the browser ever gets a downloadable file.
- **Fix:** stream CSV from an authenticated route or write it to a temporary file and download it using the existing backup-download pattern instead of returning the full payload from the action.

## Missed-issues sweep
- I re-checked the public routes, auth/session flow, upload/processing queue, restore pipeline, and the larger client components for race windows, stale assumptions, and brittle failure handling.
- I did not find any additional high-confidence defects beyond the four items above.
