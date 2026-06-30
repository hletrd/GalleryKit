# Cycle 36 Architect / Document Review

Date: 2026-06-30 KST
Reviewed HEAD: `bdfb38a1`
Lane: architecture, deploy/docs drift, migration/reconcile contracts, schema privacy rules, operational runbooks, design boundary risks

## Inventory First

- Architecture/runbook sources: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Deploy/runtime: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/src/__tests__/deploy-script-contract.test.ts`.
- Migration/reconcile/schema: `apps/web/src/db/schema.ts`, `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/*.sql`, `apps/web/scripts/migrate.js`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`, `apps/web/src/__tests__/migration-journal*.test.ts`.
- Privacy/schema boundary: `apps/web/src/lib/data.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/lib/search-enrichment-fields.ts`.
- Operational runbooks: restore/backup flow in `apps/web/src/app/[locale]/admin/db-actions.ts`, restore marker helpers, CLIP semantic-search config/docs, upload/proxy limits.
- Historical duplicate control: checked `.context/reviews/_aggregate.md`, run-9 cycle-8 architect/document artifacts, and cycle 35 plan/deferred files. I did not re-raise the Cycle 35 scanner/serve-upload findings or older deferred polish items.

## Findings

### C36-ARCH-01 - `reconcileLegacySchema` does not repair the admin-token owner FK

Severity: High
Confidence: High
Area: migration/reconcile contract, admin-token authorization boundary

Evidence:

- `apps/web/src/db/schema.ts:200-203` declares `admin_tokens.user_id -> admin_users.id` with `ON DELETE CASCADE`.
- `apps/web/scripts/migrate.js:565-577` only includes `admin_tokens_user_fk` inside `CREATE TABLE IF NOT EXISTS admin_tokens`.
- `apps/web/scripts/migrate.js:684-692` explicitly repairs older FKs with `ensureForeignKey(...)`, but omits `admin_tokens_user_fk` and the newer FK-only-in-create constraints.
- `apps/web/src/app/actions/admin-users.ts:251-267` deletes sessions and audit links, then deletes the admin row; it relies on the DB cascade to remove that user's PAT rows.
- `apps/web/src/lib/admin-tokens.ts:146-151` verifies a PAT by selecting only from `admin_tokens`; `apps/web/src/lib/admin-tokens.ts:162-166` returns the row's `user_id` without confirming the owner admin still exists.
- `apps/web/src/lib/api-auth.ts:72-85` accepts a valid scoped PAT before same-origin/cookie checks.
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-17` and `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:107-122` cover tables/columns/indexes, not FK repair.

Failure scenario:

A legacy or manually repaired DB has the `admin_tokens` table and indexes but is missing `admin_tokens_user_fk`. On deploy, `reconcileLegacySchema` runs, but `CREATE TABLE IF NOT EXISTS admin_tokens` no-ops and the FK is never added. Later, an admin deletes another admin account. The token rows do not cascade, and `verifyToken()` still authenticates any surviving PAT because it trusts the token row alone. Today the LR upload path may later fail at `images.uploaded_by` if that FK is intact, but the request has already authenticated as a deleted admin; future `lr:read` / `lr:delete` scoped routes would be exposed more directly.

Fix:

Add an explicit reconcile repair:

- `ensureForeignKey(connection, dbName, 'admin_tokens', 'admin_tokens_user_fk', 'ALTER TABLE admin_tokens ADD CONSTRAINT admin_tokens_user_fk FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE')`.
- Consider adding the same explicit repair for `image_views`, `topic_views`, `shared_group_views`, and `image_embeddings` FKs so `CREATE TABLE IF NOT EXISTS` is not the only repair path for newer tables.
- Add a migration/reconcile FK coverage test that fails when a schema or SQL FK name is present only in a `CREATE TABLE IF NOT EXISTS` body.
- Add defense in depth in live code: either delete `admin_tokens` rows inside the `deleteAdminUser` transaction before deleting `admin_users`, or make `verifyToken()` join `admin_users` so orphaned token rows fail closed even if the FK is missing.

## Verified Green / Not Re-Raised

- Deploy/docs contract: remote deploy target remains config-driven; deploy waits for `gallerykit-web` health before Docker prune; automatic `docker volume prune` still omits `-a`; persistence docs match bind mounts.
- Migration journal: `_journal.json` remains sequential with the documented idx 6 -> 7 historical inversion and globally monotonic entries from idx 18 onward.
- Privacy fields: `PrivacySensitiveKeys`, public omissions, map guard, and `SENSITIVE_KEYS` remain aligned at 20 sensitive fields.
- Restore runbook: restore holds DB/upload/backfill locks, enters durable maintenance, runs post-restore migrations before success, and provides the documented recovery command.
- Product/design boundary: no current evidence of reintroduced paid downloads, public S3/MinIO switching, or edit/culling/scoring product surfaces beyond historical migration comments and expected metadata editing.

## Validation Evidence

- `npm test --workspace=apps/web -- --run src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/admin-tokens.test.ts src/__tests__/admin-user-delete-audit-detach.test.ts`
- Result: 4 files passed, 107 tests passed.
