# Code Reviewer — Cycle 3 Review

## Files Reviewed

All source files under `apps/web/src/lib/`, `apps/web/src/app/actions/`, `apps/web/src/app/[locale]/`, `apps/web/src/components/`, and `apps/web/src/db/`.

## Findings

### C3-CR-01 [HIGH]. `load-more.tsx` — no error boundary around server action call

- **File+line**: `apps/web/src/components/load-more.tsx`
- **Issue**: The `loadMoreImages` server action is called via `startTransition` but there is no try/catch around the call. If the server action throws (e.g., DB timeout), the transition error is silently swallowed and the "Load More" button stays in its current state — no error toast, no retry option, no visual feedback. The user sees the button do nothing on click.
- **Impact**: User is stuck with no way to load more images after a transient server error. Must refresh the page.
- **Confidence**: High
- **Fix**: Wrap the server action call in a try/catch with a toast error on failure, and re-enable the button so the user can retry.

### C3-CR-02 [MEDIUM]. `getImage` — prev/next navigation may return wrong result for edge-case `capture_date` values

- **File+line**: `apps/web/src/lib/data.ts:752-786`
- **Issue**: The prev/next navigation uses `gt(images.capture_date, image.capture_date)` and `lt(images.capture_date, image.capture_date)` with `or(...)` across multiple conditions. When `capture_date` values contain fractional seconds that differ in precision between MySQL storage and the JavaScript `Date` object, the equality check `eq(images.capture_date, image.capture_date)` may fail to match rows that have the same date to the second but different sub-second precision. This could cause the prev/next navigation to skip an adjacent image.
- **Impact**: Wrong or missing prev/next links on individual photo pages. Low likelihood but high confusion when it occurs.
- **Confidence**: Medium
- **Fix**: Use a composite cursor approach that compares `capture_date + created_at + id` as a single ordering key, or truncate `capture_date` to second precision before comparison.

### C3-CR-03 [MEDIUM]. `searchImages` — tag/alias queries can exceed `effectiveLimit` total results

- **File+line**: `apps/web/src/lib/data.ts:1059-1126`
- **Issue**: The tag query uses `remainingLimit = effectiveLimit - results.length` but the alias query uses `aliasRemainingLimit = effectiveLimit - mainIds.length` (not `effectiveLimit - (results.length + tagResults.length)`). When both tag and alias queries return results, the deduplication step at line 1119-1126 may return more than `effectiveLimit` unique results because the alias query was allowed to return up to `aliasRemainingLimit` items independently. The final `.slice(0, effectiveLimit)` prevents over-returns, but the DB queries fetch more rows than needed.
- **Impact**: Over-fetching from the DB on searches that match both tags and aliases. Not a correctness bug (the final slice caps results), but wastes DB resources.
- **Confidence**: High
- **Fix**: Calculate the alias remaining limit as `effectiveLimit - mainIds.length - tagResults.length` (or just `remainingLimit - tagResults.length`). This requires sequential tag-then-alias queries instead of parallel, or accepting the slight over-fetch.

### C3-CR-04 [MEDIUM]. `session.ts` — `verifySessionToken` deletes expired sessions one-at-a-time on verification

- **File+line**: `apps/web/src/lib/session.ts:139-142`
- **Issue**: When an expired session is found during verification, it is deleted individually with `await db.delete(sessions).where(eq(sessions.id, tokenHash))`. This is correct per-session, but if many expired sessions accumulate between the hourly `purgeExpiredSessions` run, each will be lazily deleted on their next verification attempt. There is no issue with correctness, but it means individual verification calls may be slower than necessary due to the extra DELETE.
- **Impact**: Minor performance concern. The hourly purge is the primary cleanup mechanism.
- **Confidence**: Low
- **Fix**: No change needed — the hourly purge is sufficient. Document this as a known pattern if desired.

### C3-CR-05 [MEDIUM]. `auth.ts` — `login` uses `ip` variable in `logAuditEvent` even when `getClientIp` may return `"unknown"`

- **File+line**: `apps/web/src/app/actions/auth.ts:180,196`
- **Issue**: When `TRUST_PROXY` is not set and the request has no direct IP, `getClientIp` returns the string `"unknown"`. This value is logged as the IP in audit events for both `login_failure` and `login_success`. While not technically wrong (it accurately reflects the state), it reduces the forensic value of audit logs for rate-limit debugging.
- **Impact**: Audit log entries with `"unknown"` IP are less useful for incident investigation.
- **Confidence**: Medium
- **Fix**: This is a known documented limitation per the deferred item D5-MED. No change needed this cycle.

### C3-CR-06 [LOW]. `image-queue.ts` — `claimRetryCounts` are not cleaned up when the claim is eventually acquired

- **File+line**: `apps/web/src/lib/image-queue.ts:236,358-365`
- **Issue**: When a job eventually acquires its claim after multiple retries, the `claimRetryCounts` entry for that job is only deleted in the `finally` block if `claimRetryScheduled` is false. But if the claim was acquired on a retry (i.e., `claimRetryScheduled` was true from a previous attempt), the entry IS cleaned up at line 362-363 because `claimRetryScheduled` is reset to `false` at the start of each new invocation. However, if a job acquires its claim on the first try but fails processing and retries, the `claimRetryCounts` entry will be 0 (never incremented), and the `finally` block correctly deletes it. This is actually correct behavior after careful analysis.
- **Impact**: None — the code is correct.
- **Confidence**: N/A (dismissed)

### C3-CR-07 [LOW]. `data.ts` — `getImagesLite` cursor-based pagination does not validate cursor ID bounds

- **File+line**: `apps/web/src/lib/data.ts:514-539`
- **Issue**: `normalizeImageListCursor` validates `candidate.id` must be a positive integer (`candidate.id <= 0` is rejected), but there is no upper bound check. An extremely large ID (e.g., `Number.MAX_SAFE_INTEGER + 1`) would pass the `Number.isInteger` check but could cause precision issues in MySQL queries. However, MySQL's auto-increment is bounded by the column type (`INT` max 2.1B), and `Number.isInteger` correctly rejects non-integer floats, so the practical risk is negligible.
- **Impact**: None at personal-gallery scale.
- **Confidence**: Low
- **Fix**: Consider adding `candidate.id <= 2147483647` (MySQL INT max) as an additional guard, but this is defensive and not necessary.

---

## Summary

| Severity | Count | Categories |
|----------|-------|------------|
| HIGH | 1 | Error handling |
| MEDIUM | 3 | Logic, performance, audit |
| LOW | 1 | Defensive validation |

**Verdict: FIX AND SHIP** — The `load-more.tsx` error handling gap is the highest-priority item. The search over-fetch is minor but worth addressing. Other findings are documentation or defensive improvements.
