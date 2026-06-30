# Cycle 26 Security Reviewer Report

Date: 2026-06-30
Role: security-reviewer
Scope: Entire repository under `/Users/hletrd/flash-shared/gallery`

## Inventory

- Total files inventoried with `rg --files`: 802
- Top-level distribution: `apps/` 613, `plan/` 180, `docs/` 2, root/config files 7
- Primary app: `apps/web` Next.js 16 / React 19 / TypeScript 6
- API route files reviewed: 8
- Server action/admin DB action files reviewed: 13 action modules plus `apps/web/src/app/[locale]/admin/db-actions.ts`
- High-risk areas reviewed: public routes, admin API wrappers, server actions, auth/session cookies, PAT upload flow, upload path handling, derivative serving, DB backup/restore, rate limits, CSP/security headers, PII/public select fields, analytics writes, raw SQL/child process/file I/O surfaces, tracked secret patterns

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed
- `npm run lint:action-origin --workspace=apps/web`: passed
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed
- `npm audit --workspace=apps/web --audit-level=moderate`: found 0 vulnerabilities
- Targeted Vitest command passed: 19 files, 282 tests
  - Included auth wrapper/origin/rate-limit/privacy/restore/upload path/session/PAT tests.
- Manual proof for finding SEC-26-01:
  - `containsDangerousSql('INSERT INTO otherdb.audit_log VALUES (1);') -> false`
  - `containsDangerousSql('CREATE TABLE otherdb.pwned (id int);') -> false`
  - `containsDangerousSql('ALTER TABLE otherdb.pwned ADD COLUMN x int;') -> false`
  - `containsDangerousSql('UPDATE otherdb.users SET role="admin";') -> false`
- External reference checked: MySQL client `--one-database` docs state statement filtering is rudimentary and based only on `USE` statements; the docs' example says statements can execute even when they name a table in another database.

## Findings

### SEC-26-01 - Medium - Restore scanner permits cross-schema DDL/DML before invoking `mysql --one-database`

Confidence: High

Location:
- `apps/web/src/lib/sql-restore-scan.ts:39-105`
- `apps/web/src/lib/sql-restore-scan.ts:113-155`
- `apps/web/src/app/[locale]/admin/db-actions.ts:608-664`

Failure scenario:
An authenticated admin, compromised admin session, or malicious restore file uploads SQL that does not contain the currently blocked keywords but does target a qualified schema/table, for example:

```sql
CREATE TABLE otherdb.pwned (id int);
INSERT INTO otherdb.audit_log VALUES (1);
ALTER TABLE otherdb.pwned ADD COLUMN x int;
UPDATE otherdb.users SET role='admin';
```

The scanner treats these samples as safe. The restore runner then invokes:

```ts
spawn('mysql', ['--one-database', ...restoreSslArgs, DB_NAME], ...)
```

The MySQL client option is not a content-aware sandbox. Its filtering is based on the current default database selected by `USE`, so statements that occur while the default database is the app DB can still name and affect another schema if the DB account has privileges there. In a least-privilege deployment this may fail at the MySQL privilege layer, but the application-level guard currently assumes more containment than the CLI option provides.

Impact:
Cross-schema writes, table creation/alteration, privilege-adjacent tampering, or disk/metadata DoS are possible on MySQL deployments where the GalleryKit DB user has privileges beyond the single app database. Even when the app DB user is least-privileged, the scanner also accepts non-app table creation inside the app DB, which conflicts with the documented "application backup shape" restore boundary.

Concrete fix:
Make the restore scanner allowlist the app dump grammar instead of only denylisting dangerous keywords.

Recommended minimum:
- Reject any qualified object reference using a schema prefix unless the schema is exactly `DB_NAME` and the table is in `APP_BACKUP_TABLES`.
- Reject `CREATE TABLE`, `ALTER TABLE`, `INSERT INTO`, `REPLACE INTO`, and `UPDATE` when the target table is not in `APP_BACKUP_TABLES`.
- Add tests for cross-schema and unknown-table cases:
  - `CREATE TABLE otherdb.pwned (...)` -> blocked
  - `INSERT INTO otherdb.audit_log VALUES (...)` -> blocked
  - `ALTER TABLE otherdb.pwned ...` -> blocked
  - `UPDATE otherdb.users SET ...` -> blocked
  - `CREATE TABLE unknown_table (...)` -> blocked
  - own `mysqldump` output for every `APP_BACKUP_TABLES` entry -> still allowed
- Keep the operational defense too: document and enforce a DB user with privileges only on `DB_NAME.*`.

## No-New-Findings Evidence For Other Reviewed Surfaces

- Admin API route exports are covered by `withAdminAuth(...)`; lint gate passed for both admin API routes.
- Mutating admin server actions returned early on `requireSameOriginAdmin()`; lint gate passed across scanned action modules.
- Public mutating API routes are rate-limit checked or absent; public route lint gate passed.
- Auth/session review found strong Argon2id hashing, HMAC-signed random session tokens, hashed DB session IDs, production-required `SESSION_SECRET`, `httpOnly`/`secure`/`sameSite=lax` cookies, account/IP login throttles, and password-change session rotation.
- Upload/file handling review found UUID filenames, safe basename storage for user filenames, private original storage, public derivative allowlist, symlink/realpath containment checks, decompression limits, body size caps, upload quota preclaims, and GPS stripping parity across browser and PAT upload paths.
- Backup download review found admin wrapper auth, backup filename validation, realpath containment, file-handle streaming, no-store headers, audit logging, and path traversal resistance.
- PII review found public select helpers excluding known sensitive fields, map-only GPS exposure gated by topic visibility, compile-time privacy guards, and passing privacy tests.
- Public analytics writes are bounded by rate limits, target validation, bot tagging, and no raw IP persistence.
- Secrets sweep found placeholders/documentation and environment variable names, but no committed private key or live token pattern.

## Final Missed-Issues Sweep

Performed after targeted tests:
- Raw SQL and SQL template usage
- Child process execution and CLI env handling
- File read/write/delete/rename/realpath/lstat paths
- Public GET/POST route headers and cache posture
- Admin auth wrappers and token-scope flow
- Cookie/session token flow
- Direct sensitive field selections outside guarded helpers
- Search/OG/share/analytics rate-limit paths

Only SEC-26-01 remains as a new actionable security finding from this pass.
