# Tracer Review — Cycle 6 (2026-04-19)

## Summary
Causal tracing of suspicious flows and competing hypotheses. Found **0 new findings**.

## Traced Flows

### Flow 1: Login Rate Limit Rollback
**Hypothesis:** If `clearSuccessfulLoginAttempts` fails, the user is locked out despite successful login.
**Trace:** auth.ts:139-143 — `clearSuccessfulLoginAttempts` is wrapped in try/catch. If it fails, the error is logged but the login still succeeds (session token is set, redirect happens). The in-memory counter stays incremented, meaning the next failed login from the same IP may hit the limit one attempt early. This is acceptable — the DB-backed counter provides the source of truth and the in-memory counter expires after 15 minutes.
**Verdict:** ACCEPTABLE — minor inconsistency with no security impact.

### Flow 2: Upload Tracker Adjustment
**Hypothesis:** If multiple concurrent uploads from the same IP adjust the tracker simultaneously, the additive adjustment could produce incorrect totals.
**Trace:** images.ts:248-249 — `tracker.count += (successCount - files.length)` and `tracker.bytes += (uploadedBytes - totalSize)`. These are additive adjustments that assume the tracker value hasn't changed between the pre-increment and the adjustment. If concurrent requests modify the same tracker entry, the adjustments could be based on stale `tracker` references.
**Verdict:** ACCEPTABLE — The tracker is a best-effort rate limiter, not an accounting system. Slight over/under-counting is tolerable. The hard cap and pruning prevent unbounded growth.

### Flow 3: View Count Buffer Re-buffering
**Hypothesis:** If `flushGroupViewCounts` fails and re-buffers, the view counts could be double-counted.
**Trace:** data.ts:27-52 — On DB update failure, the count is added back to the buffer. The original buffer was cleared at line 31 before the DB updates, so there's no double-counting — the re-buffered count represents the same increments that failed to flush. VERIFIED CORRECT.

### Flow 4: Search Rate Limit Pre-increment Rollback
**Hypothesis:** If DB-backed check returns "limited" after in-memory pre-increment, the in-memory counter stays overcounted.
**Trace:** public.ts:66-76 — On DB "limited" response, the in-memory counter is decremented or the entry is deleted. This keeps the in-memory counter consistent with the DB source of truth. VERIFIED CORRECT.

## No New Issues Found
