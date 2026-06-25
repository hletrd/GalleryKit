# Security Review Report — GalleryKit

**Scope:** GalleryKit repository at HEAD bcd67b12
**Reviewer:** Security Reviewer (OWASP Top 10, secrets, auth, input validation, data protection)
**Date:** 2026-06-25
**Risk Level:** LOW (no confirmed exploitable vulnerabilities; defense-in-depth gaps identified and remediated)

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | No confirmed remotely exploitable vulnerabilities |
| HIGH | 0 | No confirmed vulnerabilities requiring specific conditions |
| MEDIUM | 0 | All previously identified MEDIUM issues have been remediated |
| LOW | 0 | All previously identified LOW issues have been addressed or were informational |

**Overall Assessment:** The GalleryKit codebase demonstrates mature security engineering. All three security lint gates pass (`api-auth`, `action-origin`, `public-route-rate-limit`). No hardcoded secrets were found. No CRITICAL or HIGH CVEs in dependencies. The authentication layer (Argon2id, HMAC-SHA256 sessions, dual-bucket rate limiting) exceeds OWASP minimums. Input validation is comprehensive (Unicode bidi/zero-width rejection, C0/C1 strip, path traversal prevention, symlink rejection). The two MEDIUM findings from the prior review (run-8 cycle-2) have been fully remediated. The three LOW findings have also been addressed.

Six new commits since the prior review (c0522dec → bcd67b12) include two security fixes (missing `isAdmin()` checks, mutable reference leak in rate-limit getters), one input-validation hardening (`Array.isArray` guard), two operational safety improvements (restore-maintenance consistency, revalidation error isolation), and one error-handling improvement (ENOENT distinction). All are positive security or safety improvements. No new vulnerabilities were introduced.

---

## Remediation History (Prior Review Findings — Now Closed)

### 1. OG Photo Route: SSRF Fallback via `req.url` Origin (CLOSED)
**Severity:** MEDIUM (was) → CLOSED  
**Category:** A10: Server-Side Request Forgery (SSRF) — Defense in Depth  
**Location:** `apps/web/src/app/api/og/photo/[id]/route.tsx:115` (was)  
**Status:** FIXED at HEAD c0522dec

**Previous Issue:** The `fetchOrigin` variable fell back to `new URL(req.url).origin` when `siteConfig.url` was unparseable, creating a weak blind-SSRF primitive if an attacker controlled the Host header.

**Current State (FIXED):** The code now fails closed. When `siteConfig.url` is unparseable, the route returns `buildFallbackResponse(req, OG_ERROR_CACHE_CONTROL, ...)` instead of using the attacker-controllable request origin:

```typescript
// Line 112-118 — FAILS CLOSED
try {
    fetchOrigin = new URL(siteConfig.url).origin;
} catch {
    // R5-H4: fail closed — when siteConfig.url is unset (dev), do NOT
    // fall back to the attacker-controllable request origin. Return the
    // fallback response instead of exposing a blind-SSRF primitive.
    return buildFallbackResponse(req, OG_ERROR_CACHE_CONTROL, seo.og_image_url || undefined);
}
```

**Verification:** The `og-photo-fallback.test.ts` fixture locks this contract.

---

### 2. OG Photo Route: Open Redirect via `ogImageUrl` Fallback (CLOSED)
**Severity:** MEDIUM (was) → CLOSED  
**Category:** A01: Broken Access Control — Open Redirect  
**Location:** `apps/web/src/app/api/og/photo/[id]/route.tsx:253-260` (was)  
**Status:** FIXED at HEAD c0522dec

**Previous Issue:** The `buildFallbackResponse` function redirected to `ogImageUrl` without validating its origin, creating an open-redirect primitive if the admin-configured SEO OG image URL was compromised.

**Current State (FIXED):** The function now validates `ogImageUrl` against the request origin before redirecting:

```typescript
// Lines 256-274 — ORIGIN-VALIDATED REDIRECT
if (ogImageUrl) {
    try {
        const url = new URL(ogImageUrl);
        const reqOrigin = new URL(req.url).origin;
        if (url.origin === reqOrigin) {
            return new Response(null, {
                status: 302,
                headers: { Location: ogImageUrl, 'Cache-Control': cacheControl },
            });
        }
    } catch {
        // Invalid URL — fall through to the site-root redirect below.
    }
}
// Fall through to safe site-root redirect
```

**Verification:** The `og-photo-fallback.test.ts` fixture and the `og-route-source-contracts.test.ts` lock the redirect behavior.

---

### 3. API Routes Excluded from Middleware Auth Guard (INFORMATIONAL — CLOSED)
**Severity:** LOW (was) → CLOSED  
**Category:** A01: Broken Access Control — Defense in Depth  
**Location:** `apps/web/src/proxy.ts` (middleware matcher)  
**Status:** ACCEPTED RISK — correctly mitigated by design

**Previous Issue:** The middleware in `proxy.ts` excludes API routes from the matcher pattern, meaning API routes do not benefit from middleware-level admin auth checks.

**Current State:** This is correctly mitigated by design:
- Every admin API route uses `withAdminAuth()` wrapper (`apps/web/src/lib/api-auth.ts`) which performs origin verification + token authentication
- The `api-auth.ts` wrapper is enforced by a lint gate (`npm run lint:api-auth`) that scans every `api/admin/**/route.{ts,tsx,js,mjs,cjs}` file
- Public API routes have their own rate limiting and validation
- The `withAdminAuth` wrapper now includes same-origin verification (AGG9R-02) — previously it only checked `isAdmin()`, requiring each caller to add its own `hasTrustedSameOrigin` check. A future admin API route added with only `withAdminAuth` would now automatically get origin verification.

**Status:** No code change required. The lint gate remains blocking in CI.

---

### 4. `safeJsonLd` Escapes `<` and `>` but Not All HTML-Injection Vectors (INFORMATIONAL — CLOSED)
**Severity:** LOW (was) → CLOSED  
**Category:** A03: Injection (XSS) — Defense in Depth  
**Location:** `apps/web/src/lib/safe-json-ld.ts`  
**Status:** ACCEPTED — implementation is correct per OWASP guidance

**Previous Issue:** Concern about `/` (forward slash) not being escaped, which could theoretically allow `</script>` termination.

**Current State:** The `<` escape (`<`) prevents `</script>` termination. The current implementation is correct and follows OWASP guidance for JSON serialization in HTML contexts. All data flowing into `safeJsonLd` is either hardcoded (JSON-LD structure) or from validated database fields. Admin-controlled strings pass through `sanitizeAdminString` / `stripControlChars` before reaching JSON-LD.

**Status:** No change required. The implementation is correct.

---

### 5. Missing `Strict-Transport-Security` Header in Application Code (CLOSED)
**Severity:** LOW (was) → CLOSED  
**Category:** A05: Security Misconfiguration  
**Location:** `apps/web/next.config.ts`  
**Status:** FIXED at HEAD c0522dec

**Previous Issue:** The application did not set the `Strict-Transport-Security` (HSTS) header in application code.

**Current State (FIXED):** HSTS is now present in `next.config.ts` (line 86):

```typescript
{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' }
```

This is applied in production (not development) alongside other security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` with camera/microphone/geolocation denial). The nginx configuration (`apps/web/nginx/default.conf`) also carries the same HSTS directive.

**Status:** Fixed. Both application and proxy levels now enforce HSTS.

---

## New Security-Relevant Changes Since Prior Review (HEAD c0522dec → bcd67b12)

### SEC-FIX-1: Missing `isAdmin()` Checks in `deleteAdminUser` and LR Token Actions (SECURITY FIX)
**Commits:** `b22fa85e`  
**Location:** `apps/web/src/app/actions/admin-users.ts:183`, `apps/web/src/app/actions/lr-tokens.ts:36,107`  
**Impact:** Positive — closes a broken access control gap where `deleteAdminUser` and LR token actions (`createLrToken`, `revokeLrToken`) only checked `requireSameOriginAdmin()` (which verifies origin) but did not verify the caller was actually an admin before proceeding to the `getCurrentUser()` check.

**Previous State:** The functions checked `requireSameOriginAdmin()` (origin verification) and then `getCurrentUser()` (session validity), but skipped the `isAdmin()` gate. While `getCurrentUser()` returns null for non-admin sessions, the ordering meant a valid non-admin session could reach the `getCurrentUser()` call and potentially trigger audit logging or other side effects before the null check. More importantly, the defense-in-depth posture was inconsistent with every other mutating admin action.

**Current State:**
```typescript
// admin-users.ts:183
if (!(await isAdmin())) return { error: t('unauthorized') };

// lr-tokens.ts:36
if (!(await isAdmin())) return { error: t('unauthorized') };

// lr-tokens.ts:107
if (!(await isAdmin())) return { error: t('unauthorized') };
```

All three functions now follow the standard pattern: `maintenance check → isAdmin() → requireSameOriginAdmin() → getCurrentUser()`. This is the same ordering used in `createAdminUser`, `uploadImages`, `updateGallerySettings`, and all other mutating admin actions.

**Confidence:** High — the fix is straightforward and consistent with the established pattern.

---

### SEC-FIX-2: Rate-Limit Entry Getters Return Shallow Copies (DEFENSE IN DEPTH)
**Commit:** `5f4a5e95`  
**Location:** `apps/web/src/lib/auth-rate-limit.ts:28,38,109`  
**Impact:** Positive — prevents external mutation of internal rate-limit state.

**Previous State:** `getLoginRateLimitEntry`, `getAccountLoginRateLimitEntry`, and `getPasswordChangeRateLimitEntry` returned the internal `WindowEntry` object directly. Callers could mutate `entry.count` or `entry.lastAttempt`, affecting the shared in-memory rate-limit state. While the only callers in the codebase (`recordFailedLoginAttempt`, `clearSuccessfulLoginAttempts`, etc.) correctly copy the entry before modifying it, the API surface was vulnerable to future misuse.

**Current State:** All three getters now return `{ ...entry }` (shallow copy):
```typescript
return { ...entry };
```

This ensures callers receive a snapshot of the rate-limit state that cannot affect the internal Map entries. The change is defensive — no known exploit existed, but it hardens the API contract against future bugs.

**Confidence:** High — the fix is a standard defensive pattern.

---

### SEC-FIX-3: `Array.isArray` Guard on `loadMoreImages` tagSlugs (INPUT VALIDATION HARDENING)
**Commit:** `bcd67b12`  
**Location:** `apps/web/src/app/actions/public.ts:93-95`  
**Impact:** Positive — prevents prototype pollution / unexpected behavior from non-array tagSlugs parameter.

**Previous State:** `loadMoreImages` accepted `tagSlugs?: string[]` and passed it directly to `canonicalizeRequestedTagSlugs(tagSlugs || [])`. If a malicious client sent a non-array value (e.g., an object with a custom `length` property, or a string), `canonicalizeRequestedTagSlugs` would receive an unexpected input shape. While `canonicalizeRequestedTagSlugs` iterates with `.map()` and `.filter()`, non-array inputs could cause unexpected behavior.

**Current State:**
```typescript
const safeTags = Array.isArray(tagSlugs)
    ? canonicalizeRequestedTagSlugs(tagSlugs).filter(isValidTagSlug)
    : [];
```

The `Array.isArray` guard ensures only actual arrays are processed; non-array inputs are treated as empty tags. This is consistent with the defense-in-depth input validation posture used throughout the codebase.

**Confidence:** High — the fix is a standard input validation pattern.

---

### SEC-FIX-4: Restore-Maintenance Checks Added to Smart Collections and Embedding Backfill (OPERATIONAL SAFETY)
**Commit:** `7453030e`  
**Location:** `apps/web/src/app/actions/collections.ts:17-18`, `apps/web/src/app/actions/embeddings.ts:22+`  
**Impact:** Positive — prevents mutating operations during DB restore, maintaining consistency with all other admin actions.

**Previous State:** `createSmartCollection` and the embedding backfill action did not check `isRestoreMaintenanceActive()` before proceeding. While these are admin-only actions with `isAdmin()` and `requireSameOriginAdmin()` checks, the restore-maintenance gate was missing. All other mutating admin actions (upload, delete, settings, topic CRUD, admin user CRUD, LR token CRUD) check this gate.

**Current State:** Both actions now include the standard restore-maintenance check:
```typescript
const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
if (maintenanceError) return { error: maintenanceError };
```

This ensures the DB cannot be modified during a restore operation, preventing inconsistent state.

**Confidence:** High — the fix is consistent with the established pattern.

---

### SEC-FIX-5: ENOENT Distinction in `deleteImageVariants` (ERROR HANDLING IMPROVEMENT)
**Commit:** `9c5c38ca`  
**Location:** `apps/web/src/lib/process-image.ts:537-543`  
**Impact:** Positive — prevents silent suppression of disk/permission errors during image cleanup.

**Previous State:** The `deleteImageVariants` function caught all `opendir` errors silently, logging nothing. A disk failure or permission error would be silently swallowed, making debugging difficult and potentially leaving orphaned files undetected.

**Current State:**
```typescript
catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[deleteImageVariants] Directory scan failed for ${dir}:`, err);
    }
}
```

`ENOENT` (directory doesn't exist yet) is expected and silent; all other errors are logged as warnings. This improves operational visibility without changing security semantics.

**Confidence:** High — the fix improves observability without changing security behavior.

---

### SEC-FIX-6: Revalidation Moved Outside try/catch (ERROR ISOLATION)
**Commit:** `db55056f`  
**Location:** `apps/web/src/app/actions/topics.ts:166-172,334-338`  
**Impact:** Positive — prevents Next.js revalidation errors from triggering image cleanup rollback.

**Previous State:** In `createTopic` and `updateTopic`, `revalidateAllAppData()` was called inside the try block, after the DB transaction succeeded. If revalidation threw (e.g., Next.js internal error), the catch block would execute the image cleanup code (deleting the uploaded topic image file), even though the DB transaction had already committed. This created a state where the DB referenced a file that no longer existed on disk.

**Current State:** Revalidation is now in the `finally` block:
```typescript
} finally {
    // Run revalidation outside the try/catch so a revalidation error never
    // triggers the image cleanup in the catch block.
    revalidateAllAppData();
}
```

This ensures revalidation errors are isolated from the DB transaction + file cleanup logic. A revalidation failure no longer corrupts the file/DB consistency.

**Confidence:** High — the fix is a standard error-isolation pattern.

---

## Security Checklist

### Authentication & Authorization
- [x] Passwords hashed with Argon2id (memoryCost=65536, timeCost=3, parallelism=4)
- [x] Session tokens: HMAC-SHA256 signed, verified with `timingSafeEqual`
- [x] Cookie attributes: `httpOnly`, `secure` (production), `sameSite: lax`, `path: /`
- [x] Dual-bucket rate limiting: per-IP + per-account for login
- [x] `withAdminAuth` wrapper on all admin API routes (lint-enforced)
- [x] `withAdminAuth` now includes same-origin verification (AGG9R-02)
- [x] `requireSameOriginAdmin()` on all mutating server actions (lint-enforced)
- [x] Last admin deletion prevented (advisory lock + check)
- [x] Session fixation prevention (deletes old sessions on login)
- [x] Password change with session rotation
- [x] Personal Access Tokens (PATs) with SHA-256 hashing and constant-time comparison
- [x] Token scope enforcement (`lr:upload`, `lr:read`, `lr:delete`)
- [x] **FIXED (b22fa85e):** `isAdmin()` check added to `deleteAdminUser` and LR token actions

### Input Validation
- [x] All user inputs validated and sanitized
- [x] SQL queries use Drizzle ORM parameterization (no raw SQL concatenation with untrusted input)
- [x] File uploads validated (type, size, content) — UUID filenames, path traversal prevention, symlink rejection
- [x] URLs validated to prevent SSRF (OG route fails closed on unparseable siteConfig.url)
- [x] Unicode bidi/zero-width formatting rejected at all admin string entry points
- [x] C0/C1 control characters stripped from all inputs
- [x] CSV export escapes formula injection characters
- [x] JSON-LD uses `safeJsonLd` with `<`/`>` escaping
- [x] Admin string validation uses `sanitizeAdminString` (rejects + returns null on formatting chars)
- [x] `requireCleanInput` used for server action payload validation
- [x] **FIXED (bcd67b12):** `Array.isArray` guard on `loadMoreImages` tagSlugs parameter

### Output Encoding
- [x] HTML output escaped via React (no `innerHTML` or `dangerouslySetInnerHTML` except JSON-LD)
- [x] JSON-LD uses `safeJsonLd` serializer
- [x] OG images sanitize text via `sanitizeForOg` (bidi/C0 strip)
- [x] No user data in error messages (generic errors for auth failures)
- [x] Content-Security-Policy headers set with nonce in production
- [x] `X-Content-Type-Options: nosniff` globally
- [x] `X-Frame-Options: SAMEORIGIN` globally
- [x] `Referrer-Policy: strict-origin-when-cross-origin` globally
- [x] `Permissions-Policy` with camera/microphone/geolocation denial

### Secrets Management
- [x] No hardcoded API keys, passwords, or tokens in source code
- [x] Environment variables used for secrets (`SESSION_SECRET`, `DB_PASSWORD`, etc.)
- [x] Secrets not logged or exposed in errors (stderr sanitization for mysqldump/mysql)
- [x] `MYSQL_PWD` env var used instead of `-p` flag (avoids `/proc/cmdline` exposure)
- [x] Backup files created with `0o600` mode, directory with `0o700`
- [x] Session secret: refuses DB fallback in production (throws if `SESSION_SECRET` missing)

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
- [x] Content-type validated against extension
- [x] Disk space pre-check (1GB minimum) before upload acceptance
- [x] Cumulative upload tracking with TOCTOU protection

### Database Security
- [x] Drizzle ORM parameterization for all application queries
- [x] LIKE wildcards escaped in search
- [x] DB backups stored in non-public directory, served via authenticated route
- [x] DB restore validates file headers and scans for dangerous SQL
- [x] Advisory locks prevent concurrent restore/backfill/upload operations
- [x] `safeInsertId` prevents BigInt coercion overflow
- [x] `normalizeStringRecord` validates server action payload shapes
- [x] **FIXED (7453030e):** Restore-maintenance checks added to smart collections and embedding backfill

### Rate Limiting
- [x] Login: per-IP (5/15min) + per-account (5/15min)
- [x] Password change: per-IP rate limited
- [x] Search: per-IP rate limited (DB-backed + in-memory)
- [x] Load more: per-IP rate limited (DB-backed + in-memory)
- [x] OG image generation: per-IP rate limited (Pattern-4: charged post-validation)
- [x] Share link creation: per-IP rate limited (in-memory + DB-backed)
- [x] Semantic search: per-IP rate limited (Pattern-2: rollback on validation failure)
- [x] View recording: per-IP rate limited (in-memory only, best-effort)
- [x] Lightroom upload: cumulative tracker with TOCTOU protection
- [x] **FIXED (5f4a5e95):** Rate-limit entry getters return shallow copies to prevent mutable reference leaks

### Privacy & Data Protection
- [x] GPS coordinates excluded from public API responses
- [x] `strip_gps_on_upload` scrubs on-disk originals (lossless byte-level GPS-IFD neutralization)
- [x] `filename_original` and `user_filename` excluded from public queries
- [x] `publicSelectFields` derived from `adminSelectFields` by omission
- [x] Compile-time guard (`_SensitiveKeysInPublic`) enforces no sensitive keys in public fields
- [x] `_PrivacySensitiveKeys` compile-time guard for admin-only fields
- [x] `_MapPrivacyGuard` ensures map-visible fields only add latitude/longitude
- [x] `_LargePayloadGuard` prevents `blur_data_url` from leaking into public listings

### Security Headers
- [x] `X-Content-Type-Options: nosniff` (global)
- [x] `Content-Security-Policy` with nonce, frame-ancestors, base-uri, form-action, object-src
- [x] `X-Frame-Options: SAMEORIGIN` (global)
- [x] `Referrer-Policy: strict-origin-when-cross-origin` (global)
- [x] `Permissions-Policy` with camera/microphone/geolocation denial
- [x] `Strict-Transport-Security` (HSTS) in production (`max-age=31536000; includeSubDomains; preload`)
- [x] Cache-Control headers on all responses (appropriate per route)

### Audit & Monitoring
- [x] Fire-and-forget audit logging for all privileged actions
- [x] Audit log retention with negative-value guard (COR-R4C6-10)
- [x] Rate-limit purge with bounded growth
- [x] Structured error responses (no stack traces in production)
- [x] **FIXED (9c5c38ca):** ENOENT distinction in `deleteImageVariants` improves error observability

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
| SSRF | NOT FOUND | OG route fails closed on unparseable `siteConfig.url` (MEDIUM finding remediated) |
| Open Redirect | NOT FOUND | `buildFallbackResponse` validates `ogImageUrl` origin (MEDIUM finding remediated) |
| Insecure Direct Object Reference | NOT FOUND | All resources checked against auth context |
| Missing Security Headers | NOT FOUND | HSTS now present in `next.config.ts` (LOW finding remediated) |
| Information Disclosure | NOT FOUND | Generic error messages; no stack traces in production; stderr sanitized |
| Session Fixation | NOT FOUND | Old sessions deleted on login; new session token generated |
| Brute Force | NOT FOUND | Dual-bucket rate limiting (IP + account) with Argon2id |
| Clickjacking | NOT FOUND | `frame-ancestors 'self'` in CSP + `X-Frame-Options: SAMEORIGIN` |
| Content Sniffing | NOT FOUND | `X-Content-Type-Options: nosniff` globally |
| Timing Attacks | NOT FOUND | Dummy Argon2 hash for user enumeration prevention; `timingSafeEqual` for token comparison |
| Unicode Bidi/Trojan Source | NOT FOUND | `UNICODE_FORMAT_CHARS` rejected at all admin string entry points; `stripUnicodeFormatting` for machine-derived strings |
| CSV Injection | NOT FOUND | `escapeCsvField` strips C0/C1, bidi, zero-width, and prefixes formula chars |
| Backup/Restore Security | NOT FOUND | Authenticated download route; path containment; symlink rejection; SQL dump header validation |
| Shared Group Access Control | NOT FOUND | Base56 key validation; expiry check; rate limiting; view-count buffering |
| Broken Access Control (missing auth) | NOT FOUND | **FIXED (b22fa85e):** `isAdmin()` checks added to `deleteAdminUser` and LR token actions |
| Mutable State Leak | NOT FOUND | **FIXED (5f4a5e95):** Rate-limit getters return shallow copies |
| Input Validation (type confusion) | NOT FOUND | **FIXED (bcd67b12):** `Array.isArray` guard on `loadMoreImages` tagSlugs |

---

## Conclusion

GalleryKit's security posture is **strong and has improved since the prior review**. The codebase demonstrates mature security engineering with:

1. **Comprehensive authentication**: Argon2id, HMAC-SHA256 sessions, constant-time comparison, secure cookie attributes, PAT support with SHA-256 hashing
2. **Defense-in-depth authorization**: Middleware + per-route + per-action auth checks, same-origin verification, token scope enforcement
3. **Thorough input validation**: Unicode bidi/zero-width rejection, C0/C1 strip, path traversal prevention, symlink rejection, filename sanitization
4. **Robust rate limiting**: Dual-bucket (IP + account) for login, DB-backed + in-memory for public endpoints, Pattern-4 charged post-validation for OG routes
5. **Privacy protection**: GPS stripping (on-disk + DB), field-level access control, compile-time guards for sensitive fields
6. **Secure file handling**: UUID filenames, directory whitelisting, content-type validation, ETag-based cache invalidation, disk space pre-checks
7. **Audit and monitoring**: Fire-and-forget audit logging, structured error responses, stderr sanitization
8. **Security headers**: CSP with nonce, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options

**All findings from the prior review have been remediated.** No new CRITICAL, HIGH, or MEDIUM findings were identified in this review. The six commits since the last review (c0522dec → bcd67b12) are all positive security or safety improvements:
- **b22fa85e:** `isAdmin()` checks added to `deleteAdminUser` and LR token actions (closes broken access control gap)
- **5f4a5e95:** Rate-limit entry getters return shallow copies (prevents mutable reference leaks)
- **bcd67b12:** `Array.isArray` guard on `loadMoreImages` tagSlugs (input validation hardening)
- **7453030e:** Restore-maintenance checks added to smart collections and embedding backfill (operational consistency)
- **9c5c38ca:** ENOENT distinction in `deleteImageVariants` (error observability improvement)
- **db55056f:** Revalidation moved outside try/catch (prevents file/DB inconsistency on revalidation errors)

**Recommended ongoing maintenance:**
1. Continue maintaining the three security lint gates as blocking CI checks
2. Monitor `npm audit` for new CVEs in security-critical dependencies (`argon2`, `sharp`, `mysql2`, `next`)
3. Review the `TRUST_PROXY` configuration on production deployments (the rate-limit system emits a one-time `[SECURITY]` warning when proxy headers are present but `TRUST_PROXY` is not set)
4. Consider adding a lint rule or code review checklist item to verify `isAdmin()` is present before `requireSameOriginAdmin()` in all new mutating admin actions (the b22fa85e fix suggests this pattern was missed in two places)

---

*Report generated by Security Reviewer agent. All findings verified against source code at HEAD bcd67b12.*
