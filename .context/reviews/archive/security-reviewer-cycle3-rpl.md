# Security Review — Cycle 3 (RPL loop)

**Date:** 2026-04-23
**Scope:** Full security surface — auth, sessions, rate limiting, origin checks, file upload, DB backup/restore, SSR JSON-LD, privacy fields, CSP.

## Surface inventory checked

- Auth flow (`actions/auth.ts`) — login, updatePassword, logout, getCurrentUser
- Session lifecycle (`lib/session.ts`)
- Rate limiting (`lib/rate-limit.ts`, `lib/auth-rate-limit.ts`)
- Origin guards (`lib/request-origin.ts`, `lib/action-guards.ts`)
- File upload (`actions/images.ts`, `lib/process-image.ts`, `lib/upload-paths.ts`, `app/api/admin/db/download/route.ts`)
- DB backup/restore (`admin/db-actions.ts`)
- Maintenance mode (`lib/restore-maintenance.ts`)
- JSON-LD emission (`lib/safe-json-ld.ts`, consumed in `(public)/**/page.tsx`)
- Input validation (`lib/validation.ts`, `lib/sanitize.ts`)
- Privacy field isolation (`lib/data.ts` `publicSelectFields`, compile-time guard `_SensitiveKeysInPublic`)
- CSP headers (`next.config.ts`)
- Custom lints: `lint:api-auth` (OK), `lint:action-origin` (OK)

## Findings

### SEC3-01 — No new security findings [INFO]

After cycle 46 aggregates and cycle 1-2 rpl patches (C1R-01 through C2R-03), the security posture is intact:
- ✅ Argon2id password hashing + dummy-hash timing equalization (auth.ts:57-68)
- ✅ Session fixation prevented via transactional insert+delete (auth.ts:190-202)
- ✅ Rate-limit pre-increment + rollback on infra errors (auth.ts, admin-users.ts, sharing.ts, images.ts)
- ✅ IP-based + account-scoped login rate limits (auth.ts:117-130)
- ✅ `hasTrustedSameOrigin` fail-closed default (C1R-01) applied to login + updatePassword (auth.ts:93, 274)
- ✅ `requireSameOriginAdmin` now applied to every mutating server action (C2R-02, enforced by `lint:action-origin`)
- ✅ `unstable_rethrow(e)` added to updatePassword (C2R-01) matching login pattern
- ✅ Rate-limit clear only after tx commit (C1R-02)
- ✅ HTTPS-aware cookie `secure` flag (auth.ts:204-208)
- ✅ File upload path traversal prevented: `SAFE_SEGMENT` regex + `ALLOWED_UPLOAD_DIRS` whitelist + `resolvedPath.startsWith()` containment + `lstat` symlink rejection
- ✅ UUID filenames on disk (`crypto.randomUUID()`)
- ✅ Sharp `limitInputPixels` configured via `IMAGE_MAX_INPUT_PIXELS[_TOPIC]` envs
- ✅ CSRF mitigated via Next.js server-action CSRF + explicit `hasTrustedSameOrigin` defense-in-depth
- ✅ XSS: `dangerouslySetInnerHTML` limited to JSON-LD with `safeJsonLd` escaping
- ✅ MYSQL_PWD env var used for mysqldump (not `-p` flag); `--one-database` flag on restore
- ✅ GPS lat/long excluded from public API responses; compile-time guard on public field list
- ✅ CSV export escapes formula injection chars (`=+-@\t\r`)
- ✅ LIKE wildcards escaped in search (`%_\`)

## Deferred items (carry-forward, unchanged status)

| ID | Source | Severity | Reason |
|---|---|---|---|
| D2-08 (was D1-01/D6-09) | CSP `'unsafe-inline'` hardening | LOW | Requires nonce/hash strategy |
| OC1-01 (was D6-08) | Historical secrets in git history | MEDIUM | Operational; out of code-fix cycle scope |
| D6-13 | Single-process runtime assumptions | LOW | Needs infra documentation or redesign |

## Totals

- **0 CRITICAL / HIGH / MEDIUM / LOW new findings**
- All carry-forwards retain prior status.
- Security surface remains hardened.
