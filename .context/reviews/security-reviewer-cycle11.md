# Security Reviewer -- Cycle 11 (2026-04-23)

## Scope
Security-focused review: OWASP Top 10, auth/authz, secrets, unsafe patterns, PII leakage, rate-limit consistency.

## Files Reviewed
- All files listed in code-reviewer-cycle11.md
- Additionally: `apps/web/src/proxy.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/session.ts`

## Findings

### C11-SEC-01 — `createAdminUser` rate-limit not rolled back on duplicate username (MEDIUM confidence)
- **Severity:** LOW (admin-authenticated endpoint, not a privilege escalation)
- **Confidence:** High
- **File:** `apps/web/src/app/actions/admin-users.ts:159-162`
- **Problem:** Duplicate username attempts consume a rate-limit slot, allowing an authenticated admin to accidentally lock themselves out from creating users. On admin-to-admin environments, this is a usability issue; it also creates a minor side-channel where the presence of usernames can be probed (the error message `usernameExists` is already confirming this directly, so the side-channel isn't new).
- **Related controls already in place:** login uses dummy-hash timing equalization, so username enumeration from login is blocked. `createAdminUser` needs no such guarantee because it's admin-only.
- **Fix:** Roll back both counters on the duplicate-entry branch (same as C11-FRESH-01 fix).

## Confirmed strong controls
- **Session tokens:** HMAC-SHA256 signed, constant-time comparison via `timingSafeEqual`. Session insert+invalidate is transactional.
- **Argon2id** with proper work factor.
- **Same-origin guard:** All mutating server actions use `requireSameOriginAdmin()` from `@/lib/action-guards`. The custom lint `lint:action-origin` enforces this at CI time.
- **CSRF via `SameSite=Lax` + origin check:** Layered defense; the `hasTrustedSameOrigin` check catches cases where the cookie is leaked to a third-party origin.
- **Path traversal in file serving:** Multi-layered defense in `serve-upload.ts` — `SAFE_SEGMENT` regex, `ALLOWED_UPLOAD_DIRS` whitelist, `lstat`+symlink rejection, `resolvedPath.startsWith()` containment.
- **SQL injection:** All queries via Drizzle ORM with parameterized bindings; raw conn.query paths use `?` placeholders.
- **CSV export:** Zero-width chars + bidi control chars + formula-injection chars all stripped.
- **DB restore:** Schema-scanner + `--one-database` flag; MYSQL_PWD via env var, not `-p`.
- **Rate limits:** IP-scoped AND account-scoped for login, preventing distributed brute-force.
- **PII gating:** `publicSelectFields` / `adminSelectFields` split with compile-time guard.

## Confidence note
No new CRITICAL or HIGH security issues found. The codebase has been hardened through 46+ review cycles. C11-SEC-01 is a consistency gap, not a new vulnerability class.
