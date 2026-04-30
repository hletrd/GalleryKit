# Security Reviewer — Cycle 21

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
- Password length validation uses countCodePoints (C20-AGG-01)

## New Findings

### C21-SR-01 (Low / Medium): `searchImages` query length uses `.length` (UTF-16) instead of `countCodePoints()` — same class as C20-AGG-01

- **Source**: `apps/web/src/lib/data.ts:1082`
- **Issue**: The `searchImages` function uses `query.length > 200` to guard against oversized queries. JavaScript `.length` counts UTF-16 code units, so a 101-emoji search query (202 code units, 101 code points) would be rejected by this guard. While not a direct security vulnerability, this is the same class of inconsistency that was fixed in C20-AGG-01 for passwords. The defense-in-depth guard in data.ts is more restrictive than intended for supplementary Unicode characters.
- **Confidence**: High

No other new security findings this cycle. All critical security controls remain intact and properly implemented.
