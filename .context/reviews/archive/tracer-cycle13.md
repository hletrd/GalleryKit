# Tracer - Cycle 13

Causal tracing of suspicious flows with competing hypotheses.

## Probes attempted

1. **Concurrent admin-user creation race** — hypothesis: could two concurrent `createAdminUser` calls create duplicate users or cause counter drift?
   - Trace: pre-increment locks via `checkUserCreateRateLimit` then DB `incrementRateLimit`; `ER_DUP_ENTRY` rollback exists; TX not required because no multi-row write.
   - Competing: does the in-memory `userCreateRateLimit` Map race with itself? `pruneUserCreateRateLimit` is called inside `checkUserCreateRateLimit`, but all mutations are synchronous within the same V8 tick, so no await-interleaving exists. Not an issue.

2. **Login `unstable_rethrow` swallowed by inner try** — hypothesis: is there a catch that accidentally swallows `NEXT_REDIRECT`?
   - Trace: `auth.ts:219` rethrows inside the session-creation catch; `auth.ts:224` rethrows in the outer catch; `redirect()` on `auth.ts:217` will throw `NEXT_REDIRECT` but it propagates through both rethrow points. Not an issue.

3. **`updatePassword` transaction failure leaks old sessions** — hypothesis: if the TX commit fails, would old sessions still be invalidated?
   - Trace: both `UPDATE adminUsers` and `DELETE sessions` are inside the `db.transaction(async (tx) => ...)` block at `auth.ts:360-373`. If either fails, both roll back. Session survival after a password change on DB error cannot happen. Not an issue.

4. **`restoreDatabase` advisory lock leak on error** — hypothesis: could a lock stay held?
   - Trace: `RELEASE_LOCK` in `finally`. Even on throw, lock is released. Also, MySQL releases GET_LOCK on connection close.

5. **Signature verification short-circuit** — hypothesis: can an attacker side-channel via Buffer length?
   - Trace: `session.ts:113-118` checks length equality before `timingSafeEqual`. The length check leaks length (always 64 chars for SHA-256 hex), but both valid and invalid tokens have the same signature length — no timing leak. Not an issue.

## Findings

No new CRITICAL, HIGH, MEDIUM, or LOW findings.

## Confidence: High

All probed flows terminate safely.
