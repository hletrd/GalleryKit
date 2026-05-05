# Security Review — Cycle 13 (2026-05-05)

**Reviewer angle**: OWASP Top 10, auth/authz, injection, XSS, CSRF, secrets, unsafe patterns
**Scope**: Authentication, authorization, input validation, output encoding, rate limiting, CSP, service worker, upload pipeline, database queries
**Gates**: All green

---

## Executive Summary

The codebase maintains excellent security posture. Authentication uses Argon2id with timing-safe comparison, sessions use HMAC-SHA256 with constant-time verification, and all admin mutations enforce same-origin provenance. Three lint gates (`api-auth`, `action-origin`, `public-route-rate-limit`) automatically enforce architectural invariants.

One new LOW-severity finding: CSP nonce exposed in response headers.

## Findings

### SEC-LOW-01: CSP nonce leaked via `x-nonce` response header
- **File+line**: `apps/web/src/proxy.ts:33-34`
- **Severity**: LOW
- **Confidence**: HIGH
- **CWE**: CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor)
- **Description**: The `applyProductionCsp` middleware copies the CSP nonce from request headers to response headers as `x-nonce`. In production, same-origin JavaScript can read arbitrary response headers via `fetch()` or `XMLHttpRequest`. An attacker with script execution capability (e.g., via DOM XSS) can obtain the nonce and use it to inject `<script nonce="stolen">...</script>` tags that satisfy the CSP `script-src 'nonce-...'` directive.
- **Impact**: Weakens CSP as a mitigation layer against XSS payload execution. The attacker must already have script execution, so this does not enable new attacks — it merely makes CSP bypass slightly easier.
- **Suggested fix**: Remove `response.headers.set('x-nonce', nonce)` from `applyProductionCsp`. The nonce is already available server-side via request headers (`csp-nonce.ts`) and client-side via HTML `<script nonce="...">` attributes. No code reads `x-nonce` from response headers.
- **Verification**: Searched entire codebase for client-side reads of `x-nonce` response header — none found.

## Security Posture Verification

### Authentication & Session Management
- Argon2id with memory-hard parameters (verified in `lib/password-hashing.ts`)
- Session tokens: HMAC-SHA256, verified with `timingSafeEqual` (verified in `lib/session.ts`)
- Cookie attributes: `httpOnly`, `secure` (when HTTPS or production), `sameSite: lax`, `path: /`
- Session fixation protection: existing sessions invalidated on new login (transaction-wrapped)
- Production refuses DB-stored session secret fallback (verified in `lib/session.ts:30-36`)

### Authorization
- `isAdmin()` verifies session via DB lookup (not just cookie presence)
- `requireSameOriginAdmin()` enforced on every mutating server action (verified by `lint:action-origin` gate)
- API admin routes wrapped with `withAdminAuth()` (verified by `lint:api-auth` gate)
- Last admin deletion prevented (verified in `app/actions/admin-users.ts`)

### Input Validation
- Filename sanitization: UUID-based filenames on disk, no user-controlled paths
- Path traversal prevention: `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` whitelist + `resolvedPath.startsWith()` containment
- Symlink rejection: `lstat()` + `isSymbolicLink()` check in upload routes
- EXIF bounds checking: capped tagCount, string lengths in ICC parsing
- SQL injection: Drizzle ORM parameterization for application queries; audited raw SQL surfaces confined to schema/admin maintenance

### Output Encoding
- JSON-LD uses `safeJsonLd()` which escapes `<` and Unicode line terminators
- CSV export escapes formula injection characters and strips bidi/zero-width chars
- Search LIKE wildcards escaped with backslash
- No `dangerouslySetInnerHTML` with unsanitized user input (all usages are JSON-LD with `safeJsonLd`)

### Rate Limiting
- Login: per-IP (5/15min) + per-account (5/15min) with DB backup
- Public routes: semantic search, OG images, checkout, share keys all rate-limited
- Pattern 2 rollback (rollback on validation/infrastructure failure) correctly applied to public read paths
- All public mutating routes either carry rate-limit helper or explicit `@public-no-rate-limit-required` exemption (verified by `lint:public-route-rate-limit` gate)

### Privacy
- `publicSelectFields` omits PII (latitude, longitude, filename_original, user_filename)
- Compile-time guards (`_privacyGuard`, `_mapPrivacyGuard`, `_largePayloadGuard`) prevent accidental field leakage
- GPS coordinates excluded from public API responses
- `stripGpsFromOriginal` removes GPS EXIF from on-disk originals when admin toggle is enabled

## Conclusion

Security posture is strong. One LOW finding (CSP nonce header exposure) should be fixed to reduce attack surface. No HIGH or MEDIUM severity findings.
