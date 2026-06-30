# Cycle 26 Tracer Report

Date: 2026-06-30
Role: tracer
Scope: Causal tracing of suspicious security/privacy flows across the full repository

## Inventory

- Total files inventoried with `rg --files`: 802
- Reviewed code roots: `apps/web/src/app`, `apps/web/src/lib`, `apps/web/scripts`, `apps/web/nginx`, `apps/web/next.config.ts`
- Reviewed evidence roots: `apps/web/src/__tests__`, `AGENTS.md`, `CLAUDE.md`, `package.json`, `apps/web/package.json`
- Traced priority flows:
  - Browser admin auth and cookie sessions
  - PAT-authenticated Lightroom upload route
  - Public semantic/similar search routes
  - Public OG routes
  - Shared-link lookup and analytics recording
  - Upload original/derivative file lifecycle
  - DB backup/download/restore lifecycle
  - Public PII select paths and map GPS exception
  - Raw SQL, shell child processes, and restore scanner behavior

## Validation Evidence

- Inventory built before review: 802 files.
- Security lint gates passed:
  - `lint:api-auth`
  - `lint:action-origin`
  - `lint:public-route-rate-limit`
- Dependency audit passed: 0 moderate-or-higher vulnerabilities.
- Targeted test set passed: 19 files, 282 tests.
- Manual restore-scanner probe showed cross-schema DDL/DML samples were not flagged by `containsDangerousSql`.
- External MySQL documentation checked for `mysql --one-database`: filtering is based on `USE` statements, not semantic inspection of every object reference.

## Findings

### TRC-26-01 - Medium - Restore containment depends on a CLI filter that still executes qualified cross-schema statements

Confidence: High

Location:
- `apps/web/src/lib/sql-restore-scan.ts:39-105`
- `apps/web/src/lib/sql-restore-scan.ts:113-155`
- `apps/web/src/app/[locale]/admin/db-actions.ts:608-664`

Observed causal chain:
1. `restoreDatabase()` authenticates the admin and enters restore maintenance.
2. `runRestore()` writes the uploaded SQL to a temp file and scans chunks with `containsDangerousSql()`.
3. `containsDangerousSql()` masks comments/literals and checks a denylist of dangerous statement patterns.
4. The denylist blocks many destructive/global operations, but it does not block schema-qualified `CREATE TABLE`, `ALTER TABLE`, `INSERT INTO`, `REPLACE INTO`, or `UPDATE` targets.
5. If the scan passes, `runRestore()` invokes `mysql --one-database DB_NAME`.
6. MySQL's `--one-database` is only a `USE`-state filter. A statement encountered while the default database is `DB_NAME` can still name another schema and execute there if privileges allow.

Competing hypotheses:
- Hypothesis A: `--one-database` fully confines all statements to `DB_NAME`.
  - Rejected. MySQL docs describe it as rudimentary and based on `USE` statements; examples include executed statements naming another database.
- Hypothesis B: The scanner blocks the relevant cross-schema statements before the CLI runs.
  - Rejected. Manual probes showed `INSERT INTO otherdb.audit_log`, `CREATE TABLE otherdb.pwned`, `ALTER TABLE otherdb.pwned`, and `UPDATE otherdb.users` all returned `dangerous:false`.
- Hypothesis C: Least-privilege DB permissions contain the blast radius.
  - Partially accepted as an operational mitigation, not a code guarantee. The code and docs also discuss shared MySQL risk, so the app-level scanner should not rely on deployments never granting wider privileges.

Failure scenario:
A stolen admin session or malicious SQL restore upload runs a file that begins in the app DB context and contains:

```sql
CREATE TABLE otherdb.pwned (id int);
INSERT INTO otherdb.audit_log VALUES (1);
```

The application scanner accepts it, then the MySQL client may execute it because the current default database is still the app database. On overprivileged or co-hosted MySQL servers, this can affect sibling schemas. On least-privilege servers, it still exposes a gap between the stated restore boundary and the scanner's actual grammar.

Concrete fix:
- Convert restore scanning from broad denylist to explicit restore-shape allowlist.
- Reject qualified schema references except `DB_NAME.<APP_BACKUP_TABLE>`.
- Reject unqualified table targets not in `APP_BACKUP_TABLES` for write/DDL statements.
- Add regression tests for cross-schema DDL/DML and unknown app-DB tables.
- Keep `mysql --one-database` as a secondary guard, not the primary containment boundary.

## Traced Non-Findings

- Admin API auth: both admin API routes are wrapped by `withAdminAuth`; cookie path has same-origin enforcement, token path checks required PAT scope.
- Server action CSRF: mutating actions are covered by `requireSameOriginAdmin()` according to the action-origin lint gate.
- Upload path traversal: public derivative serving and original deletion resolve/lstat/realpath under allowlisted roots and reject symlinks.
- PAT upload path: token scope, upload quota preclaim, body-size checks, safe user filename, topic validation, GPS stripping, restore-maintenance recheck, and contract lock are all present.
- Backup download path: filename regex, path containment, file-handle streaming, no-store headers, and audit logging are present.
- Public route rate limiting: public mutating API lint passed; OG/search/share/action analytics paths have in-process or DB-backed budgets appropriate to their flow.
- Session token flow: signed random tokens, hashed DB IDs, token age checks, DB expiry checks, secure cookie settings, and password-change session rotation are present.
- PII leakage: public select surfaces use guarded field sets; map GPS exposure is the explicit topic-visible exception and is covered by tests.

## Final Missed-Issues Sweep

Swept for:
- raw SQL and `db.execute`/`connection.query`
- child process `spawn`/`exec`
- public route response/cache/security headers
- direct sensitive field selections
- file-system read/write/delete/rename paths
- cookies/session/PAT token handling
- restore/backup temp-file and cleanup paths

Only TRC-26-01 remains as a new tracer finding.
