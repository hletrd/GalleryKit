# Security Reviewer — Cycle 44 (2026-04-20)

## Review Scope
Full security review: authentication, authorization, session management, input validation, SQL injection, path traversal, XSS, CSRF, rate limiting, secrets management, and OWASP Top 10 coverage.

## New Findings

### S44-01: `login` function does not apply `stripControlChars` to username [MEDIUM] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/auth.ts` line 70
**Description:** The username from `formData.get('username')` is used directly without `stripControlChars`. While `createAdminUser` (line 96) applies `stripControlChars` to the username before storing it, the login path does not sanitize before querying the DB. If an attacker sends a username with control characters (e.g., `admin\x00`), it would not match any existing user (since stored usernames were sanitized on creation), so there's no authentication bypass. However, the unsanitized value reaches the DB `WHERE` clause — this is a defense-in-depth gap compared to the consistent `stripControlChars` pattern elsewhere.
**Fix:** Apply `stripControlChars(username)` before the DB query in `login()`.
**Risk:** LOW — no bypass possible since stored usernames are clean. But inconsistent with defense-in-depth posture.

### S44-02: `searchImagesAction` applies `stripControlChars` after slice but before LIKE query [LOW] [HIGH confidence]
**File:** `apps/web/src/app/actions/public.ts` line 94
**Description:** The query is first `trim().slice(0, 200)`, then `stripControlChars` is applied. This means the 200-character limit could be applied before control character stripping, resulting in a slightly shorter effective query than intended. The order should be: strip first, then slice. This is minor because `stripControlChars` only removes characters that would not meaningfully affect a LIKE search, and the 200-char limit is generous.
**Fix:** Reorder to `stripControlChars(query.trim())?.slice(0, 200) ?? ''`.

### S44-03: Health endpoint discloses DB status to unauthenticated users [LOW] [HIGH confidence]
**File:** `apps/web/src/app/api/health/route.ts` lines 7-19
**Description:** The `/api/health` endpoint returns `{ status, db: dbOk, timestamp }` with no authentication. An attacker can probe whether the DB is reachable/reachable, aiding reconnaissance. This is a known deferred item from prior cycles (C30-08/C32-04).
**Status:** Already deferred.

## Verified as Fixed (from prior cycles)

- C43-01 (LANG/LC_ALL locale passthrough): **VERIFIED FIXED** — Hardcoded to `'C.UTF-8'`.
- CR43-02 (escapeCsvField null bytes): **VERIFIED FIXED** — Control character stripping added.
- HOME env passthrough in mysqldump/mysql: **VERIFIED FIXED** (from earlier cycles).
- SQL restore scanner hex/binary literals: **VERIFIED FIXED** (from earlier cycles).

## Previously Deferred Items (No Change)

- C30-08/C32-04: Health endpoint DB disclosure
- C30-04: `createGroupShareLink` insertId BigInt coercion
- DOC-38-01/DOC-38-02: CLAUDE.md version mismatches
