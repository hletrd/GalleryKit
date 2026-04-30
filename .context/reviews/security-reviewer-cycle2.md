# Security Reviewer — Cycle 2/100 (2026-04-28)

## Files Reviewed

All source files under `apps/web/src/` — actions, lib, db, API routes, middleware.

## Findings

### No HIGH/MEDIUM Security Findings

The codebase has been hardened across many prior cycles. Key security surfaces examined:

1. **Authentication**: Argon2id password hashing with timing-safe comparison. Session tokens use HMAC-SHA256 with `timingSafeEqual`. Session secret enforcement in production. All good.

2. **Authorization**: Every mutating action checks `isAdmin()` + `requireSameOriginAdmin()`. API routes use `withAdminAuth` wrapper. Middleware performs cookie presence check for admin routes. Defense in depth is consistent.

3. **Path Traversal**: `serveUploadFile` uses `SAFE_SEGMENT` regex, `ALLOWED_UPLOAD_DIRS` whitelist, `resolvedPath.startsWith()` containment, symlink rejection via `lstat()`. Backup download route also uses `realpath` containment and symlink rejection. Solid.

4. **SQL Injection**: All queries use Drizzle ORM parameterization. Raw SQL in `deleteAdminUser` and `restoreDatabase` uses parameterized `conn.query()`. `searchImages` properly escapes LIKE wildcards. No concatenation of untrusted input found.

5. **Unicode Formatting**: `containsUnicodeFormatting` is applied to topic aliases, tag names, topic labels, image title/description, and SEO settings. CSV export has its own hardening. Consistent coverage.

6. **Rate Limiting**: Pre-increment pattern prevents TOCTOU on all rate-limited surfaces (login, password change, user creation, sharing, search, load-more, OG). Rollback paths on failure are symmetric.

7. **Session Management**: Password change rotates all sessions in a transaction. Login invalidates pre-existing sessions. Expired sessions purged hourly. Session cookie has proper attributes.

8. **Upload Security**: Filename sanitization via UUID, decompression bomb mitigation via `limitInputPixels`, directory whitelist, symlink rejection, batch byte/file caps, disk space pre-check, upload processing contract lock.

9. **Privacy**: `publicSelectFields` omits PII with compile-time guard. Search results omit internal filenames. GPS coordinates excluded from public API. Strong separation.

10. **CSRF/Origin**: `requireSameOriginAdmin` applied to all mutating actions. `hasTrustedSameOrigin` with fail-closed default. Cookie `sameSite: lax`.

### LOW/INFO

No new security findings. The codebase security posture is robust and consistent.

## Convergence Note

This is the fifth consecutive cycle with zero new security findings of any severity. All surfaces are well-hardened.
