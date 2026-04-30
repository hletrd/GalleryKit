# Security Review — security-reviewer (Cycle 15)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30

## Summary

- No new critical or high security findings.
- No new medium security findings.
- All prior security fixes confirmed intact.

## Verified fixes from prior cycles

All prior security findings confirmed addressed:

1. C14-AGG-01 (audit.ts metadata truncation): FIXED — ellipsis marker added.
2. AGG13-01 through AGG8R-01: All confirmed intact.
3. Argon2id password hashing: confirmed.
4. HMAC-SHA256 session tokens with `timingSafeEqual`: confirmed.
5. Login rate limiting (per-IP + per-account dual bucket): confirmed.
6. `requireSameOriginAdmin()` on all mutating server actions: confirmed across all 9 action files.
7. `withAdminAuth` + `hasTrustedSameOrigin` on all API routes: confirmed.
8. Upload security (UUID filenames, path traversal prevention, symlink rejection): confirmed.
9. Privacy enforcement (`publicSelectFields` + compile-time guard): confirmed.
10. Unicode bidi/invisible formatting rejection: confirmed on all admin string surfaces.
11. `sanitizeStderr` password redaction: confirmed.
12. `safeJsonLd` XSS prevention in JSON-LD scripts: confirmed.
13. CSP with nonce in production: confirmed.
14. `serveUploadFile` security (path traversal, symlink rejection, directory whitelist, extension validation, realpath containment): confirmed.

## Deep review: comprehensive sweep

### Authentication & Session Security
- Argon2id password hashing with dummy hash for timing-safe user enumeration prevention: confirmed.
- HMAC-SHA256 session tokens with `timingSafeEqual`: confirmed.
- Login rate limiting (dual bucket, pre-increment pattern): confirmed.
- Password change rate limiting (validation-before-increment ordering): confirmed.
- Session fixation prevention (delete old before insert new in transaction): confirmed.
- `unstable_rethrow` for Next.js control flow signals: confirmed in both `login` and `updatePassword`.

### CSRF / Origin Verification
- `requireSameOriginAdmin()` on all mutating server actions: confirmed.
- `withAdminAuth` + `hasTrustedSameOrigin` on API routes: confirmed.
- `hasTrustedSameOrigin` checks both Origin and Referer with protocol normalization: confirmed.

### Input Sanitization Pipeline
- `sanitizeAdminString` (Unicode bidi/invisible rejection + C0/C1 stripping): confirmed.
- `requireCleanInput` (strip + reject-if-changed): confirmed.
- `stripControlChars`: confirmed in all FormData parsing paths.
- `countCodePoints` for MySQL-compatible varchar length: confirmed.
- LIKE wildcard escaping in search: confirmed.
- Cursor normalization with strict format validation: confirmed.

### File Upload Security
- UUID filenames via `crypto.randomUUID()`: confirmed.
- Path traversal prevention (`SAFE_SEGMENT` + `ALLOWED_UPLOAD_DIRS`): confirmed.
- Symlink rejection via `lstat()`: confirmed (both upload routes).
- Decompression bomb mitigation (Sharp `limitInputPixels`): confirmed.
- Upload tracker TOCTOU fix (pre-increment before async operations): confirmed.
- Directory extension mapping to prevent serving mismatched files: confirmed.
- `realpath` containment to prevent TOCTOU symlink race: confirmed.

### Database Security
- Drizzle ORM parameterization for all application queries: confirmed.
- Raw SQL in `deleteAdminUser` uses parameterized queries with documented rationale: confirmed.
- Advisory locks for concurrent mutation prevention: confirmed for all 5 lock names.
- `MYSQL_PWD` env var used for mysqldump/restore (not `-p` flag): confirmed.

### Privacy
- `publicSelectFields` omits all PII fields: confirmed.
- Compile-time guard `_SensitiveKeysInPublic` enforced: confirmed.
- GPS coordinates excluded from public API: confirmed.
- `filename_original` and `user_filename` excluded from public queries: confirmed.
- `blur_data_url` excluded from listing queries (fetched only in individual queries): confirmed.

### New Findings

None.

## Carry-forward (unchanged — existing deferred backlog)

- D1-01 / D2-08 / D6-09 — CSP `'unsafe-inline'` hardening
- OC1-01 / D6-08 — historical example secrets in git history
