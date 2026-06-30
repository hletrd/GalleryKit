# Cycle 27 Verifier Review

Role: verifier
Workspace: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `50dfcda0895c2af563836a71d656fbf9ae2048c9`
Date: 2026-06-30

## Inventory And Evidence

Instructions read first:

- `AGENTS.md`
- `CLAUDE.md`
- code-review skill instructions at `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Review-relevant inventory built before findings:

- Repo instruction/docs and current review aggregation: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, `.context/reviews/verifier.md`.
- Current post-cycle implementation diff from cycle-26 start: restore recovery, restore SQL scanner, modal isolation, OG/share behavior tests, deployment docs/tests.
- Production/runtime contracts: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/scripts/entrypoint.sh`, `apps/web/package.json`.
- Restore lifecycle surfaces: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/scripts/restore-maintenance-recovery.ts`, `apps/web/src/instrumentation.ts`.
- Restore SQL scanner and tests: `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/__tests__/sql-restore-scan.test.ts`.
- Schema/migration invariants: `apps/web/src/db/schema.ts`, `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/0026_analytics_top_view_indexes.sql`, `apps/web/drizzle/0027_analytics_retention_indexes.sql`, `apps/web/scripts/migrate.js`.
- Security gates and CI: `.github/workflows/quality.yml`, custom auth/origin/public-route scanner scripts, package scripts.

Validation run during this review:

- `npm run lint --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Targeted Vitest passed: `restore-maintenance.test.ts`, `sql-restore-scan.test.ts`, `cycle-26-source-contracts.test.ts`, `deploy-script-contract.test.ts` (4 files, 41 tests).
- Local scanner probes confirmed `containsDangerousSql()` returns `false` for `INSERT LOW_PRIORITY INTO otherdb.images ...`, `INSERT DELAYED INTO otherdb.images ...`, `INSERT HIGH_PRIORITY INTO otherdb.images ...`, `INSERT INTO images SELECT * FROM otherdb.images`, and `CREATE TABLE images AS SELECT * FROM otherdb.images`.
- External syntax check: MySQL 8.4 official documentation confirms `INSERT` accepts priority modifiers before `INTO` and supports `INSERT ... SELECT`; MySQL docs for `--one-database` describe default-database filtering, not a semantic sandbox for every statement form.

## Confirmed Issues

### V27-HIGH-01 - Restore-maintenance recovery command does not recover the running production app

Severity: High
Confidence: High

Evidence:

- `CLAUDE.md:401` documents `npm run restore:maintenance --workspace=apps/web -- clear --confirm-clear-restore-maintenance` as the recovery path and says not to remove the marker manually because the script "also resets process-local maintenance state when run in the app runtime."
- `apps/web/package.json:20` implements that command with `tsx scripts/restore-maintenance-recovery.ts`.
- `apps/web/package.json:83` keeps `tsx` in `devDependencies`.
- `apps/web/Dockerfile:122-125` copies only `drizzle`, `migrate.js`, `mysql-connection-options.js`, and `entrypoint.sh` into the production runner; it does not copy `scripts/restore-maintenance-recovery.ts` or the source tree needed by that TypeScript script.
- `apps/web/Dockerfile:127-129` copies the `prod-deps` `node_modules` tree into the runner, so dev-only `tsx` is not part of the production runtime contract.
- `apps/web/scripts/restore-maintenance-recovery.ts:40` clears maintenance by calling `clearDurableRestoreMaintenanceForRecovery()` in the script's own Node process.
- `apps/web/src/lib/restore-maintenance.ts:1-26` stores the active flag on the current process's `globalThis`; a separate CLI process cannot mutate the already-running Next server process.
- `apps/web/src/instrumentation.ts:1-4` syncs the durable marker only at startup. There is no marker watcher or IPC path that would clear the active flag in a running process after the external script removes the marker.
- `apps/web/src/app/[locale]/admin/db-actions.ts:693`, `apps/web/src/app/[locale]/admin/db-actions.ts:729-730`, and `apps/web/src/app/[locale]/admin/db-actions.ts:744` keep restore maintenance active after failed import or post-restore migration.

Failure scenario:

An operator uploads a bad SQL dump. `restoreDatabase()` marks restore maintenance active, the import or post-restore migration fails, and the app intentionally keeps maintenance active. The operator follows `CLAUDE.md:401`. In the shipped production container the command is unavailable because the runner lacks `tsx` and the TypeScript script. If the operator instead runs the command from a host checkout or sidecar that mounts the marker path, it removes the marker only in that separate process; the running web process still has `globalThis[gallerykit.restoreMaintenance].active = true`, so login/uploads/admin mutations remain blocked until the web process restarts or another in-process recovery path clears the flag.

Suggested fix:

Make the recovery path match the production contract. Either ship a compiled JS recovery CLI in the runner and document that it must be followed by a container restart, or add a narrow authenticated/in-process recovery endpoint/action that verifies the stale marker condition and calls `endDurableRestoreMaintenance()` inside the running app. Update `CLAUDE.md` to remove the claim that an external script resets the running process-local state unless the implementation actually does that.

### V27-MED-01 - Restore SQL scanner still permits cross-schema access through valid INSERT/SELECT forms

Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/lib/sql-restore-scan.ts:40-55` extracts write targets with a regex that recognizes `INSERT` only as `INSERT\s+(?:IGNORE\s+)?INTO`. It misses valid MySQL forms with priority modifiers before `INTO`: `INSERT LOW_PRIORITY INTO`, `INSERT DELAYED INTO`, and `INSERT HIGH_PRIORITY INTO`.
- `apps/web/src/lib/sql-restore-scan.ts:190-207` rejects schema-qualified or unknown write targets only when `SQL_WRITE_TARGET_PATTERN` matches.
- `apps/web/src/lib/sql-restore-scan.ts:212-221` then falls back to generic denylist patterns that do not reject the missed `INSERT <priority> INTO otherdb.table` forms.
- `apps/web/src/__tests__/sql-restore-scan.test.ts:53-67` covers basic schema-qualified write targets but not priority-modified `INSERT`.
- `apps/web/src/__tests__/sql-restore-scan.test.ts:83-96` allows `CREATE TABLE` and `INSERT` to known app tables, but there is no assertion that `INSERT ... SELECT ... FROM otherdb.table` or `CREATE TABLE app_table AS SELECT ... FROM otherdb.table` is rejected.
- `apps/web/src/app/[locale]/admin/db-actions.ts:623-647` relies on `containsDangerousSql(combined)` as the pre-import SQL safety gate.
- `apps/web/src/app/[locale]/admin/db-actions.ts:672-675` still invokes `mysql --one-database DB_NAME`; that option is not a replacement for the scanner's promised target/source allowlist.

Confirmed local probes:

```text
containsDangerousSql('INSERT LOW_PRIORITY INTO otherdb.images VALUES (1);') === false
containsDangerousSql('INSERT DELAYED INTO otherdb.images VALUES (1);') === false
containsDangerousSql('INSERT HIGH_PRIORITY INTO otherdb.images VALUES (1);') === false
containsDangerousSql('INSERT INTO images SELECT * FROM otherdb.images;') === false
containsDangerousSql('CREATE TABLE images AS SELECT * FROM otherdb.images;') === false
```

Failure scenario:

On an overprivileged or co-hosted MySQL server, a crafted restore file passes the scanner but references a sibling schema. Priority-modified `INSERT` can write directly to `otherdb.images`. `INSERT INTO images SELECT ... FROM otherdb.users` or `CREATE TABLE images AS SELECT ... FROM otherdb.images` can read sibling data into the GalleryKit schema, where it may later be exposed through admin or public gallery surfaces. This reopens the cross-schema class that the cycle-26 scanner change intended to close.

Suggested fix:

Replace the syntax-narrow target regex with a statement-shape allowlist for the app's own `mysqldump` output. At minimum, extend `SQL_WRITE_TARGET_PATTERN` for all MySQL `INSERT` modifiers and reject schema-qualified identifiers anywhere in executable restore statements, including SELECT sources and `CREATE TABLE ... AS SELECT`. Add regression tests for `INSERT LOW_PRIORITY|DELAYED|HIGH_PRIORITY INTO otherdb...`, `INSERT INTO app_table SELECT ... FROM otherdb...`, and `CREATE TABLE app_table AS SELECT ... FROM otherdb...`.

## Likely Issues

None beyond the confirmed issues above. The other inspected post-cycle fixes matched their stated source contracts, or the remaining concerns are already recorded in prior aggregate/deferred review items.

## Risks Needing Manual Validation

- The blast radius of V27-MED-01 depends on the deployed MySQL user's privileges. If the production DB user is limited strictly to the GalleryKit schema, the scanner bypass is contained; if it has sibling-schema privileges, the failure scenario is actionable.
- The operational recovery path for V27-HIGH-01 should be validated against the actual deployed image and host runbook. The repository contract currently proves the command is not in the runner image and cannot mutate a separate running process.

## Final Sweep Confirmation

I re-scanned docs, review history, package scripts, CI gates, deployment scripts, Docker image contents, restore lifecycle code, restore SQL scanner/tests, modal isolation wiring, schema/migration/journal/reconcile mirrors, and the custom security scanners. I avoided duplicating known permanently deferred policy items and prior aggregate findings unless the current tree claimed a fix and still had a concrete mismatch.

Files/categories reviewed:

- Docs and policy: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/reviews/_aggregate.md`.
- Runtime/deploy: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/scripts/entrypoint.sh`, `scripts/deploy-remote.sh`.
- Restore and maintenance: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/scripts/restore-maintenance-recovery.ts`, `apps/web/src/instrumentation.ts`.
- SQL restore safety: `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/__tests__/sql-restore-scan.test.ts`.
- Schema/migrations: `apps/web/src/db/schema.ts`, `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/0026_analytics_top_view_indexes.sql`, `apps/web/drizzle/0027_analytics_retention_indexes.sql`, `apps/web/scripts/migrate.js`.
- Security gates/tests: API auth scanner, action origin scanner, public route rate-limit scanner, targeted Vitest contracts, lint, and typecheck.
