# Security Reviewer — Cycle 39

## Review Scope

Full security audit covering authentication, session management, rate limiting, file upload security, SQL injection, XSS, CSRF, access control, and data privacy.

## New Findings

### SEC-39-01: `nav-client.tsx` sets locale cookie without `Secure` flag [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/nav-client.tsx` line 60
- **Description:** The locale switch sets `document.cookie = "NEXT_LOCALE=${otherLocale};path=/;SameSite=Lax;max-age=..."` without the `Secure` flag. While this is a non-sensitive locale preference cookie (not auth), it could be modified by a MITM on HTTP. The `SameSite=Lax` provides some protection, but the missing `Secure` flag is inconsistent with the session cookie which uses `Secure` in production.
- **Fix:** Add `Secure` flag when `window.location.protocol === 'https:'` to match the session cookie behavior.

### SEC-39-02: `db-actions.ts` env passthrough includes `HOME` — confirmed still present [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 121, 313
- **Description:** Already deferred as CR-38-05. Confirmed still present — no change. The `HOME` env var is passed to mysqldump/mysql child processes, which could allow `~/.my.cnf` to override connection parameters. Low risk in Docker.
- **Status:** Already deferred, no new finding.

### SEC-39-03: `sql-restore-scan.ts` does not check for `SET @@global.` pattern [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/lib/sql-restore-scan.ts` lines 1-30
- **Description:** The dangerous SQL patterns list includes `SET GLOBAL` but not `SET @@global.` or `SET @@session.`. While `SET GLOBAL` covers the most common case, a crafted SQL dump could use `SET @@global.variable = value` to bypass the filter. The `--one-database` flag on the mysql client provides an additional layer of protection.
- **Fix:** Add patterns `/\bSET\s+@@global\./i` and optionally `/\bSET\s+@@session\./i` to the dangerous SQL patterns list.

## Previously Deferred Items Confirmed

All previously deferred security items remain valid. No new critical or high-severity findings.
