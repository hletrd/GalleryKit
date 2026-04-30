# Plan 75-Deferred — Deferred Items (Cycle 29)

**Created:** 2026-04-19 (Cycle 29)
**Status:** Deferred

## Deferred Findings

### C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap [LOW, Low Confidence]

- **File+Line:** `apps/web/src/lib/auth-rate-limit.ts`, line 64
- **Original Severity/Confidence:** LOW / Low
- **Reason for deferral:** Purely cosmetic/semantic improvement. The shared constant `LOGIN_RATE_LIMIT_MAX_KEYS` (5000) works correctly for the password change rate limit map — the map is separate from `loginRateLimit` and the cap prevents unbounded growth. A dedicated constant would be clearer but provides no functional benefit.
- **Exit criterion:** If the password change rate limit map needs a different cap than the login map (e.g., smaller since password changes are rarer), this should be re-opened.

## Carry-Forward from Previous Cycles

All previously deferred items from cycles 5-28 remain deferred with no change in status.
