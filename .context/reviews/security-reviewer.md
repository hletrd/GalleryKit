# Cycle 3 Deep Review — Security Reviewer

Date: 2026-06-24
HEAD: 1d5545cb

## Executive Summary

**Risk Level: LOW**

The GalleryKit codebase demonstrates a mature, defense-in-depth security posture. After systematic evaluation against all applicable OWASP Top 10 categories, no new critical or high-severity vulnerabilities were identified in this cycle. The codebase maintains strong authentication (Argon2id + HMAC-SHA256 sessions), comprehensive rate limiting, parameterized SQL via Drizzle ORM, path traversal prevention, and XSS defenses via CSP nonces and JSON-LD sanitization.

All security lint gates pass (`lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`). `npm audit` returns 0 vulnerabilities. No hardcoded secrets were found in the codebase.

### New Findings (Cycle 3): 0 Critical, 0 High, 2 Medium, 2 Low

### Verified Fixed (from Prior Cycles): 9 items

### Remaining Open (from Cycle 1): 6 items (all previously assessed)

---

## New Findings

### SEC3-01 — `getRateLimitBucketStart` Division by Zero with Sub-Second Windows

- **Severity:** MEDIUM
- **Confidence:** High
- **Category:** A05: Security Misconfiguration / Denial of Service
- **Location:** `apps/web/src/lib/rate-limit.ts:329-332`
- **Exploitability:** Local — requires admin to configure a window < 1000ms
- **Blast Radius:** Rate limiting breaks for the affected bucket type; all requests in the same second get the same bucket, collapsing the rate limit

**Issue:**
```typescript
export function getRateLimitBucketStart(nowMs: number, windowMs: number): number {
    const windowSec = Math.floor(windowMs / 1000);
    const nowSec = Math.floor(nowMs / 1000);
    return nowSec - (nowSec % windowSec);  // Division by zero when windowSec === 0
}
```

If `windowMs < 1000`, `windowSec` becomes 0, causing `NaN` from modulo-by-zero. All current constants are >= 60 seconds (LOGIN_WINDOW_MS = 900000, SEARCH_WINDOW_MS = 60000, etc.), so this is not exploitable with shipped defaults. However, if an admin or future code path passes a sub-second window, rate limiting silently breaks.

**Remediation:**
```typescript
export function getRateLimitBucketStart(nowMs: number, windowMs: number): number {
    const windowSec = Math.max(1, Math.floor(windowMs / 1000));
    const nowSec = Math.floor(nowMs / 1000);
    return nowSec - (nowSec % windowSec);
}
```

---

### SEC3-02 — `enqueueImageProcessing` Silent Rejection Without Caller Feedback

- **Severity:** MEDIUM
- **Confidence:** High
- **Category:** A04: Insecure Design
- **Location:** `apps/web/src/lib/image-queue.ts:243-252`
- **Exploitability:** Local — requires restore maintenance or invalid job state
- **Blast Radius:** Uploads appear to succeed but images never process; admin has no visibility into the failure

**Issue:**
```typescript
export const enqueueImageProcessing = (job: ImageProcessingJob) => {
    const state = getProcessingQueueState();
    if (state.shuttingDown || isRestoreMaintenanceActive()) {
        console.debug(`[Queue] Ignoring job ${job.id} while processing is unavailable`);
        return;  // Silent return — no feedback to caller
    }
    if (!hasValidJobFilenames(job)) {
        console.error(`[Queue] Rejecting job ${job.id} with invalid filename metadata`);
        return;  // Silent return — no feedback to caller
    }
    // ...
};
```

The function returns `void` and gives no signal to callers (e.g., `uploadImages` in `actions/images.ts`) that the job was rejected. An admin uploading during restore maintenance sees a successful upload but the image never appears in the gallery. The `console.debug`/`console.error` logs are not surfaced to the user.

**Remediation:** Return a boolean or throw an error so callers can surface the condition to the user:
```typescript
export function enqueueImageProcessing(job: ImageProcessingJob): boolean {
    const state = getProcessingQueueState();
    if (state.shuttingDown || isRestoreMaintenanceActive()) {
        return false;
    }
    if (!hasValidJobFilenames(job)) {
        return false;
    }
    // ... enqueue logic ...
    return true;
}
```

---

### SEC3-03 — `getTrustedRequestProtocol` Falls Back to `http` Without Warning

- **Severity:** LOW
- **Confidence:** Medium
- **Category:** A05: Security Misconfiguration
- **Location:** `apps/web/src/lib/request-origin.ts:45-52`
- **Exploitability:** Remote — requires direct HTTP access (no reverse proxy)
- **Blast Radius:** Cookie `secure` flag may be omitted on misconfigured deployments, allowing session theft via network sniffing

**Issue:**
```typescript
export function getTrustedRequestProtocol(requestHeaders: HeaderLookup) {
    const trustedForwardedProto = trustsProxyHeaders()
        ? normalizeTrustedProxyHeaderValue(requestHeaders.get('x-forwarded-proto'))
        : '';
    return trustedForwardedProto
        || getProtocolFromCandidate(requestHeaders.get('origin'))
        || getProtocolFromCandidate(requestHeaders.get('referer'))
        || 'http';  // Falls back to http — may omit secure cookie flag
}
```

When `TRUST_PROXY` is unset and no Origin/Referer headers are present, the function returns `'http'`. This is used in `auth.ts:229` to determine the `secure` cookie flag: `secure: requireSecureCookie || process.env.NODE_ENV === 'production'`. The production check (`NODE_ENV === 'production'`) mitigates this, but the function's fallback behavior is misleading.

**Note:** The production path in `auth.ts:233` always sets `secure: true` when `NODE_ENV === 'production'`, so this is a code-clarity issue rather than an exploitable vulnerability. The `getTrustedRequestProtocol` function is also used in `updatePassword` for cookie setting, which has the same production guard.

**Remediation:** Add a `console.warn` when falling back to `http` in production, or document that this function is only used as a hint and the production check is the actual security control.

---

### SEC3-04 — `safeJsonLd` Does Not Escape `>` Character

- **Severity:** LOW
- **Confidence:** Medium
- **Category:** A03: Injection (XSS)
- **Location:** `apps/web/src/lib/safe-json-ld.ts:14-19`
- **Exploitability:** Remote — requires attacker to inject JSON-LD data via admin-controlled fields
- **Blast Radius:** XSS via `</script><script>alert(1)</script>` injection in JSON-LD

**Issue:**
```typescript
export function safeJsonLd(data: unknown): string {
    return JSON.stringify(data)
        .replace(/</g, '\\u003c')
        .replace(/ /g, '\\u2028')
        .replace(/ /g, '\\u2029');
}
```

The function escapes `<` to prevent `</script>` termination but does not escape `>`. While `>` is not needed to close a script tag (the parser looks for `</script`), an attacker could craft a payload like `</script><script>alert(1)</script>` where the first `</script>` is broken by the `<` escape but the second `<script>` tag opens a new script context. However, because all JSON-LD data flows through `safeJsonLd` which escapes `<`, the `</script>` pattern is broken. The `>` character alone cannot open a new script tag.

**Assessment:** This is a defense-in-depth concern. The current escaping is sufficient because:
1. `<` is escaped, breaking `</script>`
2. No other HTML tag can be opened without `<`
3. All JSON-LD inputs are admin-controlled and validated

**Remediation:** For completeness, also escape `>`:
```typescript
export function safeJsonLd(data: unknown): string {
    return JSON.stringify(data)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/ /g, '\\u2028')
        .replace(/ /g, '\\u2029');
}
```

---

## Verified Fixed (from Prior Cycles)

| Finding | Status | Evidence |
|---------|--------|----------|
| AGG-01: Action origin scanner | FIXED | `check-action-origin.ts` passes all fixture tests |
| AGG-03: Public route rate limit | FIXED | `check-public-route-rate-limit.ts` passes all fixtures |
| AGG-08: Restore maintenance | FIXED | `isRestoreMaintenanceActive()` checked before all mutating admin actions |
| AGG-12: Rate limit refund | FIXED | Semantic/search routes do NOT rollback after expensive work begins |
| AGG-20: Partial numeric IDs | FIXED | Regex validation before `parseInt` in all route handlers |
| AGG-24/25: Dependency CVEs | FIXED | `npm audit` returns 0 vulnerabilities |
| AGG-28: Token nginx throttle | FIXED | `nginx/default.conf:107-120` admin token routes under `limit_req zone=admin` |
| C2R-02: Action origin wiring | FIXED | All mutating actions call `requireSameOriginAdmin()` |
| C20-MED-01: `safeInsertId` | FIXED | Used at all insert sites (`images.ts:383`, `admin-users.ts:147`, `sharing.ts`) |

---

## Remaining Open (from Cycle 1, verified still present)

### AGG-06: DB Restore Incomplete Dump Validation — MEDIUM

- **Location:** `apps/web/src/lib/db-restore.ts:21-25`
- **Issue:** `hasPlausibleSqlDumpHeader` only checks the first line against `/^(?:--|CREATE\s|INSERT\s|DROP\s|SET\s|\/\*!)/i`. A file containing only `--` comments and `DROP` statements would pass. No `CREATE TABLE` requirement or table-name whitelist exists.
- **Risk:** Requires admin credentials to upload. A malicious admin could restore a destructive dump.
- **Mitigation:** The `containsDangerousSql` scanner (`sql-restore-scan.ts:39-93`) blocks 20+ dangerous patterns (GRANT, REVOKE, CREATE USER, DROP DATABASE, DROP TABLE, TRUNCATE, DELETE FROM, LOAD DATA, SYSTEM, SHUTDOWN, CREATE TRIGGER/FUNCTION/PROCEDURE/EVENT, etc.). The `--one-database` flag limits scope. The advisory lock prevents concurrent restores.

### AGG-07: Post-Restore Async Hooks — MEDIUM

- **Location:** `apps/web/src/lib/image-queue.ts` (caption generation, CLIP embedding)
- **Issue:** The `cleanupOriginalIfRestoreMaintenanceBegan` guard checks maintenance state at upload start, but the queue worker fires caption generation and CLIP embedding as fire-and-forget after processing. If a restore begins during processing, these hooks may write to the DB after the restore completes.
- **Risk:** Data corruption in restored database from post-restore writes.
- **Mitigation:** The restore maintenance flag is checked at upload time. The window is narrow (processing time). No data loss has been observed.

### AGG-26: CSP Inline Styles — LOW

- **Location:** `apps/web/src/lib/content-security-policy.ts:108`
- **Issue:** Production CSP includes `'unsafe-inline'` in `style-src`. This weakens XSS protection against CSS injection attacks.
- **Risk:** LOW — GalleryKit has no user-generated CSS injection surface. All styles are admin-controlled or Tailwind-generated.
- **Mitigation:** The `style-src` includes `'self'` as well. No user content is rendered as CSS. The `'unsafe-inline'` is required for Tailwind's utility classes and shadcn/ui components.

### AGG-27: Search LIKE SQL Mode Dependency — LOW

- **Location:** `apps/web/src/lib/data.ts:1412-1418`
- **Issue:** LIKE escaping uses backslash (`query.trim().replace(/[%_\\]/g, '\\$&')`) which assumes standard MySQL backslash escape semantics. If the server runs with `NO_BACKSLASH_ESCAPES` SQL mode, the escaping is weakened.
- **Risk:** LOW — `NO_BACKSLASH_ESCAPES` is not the default. The search is public-read-only (no data modification). The query is still parameterized via Drizzle.
- **Mitigation:** Documented in code comment. At personal-gallery scale this is acceptable. For multi-tenant deployments, consider full-text search or a dedicated search engine.

### AGG-30: Legacy Symlink Cleanup — LOW

- **Location:** `apps/web/src/lib/serve-upload.ts:175-178`, `apps/web/src/lib/storage/local.ts:94-96`
- **Issue:** Symlinks are rejected at serve time (`lstat` + `isSymbolicLink()` check), but no periodic cleanup of existing symlinks in `public/uploads/` exists. A symlink created by an attacker with filesystem access before the code was deployed could persist.
- **Risk:** LOW — requires filesystem access to create the symlink. The serve-time check blocks it. The `original/` directory is excluded from public serving by nginx.
- **Mitigation:** Symlink rejection is active at both the nginx level (`location ^~ /uploads/original/ { return 404; }`) and the application level (`serve-upload.ts`).

### AGG-31: Storage Abstraction Public Path Risk — LOW

- **Location:** `apps/web/src/lib/storage/local.ts:130-138`
- **Issue:** `getUrl()` throws for `original/` keys but returns `/uploads/...` for all other keys. If a future storage backend doesn't enforce the same public/private boundary, original uploads could be exposed.
- **Risk:** LOW — Only the local backend is used. The `getUrl()` function is not called for original files in practice.
- **Mitigation:** The `original/` directory is blocked at the nginx level. The upload path uses `SAFE_SEGMENT` regex and `resolvedPath.startsWith()` containment.

---

## OWASP Top 10 Evaluation

### A01: Broken Access Control — PASS
- All `/api/admin/*` routes wrapped with `withAdminAuth()` (enforced by `lint:api-auth`)
- All mutating server actions call `requireSameOriginAdmin()` (enforced by `lint:action-origin`)
- Middleware guards `/[locale]/admin/*` sub-routes with session cookie format check
- Last admin deletion prevented to avoid lockout
- PAT tokens enforce scope checks (`tokenHasScope`)
- No horizontal privilege escalation paths identified

### A02: Cryptographic Failures — PASS
- Passwords hashed with Argon2id (memoryCost=65536, timeCost=3, parallelism=4)
- Session tokens use HMAC-SHA256 with `timingSafeEqual` constant-time comparison
- Session secret requires env var in production (refuses DB fallback)
- PAT tokens stored as SHA-256 digests only; plaintext shown once
- Cookie attributes: `httpOnly`, `secure` (production), `sameSite: 'lax'`, `path: '/'`
- No weak algorithms or deprecated crypto detected

### A03: Injection — PASS
- All SQL uses Drizzle ORM parameterization; no string concatenation in queries
- Raw SQL in `admin-tokens.ts` uses Drizzle `sql` tagged template literals with parameter binding
- Smart collections use AST-based compiler with allowlisted columns and depth-limited predicates
- JSON-LD uses `safeJsonLd` with `<` escaping
- No `eval()`, `Function()`, or `setTimeout(string)` patterns
- No command injection in `mysqldump`/`mysql` spawn (args are arrays, not shell strings)

### A04: Insecure Design — PASS (with notes)
- Rate limiting uses pre-increment pattern to prevent TOCTOU race conditions
- Session fixation prevented via transaction-based session rotation
- Advisory locks serialize concurrent operations (restore, backfill, upload contract)
- Upload processing uses claim-then-process with conditional UPDATE
- **Note:** SEC3-02 (silent enqueue rejection) is a design concern

### A05: Security Misconfiguration — PASS (with notes)
- Debug disabled in production (`NODE_ENV` checks)
- Security headers set: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS
- CSP with nonce-based script-src in production
- `server_tokens off` in nginx
- **Note:** SEC3-01 (division by zero) and SEC3-03 (http fallback) are minor misconfiguration concerns

### A06: Vulnerable Components — PASS
- `npm audit`: 0 vulnerabilities
- All dependencies are current and well-maintained
- No known CRITICAL or HIGH CVEs in dependency tree

### A07: Auth Failures — PASS
- Strong password hashing (Argon2id)
- Session tokens cryptographically random (16 bytes hex = 128 bits entropy)
- JWT not used (session cookies with HMAC-SHA256 instead)
- Access control enforced on all protected resources
- Login rate limiting: per-IP (5/15min) + per-account (5/15min) with dummy hash for timing equality

### A08: Integrity Failures — PASS
- No signed updates mechanism (not applicable for self-hosted deployment)
- CI/CD pipeline not in scope (manual deploy via SSH)
- No supply-chain attacks detected in dependencies

### A09: Logging Failures — PASS (with notes)
- Audit events logged via `logAuditEvent` for admin mutations
- Login attempts logged (failed + successful)
- Rate limit violations logged
- **Note:** Analytics DB failures logged at `console.debug` level (too quiet for production monitoring)

### A10: SSRF — PASS
- No outbound URL fetching from user input in API routes
- `parseCspImageBaseUrl` validates IMAGE_BASE_URL with protocol and credential checks
- No `fetch()` to user-controlled URLs in server-side code
- File upload paths use `SAFE_SEGMENT` regex and `resolvedPath.startsWith()` containment

---

## Security Checklist

- [x] No hardcoded secrets (verified via grep scan)
- [x] All inputs validated (Drizzle ORM parameterization, validation.ts guards)
- [x] Injection prevention verified (no SQLi, XSS, command injection)
- [x] Authentication/authorization verified (Argon2id, HMAC-SHA256, dual rate limiting)
- [x] Dependencies audited (npm audit: 0 vulnerabilities)
- [x] Path traversal prevention (SAFE_SEGMENT, resolvedPath containment, symlink rejection)
- [x] CSP with nonce-based script-src
- [x] Cookie security attributes (httpOnly, secure, sameSite)
- [x] Session management (24h expiry, transaction-based rotation)
- [x] Unicode bidi/invisible formatting rejection (Trojan-Source defense)
- [x] CSV injection prevention (formula char prefixing, control char stripping)
- [x] DB restore with SQL dump scanning (20+ dangerous patterns blocked)
- [x] Admin PAT tokens with SHA-256 hashing and timingSafeEqual
- [x] CLIP semantic search with stub vs production mode gating
- [x] GPS metadata stripping from originals
- [x] Privacy field guards (compile-time `_PrivacySensitiveKeys` check)

---

## Final Sweep: Commonly Missed Issues

### CORS Configuration — NOT APPLICABLE
GalleryKit is a same-origin application. No CORS headers are configured. The `api-auth.ts` wrapper enforces same-origin for all `/api/admin/*` routes. Public API routes (`/api/search/semantic`, `/api/search/similar/[id]`) use `hasTrustedSameOrigin()` which checks Origin/Referer headers.

### HSTS — CONFIGURED
Nginx sets `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` on all responses.

### Clickjacking — PROTECTED
`X-Frame-Options: SAMEORIGIN` on all responses. CSP `frame-ancestors 'self'` provides defense-in-depth.

### Content-Type Sniffing — PROTECTED
`X-Content-Type-Options: nosniff` on all responses.

### Open Redirect — NOT FOUND
No user-controlled redirect targets. All redirects use hardcoded paths or validated slugs.

### Mass Assignment — NOT FOUND
All DB writes use explicit column lists. No `req.body` spread into ORM inserts.

### Insecure Deserialization — NOT FOUND
No deserialization of untrusted data. JSON parsing uses `JSON.parse` with type guards.

### XML External Entities (XXE) — NOT FOUND
No XML parsing of user input.

### Log Injection — MITIGATED
`sanitizeStderr` redacts passwords from MySQL error messages. No user-controlled data in log paths.

### Race Conditions — MITIGATED
Advisory locks, transactions, and conditional UPDATEs prevent race conditions in critical paths (upload, restore, backfill, delete).

---

## Recommendations Summary

1. **SEC3-01 (MEDIUM):** Add `Math.max(1, ...)` guard to `getRateLimitBucketStart` to prevent division by zero with sub-second windows.
2. **SEC3-02 (MEDIUM):** Return a boolean from `enqueueImageProcessing` so callers can surface rejection reasons to admins.
3. **SEC3-03 (LOW):** Document or warn on `http` fallback in `getTrustedRequestProtocol` for production deployments.
4. **SEC3-04 (LOW):** Add `>` escaping to `safeJsonLd` for completeness (defense-in-depth).
5. **AGG-06 (MEDIUM):** Add `CREATE TABLE` requirement to `hasPlausibleSqlDumpHeader` or implement table-name whitelist validation.
6. **AGG-07 (MEDIUM):** Check restore maintenance flag in queue worker before firing post-processing hooks (caption generation, CLIP embedding).
7. **AGG-26 (LOW):** Consider migrating to nonce-based or hash-based CSP for `style-src` to remove `'unsafe-inline'` (requires significant Tailwind/shadcn refactoring).
8. **AGG-27 (LOW):** Document `NO_BACKSLASH_ESCAPES` incompatibility in deployment docs. Consider `ESCAPE` clause in Drizzle for future-proofing.

---

*Review completed by Security Reviewer agent. All applicable OWASP Top 10 categories evaluated. Findings prioritized by severity x exploitability x blast radius.*
