# tracer — cycle 10 rpl

HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Scope: causal tracing of suspicious flows.

## Active traces

### T10-1 — `createAdminUser` happy-path and error-path ordering

Trace:

1. Admin opens admin/users, fills form, submits.
2. Server action `createAdminUser(formData)` entered.
3. `isAdmin()` check — passes.
4. `requireSameOriginAdmin()` — passes.
5. `getRestoreMaintenanceMessage()` — passes.
6. `getClientIp(requestHeaders)` — returns admin's IP.
7. `checkUserCreateRateLimit(ip)` — in-memory check; if >10/hr, return error.
8. `incrementRateLimit(ip, 'user_create', ...)` + `checkRateLimit(...)` — DB pre-increment.
9. `stripControlChars` extraction of username/password/confirmPassword.
10. Length/format/match validation.
11. Argon2 hash + DB insert.

**Divergence from login/updatePassword pattern**: The extract+validate block (step 9-10) runs AFTER the rate-limit increment (step 7-8). If the admin mistypes "a" (1 char) 20 times in rapid succession, the hour-long budget is consumed, and legitimate retry is blocked.

Competing hypotheses:
- **H1**: Design intent was "any failed admin action counts", including typos. Counter-evidence: cycle 9 rpl AGG9R-RPL-01 fix established the opposite intent for `updatePassword`.
- **H2**: Oversight — pattern was originally copied from cycle-9 `updatePassword` pre-fix state. Evidence: comment at admin-users.ts:80 says "Uses the same pre-increment pattern as login (A-01 fix)". But `login` ALSO validates before incrementing (auth.ts:83-89).

**Diagnosis**: H2. The pattern drifted. AGG9R-RPL-02 fix is warranted.

### T10-2 — `sharing.ts` catch block and NEXT_REDIRECT propagation

Trace:
1. Admin calls `createPhotoShareLink(imageId)`.
2. Enters try block at sharing.ts:122.
3. Inside try: `revalidateLocalizedPaths(...)` at line 151.
4. `revalidateLocalizedPaths` in `lib/revalidation.ts` — DOES NOT throw NEXT_REDIRECT (it calls `revalidatePath` internally, which does NOT throw NEXT_REDIRECT — only `redirect()` does).

**Current state**: No NEXT_REDIRECT signal in the try block path. Catch-all `catch (e)` is safe against current code paths. Risk is future-only: if a new caller inside the try-block uses `redirect()`, the catch would swallow. Low risk.

### T10-3 — Cross-referenced verification of AGG9R-RPL-14 (`recordFailedLoginAttempt` export)

Trace:
1. Source definition: `auth-rate-limit.ts:20-27`.
2. Reference search shows only `auth-rate-limit.test.ts:19,44` — test consumer.
3. Production callers: NONE directly. The `login` flow uses `limitData.count += 1` + `incrementRateLimit` inline at auth.ts:136-141 instead of calling the helper.

**Diagnosis**: The helper is "semi-live" — it's a utility for tests and potential future callers. Removing it would break tests. Keeping it documents the intended pattern. Net-net: not dead code. Withdraw the AGG9R-RPL-14 deferral.

## Competing hypotheses resolved

- H1 (createAdminUser intentionally different) — REJECTED in favor of H2 (pattern drift).
- H3 (`recordFailedLoginAttempt` is dead) — REJECTED; tests are consumers.

## Summary

- 1 confirmed bug class (C10R-RPL-01 / AGG9R-RPL-02).
- 1 withdrawn deferral (AGG9R-RPL-14).
- 1 non-issue confirmed (sharing.ts catch blocks).
