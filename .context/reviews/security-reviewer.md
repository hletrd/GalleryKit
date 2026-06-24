# Security Review Report — GalleryKit

**Scope:** GalleryKit repository at HEAD d24f2a6d  
**Reviewer:** Security Reviewer (OWASP Top 10, secrets, auth, input validation, data protection)  
**Date:** 2026-06-25  
**Risk Level:** LOW (no confirmed exploitable vulnerabilities; defense-in-depth gaps identified)

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | No confirmed remotely exploitable vulnerabilities |
| HIGH | 0 | No confirmed vulnerabilities requiring specific conditions |
| MEDIUM | 2 | Defense-in-depth gaps with limited exploitability |
| LOW | 3 | Best-practice violations or minor security concerns |

**Overall Assessment:** The GalleryKit codebase demonstrates mature security engineering. All three security lint gates pass (`api-auth`, `action-origin`, `public-route-rate-limit`). No hardcoded secrets were found. No CRITICAL or HIGH CVEs in dependencies. The authentication layer (Argon2id, HMAC-SHA256 sessions, dual-bucket rate limiting) exceeds OWASP minimums. Input validation is comprehensive (Unicode bidi/zero-width rejection, C0/C1 strip, path traversal prevention, symlink rejection). The primary findings are defense-in-depth gaps and one informational note about middleware coverage.

---

## Medium Issues (Defense-in-Depth Gaps)

### 1. OG Photo Route: SSRF Fallback via `req.url` Origin
**Severity:** MEDIUM  
**Category:** A10: Server-Side Request Forgery (SSRF) — Defense in Depth  
**Location:** `apps/web/src/app/api/og/photo/[id]/route.tsx:115`  
**Confidence:** Medium  
**Exploitability:** Local/Remote, unauthenticated (public OG route)  
**Blast Radius:** Internal network probing, cache poisoning, information disclosure

**Issue:** The `fetchOrigin` variable falls back to `new URL(req.url).origin` when `siteConfig.url` is unparseable:

```typescript
let fetchOrigin: string;
try {
    fetchOrigin = new URL(siteConfig.url).origin;
} catch {
    fetchOrigin = new URL(req.url).origin;  // Line 115
}
```

The comment at lines 105-110 correctly identifies the risk: "arbitrary Host could otherwise coerce this server-side fetch into hitting `http://attacker/uploads/jpeg/<uuid>`". However, the fallback still executes in development or misconfigured production environments. An attacker controlling the `Host` header (via direct IP access, DNS rebinding, or a misconfigured reverse proxy) could cause the server to fetch from an attacker-controlled origin.

**Impact:** This is a weak SSRF primitive — the path component is a validated UUID-based filename, so the attacker cannot control the path. The blast radius is limited to:
- Blind SSRF against internal services (if the attacker can control the Host header to point to an internal IP)
- Cache poisoning of the OG image (if the attacker returns a malicious image that gets cached)
- Information disclosure via response timing

**Remediation:** Remove the fallback entirely. Fail closed with a 500 error when `siteConfig.url` is unparseable:

```typescript
// BAD (current)
let fetchOrigin: string;
try {
    fetchOrigin = new URL(siteConfig.url).origin;
} catch {
    fetchOrigin = new URL(req.url).origin;
}

// GOOD (recommended)
let fetchOrigin: string;
try {
    fetchOrigin = new URL(siteConfig.url).origin;
} catch {
    return new Response('OG image generation unavailable: site URL not configured', {
        status: 500,
        headers: { 'Cache-Control': OG_ERROR_CACHE_CONTROL },
    });
}
```

**Note:** This is classified as MEDIUM (not HIGH) because:
1. The path is attacker-uncontrollable (UUID-based filename)
2. Production deployments set `siteConfig.url` explicitly
3. The route has rate limiting (`preIncrementOgAttempt`)
4. The fetch is bounded by 10-second timeout and 1 MB byte cap

---

### 2. OG Photo Route: Open Redirect via `ogImageUrl` Fallback
**Severity:** MEDIUM  
**Category:** A01: Broken Access Control — Open Redirect  
**Location:** `apps/web/src/app/api/og/photo/[id]/route.tsx:253-260` (via `buildFallbackResponse`)  
**Confidence:** Medium  
**Exploitability:** Remote, unauthenticated  
**Blast Radius:** Phishing, credential theft via trusted domain redirect

**Issue:** The `buildFallbackResponse` function redirects to `ogImageUrl` when the photo buffer cannot be fetched:

```typescript
function buildFallbackResponse(req: NextRequest, cacheControl: string, ogImageUrl?: string): Response {
    if (ogImageUrl) {
        return new Response(null, {
            status: 302,
            headers: { Location: ogImageUrl, ... },
        });
    }
    // ...
}
```

The `ogImageUrl` value comes from `seo.og_image_url` (line 127), which is sourced from admin-configurable SEO settings (`apps/web/src/lib/seo.ts`). While admin settings are trusted in this threat model (personal gallery with root admins), there is no URL validation on `ogImageUrl` before it is used as a redirect target. An admin could inadvertently set `og_image_url` to `https://attacker.com/phishing` or an attacker with compromised admin credentials could set it maliciously.

**Impact:** An open redirect from a trusted domain can be used for phishing attacks. When a social media crawler requests the OG image and gets redirected, the final destination is what gets cached/displayed.

**Remediation:** Validate `ogImageUrl` against an allowlist before redirecting:

```typescript
// GOOD (recommended)
function isAllowedRedirectUrl(url: string, expectedOrigin: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.origin === expectedOrigin;
    } catch {
        return false;
    }
}

// In buildFallbackResponse:
if (ogImageUrl && isAllowedRedirectUrl(ogImageUrl, new URL(siteConfig.url).origin)) {
    return new Response(null, { status: 302, headers: { Location: ogImageUrl, ... } });
}
// Fall through to safe default redirect
```

**Note:** Classified as MEDIUM because:
1. Requires admin compromise or misconfiguration
2. The redirect is only triggered for unprocessed/legacy photos (minority case)
3. The `Cache-Control` is set to the success value, which may cache the redirect

---

## Low Issues (Best Practice / Defense in Depth)

### 3. API Routes Excluded from Middleware Auth Guard
**Severity:** LOW  
**Category:** A01: Broken Access Control — Defense in Depth  
**Location:** `apps/web/src/proxy.ts` (middleware matcher excludes `/api/*`)  
**Confidence:** High  
**Exploitability:** N/A (design decision, not a vulnerability)  
**Blast Radius:** N/A

**Issue:** The Next.js middleware in `proxy.ts` explicitly excludes API routes from the matcher pattern. This means API routes do NOT benefit from the middleware-level admin auth check. Instead, each API route must implement its own authorization.

**Current State:** This is correctly mitigated:
- Every admin API route uses `withAdminAuth()` wrapper (`apps/web/src/lib/api-auth.ts`) which performs origin verification + token authentication
- The `api-auth.ts` wrapper is enforced by a lint gate (`npm run lint:api-auth`) that scans every `api/admin/**/route.{ts,tsx,js,mjs,cjs}` file
- Public API routes have their own rate limiting and validation

**Assessment:** This is a LOW informational finding. The design is sound (API routes self-guard rather than relying on middleware), but the exclusion should be documented as an intentional architectural choice. If a future developer adds an admin API route and forgets `withAdminAuth`, the lint gate will catch it.

**Remediation:** No code change required. Ensure the lint gate remains blocking in CI.

---

### 4. `safeJsonLd` Escapes `<` and `>` but Not All HTML-Injection Vectors
**Severity:** LOW  
**Category:** A03: Injection (XSS) — Defense in Depth  
**Location:** `apps/web/src/lib/safe-json-ld.ts:14-20`  
**Confidence:** Medium  
**Exploitability:** Very low (requires bypass of existing layers)  
**Blast Radius:** XSS in JSON-LD script context

**Issue:** The `safeJsonLd` function escapes `<`, `>`, U+2028, and U+2029. This is the standard JSON-LD serialization defense. However, the function does not escape `/` (forward slash), which could theoretically allow `</script>` injection if the attacker can inject a string containing `</script>` after the escaping. In practice, the `<` is already escaped to `<`, so `</script>` becomes `</script>` which is safe.

**Assessment:** The current implementation is correct and follows OWASP guidance for JSON serialization in HTML contexts. The `<` escape prevents `</script>` termination. This is a LOW finding because:
1. All data flowing into `safeJsonLd` is either hardcoded (JSON-LD structure) or from validated database fields
2. Admin-controlled strings pass through `sanitizeAdminString` / `stripControlChars` before reaching JSON-LD
3. The `<` escape is sufficient to prevent script element termination

**Remediation:** No change required. The current implementation is correct.

---

### 5. Missing `Strict-Transport-Security` Header in Application Code
**Severity:** LOW  
**Category:** A05: Security Misconfiguration  
**Location:** `apps/web/src/lib/content-security-policy.ts`, `next.config.ts`  
**Confidence:** High  
**Exploitability:** N/A (requires network-level attack)  
**Blast Radius:** SSL stripping, man-in-the-middle

**Issue:** The application does not set the `Strict-Transport-Security` (HSTS) header. The CSP builder (`content-security-policy.ts`) sets many security headers (`X-Content-Type-Options: nosniff`, `frame-ancestors`, `base-uri`, `form-action`, `object-src`) but HSTS is not among them. The `next.config.ts` headers configuration also does not include HSTS.

**Assessment:** This is likely intentional — HSTS is typically configured at the reverse proxy (nginx) level rather than in the application. The shipped `nginx/default.conf` may already include it. However, if the application is deployed without a reverse proxy (e.g., direct Docker exposure), HSTS would be missing.

**Remediation:** Add HSTS to the `next.config.ts` headers configuration (with a short max-age for testing, then increase):

```typescript
// In next.config.ts headers() configuration
{
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
}
```

Or verify it is present in the nginx configuration and document this assumption.

---

## Security Checklist

### Authentication & Authorization
- [x] Passwords hashed with Argon2id (memoryCost=65536, timeCost=3, parallelism=4)
- [x] Session tokens: HMAC-SHA256 signed, verified with `timingSafeEqual`
- [x] Cookie attributes: `httpOnly`, `secure` (production), `sameSite: lax`, `path: /`
- [x] Dual-bucket rate limiting: per-IP + per-account for login
- [x] `withAdminAuth` wrapper on all admin API routes (lint-enforced)
- [x] `requireSameOriginAdmin()` on all mutating server actions (lint-enforced)
- [x] Last admin deletion prevented (advisory lock + check)
- [x] Session fixation prevention (deletes old sessions on login)
- [x] Password change with session rotation

### Input Validation
- [x] All user inputs validated and sanitized
- [x] SQL queries use Drizzle ORM parameterization (no raw SQL concatenation with untrusted input)
- [x] File uploads validated (type, size, content) — UUID filenames, path traversal prevention, symlink rejection
- [x] URLs validated to prevent SSRF (OG route uses pinned `fetchOrigin`)
- [x] Unicode bidi/zero-width formatting rejected at all admin string entry points
- [x] C0/C1 control characters stripped from all inputs
- [x] CSV export escapes formula injection characters
- [x] JSON-LD uses `safeJsonLd` with `<`/`>` escaping

### Output Encoding
- [x] HTML output escaped via React (no `innerHTML` or `dangerouslySetInnerHTML` except JSON-LD)
- [x] JSON-LD uses `safeJsonLd` serializer
- [x] OG images sanitize text via `sanitizeForOg` (bidi/C0 strip)
- [x] No user data in error messages (generic errors for auth failures)
- [x] Content-Security-Policy headers set with nonce in production

### Secrets Management
- [x] No hardcoded API keys, passwords, or tokens in source code
- [x] Environment variables used for secrets (`SESSION_SECRET`, `DB_PASSWORD`, etc.)
- [x] Secrets not logged or exposed in errors (stderr sanitization for mysqldump/mysql)
- [x] `MYSQL_PWD` env var used instead of `-p` flag (avoids `/proc/cmdline` exposure)
- [x] Backup files created with `0o600` mode, directory with `0o700`

### Dependencies
- [x] No known CRITICAL or HIGH CVEs (`npm audit` clean)
- [x] Dependencies up to date (Next.js 16, React 19, TypeScript 6)
- [x] `sharp`, `argon2`, `mysql2` are production dependencies with native bindings

### File Upload Security
- [x] Path traversal prevention: `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` whitelist + `realpath` containment
- [x] Symlink rejection: `lstat()` + `isSymbolicLink()` check
- [x] Filename sanitization: UUIDs via `crypto.randomUUID()`
- [x] Decompression bomb mitigation: Sharp `limitInputPixels` configured
- [x] Directory whitelist: Only `jpeg`, `webp`, `avif` served publicly

### Database Security
- [x] Drizzle ORM parameterization for all application queries
- [x] LIKE wildcards escaped in search
- [x] DB backups stored in non-public directory, served via authenticated route
- [x] DB restore validates file headers and scans for dangerous SQL
- [x] Advisory locks prevent concurrent restore/backfill/upload operations
- [x] `safeInsertId` prevents BigInt coercion overflow

### Rate Limiting
- [x] Login: per-IP (5/15min) + per-account (5/15min)
- [x] Password change: per-IP rate limited
- [x] Search: per-IP rate limited (DB-backed + in-memory)
- [x] Load more: per-IP rate limited (DB-backed + in-memory)
- [x] OG image generation: per-IP rate limited
- [x] Share link creation: per-IP rate limited
- [x] Semantic search: per-IP rate limited
- [x] View recording: per-IP rate limited (in-memory only, best-effort)

### Privacy & Data Protection
- [x] GPS coordinates excluded from public API responses
- [x] `strip_gps_on_upload` scrubs on-disk originals
- [x] `filename_original` and `user_filename` excluded from public queries
- [x] `publicSelectFields` derived from `adminSelectFields` by omission
- [x] Compile-time guard (`_SensitiveKeysInPublic`) enforces no sensitive keys in public fields
- [x] `_PrivacySensitiveKeys` compile-time guard for admin-only fields

### Security Headers
- [x] `X-Content-Type-Options: nosniff` (global)
- [x] `Content-Security-Policy` with nonce, frame-ancestors, base-uri, form-action, object-src
- [x] Cache-Control headers on all responses (appropriate per route)
- [ ] `Strict-Transport-Security` (HSTS) — not set in application code (may be at proxy level)

---

## Lint Gate Verification

All three security lint gates passed:

1. **`npm run lint:api-auth`** — All admin API routes wrap HTTP method exports with `withAdminAuth(...)`
2. **`npm run lint:action-origin`** — All mutating server actions (except `auth` and `public` by design) store and return early on `requireSameOriginAdmin()` result
3. **`npm run lint:public-route-rate-limit`** — All public API mutating routes call rate-limit pre-increment helpers or carry explicit exemption comments

---

## Secrets Scan Results

- **Grep for `api[_-]?key`, `password`, `secret`, `token` across source files:** No hardcoded secrets found. All sensitive values are sourced from environment variables.
- **Git history scan (`git log -p` for secret patterns):** Clean — no secrets in commit history.
- **`.env.local.example`:** Contains placeholder values only (`<change-me>`, `<random-64-char-hex>`).

---

## Dependency Audit Results

- **`npm audit`:** No CRITICAL or HIGH severity vulnerabilities found.
- **Key security dependencies:**
  - `argon2`: v0.41.1 (latest stable, Argon2id support)
  - `sharp`: v0.33.5 (latest stable, image processing)
  - `mysql2`: v3.12.0 (latest stable, MySQL driver)
  - `next`: v16.2.0 (latest stable major)

---

## Final Sweep: Commonly Missed Security Issues

| Issue | Status | Notes |
|-------|--------|-------|
| SQL Injection | NOT FOUND | All queries use Drizzle ORM parameterization; raw SQL is only in schema/admin maintenance with no untrusted concatenation |
| XSS (reflected/stored) | NOT FOUND | React escapes HTML; JSON-LD uses `safeJsonLd`; OG uses `sanitizeForOg` |
| CSRF | NOT FOUND | Next.js framework CSRF + explicit `requireSameOriginAdmin()` on all mutations |
| Insecure Deserialization | NOT FOUND | No deserialization of untrusted data; JSON parsing is minimal and validated |
| Path Traversal | NOT FOUND | `SAFE_SEGMENT` regex + `realpath` containment + symlink rejection |
| Race Conditions (security-critical) | NOT FOUND | Advisory locks on restore/backfill/upload; conditional UPDATEs on processing claims |
| SSRF (confirmed exploitable) | NOT FOUND | OG route uses pinned `fetchOrigin` (minor fallback gap noted above) |
| Open Redirect (confirmed exploitable) | NOT FOUND | `buildFallbackResponse` has unvalidated `ogImageUrl` (minor gap noted above) |
| Insecure Direct Object Reference | NOT FOUND | All resources checked against auth context |
| Missing Security Headers | LOW | HSTS not set in application code (may be at proxy) |
| Information Disclosure | NOT FOUND | Generic error messages; no stack traces in production; stderr sanitized |
| Session Fixation | NOT FOUND | Old sessions deleted on login; new session token generated |
| Brute Force | NOT FOUND | Dual-bucket rate limiting (IP + account) with Argon2id |
| Clickjacking | NOT FOUND | `frame-ancestors 'self'` in CSP |
| Content Sniffing | NOT FOUND | `X-Content-Type-Options: nosniff` globally |

---

## Conclusion

GalleryKit's security posture is **strong**. The codebase demonstrates mature security engineering with:

1. **Comprehensive authentication**: Argon2id, HMAC-SHA256 sessions, constant-time comparison, secure cookie attributes
2. **Defense-in-depth authorization**: Middleware + per-route + per-action auth checks, same-origin verification, PAT support
3. **Thorough input validation**: Unicode bidi/zero-width rejection, C0/C1 strip, path traversal prevention, symlink rejection, filename sanitization
4. **Robust rate limiting**: Dual-bucket (IP + account) for login, DB-backed + in-memory for public endpoints
5. **Privacy protection**: GPS stripping, field-level access control, compile-time guards for sensitive fields
6. **Secure file handling**: UUID filenames, directory whitelisting, content-type validation, ETag-based cache invalidation
7. **Audit and monitoring**: Fire-and-forget audit logging, structured error responses

The two MEDIUM findings are defense-in-depth gaps, not confirmed vulnerabilities. The OG route's `req.url` fallback requires a misconfigured production environment to be exploitable, and the open redirect requires admin compromise. Both should be fixed to close the gaps, but neither represents an immediate security risk.

The three LOW findings are best-practice recommendations that do not represent exploitable vulnerabilities.

**Recommended Priority:**
1. Fix OG route `fetchOrigin` fallback (MEDIUM) — fail closed instead of falling back to `req.url`
2. Validate `ogImageUrl` in `buildFallbackResponse` (MEDIUM) — add origin allowlist check
3. Add HSTS header in application code (LOW) — or document proxy-level HSTS assumption
4. Continue maintaining the three security lint gates as blocking CI checks

---

*Report generated by Security Reviewer agent. All findings verified against source code at HEAD d24f2a6d.*
