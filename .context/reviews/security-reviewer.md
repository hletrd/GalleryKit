# Security Reviewer — Cycle 3 Deep Review (2026-04-27)

**HEAD:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`
**Scope:** Full codebase security audit — OWASP Top 10, auth/authz, secrets, unsafe patterns

## Methodology

Reviewed all server actions, API routes, middleware, session management, cookie handling, file upload/download paths, SQL injection surfaces, XSS vectors, CSRF protection, rate limiting, and data exposure. Cross-referenced against OWASP Top 10 (2021).

## Findings (New — Not in Prior Cycles)

### LOW Severity (2)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-S01 | `nav-client.tsx` sets the `NEXT_LOCALE` cookie with `SameSite=Lax` and conditionally adds `Secure` based on `window.location.protocol`. The `SameSite=Lax` attribute is now explicit (fixed from C2-F02). However, the cookie is set via `document.cookie` (client-side JavaScript), which means it is subject to browser-specific cookie size limits and is visible to any JS running in the page context. This is acceptable for a locale preference (not security-sensitive), but the cookie is also read by next-intl middleware for locale detection. If an attacker could inject JS (via XSS), they could manipulate the locale cookie. This is a defense-in-depth concern, not a direct vulnerability, since XSS would already give the attacker full page control. | `components/nav-client.tsx:66` | Low |
| C3-S02 | `restoreDatabase` in `db-actions.ts` streams the uploaded SQL file directly into `mysql --one-database`. The `--one-database` flag only filters the `USE` database context — it does not prevent `DROP DATABASE` or `ALTER TABLE` statements that target other databases if they don't include a `USE` statement. The SQL scan (`containsDangerousSql`) blocks `DROP DATABASE` and other dangerous statements, but the `--one-database` flag alone would not provide isolation if the scanner were bypassed. The defense-in-depth chain (header validation + SQL scanning + `--one-database`) is sufficient for the threat model of a trusted admin performing restore. | `app/[locale]/admin/db-actions.ts:412-414` | Low |

### INFO (1)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-S03 | The `SESSION_SECRET` env var is required in production (enforced by `session.ts:30-36`). If it's missing, the app throws and refuses to start. The dev-only fallback to DB-stored secret is acceptable. The secret is cached in `cachedSessionSecret` and never logged. This is correctly implemented. | `lib/session.ts:16-80` | Info |

## Verified Controls (No New Issues)

1. **Authentication**: Argon2id + timing-safe comparison, HMAC-SHA256 session tokens, 24-hour expiry, rate limiting (per-IP + per-account)
2. **Authorization**: `isAdmin()` / `requireSameOriginAdmin()` on all mutating actions, `withAdminAuth` on API routes, middleware cookie check, privacy guard
3. **Injection**: Drizzle ORM parameterization, SQL restore scanner, LIKE wildcard escaping, CSV formula injection prevention, `safeJsonLd()` escaping, path traversal prevention
4. **Security Misconfiguration**: CSP with nonce, conditional GA domains, `X-Content-Type-Options: nosniff`, cookie Secure flag, restrictive file modes
5. **Sensitive Data Exposure**: GPS/filename exclusion from public API, authenticated backup download, session tokens HMAC-signed
6. **XSS**: React auto-escaping, `safeJsonLd()` for dangerouslySetInnerHTML, CSP script-src nonce
7. **CSRF**: Next.js built-in + `requireSameOriginAdmin()` defense-in-depth, SameSite: Lax
8. **Rate Limiting**: Login, password, search, load-more, share, user-create, OG — all with hard caps
9. **Unicode Spoofing**: `UNICODE_FORMAT_CHARS` rejection on all admin string surfaces
10. **Data Integrity**: Advisory locks, upload tracker TOCTOU, view count buffer swap
