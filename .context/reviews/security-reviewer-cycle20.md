# Security Reviewer — Cycle 20

## Review Scope
Authentication (login, sessions, password change), authorization (middleware guard, server action guards), rate limiting (in-memory + DB-backed), file upload security (path traversal, symlink, filename sanitization), SQL injection (ORM parameterization), XSS/Content-Type headers, cookie security, secrets management, and privacy (GPS coordinate exclusion).

## New Findings

### SEC-20-01: `uploadTracker` count can go negative after failed uploads, bypassing rate limit [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/actions/images.ts` lines 273-278
- **Description**: Same root issue as CR-20-05 but from a security angle. The tracker adjustment `currentTracker.count += (successCount - files.length)` can make the count negative when all uploads fail. A negative count effectively grants the IP additional uploads beyond the intended limit. This is a rate-limit bypass vector.
- **Concrete attack scenario**: An attacker with admin credentials sends 100 intentionally corrupt files (0 bytes, wrong MIME type) per hour. Each batch decrements the tracker by 100, accumulating negative count. After a few rounds, the tracker is at -300. The attacker then uploads 400 legitimate files (100 allowed + 300 from negative balance) in a single batch, exceeding the 100-file-per-hour limit. Combined with the 10GB total size limit, this could be used to fill disk space faster than intended.
- **Fix**: Clamp count to >= 0 after adjustment, or use absolute count tracking instead of differential adjustments.

### SEC-20-02: `seo.ts` does not validate `seo_og_image_url` against JavaScript URIs or open redirect patterns [LOW] [LOW confidence]
- **File**: `apps/web/src/app/actions/seo.ts` lines 89-98
- **Description**: The OG image URL validation checks for `http:` or `https:` protocol, which is correct. However, the URL is stored in the database and rendered in OG meta tags (`<meta property="og:image" content="...">`). Since Next.js metadata API properly escapes attribute values in meta tags, and the URL is only used in meta tags (not as a link href), there is no XSS risk. The `http:`/`https:` check is sufficient. Not an issue.
- **Verdict**: Not an issue.

### SEC-20-03: `deleteAdminUser` returns `{ success: true }` when no user was actually deleted (idempotent but misleading) [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/admin-users.ts` lines 157-166
- **Description**: Same as CR-20-02. While not a direct security vulnerability (the transaction correctly prevents deleting the last admin), returning success when nothing was deleted could mask concurrent deletion attempts in audit logs. The admin might believe they deleted a user who was already gone, creating confusion during incident response.
- **Fix**: Check affected rows and return an appropriate error.

## Previously Fixed — Confirmed

All security findings from prior cycles remain resolved:
- SEC-39-01 (Locale cookie Secure flag): Fixed — `nav-client.tsx` includes Secure on HTTPS
- SEC-39-03 (SET @@global. pattern): Fixed — `sql-restore-scan.ts` includes the pattern
- C19-01 (revokePhotoShareLink race): Fixed — conditional WHERE clause
- C19-02 (storage backend DB/live inconsistency): Fixed — roll-back on failure
