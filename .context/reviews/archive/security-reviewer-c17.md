# Security Reviewer — Cycle 17

## Inventory of reviewed files

- `apps/web/src/app/actions/auth.ts` — login, logout, password change
- `apps/web/src/lib/session.ts` — token generation, HMAC verification
- `apps/web/src/lib/rate-limit.ts` — IP + account rate limiting
- `apps/web/src/lib/validation.ts` — input validation
- `apps/web/src/lib/sanitize.ts` — sanitization utilities
- `apps/web/src/proxy.ts` — middleware auth guard
- `apps/web/src/lib/content-security-policy.ts` — CSP headers
- `apps/web/src/app/actions/images.ts` — upload, delete, update
- `apps/web/src/lib/request-origin.ts` — same-origin check

## Findings

### C17-SR-01: CSP `style-src 'unsafe-inline'` persists in production
- **Confidence**: High
- **Severity**: Medium
- **Location**: `apps/web/src/lib/content-security-policy.ts:81`
- **Issue**: Production CSP includes `style-src 'self' 'unsafe-inline'`. This enables CSS-based data exfiltration (e.g., attribute selectors sending data via background-image URLs). Modern browsers mitigate the worst cases but the risk remains. This was previously flagged as A1-MED-08 and deferred.
- **Fix**: Long-term, migrate Tailwind CSS to nonce-based style-src. Short-term, document the tradeoff explicitly in CLAUDE.md.

### C17-SR-02: `getClientIp` returns "unknown" when `TRUST_PROXY` is unset — rate limiting effectively disabled
- **Confidence**: High
- **Severity**: Medium
- **Location**: `apps/web/src/lib/rate-limit.ts:117`
- **Issue**: In reverse-proxy deployments without `TRUST_PROXY=true`, all users share the "unknown" rate-limit bucket, effectively disabling per-IP rate limiting. A warning is logged once, but the warning only fires in production when proxy headers are present (line 118-121). If the proxy sends `X-Forwarded-For` but `TRUST_PROXY` is not set, all users are rate-limited as a single IP ("unknown"), which means the 5-attempt login limit is shared across ALL users globally.
- **Concrete scenario**: Admin deploys behind nginx with `X-Forwarded-For` header but forgets to set `TRUST_PROXY=true`. All login attempts from all IPs share the "unknown" bucket. After 5 failed logins from any IP worldwide, ALL users are locked out for 15 minutes.
- **Fix**: Add a startup-time check that warns if `TRUST_PROXY` is not set and the app detects proxy headers. Consider making the "unknown" bucket less restrictive (separate budget) or refusing to start in production with proxy headers but no `TRUST_PROXY`.

### C17-SR-03: `login` rate-limit rollback on DB-unavailable path still rolls back on infrastructure errors
- **Confidence**: High
- **Severity**: Low (previously mitigated)
- **Location**: `apps/web/src/app/actions/auth.ts:155-162`
- **Issue**: The outer try/catch (line 164-254) correctly does NOT roll back on infrastructure errors (C1F-CR-04/C1F-SR-01 fix). However, the inner DB check (lines 142-162) still has a `catch` block that checks `limitData.count > LOGIN_MAX_ATTEMPTS` and rolls back if the in-memory count exceeds the limit. This rollback on DB-unavailable is intentional (avoid locking out legitimate users when the DB is down), but it could give an attacker extra attempts if they can induce DB failures.
- **Fix**: The current behavior is a deliberate tradeoff (usability vs. security). Document the tradeoff explicitly. The previous fix (no rollback on outer infrastructure errors) is the more impactful protection.

### C17-SR-04: `sessionStorage` usage for auto-lightbox flag is client-side only
- **Confidence**: High
- **Severity**: Low (informational)
- **Location**: `apps/web/src/components/photo-viewer.tsx:68,144,149,158`
- **Issue**: The `gallery_auto_lightbox` sessionStorage flag is set before navigation and read on mount. sessionStorage is per-tab, so there's no cross-origin leakage. The values are hardcoded ('true') and not user-controlled. All operations are wrapped in try/catch. No security concern.
- **Fix**: No fix needed.

### C17-SR-05: `verifySessionToken` deletes expired sessions synchronously on verification
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/lib/session.ts:139-141`
- **Issue**: When a session token is verified but expired, the code deletes the session row from the DB. This is a correctness improvement (cleanup), but it adds a write operation to every read path. In high-traffic scenarios, this could add unnecessary DB write pressure. The hourly `purgeExpiredSessions` GC (in image-queue.ts) already handles bulk cleanup.
- **Fix**: Consider making the delete `await ... .catch(console.debug)` so a failed delete doesn't block the verification. Or rely solely on the hourly GC and skip the eager delete.

### C17-SR-06: No Content-Security-Policy `report-uri` or `report-to` directive
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/lib/content-security-policy.ts`
- **Issue**: The CSP header does not include a reporting directive. CSP violations are silently dropped by the browser with no server-side visibility. For a production gallery, this means potential XSS attempts via CSP violations go undetected.
- **Fix**: Add `report-uri /api/csp-report` or `report-to` directive with a simple API route to log violations.

### C17-SR-07: `sanitizeStderr` regex for password redaction could miss unusual MySQL error formats
- **Confidence**: Low
- **Severity**: Low
- **Location**: `apps/web/src/lib/sanitize.ts:117-119`
- **Issue**: The two regexes cover "password=VALUE" and "using password: YES/NO" patterns. Unusual MySQL error formats (e.g., authentication plugin messages like "caching_sha2_password: ...") may not be caught by the existing regexes. The `sensitiveValues` parameter (C1F-SR-08) provides additional coverage for DB host/user/name, but password hashes in auth plugin messages could still leak.
- **Fix**: Consider adding a third regex for common auth plugin error patterns, or rely on the `sensitiveValues` parameter being comprehensive.

### C17-SR-08: `proxy.ts` CSP nonce is passed through request headers without validation
- **Confidence**: Low
- **Severity**: Low
- **Location**: `apps/web/src/proxy.ts:33`
- **Issue**: The middleware reads `x-nonce` from the request headers it just set (line 33) and copies it to the response. Since the nonce is generated by the middleware itself (line 42), this is not a vulnerability — an attacker cannot inject a nonce because the middleware overwrites any incoming `x-nonce` header. However, the pattern of reading a security-sensitive header from the request is unusual.
- **Fix**: No fix needed. The nonce is generated server-side and never trusted from the client.
