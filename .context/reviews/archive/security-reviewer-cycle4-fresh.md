# Security Reviewer — Cycle 4 Fresh Review (2026-04-27)

**Scope:** Full codebase security posture — OWASP top 10, auth/authz, input validation, injection, secrets

## Findings

### C4-S01 — `restoreDatabase` temp file leak on synchronous throw in `containsDangerousSql` (LOW, Low confidence)

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:375-400`

In `runRestore`, the SQL scan loop calls `containsDangerousSql(combined)` which is a pure string operation. If it were to throw (e.g., catastrophic regex backtracking on a malformed file — extremely unlikely given the bounded patterns), the error would propagate out of `runRestore` and then out of the `restoreDatabase` outer try/finally. The finally block releases the connection but does NOT clean up `tempPath`. The temp file would leak to `/tmp`.

The `containsDangerousSql` function uses `.test()` and `.replace()` on pre-sanitized strings, so a throw is theoretically impossible. This is a defense-in-depth concern at the very edge of plausibility.

Already noted in cycle 5 RPL as AGG5R-19 (LOW/LOW).

**Impact:** Theoretical temp file leak under impossible conditions.

**Suggested fix:** Wrap the SQL scan loop in try/catch that cleans up tempPath on error.

### C4-S02 — Backup download leaks symlink existence via 403 vs 404 (LOW, Medium confidence)

**File:** `apps/web/src/app/api/admin/db/download/route.ts:60-66`

The backup download route returns 403 for symlinks and 404 for ENOENT. An attacker who can hit this authenticated endpoint could determine whether a backup filename is a symlink. Already noted in C1-F09.

**Impact:** Information leak for authenticated admin users only. Low risk since the endpoint requires admin auth.

## Verified Controls

1. Argon2id + timing-safe comparison for auth — intact
2. Path traversal prevention (SAFE_SEGMENT + realpath containment) — intact
3. Privacy guard (compile-time + separate field sets) — intact
4. Rate-limit TOCTOU fix (pre-increment pattern) — intact across all surfaces
5. SQL restore scanner blocks dangerous patterns — intact, now includes CALL/RENAME USER/DO
6. Unicode bidi/formatting rejection — intact across all admin string surfaces
7. CSP with conditional GA domains — intact
8. Advisory locks for concurrent operations — intact
9. Symlink rejection on upload/serve routes — intact
