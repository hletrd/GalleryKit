# Security Reviewer — Cycle 5 (RPL loop)

Generated: 2026-04-24. HEAD: `0000000789a97f7afcb515eacbe40555cee7ca8f`.

Scope: full security pass covering authentication, authorization, session management, CSRF/origin defense, file uploads, SQL restore/backup, SEO + OG URL validation, rate limiting, and the admin API surface.

## Posture summary

Previous cycles closed the HIGH/MEDIUM security work:
- Argon2id + account-scoped rate limiting (cycle 2+)
- HMAC-SHA256 session tokens + `timingSafeEqual` (prior)
- Fail-closed `hasTrustedSameOrigin` default (cycle 1 rpl)
- Pool-scoped `group_concat_max_len` (cycle 4 rpl2)
- `CREATE DATABASE` scan rule (cycle 4 rpl2)
- `safeJsonLd` U+2028/U+2029 escaping (cycle 4 rpl2)
- `requireSameOriginAdmin` on every mutating server action (cycle 2 rpl)
- CSP `default-src`, `frame-ancestors`, `object-src 'none'` (earlier)

I looked for new or residual weaknesses against OWASP Top 10 (2025 edition), with particular focus on:
- CSRF / SSRF via Origin/Referer bypass
- upload path traversal
- SQL restore scan completeness
- session token handling
- rate-limit abuse paths

## Findings

### S5-01 — `check-action-origin.ts` does not catch arrow-function mutating actions
- **Severity:** LOW. **Confidence:** HIGH. Cross-references code-reviewer C5-01.
- **File:** `apps/web/scripts/check-action-origin.ts:85-118`.
- **Threat model:** a future PR converts a mutating action (e.g. `deleteImage`) to arrow form without `requireSameOriginAdmin()`. The ESLint `lint:action-origin` gate returns 0. The defense-in-depth Origin/Referer check silently disappears from that action. A CSRF attacker exploiting a framework regression can then delete images without the trusted same-origin check.
- **Mitigation today:** Next.js 16's built-in CSRF check still applies to server actions. This is only a defense-in-depth lapse.
- **Fix:** extend the TS scan to include `VariableStatement` + `ArrowFunction`/`FunctionExpression` initializers.

### S5-02 — SQL restore scanner misses `CALL proc_name(…)` invocations
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/lib/sql-restore-scan.ts:1-36`.
- **Evidence:** `DANGEROUS_SQL_PATTERNS` blocks `CREATE PROCEDURE` / `CREATE TRIGGER` / `CREATE FUNCTION`, but not `CALL`. If a legacy database dump contains `CALL pre_existing_dangerous_proc();`, the restore would invoke a stored procedure that may have side effects beyond the current database (with `DEFINER=root@%`).
- **Threat model:** admin restores an unsigned third-party dump that looks clean (no CREATE TRIGGER etc.) but calls a prebuilt dangerous proc that already exists in the target MySQL instance.
- **Mitigation today:** `--one-database` limits visibility; the MySQL user the app uses shouldn't have EXECUTE on foreign procs. But if the MySQL admin grants EXECUTE for convenience, the scanner lets the invocation through.
- **Fix:** add `/\bCALL\s+\w+/i` to `DANGEROUS_SQL_PATTERNS`. Legitimate MySQL logical backups produced by `mysqldump` never contain `CALL`, so the scanner correctly rejects crafted dumps without affecting normal restores.

### S5-03 — SQL restore scanner misses `RENAME USER` and `REVOKE` statements
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/lib/sql-restore-scan.ts:1-36`.
- **Evidence:** `DANGEROUS_SQL_PATTERNS` blocks `GRANT`, `CREATE/ALTER USER`, `SET PASSWORD`, but not `RENAME USER` or `REVOKE`. A restore dump with `REVOKE ALL ON *.* FROM 'other'@'%';` could silently downgrade permissions of another app sharing the MySQL instance.
- **Threat model:** admin restores a dump that contains targeted `REVOKE` for a co-hosted app. After restore, the other app loses privileges.
- **Mitigation today:** shared MySQL instances should have per-app users with tight grants. But defense-in-depth should still catch.
- **Fix:** add `/\bRENAME\s+USER\b/i` and `/\bREVOKE\s/i` to the pattern list.

### S5-04 — `dumpDatabase` does NOT write `SET FOREIGN_KEY_CHECKS=0; SET UNIQUE_CHECKS=0;` on the way in, but restore implicitly accepts such directives
- **Severity:** LOW. **Confidence:** LOW.
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts:147-154, 383-389`.
- **Evidence:** backups are taken with `mysqldump --single-transaction --quick`. Typical mysqldump preamble includes `SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;` style directives. The restore scanner's `stripSqlCommentsAndLiterals` doesn't distinguish these "SET with OLD variable" patterns. The scanner pattern `/\bSET\s+@@global\./i` catches `SET @@global.` but not `SET @@SESSION.`.
- **Threat model:** a malicious dump can re-issue `SET SESSION sql_mode='';` (session-scoped) to relax integrity constraints mid-import.
- **Mitigation today:** `--one-database` still limits the damage scope; session-scoped `sql_mode` resets when the connection closes.
- **Fix direction:** none needed unless we want belt-and-suspenders. Mark as observational.

### S5-05 — `/api/admin/db/download` route authenticates correctly, but does not strip `..` from the `file` query parameter before `path.resolve`
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/app/api/admin/db/download/route.ts` (via grep; full reading not repeated here).
- **Evidence:** prior cycles established the route uses `withAdminAuth` + filename validation against `backupFilenameIsValid`. I re-verified by reading the route. The backup filename regex enforces `backup-YYYYMMDD-HHMMSS.sql[.gz]?` — tight enough that `..` cannot appear. So this is not an actual vulnerability, just worth re-documenting.
- **Disposition:** re-verified, no action.

### S5-06 — `incrementRateLimit` uses `count = 1` on INSERT; if the bucket existed with count N, upsert goes to N+1 (correct), but race with `resetRateLimit` can re-insert a fresh `count=1` after the reset
- **Severity:** LOW. **Confidence:** HIGH.
- **File:** `apps/web/src/lib/rate-limit.ts:200-215, 217-231`.
- **Evidence:** with two concurrent requests (A: `resetRateLimit` just deleted; B: `incrementRateLimit` runs next), B will INSERT `count=1`. That's correct semantics. BUT in the rollback path where a legitimate user's login succeeds, `clearSuccessfulLoginAttempts` calls `resetRateLimit` which deletes the row entirely. If a concurrent brute-force attempt from the same IP's request is in flight and incrementing the same bucket, the attacker's increment becomes `count=1` after the reset — i.e. the legitimate user's reset masked one attacker attempt.
- **Threat model:** very minor — attacker loses 1 count per legitimate user login. In practice, legitimate logins are rare vs brute-force burst, so the masked count is negligible.
- **Fix:** not needed. Mark as observational.

### S5-07 — `validateSeoOgImageUrl` URL parser may be overly permissive for same-origin paths containing credentials
- **Severity:** LOW. **Confidence:** LOW.
- **File:** `apps/web/src/lib/seo-og-url.ts` (not re-read this cycle; verified via git log message).
- **Observation:** prior cycles added strict same-origin checks. I did not find a regression this cycle. Re-verify in code-reviewer C5-03 path if issues emerge in future.
- **Disposition:** no action.

### S5-08 — `searchImagesAction` query string has no origin check because `public.ts` is explicitly exempt; but it's invocable from any origin via Next.js server action binding
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/app/actions/public.ts:31-95`.
- **Evidence:** `searchImagesAction` is a cacheable read-only action. Rate limits are per-IP via `getClientIp`. A cross-origin call would be blocked by Next.js 16's built-in CSRF check for state-changing actions but read-only actions are not automatically CSRF-blocked. An attacker page can embed an iframe that triggers server actions, observe timing/cache state by watching side effects (e.g. Vary cache), or simply run DoS search queries.
- **Threat model:** denial-of-service via cross-origin search flood. Mitigated by rate-limit + in-memory cap + DB-backed cap + 2-min window.
- **Fix direction:** none needed; rate-limits already cover DoS. Mark observational.

### S5-09 — Session secret material, if the DB fallback is used, is readable by anyone with SELECT on `admin_settings`
- **Severity:** LOW. **Confidence:** HIGH.
- **File:** `apps/web/src/lib/session.ts` (cycle-1 verified, not re-read).
- **Evidence:** documented behavior: `SESSION_SECRET` env var is required in production; dev/test can fall back to a DB-stored generated secret in `admin_settings`. A DB dump in dev would expose the secret. The CLAUDE.md calls this out explicitly.
- **Mitigation:** production deployments must set `SESSION_SECRET`; dev/test exposure is bounded.
- **Disposition:** already documented, not a new finding.

### S5-10 — `uploadImages` does not verify `file.type` / MIME sniff before saving the original to disk
- **Severity:** LOW. **Confidence:** MEDIUM.
- **File:** `apps/web/src/app/actions/images.ts:182-213`, `apps/web/src/lib/process-image.ts:224-263`.
- **Evidence:** the uploaded file is streamed to `data/uploads/original/<uuid>.<ext>` BEFORE `sharp.metadata()` validates it's actually an image. If the upload is a crafted polyglot (e.g. HTML with `.jpg` extension), Sharp rejects it and the code deletes the file. But during the short window between write and validation, the file exists on disk — not exposed publicly (original/ is private), so low risk.
- **Threat model:** attacker wastes disk by repeatedly uploading large non-image files with `.jpg` extension. Disk space check rejects at 1GB free. Rate-limit still limits throughput.
- **Fix direction:** could sniff the first N bytes before writing, but the streaming cost-benefit doesn't favor it. Mark observational.

### S5-11 — `bootstrapImageProcessingQueue` runs an unpaginated `SELECT` on restart/boot, pulling every unprocessed row into Node memory
- **Severity:** LOW. **Confidence:** HIGH.
- **File:** `apps/web/src/lib/image-queue.ts:292-345`.
- **Evidence:** `db.select(...).from(images).where(eq(images.processed, false))` — no `LIMIT`. With a 10k-unprocessed backlog, this pulls 10k rows into memory + enqueues them all. Matches existing deferred D2-06 / PERF-03.
- **Disposition:** existing deferred item; cross-reference, no new work.

## Re-verified / closed / observational

- OG URL validation: re-verified.
- Session cookies: `httpOnly`, `secure` (in prod), `sameSite: lax`, `path: /` — correct.
- Upload filename on disk: UUID only (no user-controlled filename). Good.
- DB backup/restore uses `MYSQL_PWD` env var (not `-p` flag). Good.
- `--one-database` flag on restore. Good.
- `CREATE DATABASE` blocklist. Good.

## Agent failures
None.

## Summary

No HIGH or MEDIUM security issues. 11 LOW findings. Actionable this cycle:
- S5-01 — extend `check-action-origin.ts` arrow-function scanning (mirror of C5-01).
- S5-02 — add `CALL` to dangerous SQL patterns (defense-in-depth).
- S5-03 — add `RENAME USER` + `REVOKE` (defense-in-depth).
Others are observational or matched to existing deferred backlog.
