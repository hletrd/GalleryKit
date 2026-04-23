# Security Reviewer - Cycle 13 (current run, 2026-04-23)

Note: Earlier cycle-13 file `security-reviewer-cycle13-historical-2026-04-19.md` is preserved for provenance; its findings (SEC-13-01 validated-fallback, SEC-13-02 storageBackend cast) were implemented in plan-122 C13-02.

Scope: full-repo authentication, authorization, rate-limiting, path traversal, CSRF/same-origin, PII exposure, DB/SQL safety, file serving, argument injection, secret handling.

## Findings

No new CRITICAL, HIGH, MEDIUM, or LOW findings.

### Hot-path re-verification (unchanged since cycle 12)

1. **Argon2id password hashing** (`apps/web/src/app/actions/auth.ts:136`, `apps/web/src/app/actions/admin-users.ts:136`). Dummy-hash branch equalizes user-exists vs missing timing.
2. **HMAC-SHA256 session tokens** (`apps/web/src/lib/session.ts:82-145`) with constant-time `timingSafeEqual`; tokens hashed before DB storage.
3. **`SESSION_SECRET` env enforcement in production** (`session.ts:30-36`): production throws rather than fall back to DB-stored secret.
4. **IP + account-scoped login rate limiting** (`auth.ts:96-141`): pre-increment before Argon2 verify; account-scoped bucket keyed by SHA-256 of normalized username (prefix `acct:`).
5. **Same-origin enforcement** on every mutating server action via `requireSameOriginAdmin()` (`action-guards.ts:37-44`) + `hasTrustedSameOrigin()` with default fail-closed semantics (C1R-01). Also enforced at build time via `lint:action-origin` (18 actions).
6. **Path traversal defense layered**: `SAFE_SEGMENT` regex, `ALLOWED_UPLOAD_DIRS` whitelist, `resolvedPath.startsWith()` containment, `lstat()` symlink rejection.
7. **Decompression-bomb mitigation** via Sharp `limitInputPixels`.
8. **Bounded Map + LRU eviction** on every in-memory rate-limit Map.
9. **CSV formula-injection defense** (`csv-escape.ts`): strips zero-width chars, prefixes `=`, `+`, `-`, `@`, `\t`, `\r`, collapses CRLF.
10. **PII guards compile-time enforced** via `_privacyGuard`; GPS / `filename_original` / `user_filename` excluded from public selects.
11. **SQL restore scanner** (`sql-restore-scan.ts`) blocks all dangerous DDL/DML including `GRANT`, `REVOKE`, `CREATE DATABASE`, `CALL`, prepared statements, etc.
12. **MySQL advisory locks** scoped to DB server; `RELEASE_LOCK` catches are logged not swallowed.
13. **Upload tracker TOCTOU** closed via pre-registration on first insert (C8R-RPL-02).
14. **`mysqldump` / `mysql` spawn** uses arg arrays (no shell), minimal env, `MYSQL_PWD` via env not CLI flag, backup file mode `0o600`.
15. **`dangerouslySetInnerHTML`** limited to JSON-LD script tags, all wrapped in `safeJsonLd()`.

### Gate status

- `lint:action-origin`: 18/18 mutating server actions enforce same-origin.
- `lint:api-auth`: `/api/admin/db/download` properly guarded.
- `vitest` privacy-fields test: asserts `adminSelectFieldKeys \ publicSelectFieldKeys == sensitive keys`.

## Confidence: High

No new security action items. Convergence holds across cycles 12 and 13.
