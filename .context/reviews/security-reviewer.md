# Security Review — security-reviewer (Cycle 16)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical, high, or medium security findings.
- All prior security fixes confirmed intact.

## Verified fixes from prior cycles

All prior security findings confirmed addressed:

1. C1F-SR-08 (sanitizeStderr redacts DB_HOST, DB_USER, DB_NAME): CONFIRMED.
2. C1F-SR-01 (rate-limit rollback on infrastructure errors): CONFIRMED — fixed in commit e5a6779.
3. C1F-DB-02 (permanently-failed IDs prevent infinite re-enqueue): CONFIRMED.
4. Argon2id password hashing: confirmed.
5. HMAC-SHA256 session tokens with `timingSafeEqual`: confirmed.
6. Login rate limiting (per-IP + per-account dual bucket): confirmed.
7. `requireSameOriginAdmin()` on all mutating server actions: confirmed.
8. `withAdminAuth` + `hasTrustedSameOrigin` on all API routes: confirmed.
9. Upload security (UUID filenames, path traversal prevention, symlink rejection): confirmed.
10. Privacy enforcement (`publicSelectFields` + compile-time guard): confirmed.
11. Unicode bidi/invisible formatting rejection: confirmed on all admin string surfaces.
12. `safeJsonLd` XSS prevention in JSON-LD scripts: confirmed.
13. CSP with nonce in production: confirmed.
14. `serveUploadFile` security: confirmed.

## Deep review: sanitize and auth patterns

- `sanitizeAdminString` now returns `null` when `rejected=true` (C1F-CR-08/C1F-TE-05): confirmed.
- `UNICODE_FORMAT_CHARS` (non-/g) used for `.test()` in `sanitizeAdminString` (C8-AGG8R-01): confirmed.
- `UNICODE_FORMAT_CHARS_RE` (with /g) used only for `.replace()` in `stripControlChars`: confirmed.
- All admin string entry points use `sanitizeAdminString` or `requireCleanInput`: confirmed.

## New Findings

None.

## Carry-forward (unchanged — existing deferred backlog)

- D1-01 / D2-08 / D6-09 — CSP `'unsafe-inline'` hardening
- OC1-01 / D6-08 — historical example secrets in git history
