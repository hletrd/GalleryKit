# Security Review — Cycle 1 Fresh

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30
Scope: whole repository — OWASP top 10, auth/authz, secrets, unsafe patterns, input validation.

## Inventory reviewed

All `apps/web/src/` files including: auth actions, API routes, middleware, session management, rate limiting, input validation, DB access, file upload/processing, CSP, sanitization, and privacy enforcement.

---

## Findings

### C1F-SR-01 (High / High). `login` rate-limit rollback on infrastructure error gives attacker extra attempts

- Location: `apps/web/src/app/actions/auth.ts:249-258`
- When an unexpected error occurs during login verification (e.g., DB connection lost), the code rolls back the pre-incremented rate-limit count. This means an attacker who triggers infrastructure errors (e.g., by overloading the DB) can reduce their failed-attempt count, effectively getting more than 5 attempts per 15-minute window.
- **Scenario**: Attacker makes 5 rapid attempts. On attempt 3, the DB blips and the Argon2 verify fails with an unexpected error. The rollback decrements the count from 3 to 2. The attacker now has 3 more attempts instead of 2.
- **Severity**: Medium — requires triggering infrastructure errors, which is non-trivial but possible.
- **Fix**: Don't roll back on unexpected errors, or use a separate "infrastructure error" counter.

### C1F-SR-02 (Medium / High). `CSP style-src` allows `'unsafe-inline'` in production

- Location: `apps/web/src/lib/content-security-policy.ts:82`
- The production CSP includes `style-src 'self' 'unsafe-inline'`. While Tailwind CSS and Radix UI heavily depend on inline styles for dynamic state, `'unsafe-inline'` in style-src can be abused for CSS-based data exfiltration (attribute selectors reading DOM values, `:visited` history probing). Modern browsers have mitigations but the attack surface remains.
- **Severity**: Low — modern browsers mitigate the worst CSS exfiltration vectors. Removing `'unsafe-inline'` would require significant refactoring of the UI library stack.
- **Fix**: Long-term, migrate to CSP nonce-based or hash-based style-src. Short-term, document the tradeoff.

### C1F-SR-03 (Medium / Medium). `restoreDatabase` temp file uses predictable `os.tmpdir()` path

- Location: `apps/web/src/app/[locale]/admin/db-actions.ts:364`
- The restore creates a temp file at `os.tmpdir() + '/restore-${randomUUID()}.sql'`. While `randomUUID()` provides uniqueness, the temp directory itself is typically world-readable on multi-user systems. The file is created with `mode: 0o600`, but between the `createWriteStream` call and the mode being set, there's a brief window where the file may be readable.
- **Severity**: Low — the window is extremely brief and the file contains a DB backup (already behind admin auth). On single-user systems (Docker), this is irrelevant.
- **Fix**: Use `fs.open()` with `O_CREAT | O_EXCL | O_WRONLY` and mode `0o600` to create the file atomically, then create the write stream from the fd.

### C1F-SR-04 (Low / High). `proxy.ts` cookie format check is lenient — any 3-colon-split string passes

- Location: `apps/web/src/proxy.ts:83`
- The middleware checks `token.split(':').length !== 3` to validate the cookie. The actual token format is `timestamp:random:signature`. A token like `a:b:c` would pass this check and proceed to the full `verifySessionToken()` which does the HMAC verification. The middleware check is only a fast-reject for obviously invalid cookies, not a security boundary.
- **Severity**: Low — the actual security check is in `verifySessionToken()` which does HMAC verification. The middleware just avoids the DB query for obviously malformed tokens.
- **Fix**: No fix needed — this is documented as a fast-reject, not a security boundary.

### C1F-SR-05 (Medium / Medium). `DB_PASSWORD` exposed in child process environment for mysqldump/mysql

- Location: `apps/web/src/app/[locale]/admin/db-actions.ts:153,444`
- The `MYSQL_PWD` environment variable is passed to child processes for mysqldump and mysql. While this is the recommended approach (vs CLI flags visible in `/proc/cmdline`), the password is visible in `/proc/<pid>/environ` on Linux. The code already documents this tradeoff and uses `MYSQL_PWD` per MySQL best practices.
- **Severity**: Low — `/proc/<pid>/environ` is readable only by the same user or root. In Docker, the process runs as a single user.
- **Fix**: No fix needed — already using best-practice approach.

### C1F-SR-06 (Low / Low). Session secret fallback in dev mode stores secret in DB

- Location: `apps/web/src/lib/session.ts:40-80`
- In development mode, if `SESSION_SECRET` is not set, the code generates a random secret and stores it in the `admin_settings` table. This means the DB-stored secret lives in the same trust domain as user data, making DB compromise equivalent to session forgery. Production mode correctly refuses this fallback.
- **Severity**: Low — dev-only, production is safe.
- **Fix**: No fix needed — production is already hardened.

### C1F-SR-07 (Medium / Medium). `getClientIp` returns "unknown" when TRUST_PROXY is not set but proxy headers are present

- Location: `apps/web/src/lib/rate-limit.ts:92-123`
- When `TRUST_PROXY` is not set but `X-Forwarded-For` or `X-Real-IP` headers are present, the function returns `"unknown"` and logs a warning (once). This means all users behind the same reverse proxy share the same rate-limit bucket `"unknown"`, making the rate limit effectively per-server instead of per-user.
- **Severity**: Medium — in a reverse-proxy deployment without `TRUST_PROXY=true`, rate limiting is effectively disabled for all users.
- **Fix**: Document the `TRUST_PROXY` requirement prominently in deployment docs. Consider making the warning more visible (e.g., startup-time check).

### C1F-SR-08 (Low / Low). `sanitizeStderr` redacts password but not other sensitive env vars

- Location: `apps/web/src/lib/sanitize.ts:98-111`
- The function redacts `MYSQL_PWD` and generic `password=` patterns from child process stderr. However, other sensitive values like `DB_HOST`, `DB_USER`, `DB_NAME` could also appear in error messages and are not redacted.
- **Severity**: Low — these are typically less sensitive than the password itself.
- **Fix**: Consider redacting all DB connection parameters from stderr.
