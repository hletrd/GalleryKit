# Aggregate Review — Cycle 11 Round 2 (2026-04-19)

**Source reviews:** comprehensive-review-cycle11-r2 (single reviewer, multi-angle)

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

---

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C11R2-01 | `s/[key]/page.tsx` uses dynamic import inconsistent with `g/[key]/page.tsx` static import | LOW | HIGH | IMPLEMENT |
| C11R2-02 | `createAdminUser` DB rate limit has check-then-increment TOCTOU (same pattern fixed for login in A-01) | MEDIUM | HIGH | IMPLEMENT |
| C11R2-03 | Password confirmation only checked client-side in admin user creation | LOW | MEDIUM | DEFER |

### C11R2-01: Inconsistent dynamic import [LOW]

`s/[key]/page.tsx` still uses `dynamic(() => import('@/components/photo-viewer'))` while `g/[key]/page.tsx` was recently converted to a static import. No `ssr: false` option or loading state is provided, making the dynamic import unnecessary.

**Fix:** Convert to static import matching `g/[key]/page.tsx`.

### C11R2-02: createAdminUser DB rate limit TOCTOU [MEDIUM]

The `createAdminUser` function calls `checkRateLimit` (DB read) then later `incrementRateLimit` (DB write) as two separate operations. Between these, concurrent requests can both pass the check. The login function was fixed with pre-increment (A-01) but `createAdminUser` was not.

**Fix:** Pre-increment the DB rate limit before the Argon2 hash, matching the login pattern.

### C11R2-03: Password confirmation client-side only [LOW]

`createAdminUser` does not validate `confirmPassword` server-side. The check is client-only. Since the action requires admin auth, this is low risk — but inconsistent with the password change flow which validates server-side.

**Fix:** Accept and validate `confirmPassword` server-side, or document as acceptable.

---

## PREVIOUSLY FIXED — Confirmed Resolved Since Last Full Review

S-01, S-02, S-05, S-06, S-07, C-02, C-03, C-08, R-03, D-01, D-05, D-07, A-01, A-02, A-04, SEC-39-03, C39-01, C39-02, C39-03 — all confirmed fixed.

---

## DEFERRED CARRY-FORWARD

All previously deferred items from cycles 5-39 remain deferred with no change in status (see comprehensive review for full list).

---

## AGENT FAILURES

None — single reviewer completed successfully.

---

## TOTALS

- **1 MEDIUM** finding requiring implementation
- **1 LOW** finding recommended for implementation
- **1 LOW** finding deferred
- **0 CRITICAL/HIGH** findings
- **3 total** new findings (1M + 2L)
