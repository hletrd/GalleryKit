# Security Reviewer — Cycle 20

## Review method
Direct deep review of security-critical modules: session.ts, auth.ts,
request-origin.ts, api-auth.ts, proxy.ts, validation.ts, sanitize.ts,
csv-escape.ts, safe-json-ld.ts, content-security-policy.ts, rate-limit.ts,
auth-rate-limit.ts, db-actions.ts, image-queue.ts, advisory-locks.ts,
upload-tracker-state.ts, public.ts, schema.ts, process-image.ts,
serve-upload.ts, upload-paths.ts.

## Previously verified security controls (all still in place)
- Session tokens: HMAC-SHA256 signed, timingSafeEqual comparison
- Cookie attributes: httpOnly, secure (production), sameSite:lax, path:/
- Login rate limiting: dual-bucket (IP + account), pre-increment TOCTOU fix
- No rate-limit rollback on infrastructure errors (auth paths)
- Path traversal prevention: SAFE_SEGMENT regex + whitelist + startsWith
- Symlink rejection on upload routes
- Filename sanitization: UUIDs (no user-controlled filenames)
- Decompression bomb mitigation: Sharp limitInputPixels
- Directory whitelist for public serving
- CSV formula injection prevention with Unicode bidi/zero-width stripping
- Privacy: publicSelectFields omits lat/lon/filename_original/user_filename
- Compile-time privacy guard
- Advisory locks centralized in advisory-locks.ts
- SQL restore scanning via appendSqlScanChunk/containsDangerousSql
- MYSQL_PWD env var for mysqldump/restore
- Backup files stored non-public, served via authenticated route
- Restore file header validation
- Same-origin verification on all mutating admin actions and API routes
- X-Content-Type-Options: nosniff on admin API responses
- Stricter middleware session cookie format check

## New Findings

No new security findings this cycle. All critical security controls remain intact and properly implemented.

## Summary
The codebase maintains strong defense-in-depth: parameterized queries, timing-safe session verification, dual-bucket rate limiting, same-origin CSRF checks, comprehensive input sanitization with Unicode bidi/invisible character rejection, path traversal prevention, and symlink rejection. The prior cycle's finding about `getImageByShareKeyCached` wrapping a function with side effects has been documented at the definition site (C19-AGG-01 fix). No new attack surface has been introduced.
