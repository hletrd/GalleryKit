# Security Reviewer — Cycle 14 (current run)

**Reviewer:** security-reviewer (OWASP top 10, secrets, unsafe patterns, auth/authz)
**Scope:** Full server-side auth + mutation surface, file IO, restore tooling, deploy script, reverse-proxy config.

## Methodology

Re-audited every privileged code path with emphasis on:
- Auth + session lifecycle (`session.ts`, `auth.ts`, `admin-users.ts`, `auth-rate-limit.ts`).
- CSRF defense in depth (`request-origin.ts`, `action-guards.ts`, every mutating action).
- File IO + path traversal (`serve-upload.ts`, `process-image.ts`, the `/api/admin/db/download` route).
- SQL restore scanner (`sql-restore-scan.ts`) and the restore pipeline in `db-actions.ts`.
- Rate limiting (per-IP and per-account) — both in-memory caches and the DB-backed bucket.
- Privacy boundary (`data.ts` `publicSelectFields` derivation + compile-time guard).
- Deploy script (`scripts/deploy-remote.sh`) and reverse-proxy config (`apps/web/nginx/default.conf`).

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| (none new) | Cycle 14 found no security regressions. All defenses from cycles 1–13 are intact. | — | — | — |

### Re-checks vs the historical 2026-04-19 findings

- **C14-03 (`DO SLEEP(86400)` in restore).** Re-confirmed — `apps/web/src/lib/sql-restore-scan.ts` does not match `\bDO\s+/i`. Genuinely a defense-in-depth gap, but admin-only DoS surface (the much more dangerous LOAD DATA / GRANT / CREATE FUNCTION paths are blocked). DEFER per aggregate.
- **C14-04 (`seo_og_image_url` SSRF).** No server-side fetch path consumes the URL — purely emitted in HTML meta. Not a current vulnerability. NO ACTION.
- **C14-01 (orphaned topic temp files).** Already fixed — `cleanOrphanedTopicTempFiles` runs at bootstrap from `apps/web/src/lib/image-queue.ts:350`.
- **C14-02 (extension/content mismatch).** Sharp validates content independently. NO ACTION.

### Specific re-checks vs earlier withdrawn findings

- Session secret production guard intact (`session.ts:30-36`).
- Constant-time signature compare (`session.ts:113-119`).
- Argon2 dummy hash (`auth.ts:62-68/157`).
- Pre-increment login rate limit (`auth.ts:135-144`).
- Account-scoped rate limit (`auth.ts:122-141`).
- Restore SQL scanner blocks GRANT/REVOKE/RENAME USER/CREATE USER/ALTER USER/SET PASSWORD/DROP DATABASE/CREATE DATABASE/CALL/LOAD DATA/INTO OUTFILE/INTO DUMPFILE/SYSTEM/SHUTDOWN/SOURCE/CREATE TRIGGER|FUNCTION|PROCEDURE|EVENT/ALTER EVENT/DELIMITER/INSTALL PLUGIN/SET GLOBAL/CREATE SERVER/RENAME TABLE/CREATE VIEW/PREPARE/EXECUTE/DEALLOCATE/SET @= 0x|b'|X'|@@global. after stripping comments + literals + hex/binary literals.
- Path traversal: `SAFE_SEGMENT` regex + `lstat()` symlink rejection + `realpath().startsWith(resolvedRoot + path.sep)` containment + per-directory extension whitelist.
- Backup download enforces `withAdminAuth` + strict `hasTrustedSameOriginWithOptions(allowMissingSource: false)` + `isValidBackupFilename` regex + symlink rejection + containment.
- CSRF defense in depth: `lint:action-origin` gate enforces `requireSameOriginAdmin` on every mutating action.
- Privacy: `publicSelectFields` derived from `adminSelectFields` by destructuring + omitting; compile-time `_privacyGuard` enforces no sensitive keys leak in.
- Reverse-proxy config: `client_max_body_size 2G` globally with 250M sub-limit on `/admin/db`, blocks `/uploads/original/`, sets `X-Content-Type-Options/nosniff`, `X-Frame-Options/SAMEORIGIN`, `Referrer-Policy/strict-origin-when-cross-origin`, `Permissions-Policy`, `Strict-Transport-Security`, hides `X-Powered-By`, applies `limit_req` zones to login (10r/m) and admin mutation routes (30r/m), and uses `proxy_add_x_forwarded_for` so spoofed left-most XFF cannot poison rate limiting.
- Deploy script reads `.env.deploy` (gitignored) for credentials and uses `printf %q` to escape the remote command.

## Verdict

No new security findings this cycle. The repo's defense-in-depth layers all remain operative.
