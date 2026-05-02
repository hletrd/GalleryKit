# Aggregate Review — Cycle 7 (2026-04-30)

## Review method

Deep single-pass review of all source files from multiple specialist perspectives
(code quality, security, performance, architecture, correctness, UI/UX, test coverage,
documentation, debugging). All key modules examined: data.ts, auth.ts, public.ts,
sharing.ts, admin-users.ts, images.ts, settings.ts, image-queue.ts, rate-limit.ts,
session.ts, proxy.ts, sanitize.ts, validation.ts, content-security-policy.ts,
bounded-map.ts, upload-tracker-state.ts, action-guards.ts, lightbox.tsx,
photo-viewer.tsx, image-manager.tsx, health route.

## GATE STATUS (prior cycle — all green)

- eslint: clean
- tsc --noEmit: clean
- vitest: passing
- lint:api-auth: OK
- lint:action-origin: OK
- next build: success

---

## New findings (not in cycles 1-6 deferred lists)

### HIGH severity

#### C7-HIGH-01: `deleteAdminUser` advisory lock name is not scoped per-user — concurrent delete of different users serializes
- **Source**: Code review of `apps/web/src/app/actions/admin-users.ts:207`
- **Location**: `deleteAdminUser()` function
- **Issue**: The advisory lock `gallerykit_admin_delete` is a single global lock, not scoped to the user being deleted. If two admins concurrently delete different users, one blocks for 5 seconds (the GET_LOCK timeout) and then fails with `DELETE_LOCK_TIMEOUT` even though the operations are independent and non-conflicting. In a multi-admin deployment, this could cause confusing "failed to delete user" errors for legitimate concurrent deletions of different accounts.
- **Fix**: Scope the lock to the target user ID: `gallerykit_admin_delete:${id}`. This allows concurrent deletion of different users while still serializing concurrent attempts to delete the same user.
- **Confidence**: High

### MEDIUM severity

#### C7-MED-01: `BoundedMap.prune()` deletes during Map iteration — ES6-safe but fragile
- **Source**: Code review of `apps/web/src/lib/bounded-map.ts:101-105`
- **Location**: `BoundedMap.prune()` method
- **Issue**: The prune method iterates over `this.map` entries and calls `this.map.delete(key)` inside the `for...of` loop. Per ES6 spec, deleting entries during `Map.prototype` iteration is safe — the iterator accounts for deletions. However, this pattern is also used in `upload-tracker-state.ts:27-30` (pruneUploadTracker) and `image-queue.ts:89-94` (pruneRetryMaps). While technically correct, it is a risky pattern that could confuse code reviewers and static analysis tools, and it is used in multiple places without any comment noting the ES6 guarantee.
- **Fix**: Collect keys to delete first, then delete them in a separate pass. This makes the intent clearer and avoids any potential issues with future spec changes. Add a comment at each call site noting the ES6 Map deletion guarantee for future readers.
- **Confidence**: Medium

#### C7-MED-02: `uploadTracker` prune iteration-deletion in `pruneUploadTracker` same pattern as BoundedMap
- **Source**: Code review of `apps/web/src/lib/upload-tracker-state.ts:27-30`
- **Location**: `pruneUploadTracker()` function
- **Issue**: Same iteration-during-deletion pattern as BoundedMap.prune(), but on a raw Map rather than the BoundedMap class. If the raw Map is ever replaced with a BoundedMap, this prune method becomes redundant but the duplicate code could cause confusion. Additionally, the hard-cap eviction loop at lines 33-40 duplicates the exact same FIFO eviction pattern used in BoundedMap.prune(), image-queue.pruneRetryMaps(), and data.ts viewCountRetryCount eviction.
- **Fix**: Migrate `uploadTracker` to use BoundedMap to eliminate the duplicated prune/evict logic and reduce the number of raw Map instances that need independent maintenance.
- **Confidence**: Medium

#### C7-MED-03: `image-manager.tsx` edit dialog `maxLength` uses JS `.length` which counts UTF-16 code units, not code points
- **Source**: Code review of `apps/web/src/components/image-manager.tsx:496-500`
- **Location**: Edit dialog Input and Textarea components
- **Issue**: The `maxLength={255}` on the title input and `maxLength={5000}` on the description textarea use the browser's native `maxLength` attribute, which counts UTF-16 code units (same as JS `.length`). The server-side validation in `updateImageMetadata` uses `countCodePoints()`, which counts Unicode code points. For strings containing supplementary characters (emoji, rare CJK), the client-side limit is stricter than the server allows. A user pasting a title with emoji could be blocked at 127 characters (each emoji = 2 UTF-16 units) even though the server allows 255 code points.
- **Fix**: Either (a) use a custom `onInput` handler that counts code points and truncates accordingly, or (b) document the discrepancy as an acceptable tradeoff (server rejects, client is merely a UX hint).
- **Confidence**: Medium

#### C7-MED-04: `searchImages` GROUP BY with all individual columns is fragile — schema changes require updating the GROUP BY list
- **Source**: Code review of `apps/web/src/lib/data.ts:1127-1139` and `1147-1159`
- **Location**: Tag and alias search sub-queries
- **Issue**: The GROUP BY clause lists every column in the SELECT individually. If a column is added to `searchFields` (e.g., adding `filename_webp` for a future feature), the developer must also add it to the GROUP BY clause in both the tag and alias sub-queries. If they forget, the query breaks under `ONLY_FULL_GROUP_BY` SQL mode. The main query (line 1063) does not use GROUP BY (no JOIN), so it is not affected.
- **Fix**: Add a comment above `searchFields` noting that any new field must be added to both GROUP BY clauses. Alternatively, consider using a subquery pattern that groups by `images.id` only and joins the tag/alias results afterward.
- **Confidence**: Medium

#### C7-MED-05: `image-queue.ts` `claimRetryCounts` not cleaned up when permanentlyFailedIds is capped
- **Source**: Code review of `apps/web/src/lib/image-queue.ts:341-345`
- **Location**: `enqueueImageProcessing` catch block (permanent failure)
- **Issue**: When a job permanently fails and its ID is added to `permanentlyFailedIds`, the `claimRetryCounts` entry for that job is only cleaned up in the `finally` block (line 363) when `!claimRetryScheduled`. However, if `MAX_PERMANENTLY_FAILED_IDS` is exceeded and the oldest entry is evicted from `permanentlyFailedIds` (line 343-344), the corresponding `claimRetryCounts` entry for the evicted ID is never cleaned up. Over time with many permanent failures, `claimRetryCounts` could accumulate stale entries for IDs that are no longer in `permanentlyFailedIds`.
- **Fix**: When evicting from `permanentlyFailedIds`, also delete the corresponding entry from `claimRetryCounts` and `retryCounts`.
- **Confidence**: Medium

### LOW severity

#### C7-LOW-01: `upload-tracker-state.ts` prune iteration-deletion on raw Map (same ES6-safe pattern)
- **Source**: Code review of `apps/web/src/lib/upload-tracker-state.ts:27-30`
- **Issue**: Same as C7-MED-01 but on the upload tracker's raw Map. Technically safe per ES6 spec but would be cleaner with the collect-then-delete pattern.
- **Fix**: Migrate to BoundedMap or use collect-then-delete pattern.
- **Confidence**: Low

#### C7-LOW-02: `proxy.ts` `isProtectedAdminRoute` does not protect `/admin` (no trailing slash) — login page is intentionally excluded
- **Source**: Code review of `apps/web/src/proxy.ts:55-71`
- **Location**: `isProtectedAdminRoute()` function
- **Issue**: The function correctly excludes the login page (`/[locale]/admin` exactly) from auth protection. However, the comment says "The login page is exactly /[locale]/admin (no trailing slash, no subpath)" which is accurate for the locale-prefixed path, but for the default locale (no prefix), `pathname === '/admin'` is NOT checked — only `pathname.startsWith('/admin/')` is checked. This means a request to `/admin` (no locale prefix, no trailing slash) passes through to the intl middleware without the cookie guard. This is actually correct behavior (it is the login page), but the logic is asymmetric between the locale-prefixed and non-prefixed cases. The non-prefixed case does NOT explicitly match `/admin` as the login page — it just falls through because `!pathname.startsWith('/admin/')` when pathname is exactly `/admin`. The code works correctly by accident of the logic flow, but the asymmetry could confuse future maintainers.
- **Fix**: Add a comment explaining why `/admin` (no prefix, no slash) is not protected: it IS the login page, and the lack of a `pathname === '/admin'` check in the non-prefixed branch means it correctly falls through without protection.
- **Confidence**: Low (behavior is correct, code clarity only)

#### C7-LOW-03: `photo-viewer.tsx` `navigate` callback has stale closure over `images` if `images` prop changes
- **Source**: Code review of `apps/web/src/components/photo-viewer.tsx:137-154`
- **Location**: `navigate` useCallback
- **Issue**: The `navigate` callback depends on `images`, `currentIndex`, `prevId`, `nextId`, and `router`. When the `images` prop changes (e.g., after a revalidation), the `useEffect` on line 80-82 updates `currentImageId`, but the `navigate` function closes over the new `images` immediately since it's in the dependency array. This appears correct, but there is a subtle edge case: if `images` updates and `currentImageId` has not yet been updated via the effect, `currentIndex` could briefly be -1 (not found), making `navigate` compute `newIndex` incorrectly. In practice this is a very brief window and the effect runs synchronously, so the risk is minimal.
- **Fix**: Add a guard in `navigate`: if `currentIndex === -1`, return early.
- **Confidence**: Low

#### C7-LOW-04: `health/route.ts` DB probe does not include timing information
- **Source**: Code review of `apps/web/src/app/api/health/route.ts:29`
- **Location**: DB health check query
- **Issue**: The health endpoint checks DB connectivity with `SELECT 1` but does not report how long the query took. For monitoring and alerting purposes, a slow-but-successful DB connection is nearly as bad as a failed one. The deferred item from plan 337 (health check counter) covers alerting but not timing.
- **Fix**: Add `dbOkDurationMs` to the response JSON when `HEALTH_CHECK_DB=true`.
- **Confidence**: Low

#### C7-LOW-05: `content-security-policy.ts` does not include `style-src-attr` or `style-src-elem` directives
- **Source**: Code review of `apps/web/src/lib/content-security-policy.ts:81`
- **Location**: CSP `style-src 'self' 'unsafe-inline'`
- **Issue**: The CSP uses `style-src 'self' 'unsafe-inline'` which applies to all style sources. Modern browsers support `style-src-attr` and `style-src-elem` as more specific directives that could restrict inline styles to attributes only (for Tailwind's runtime) while blocking inline `<style>` elements. This is a defense-in-depth improvement that would reduce the attack surface of `unsafe-inline`. However, this is already covered by the existing deferred item D4-MED (CSP unsafe-inline).
- **Fix**: When addressing D4-MED, consider splitting `style-src` into `style-src-attr` and `style-src-elem`.
- **Confidence**: Low (already covered by deferred item)

#### C7-LOW-06: `admin-users.ts` `deleteAdminUser` rolls back transaction but does not explicitly release the advisory lock on error paths
- **Source**: Code review of `apps/web/src/app/actions/admin-users.ts:244-262`
- **Location**: `deleteAdminUser` catch/finally blocks
- **Issue**: The `finally` block correctly releases the advisory lock with `RELEASE_LOCK` and calls `conn.release()`. However, the `conn.rollback()` in the catch block (line 245) could throw if the connection is broken, and the lock release in the finally block also has a `.catch(() => {})` guard. This is correct but the error handling is defensive — if `conn.rollback()` throws, the lock is still released in the finally block. No actual bug, but the catch block's `conn.rollback().catch(() => {})` could mask a broken connection that would also fail on `RELEASE_LOCK`.
- **Fix**: No fix needed — the finally block is correct. Document that the lock release is the authoritative cleanup step.
- **Confidence**: Low (informational)

## Previously fixed findings (confirmed still fixed from cycles 1-6)

- A1-HIGH-01: Login rate-limit rollback — FIXED (no rollback on infrastructure error)
- A1-HIGH-02: Image queue infinite re-enqueue — FIXED (permanentlyFailedIds tracking)
- C18-MED-01: searchImagesAction re-throws — FIXED (returns structured error)
- C6F-01: getSharedGroup returns null on empty images — FIXED (returns empty array)
- C6F-02: isNotNull(capture_date) guards — FIXED
- C6F-03: searchImages GROUP BY with created_at — FIXED
- C4F-08/09: getImageByShareKey blur_data_url and topic_label — FIXED
- C4F-12: search ORDER BY matches gallery — FIXED
- C5F-01: undated image prev/next navigation — FIXED
- A1-MED-04: sanitizeAdminString returns null — FIXED

## Deferred items carried forward (no change)

All items from plan-355-deferred-cycle4.md and plan-357-cycle6-fixes.md remain deferred:
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
- D1-LOW: BoundedMap.prune() iteration delete
- C5F-02: sort-order condition builder consolidation
- C6F-06: getImageByShareKey parallel tag query

## Summary statistics

- Total new findings this cycle: 10
- HIGH severity: 1
- MEDIUM severity: 5
- LOW severity: 4
- Previously fixed (verified): 10
- Deferred carry-forward: 18 items (no change)
