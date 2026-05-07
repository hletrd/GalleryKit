# Aggregate Review — Cycle 31 (2026-04-19)

## Summary

Cycle 31 review of the full codebase found **5 LOW** severity issues. No CRITICAL or HIGH findings. The codebase remains in strong shape after 30 prior cycles of fixes.

## Findings

| ID | Severity | Confidence | File | Description |
|----|----------|------------|------|-------------|
| C31-01 | LOW | Medium | `db-actions.ts:142-154` | `dumpDatabase` resolves before writeStream finishes flushing — backup download may be truncated |
| C31-02 | LOW | Low | `images.ts:247-248` | Upload tracker final adjustment overwrites concurrent pre-increment state (race condition) |
| C31-03 | LOW | Low | `auth.ts:233` | Unnecessary `pruneLoginRateLimit` call in password change flow |
| C31-04 | LOW | Low | `sharing.ts:106-109,182-185` | Share link creation retries on all exceptions, not just key collisions |
| C31-05 | LOW | Low | `db-actions.ts:142-154` | `dumpDatabase` close callback can leave promise pending on `getCurrentUser()` error |

## Previously Fixed (Confirmed)

All cycle 1-30 findings remain resolved. No regressions detected.

## Deferred Carry-Forward

All previously deferred items from cycles 5-29 remain deferred with no change in status.

## Actionable This Cycle

- C31-01: Await writeStream 'finish' event before resolving dumpDatabase success (moderate change)

## Deferred Candidates

- C31-02: Upload tracker concurrent overwrite (low risk — requires exact timing with same IP, pre-increment already prevents the primary TOCTOU)
- C31-03: Unnecessary pruneLoginRateLimit call (cosmetic, no functional impact)
- C31-04: Share link retry on all exceptions (low risk — 5 retries max, wastes connections but doesn't cause data loss)
- C31-05: dumpDatabase pending promise on audit error (low risk — getCurrentUser is unlikely to fail right after a successful mysqldump)
