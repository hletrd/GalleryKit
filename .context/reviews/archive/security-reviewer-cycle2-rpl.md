# security-reviewer — cycle 2 rpl

HEAD: `00000006e` (post cycle 1 rpl).

## Threat-model scope
OWASP top 10: auth & session, access control, CSRF/provenance, input validation, privacy exposure, injection (SQL, formula, path), file handling, secrets management.

## Findings

### SEC2R-01 — Server-side mutating actions outside `auth.ts` have no explicit origin check (broader audit)
- **Signal:** agrees with CR2R-02 from the code-reviewer.
- **Citation:** `apps/web/src/app/actions/{images,tags,topics,sharing,seo,settings,admin-users}.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`. Only `auth.ts` imports `hasTrustedSameOrigin`.
- **Severity / confidence:** MEDIUM / MEDIUM.
- **Exploit chain (hypothesis):** an authenticated admin browses a malicious site, which issues a cross-origin fetch/form-POST that uses a relative URL ending in the server-action RSC token. Next.js framework-level origin checks apply, but the explicit server-side `hasTrustedSameOrigin` check is missing — every fallback/tuning that passed the cycle-1 aggregate for AGG1R-01 now also matters for these mutations.
- **Fix:** same as CR2R-02 — wrap each mutating action in an explicit provenance check after the `isAdmin()` check. Already scheduled as follow-on to the cycle 1 rpl plan; defer if the framework check is deemed authoritative, but keep the deferral explicit per `D1-02`.

### SEC2R-02 — `/api/admin/db/download` does not enforce a cap on how fast backups are streamed
- **Citation:** `apps/web/src/app/api/admin/db/download/route.ts:13-87`.
- **Severity / confidence:** LOW / MEDIUM.
- **Why it matters:** the route is already protected by `withAdminAuth` + `hasTrustedSameOriginWithOptions({ allowMissingSource: false })` + `isValidBackupFilename`, which is strong. But a single authenticated admin (or a compromised admin) can repeatedly stream the largest backup, saturating egress on a small self-hosted VM. There is currently no rate limit on this endpoint.
- **Fix:** defer — this is a DoS-from-privileged-principal scenario, not a primary attack surface. Add to the deferred register instead of shipping now.

### SEC2R-03 — `restoreDatabase` scans the whole dump for dangerous SQL but still executes the same file
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:332-349` + `lib/sql-restore-scan.ts`.
- **Severity / confidence:** LOW / HIGH (already mitigated, just recording).
- **Observation:** the restore pipeline currently reads the uploaded file twice — once for the dangerous-SQL scan, once for the spawn stdin. This is correct behavior (and the `mysql --one-database` flag is the real enforcement mechanism), but any future refactor that short-circuits the scan while keeping the stdin stream would be a regression. Current code is safe.
- **Fix:** none this cycle. Add a test lock (deferred) that asserts the scan pass always runs before the spawn pipe.

### SEC2R-04 — Session token timestamp accepted without timezone / clock-drift guard
- **Citation:** `apps/web/src/lib/session.ts:121-128`.
- **Severity / confidence:** LOW / LOW.
- **Why it matters:** `Date.now() - tokenTimestamp < 0` is rejected (client skew in the future) but negative-skew tokens (issued in the past on a forward-moving clock) have no lower bound beyond the 24h window. If the server's wall clock jumps backward by more than 24h, all existing tokens suddenly appear "in the future" and reject cleanly; if the server's clock jumps forward by >24h, every existing token instantly expires and all admins are logged out. This is a known Next.js/systemd interaction not in scope for this cycle; documenting for future hardening.
- **Fix:** none this cycle.

### SEC2R-05 — CSP still ships with `'unsafe-inline'` for script-src and style-src in production
- **Citation:** `apps/web/next.config.ts:72-85`.
- **Severity / confidence:** LOW / HIGH.
- **Disposition:** pre-existing D1-01. Unchanged this cycle.

### SEC2R-06 — Historical example secrets in git history
- **Signal:** pre-existing SEC1-03 / OC1-01. Already documented.
- **Disposition:** operationally closed. No new code change this cycle.

## Summary
One new meaningful finding (SEC2R-01 — broader mutation-surface provenance audit). Everything else is either re-confirmation of an existing deferral, an observation (SEC2R-03), or a low-signal clock skew note (SEC2R-04).
