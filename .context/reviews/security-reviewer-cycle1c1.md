# Security Reviewer -- Cycle 1 (Fresh)

## Files Reviewed
All action files, middleware, auth, rate-limit, SQL restore scan, serve-upload, request-origin, data.ts, validation.ts, sanitize.ts

## S1-01: `hasTrustedSameOrigin` trusts X-Forwarded-Host without configured allowlist
**File:** `apps/web/src/lib/request-origin.ts` lines 14-25, 36-53
**Severity:** MEDIUM | **Confidence:** High
**Problem:** `getExpectedOrigin` derives the "expected" origin from `X-Forwarded-Host` and `Host` headers. If `TRUST_PROXY` is not set but the app is behind a reverse proxy that doesn't strip these headers, an attacker can spoof `X-Forwarded-Host` to match their own origin, causing `hasTrustedSameOrigin` to return `true` for cross-origin requests. The function already validates that Origin/Referer match the expected origin, but if the expected origin itself is spoofed, the check is bypassed.
**Fix:** Derive allowed hosts from `BASE_URL` env var or `site-config.json`. If `X-Forwarded-Host` doesn't match any configured host, reject. This is partially mitigated by the fact that `getClientIp` requires `TRUST_PROXY=true` to trust proxy headers, but the origin check is a separate code path.

## S1-02: SQL restore allows `CREATE TABLE`
**File:** `apps/web/src/lib/sql-restore-scan.ts` lines 1-31
**Severity:** LOW | **Confidence:** Medium
**Problem:** The dangerous SQL pattern list blocks `CREATE TRIGGER`, `CREATE FUNCTION`, `CREATE PROCEDURE`, `CREATE EVENT`, `CREATE VIEW`, and `CREATE SERVER`, but does NOT block `CREATE TABLE`. A malicious SQL dump could create arbitrary tables in the database. While `--one-database` limits scope, new tables could interfere with the application or be used to store malicious data.
**Mitigation:** Legitimate mysqldump output includes `CREATE TABLE` statements for the gallery's own tables, so blocking `CREATE TABLE` entirely would break normal restores. The current approach of blocking dangerous object types (triggers, functions, procedures) while allowing tables is a reasonable trade-off.
**Fix (if desired):** Add post-restore validation that only expected table names exist. This is a defense-in-depth measure, not a critical fix.

## S1-03: Missing Content-Security-Policy header
**File:** `apps/web/src/proxy.ts` (middleware) or `next.config.js`
**Severity:** MEDIUM | **Confidence:** Medium
**Problem:** The application does not set a Content-Security-Policy header. Without CSP, the app is more vulnerable to XSS attacks. While React's JSX escaping provides good XSS protection by default, CSP provides defense-in-depth.
**Fix:** Add a CSP header via middleware or `next.config.js`. Start with a report-only mode to identify required directives, then enforce. Minimum: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'`.

## S1-04: `original_format` and `original_file_size` set to NULL rather than omitted in public responses
**File:** `apps/web/src/lib/data.ts` lines 179-183
**Severity:** LOW | **Confidence:** Medium
**Problem:** In `publicSelectFields`, `original_format` and `original_file_size` are included as `sql<string | null>\`NULL\`` and `sql<number | null>\`NULL\`` respectively. This means public API responses include these keys with null values, which leaks the field names. An attacker knows these fields exist in the data model. While the values are null, leaking field names can assist in targeted attacks.
**Fix:** Omit these fields entirely from `publicSelectFields` (like `latitude` and `longitude`), or add them to the `_PrivacySensitiveKeys` type guard.

## S1-05: No rate limiting on `loadMoreImages` public endpoint
**File:** `apps/web/src/app/actions/public.ts` lines 10-23
**Severity:** LOW | **Confidence:** Medium
**Problem:** `loadMoreImages` is an unauthenticated server action with no rate limiting. While it only reads data (no mutation), an attacker could call it repeatedly with high offsets to cause expensive DB queries. The offset is capped at 10000 and the limit at 100, which mitigates the worst cases.
**Fix:** Consider adding a lightweight rate limit (e.g., 60 requests/minute per IP) for unauthenticated data-loading endpoints.

## Verified Correct (No Fix Needed)

- Login rate limiting: Pre-increment + rollback pattern is correct (C1-07 from prior review was already fixed)
- Session fixation protection: Transaction wraps insert + delete
- Password change session invalidation: Transactional
- Path traversal in serve-upload: Multiple layers of defense (SAFE_SEGMENT, ALLOWED_UPLOAD_DIRS, realpath containment, symlink rejection)
- SQL restore scan: Comprehensive pattern list with streaming chunk scanning
- Privacy guard: Compile-time type guard + separate object references
- GROUP_CONCAT truncation: Already fixed with `SET SESSION group_concat_max_len = 10000`
- OG image URL same-origin check: Already implemented in seo.ts
