# tracer — cycle 9 rpl

HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f`.

## Trace: what happens when an admin submits a password change with an empty confirmation field

1. Client POSTs the server action on `/admin/password`.
2. `updatePassword` (auth.ts:261) runs.
3. Line 263-266: `getCurrentUser()` returns the admin — check passes.
4. Line 267-270: restore maintenance check — passes.
5. Line 273-276: `hasTrustedSameOrigin` — passes (same-origin admin browser).
6. Line 277: `getClientIp(requestHeaders)` returns the admin's IP.
7. Line 279: `prunePasswordChangeRateLimit(now)` O(n) prune walk.
8. Line 280: `getPasswordChangeRateLimitEntry(ip, now)` returns existing or fresh entry (count: 0, lastAttempt: 0).
9. Line 281-283: count check — passes (count < 10).
10. Line 285-291: DB-backed rate-limit check — passes.
11. **Line 298-301: pre-increment in-memory and DB counters to 1.**
12. Line 308-310: extract currentPassword / newPassword / confirmPassword. `confirmPassword` is `''`.
13. **Line 312-314: `!confirmPassword` → return `{ error: t('allFieldsRequired') }` WITHOUT rolling back the pre-increment.**
14. Next attempt: count starts from 1, not 0. After 10 typos the admin is locked out for 15 minutes.

The lockout is entirely caused by the ordering at steps 11-13. No Argon2 verify ever ran, no infrastructure error occurred.

## Competing hypotheses

**H1: Intentional — penalize typos to slow adversaries who guess passwords.**
- Counter-argument: the purpose of a rate limit is to slow auth *guesses*. A typo on the confirm field is never a password guess; confirmPassword is compared to newPassword on the client before submit ideally, and on the server the mismatch doesn't reveal anything about the current password. Penalizing confirm-password typos adds zero adversary cost while imposing real cost on the admin.
- Verdict: weak. No documentation supports "typo penalty" design.

**H2: Refactor regression — the ordering used to put validation before the increment, then was rearranged.**
- Counter-argument: `login` still has validation BEFORE increment (auth.ts:83-89). The inconsistency is what signals the regression.
- Verdict: likely. The comment at line 293-296 says "pre-increment BEFORE expensive Argon2 verify (TOCTOU fix)" — this is correct motivation, but it was implemented in a location that also precedes validation, not just Argon2.

**H3: Deliberate defense against concurrent typo-bomb attacks.**
- Counter-argument: the in-memory-map pre-increment at step 11 and DB pre-increment at step 12 happen AFTER `hasTrustedSameOrigin` — a cross-origin attacker cannot reach step 11. A same-origin concurrent typo burst is not a meaningful threat (one admin, one window).
- Verdict: weak. No plausible attack scenario justifies step 11 happening before step 12.

**H1 confidence: LOW.** **H2 confidence: HIGH.** **H3 confidence: LOW.**

## Diagnosis

H2 best explains the observed code state. The fix is to reorder: form-field extraction + validation should occur above the pre-increment block. The comment "Sanitize before validation so length checks operate on the same value that will be hashed" at line 306-307 confirms the intent — sanitization happens just before validation, and validation should gate the rate limit.

## Related

- `createAdminUser` in `admin-users.ts:107-125` has a similar structure — rate-limit increment happens BEFORE username/password form-field extraction. Trace through: if an attacker POSTs empty username, the counter is burned. However, this is an ADMIN-CREATE action (only reachable when already logged in) and the counter is per-IP. Lower impact but same pattern inconsistency.
- Sharing actions (`createPhotoShareLink`, `createGroupShareLink`) validate imageId / imageIds BEFORE the share-rate-limit check. Correct ordering.

## Proposed unified invariant

> Every rate-limited action MUST validate form-input shape (presence, length, type) BEFORE any rate-limit counter mutation. Rate-limit mutations should gate only expensive work (DB queries, Argon2, file I/O), not form parsing.
