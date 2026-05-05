# Security Review — Cycle 14 (2026-05-06)

**Reviewer angle**: OWASP Top 10, auth/authz, injection, XSS, CSRF, secrets, unsafe patterns
**Scope**: Authentication, authorization, input validation, output encoding, rate limiting, CSP, service worker, upload pipeline, database queries
**Gates**: All green

---

## Executive Summary

Security posture remains strong. No new findings in cycle 14. The C13-LOW-01 CSP nonce leak has been verified as fixed. All three automated security lint gates pass.

## Findings

No new findings in cycle 14.

## Security Posture Verification (Cycle 14 Re-check)

### Authentication & Session Management
- Argon2id with memory-hard parameters (verified in `lib/password-hashing.ts`)
- Session tokens: HMAC-SHA256, verified with `timingSafeEqual` (verified in `lib/session.ts`)
- Cookie attributes: `httpOnly`, `secure` (when HTTPS or production), `sameSite: lax`, `path: /`
- Session fixation protection: existing sessions invalidated on new login (transaction-wrapped)
- Production refuses DB-stored session secret fallback

### Authorization
- `isAdmin()` verifies session via DB lookup (not just cookie presence)
- `requireSameOriginAdmin()` enforced on every mutating server action (verified by `lint:action-origin` gate)
- API admin routes wrapped with `withAdminAuth()` (verified by `lint:api-auth` gate)
- Last admin deletion prevented

### Input Validation
- Filename sanitization: UUID-based filenames on disk
- Path traversal prevention: `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` whitelist + `resolvedPath.startsWith()` containment
- Symlink rejection: `lstat()` + `isSymbolicLink()` check
- EXIF bounds checking: capped tagCount, string lengths
- SQL injection: Drizzle ORM parameterization for application queries

### Output Encoding
- JSON-LD uses `safeJsonLd()` which escapes `<` and Unicode line terminators
- CSV export escapes formula injection characters and strips bidi/zero-width chars
- Search LIKE wildcards escaped with backslash
- No `dangerouslySetInnerHTML` with unsanitized user input

### Rate Limiting
- Login: per-IP (5/15min) + per-account (5/15min) with DB backup
- Public routes: semantic search, OG images, checkout, share keys all rate-limited
- Pattern 2 rollback correctly applied
- All public mutating routes either carry rate-limit helper or explicit exemption (verified by `lint:public-route-rate-limit` gate)

### Privacy
- `publicSelectFields` omits PII (latitude, longitude, filename_original, user_filename)
- Compile-time guards prevent accidental field leakage
- GPS coordinates excluded from public API responses

### CSP (Post-C13 Fix)
- Verified: `proxy.ts` no longer sets `x-nonce` in response headers
- Nonce is generated per-request, embedded in `<script nonce="...">` attributes
- CSP policy correctly uses `script-src 'nonce-...'` directive

## Conclusion

No new security findings in cycle 14. Posture remains strong.
