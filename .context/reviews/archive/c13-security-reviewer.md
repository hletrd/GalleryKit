# Security Review — Cycle 13 (security-reviewer)

## Review Scope
Authentication, authorization, input validation, session management, file operations, SQL injection, XSS, CSRF protections.

## Findings

### C13-SR-01: `proxy.ts` middleware cookie format check accepts tokens with empty fields
- **File+line**: `apps/web/src/proxy.ts:87`
- **Severity**: Low | **Confidence**: Low
- **Issue**: Already deferred as C11-LOW-01 / C12-LOW-04. The `token.split(':').length !== 3` check allows tokens like `::` (three empty fields). No security impact since `verifySessionToken` validates each field (timestamp must be numeric, signature must match). Confirming carry-forward.
- **Fix**: Already deferred.

### C13-SR-02: `restoreDatabase` temp file path uses `os.tmpdir()` + UUID
- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:366`
- **Severity**: Low | **Confidence**: Low
- **Issue**: Already deferred as D6-MED in earlier cycles. The temp file path is predictable in structure (`/tmp/restore-<uuid>.sql`) but the UUID provides sufficient entropy. The file is created with mode 0o600. Advisory lock prevents concurrent restores.
- **Fix**: Already deferred.

### C13-SR-03: `UNICODE_FORMAT_CHARS` regex uses non-`/g` flag for `.test()` — correct pattern
- **File+line**: `apps/web/src/lib/validation.ts:56` and `apps/web/src/lib/sanitize.ts:168`
- **Severity**: N/A | **Confidence**: High
- **Issue**: Verified that the stateful-regex bug (C8-AGG8R-01) from cycle 8 remains fixed. `UNICODE_FORMAT_CHARS` (no `/g`) is used for `.test()` and `UNICODE_FORMAT_CHARS_RE` (with `/g`) is used for `.replace()`. The two imports are kept separate and the pattern is correct.

### C13-SR-04: Session token timestamp validated with `parseInt` but no minimum timestamp check
- **File+line**: `apps/web/src/lib/session.ts:122-128`
- **Severity**: Low | **Confidence**: Low
- **Issue**: The timestamp from the session token is validated with `parseInt` and checked for `Number.isFinite`, and the age is checked to be within 24 hours. However, there is no explicit minimum timestamp (e.g., must be after year 2020). A token with timestamp=1 would fail the age check (> 24 hours), so this is defense-in-depth only. The `tokenAge < 0` check also prevents future timestamps.
- **Fix**: No fix needed — the 24-hour age window already prevents ancient timestamps.

### C13-SR-05: `searchImages` query LIKE pattern with escaped wildcards
- **File+line**: `apps/web/src/lib/data.ts:1063`
- **Severity**: N/A | **Confidence**: High
- **Issue**: Verified that LIKE wildcard escaping is correct — `%`, `_`, and `\` are escaped with backslash before wrapping in `%...%`. This prevents LIKE wildcard abuse per CLAUDE.md.

### C13-SR-06: CSP `style-src` includes `'unsafe-inline'` in production
- **File+line**: `apps/web/src/lib/content-security-policy.ts:81`
- **Severity**: Low | **Confidence**: Low
- **Issue**: Already deferred as D4-MED. `style-src 'self' 'unsafe-inline'` is needed for Tailwind CSS runtime styles. No change since prior cycles.
- **Fix**: Already deferred.

## Summary
- Total findings: 6 (3 carried forward confirmations, 2 verified-as-correct, 1 new observation)
- No new HIGH/MEDIUM security issues found
- All prior security fixes remain intact
