# Security Review — Cycle 1 (New Loop)

**Reviewer:** Security (OWASP, secrets, unsafe patterns, auth/authz)
**Date:** 2026-04-19

## Methodology
- Reviewed all authentication flows (login, logout, password change, session management)
- Examined all server actions for authorization bypasses
- Checked middleware auth guard for bypass opportunities
- Reviewed file upload security (path traversal, symlink, filename sanitization, decompression bombs)
- Verified SQL injection protection across all queries
- Checked for XSS vectors (dangerouslySetInnerHTML, innerHTML, user content in responses)
- Reviewed rate limiting for bypass opportunities
- Checked for information disclosure (error messages, stack traces, env vars)
- Verified cookie security attributes

## Findings

### C1N-07: Search rate limit DB check does not roll back in-memory increment on `limited=true` [MEDIUM, High Confidence]
**File:** `apps/web/src/app/actions/public.ts:62-69`
**Problem:** When `checkRateLimit` (DB-backed) returns `limited: true`, the function returns `[]` immediately without rolling back the pre-incremented in-memory counter. This means the in-memory counter overcounts compared to the DB, causing legitimate requests to be prematurely rate-limited. While this is a "fail-closed" direction (over-limiting rather than under-limiting), it's still a correctness issue — users may be denied valid search requests.
**Concrete scenario:** User at 29/30 limit makes 2 concurrent requests. Both pass in-memory check (count=29). Both increment to 30 and 31. DB check for the 2nd request returns limited. But in-memory is now 31. Next request from same user fails the in-memory check even though DB shows 30 (at limit, not over).
**Suggested fix:** After `dbLimit.limited` returns true, decrement the in-memory counter:
```typescript
if (dbLimit.limited) {
    const currentEntry = searchRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        currentEntry.count--;
    } else {
        searchRateLimit.delete(ip);
    }
    return [];
}
```
This mirrors the existing pattern at lines 74-84 for DB increment failures.

### C1N-08: `isValidTopicAlias` allows null bytes (\x00) in alias strings [LOW, Medium Confidence]
**File:** `apps/web/src/lib/validation.ts:25`
**Problem:** The regex `^[^/\\\s?#<>"'&]+$` does not explicitly exclude null bytes (\x00). A null byte in a URL could cause truncation in some contexts (C-style string handling). While MySQL and modern web frameworks handle null bytes correctly, it's a defense-in-depth concern.
**Suggested fix:** Add `\x00` to the excluded character class: `^[^/\\\s?\x00#<>"'&]+$`

### C1N-09: `isValidTagName` does not exclude null bytes [LOW, Medium Confidence]
**File:** `apps/web/src/lib/validation.ts:30`
**Problem:** Same as C1N-08 — the regex `/[<>"'&]/` does not check for null bytes. Tag names could contain \x00.
**Suggested fix:** Add null byte check: `/[<>"'&\x00]/`

## No-New-Findings Items (Confirmed Secure)
- **Authentication:** Argon2id with dummy hash for timing-safe user enumeration prevention. HMAC-SHA256 session tokens verified with `timingSafeEqual`. Cookie attributes correct (httpOnly, secure in production, sameSite:lax).
- **Session fixation prevention:** Transaction wraps insert + delete of pre-existing sessions.
- **Password change:** Transactional password update + session invalidation. Rate limited separately from login.
- **Authorization:** Every server action calls `isAdmin()`. Middleware guards protected admin routes. API routes use `withAdminAuth`. Defense in depth.
- **Path traversal:** `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` whitelist + `resolvedPath.startsWith()` containment check in serve-upload.ts.
- **Symlink rejection:** Both upload routes use `lstat()` and reject symbolic links.
- **Filename sanitization:** UUIDs via `crypto.randomUUID()` for disk filenames.
- **SQL injection:** All queries via Drizzle ORM (parameterized). LIKE wildcards escaped in search.
- **XSS:** `safeJsonLd` escapes `<`. No raw innerHTML with user content. React auto-escapes.
- **CSV injection:** Formula injection characters escaped.
- **DB backup security:** `--one-database` flag, dangerous SQL pattern scanning, advisory lock prevents concurrent restores.
- **Privacy:** GPS coordinates and `filename_original` excluded from public API responses.

## Previously Deferred Items (Unchanged)
All previously deferred security items from cycles 5-37 remain deferred.
