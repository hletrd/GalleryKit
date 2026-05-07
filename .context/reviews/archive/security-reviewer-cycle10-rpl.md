# security-reviewer — cycle 10 rpl

HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Scope: OWASP Top 10, authN/authZ, input validation, secrets, unsafe patterns. Cross-checked against cycle 9 rpl security findings.

## Findings

### C10R-RPL-S01 — `createAdminUser` rate-limit pre-increment happens before form-field validation [LOW / HIGH]

File: `apps/web/src/app/actions/admin-users.ts:83-125`.

Matches the pattern fixed in cycle 9 rpl for `updatePassword` (AGG9R-RPL-01). An already-authenticated admin mistyping the username regex (underscore or dash only!) or password confirmation 10 times burns the 1-hour user-create budget even though no Argon2 hash ran. Impact is limited (authenticated admin self-DoS), but the fix is trivial and consistent with the rest of the codebase.

See code-reviewer C10R-RPL-01 for the fix diff.

Confidence: High.

### C10R-RPL-S02 — `deleteTopicAlias` dead `\x00` regex branch (AGG9R-RPL-12 carry-forward) [LOW / LOW]

File: `apps/web/src/app/actions/topics.ts:446`.

`stripControlChars` at line 440 already removes `\x00` (it strips 0x00-0x1F). The regex `/[/\\\x00]/` therefore has `\x00` as dead. No security impact either way — the input is already sanitized before the check — but removing it eliminates the appearance of defense-in-depth where there is none. Alternative: leave the regex as-is since defense-in-depth is the right design principle here (if `stripControlChars` were ever refactored to miss `\x00`, this regex would still catch it).

Proposed: Keep the regex as-is (defense-in-depth). Add a comment: `// Regex includes \x00 as belt-and-suspenders even though stripControlChars above already strips 0x00-0x1F.` Align with C10R-RPL-03 stance.

Confidence: Low. Observational.

### C10R-RPL-S03 — Account-scoped login rate-limit and password-change rate-limit share `LOGIN_WINDOW_MS` but no explicit bound test [LOW / MEDIUM]

File: `apps/web/src/lib/auth-rate-limit.ts:59, 87-107`.

`passwordChangeRateLimit` uses `LOGIN_WINDOW_MS` for both expiry and pruning, but the constant is imported from `rate-limit.ts`. There's no explicit test verifying that a password-change bucket survives for exactly 15 minutes from last attempt. If `LOGIN_WINDOW_MS` is ever changed without thinking about its downstream use in password-change expiry, admins could be locked out longer or shorter than documented.

Proposed: Either (a) rename the import to `PASSWORD_CHANGE_WINDOW_MS` aliased to `LOGIN_WINDOW_MS` for clarity, or (b) add a test that asserts `passwordChangeRateLimit` expires at `LOGIN_WINDOW_MS` boundary. Option (b) is lower-cost.

Confidence: Medium.

### C10R-RPL-S04 — `restoreDatabase` `RELEASE_LOCK` has no per-query timeout (AGG9R-RPL-13 carry-forward) [LOW / MEDIUM]

File: `apps/web/src/app/[locale]/admin/db-actions.ts:300-314`.

Carry-forward from cycle 9 rpl. Deferred pending "DB-resilience cycle". Risk path: deadlock or connection hang in the release query blocks the pool. Still LOW priority given current test infrastructure.

Confidence: Medium. Carry-forward.

## Summary

- 0 HIGH findings
- 0 MEDIUM findings
- 4 LOW findings (1 consistency fix, 1 observation, 1 docs/test, 1 carry-forward)

No new security-critical issues this cycle. The codebase continues to show the defense-in-depth patterns added through 46+ review cycles. Only notable gap is the consistency fix for `createAdminUser` rate-limit ordering.
