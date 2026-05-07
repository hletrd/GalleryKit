# Security Reviewer - Cycle 12

Scope: full-repo authentication, authorization, rate-limiting, path traversal, CSRF/same-origin, PII exposure, DB/SQL safety, file serving.

## Findings

No new CRITICAL, HIGH, MEDIUM, or LOW findings.

### Confirmed protections (unchanged, still in force)

1. **Argon2id password hashing** + constant-time verify; dummy-hash branch equalizes user-exists vs missing timing.
2. **HMAC-SHA256 session tokens** with `timingSafeEqual` verification; cookies `httpOnly`, `secure` (prod), `sameSite: lax`.
3. **IP + account-scoped login rate limiting** (5 per 15 min) with pre-increment TOCTOU fix (A-01).
4. **Same-origin enforcement** on every mutating server action via `requireSameOriginAdmin()` and `hasTrustedSameOrigin()`, plus `lint:action-origin` gate at build time.
5. **Path traversal defense** layered: `SAFE_SEGMENT` regex, `ALLOWED_UPLOAD_DIRS` whitelist, `resolvedPath.startsWith()` containment, `lstat()` symlink rejection.
6. **Decompression-bomb mitigation** via Sharp `limitInputPixels`.
7. **Bounded Map + LRU eviction** on every in-memory rate-limit Map (login, password change, user create, share create, search, upload tracker).
8. **CSV formula-injection defense** strips zero-width chars AND prefixes `=`, `+`, `-`, `@`, `\t`, `\r`.
9. **PII guards** compile-time enforced via `_privacyGuard`; GPS/filename_original/user_filename excluded from public selects.
10. **MySQL advisory locks** scoped to DB server (verified in CLAUDE.md); `RELEASE_LOCK` catches logged not swallowed.
11. **Upload tracker TOCTOU** closed via pre-registration on first insert (C8R-RPL-02).
12. **CSRF-style origin check** rejects cross-site POSTs regardless of cookie presence.

### Gate status

- `lint:action-origin`: all 18 mutating server actions enforce same-origin check.
- `lint:api-auth`: the one API route (`/api/admin/db/download`) is properly guarded.

## Confidence: High

No new security action items.
