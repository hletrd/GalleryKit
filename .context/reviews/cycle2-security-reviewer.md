# Cycle 2 — Security Reviewer Findings

**Date**: 2026-05-05
**Scope**: OWASP Top 10, secrets, unsafe patterns, auth/authz
**Method**: Single-agent comprehensive review

---

## Files Examined

All security-critical surfaces:
- `proxy.ts` — Middleware auth guard
- `src/app/actions/auth.ts` — Login/session management
- `src/app/actions/images.ts` — Upload/delete actions
- `src/app/api/admin/db/download/route.ts` — Backup download (withAdminAuth)
- `src/app/api/download/[imageId]/route.ts` — Token-bound download
- `src/app/api/checkout/[imageId]/route.ts` — Stripe checkout
- `src/app/api/reactions/[imageId]/route.ts` — Public reaction endpoint
- `src/app/api/og/photo/[id]/route.tsx` — OG image fetch
- `src/lib/blur-data-url.ts` — CSS injection defense
- `src/lib/validation.ts` — Input validation (partial)
- `src/lib/sanitize.ts` — Sanitization helpers (partial)
- `src/lib/content-security-policy.ts` — CSP generation (partial)

---

## Findings

**0 new security findings.**

### Auth / Session
- Middleware cookie format check (3 colon-separated segments, min 100 chars) is intact.
- `isAdmin()` verifies session via HMAC-SHA256 with `timingSafeEqual`.
- Argon2id password hashing with dummy hash for timing equalization.
- Dual rate limiting (per-IP + per-account) for login.
- Session cookie attributes: `httpOnly`, `secure` (production), `sameSite: lax`.

### Input Validation
- Filename sanitization via `stripControlChars` + `path.basename` + byte-length cap.
- Tag names validated with `isValidTagName` and `isValidTagSlug`.
- Topic slug validated with `isValidSlug`.
- Image ID validated with `Number.isInteger(id) && id > 0` across all API routes.
- CSV export escapes formula injection chars, bidi overrides, zero-width chars.
- Admin string fields reject Unicode formatting chars at validation layer.

### Path Traversal / File Access
- `filePath.startsWith(uploadsDir + path.sep)` containment in download route.
- `lstat()` + `isSymbolicLink()` rejection in upload and download routes.
- `realpath()` traversal check in backup download.
- UUID-based filenames prevent user-controlled paths on disk.

### XSS / Injection
- `blur_data_url` validated with `isSafeBlurDataUrl` (MIME prefix + length cap).
- OG image sanitize strips Unicode formatting chars before rendering.
- CSP nonce regenerated per request in production.

### API Security
- All `/api/admin/*` routes wrap handlers with `withAdminAuth`.
- All mutating server actions enforce `requireSameOriginAdmin()`.
- Public mutating routes (reactions, checkout) have rate limiting.
- lint:api-auth and lint:action-origin gates pass (verified).

### Secrets
- No hardcoded secrets observed in source.
- `SESSION_SECRET` and `ADMIN_PASSWORD` required via env vars.

---

## Commonly Missed Issues Sweep

- **Open redirects**: OG fallback redirects use origin from request, not user input.
- **CSRF**: Same-origin checks on mutating actions; cookie `sameSite: lax`.
- **Sensitive data exposure**: Privacy fields excluded from public queries; compile-time guard enforced.
- **Security misconfiguration**: CSP enforced in production; `X-Content-Type-Options: nosniff` on uploads.

**Conclusion**: No security issues found in this cycle.
