# Security Reviewer — Cycle 19

## Review method
Direct deep review of security-critical modules: session.ts, auth.ts,
request-origin.ts, api-auth.ts, proxy.ts, validation.ts, sanitize.ts,
csv-escape.ts, safe-json-ld.ts, content-security-policy.ts, rate-limit.ts,
auth-rate-limit.ts, db-actions.ts, image-queue.ts, advisory-locks.ts,
upload-tracker-state.ts, public.ts, schema.ts.

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
- Advisory locks centralized in advisory-locks.ts (C9-SR-01 FIXED)
- SQL restore scanning via appendSqlScanChunk/containsDangerousSql
- MYSQL_PWD env var for mysqldump/restore (not CLI flags)
- Backup files stored non-public, served via authenticated route
- Restore file header validation
- Same-origin verification on all mutating admin actions and API routes
- X-Content-Type-Options: nosniff on admin API responses (C16-LOW-08 FIXED)
- Stricter middleware session cookie format check (C16-LOW-05 FIXED)

## New Findings

### C19-SR-01 (Low / Medium): `getImageByShareKeyCached` with `cache()` could suppress view-count increments across deduplicated calls

- **Source**: Direct code review of `apps/web/src/lib/data.ts:1231`
- **Location**: `getImageByShareKeyCached = cache(getImageByShareKey)`
- **Issue**: Same as C19-CR-01. `getImageByShareKey` has a side effect (`bufferGroupViewCount`) controlled by `incrementViewCount`. When `cache()` deduplicates calls within a single request, only the first invocation's side effect runs. Currently the only consumer passes `incrementViewCount: true` and there's only one call per page render, so this is a latent risk. However, if a future SSR path renders the same share key twice (e.g., nested component), the second call's view-count increment would be silently dropped.
- **Fix**: Document the caching caveat or remove `cache()` from `getImageByShareKeyCached` since shared-photo pages are not deduplicated within a single request in practice.
- **Confidence**: Medium

### C19-SR-02 (Low / Low): `adminUsers.updated_at` is `onUpdateNow()` — informational only

- **Source**: Direct code review of `apps/web/src/db/schema.ts:112`
- **Location**: `adminUsers.updated_at` column definition
- **Issue**: The newly added `updated_at` column with `onUpdateNow()` will auto-update on any row mutation. This includes password changes (useful for "last password change" tracking), but also includes any future admin-user update. This is correct behavior and not a security issue.
- **Fix**: No action needed.
- **Confidence**: Low (informational)

## Summary
No new high or medium severity security findings. All critical security controls verified as intact. The codebase maintains strong defense-in-depth: parameterized queries, timing-safe session verification, dual-bucket rate limiting, same-origin CSRF checks, and comprehensive input sanitization with Unicode bidi/invisible character rejection.
