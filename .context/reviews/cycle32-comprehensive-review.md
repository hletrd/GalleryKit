# Comprehensive Code Review — Cycle 32 (2026-04-19)

**Reviewer:** General-purpose deep review agent
**Scope:** Full codebase, all action modules, middleware, security, data layer, UI components, i18n

## Summary

Cycle 32 review of the full codebase after 31 prior cycles of fixes. The codebase is in strong shape. This review found **4 findings** (1 MEDIUM, 3 LOW). No CRITICAL issues.

## Findings

### C32-01: ~~`db/index.ts` connection pool config mismatch with CLAUDE.md documentation~~ — FALSE POSITIVE
**Severity:** ~~MEDIUM~~ N/A | **Confidence:** ~~High~~ N/A
**File:** `apps/web/src/db/index.ts:18` and `CLAUDE.md` (Connection pool section)

**Resolved:** CLAUDE.md already states "10 connections" matching the code. This was already fixed in a prior cycle. No action needed.

### C32-02: `restoreDatabase` does not wrap `getCurrentUser()` in try-catch (unlike `dumpDatabase`)
**Severity:** LOW | **Confidence:** Medium
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:325-326`

After cycle 31 hardened `dumpDatabase` to wrap `getCurrentUser()` in try-catch so audit logging errors don't prevent the success resolve, the `restoreDatabase` function's close callback still calls `getCurrentUser()` directly without a try-catch. If `getCurrentUser()` throws (e.g., DB temporarily unavailable after a restore), the promise will reject and the client will see a generic error despite the restore succeeding.

```ts
// db-actions.ts line 325
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'db_restore', 'database', DB_NAME).catch(console.debug);
```

**Fix:** Wrap `getCurrentUser()` in try-catch, matching the pattern from `dumpDatabase`:
```ts
try {
    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'db_restore', 'database', DB_NAME).catch(console.debug);
} catch (err) {
    console.debug('Failed to log audit event for restore:', err);
}
```

### C32-03: `pruneShareRateLimit` uses insertion-order eviction, not LRU
**Severity:** LOW | **Confidence:** Low
**File:** `apps/web/src/app/actions/sharing.ts:26-38`

The `pruneShareRateLimit` function evicts the first entries in the Map when over the cap. JavaScript Maps iterate in insertion order, but this is not true LRU — a frequently-used entry that was inserted early will still be evicted before a recently-inserted but never-reused entry. The same pattern exists in `uploadTracker`, `loginRateLimit`, and `passwordChangeRateLimit`.

This is a Low severity issue because all these Maps have hard caps and expiry-based pruning, so the eviction order only matters during burst traffic that exceeds the cap. In practice, the cap is large enough that this is unlikely to cause problems.

**Fix:** This is a known trade-off documented in prior cycles. The simplest improvement would be to re-insert accessed entries (delete + set) to move them to the end of the iteration order, providing approximate LRU. However, this adds complexity for marginal benefit.

### C32-04: `health` route exposes database connectivity status to unauthenticated users
**Severity:** LOW | **Confidence:** High
**File:** `apps/web/src/app/api/health/route.ts:15-18`

The `/api/health` endpoint returns `{ status, db: dbOk, timestamp }` to all callers without authentication. The `db: true/false` field reveals whether the database is reachable. An attacker could probe this endpoint to time a DoS attack when the DB is down, or use it to enumerate infrastructure details.

This was previously flagged as C30-08 and deferred. Re-noting for completeness since it remains unfixed.

**Fix:** Either authenticate the endpoint (using `withAdminAuth`), or remove the `db` field from the response body (returning only `status: "ok"` or `"degraded"` without the `db` boolean). The status code (200 vs 503) already conveys health status to load balancers.

## Previously Fixed (Confirmed)

All cycle 1-31 findings remain resolved. No regressions detected. The cycle 31 fixes are properly implemented:
- C31-01: `dumpDatabase` correctly awaits writeStream flush before resolving
- C31-02: Upload tracker uses additive adjustment
- C31-03: Unnecessary `pruneLoginRateLimit` removed from `updatePassword`
- C31-04: Share link retry only on key collision

## Deferred Carry-Forward

All previously deferred items from cycles 5-29 remain deferred with no change in status. See `.context/plans/77-deferred-cycle31.md` for the full list.
