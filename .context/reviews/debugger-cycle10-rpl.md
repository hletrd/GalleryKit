# debugger — cycle 10 rpl

HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Scope: latent bug surface, failure modes, regressions.

## Findings

### D10R-RPL-01 — `createAdminUser` validation-error rate-limit burn (C10R-RPL-01 companion) [LOW / HIGH]

File: `apps/web/src/app/actions/admin-users.ts:83-125`.

Failure mode: admin opens "add user" form, types the username but accidentally presses Enter before typing password → empty password → action fires → rate-limit increments → admin retries → repeats → after 10 submissions, admin is locked out for 1 hour (USER_CREATE_WINDOW_MS = 3_600_000 ms).

Regression surface: NO existing test triggers this path. Will not catch if reintroduced.

Confidence: High.

### D10R-RPL-02 — `sharing.ts` FK violation rollback races [LOW / MEDIUM]

File: `apps/web/src/app/actions/sharing.ts:287-301`.

Catch handles `ER_NO_REFERENCED_ROW_2` by rolling back the rate-limit counter. But if a concurrent request has also pre-incremented the counter, the rollback `count > 1 ? count-- : delete` may leave the counter at 0 when the concurrent request expects it to still count their attempt. This is the classic concurrent rollback bug addressed by `rollbackShareRateLimit` using decrement-not-delete. Looking at the code, it DOES use decrement properly. Not a bug.

Spot-check: confirm `rollbackShareRateLimitFull` uses decrement-not-delete semantics for BOTH in-memory and DB counters. Verified at lines 69-90: in-memory uses `currentEntry.count--` or delete-if-count<=1; DB uses `decrementRateLimit`. Correct.

Confidence: High (non-issue).

### D10R-RPL-03 — Potential DB pool exhaustion if `restoreDatabase` hangs on RELEASE_LOCK (AGG9R-RPL-13 carry-forward) [LOW / MEDIUM]

File: `apps/web/src/app/[locale]/admin/db-actions.ts:300-314`.

Failure mode: A DB-level deadlock or client-server network partition keeps the RELEASE_LOCK query alive indefinitely. The pool connection is stuck; if enough restore attempts hit this, pool exhaustion → entire app hangs.

Mitigation: `connection.getConnection()` has no per-call timeout; MySQL pool has 30s keepalive but no query timeout.

Carry-forward. Low priority because restore is admin-gated and rare.

Confidence: Medium.

### D10R-RPL-04 — `prunePasswordChangeRateLimit` pruning might be called when passwordChangeRateLimit is empty [LOW / LOW]

File: `apps/web/src/lib/auth-rate-limit.ts:90-107`.

Called from `auth.ts:310`. If `passwordChangeRateLimit.size === 0`, the prune is a no-op. The `for...of` loop over an empty Map is effectively free. Not actionable.

Confidence: High (non-issue).

### D10R-RPL-05 — `flushGroupViewCounts` consecutiveFlushFailures semantics (AGG9R-RPL-11 carry-forward) [LOW / MEDIUM]

File: `apps/web/src/lib/data.ts:82-89`.

Unchanged from cycle 9 rpl. Current logic: counter increments only on total-failure (0 succeeded in a batch). If 9 of 10 succeed but one row is re-buffered, counter resets. Test gap remains.

Confidence: Medium. Carry-forward.

## Summary

- 1 latent bug scheduled this cycle (D10R-RPL-01 — companion to C10R-RPL-01).
- 2 non-issues confirmed (FK rollback races, empty-map prune).
- 2 carry-forward (RELEASE_LOCK timeout, flush counter semantics).
