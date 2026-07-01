# Cycle 84/100 Architect Review

Reviewed HEAD: `023ae28d41ee757caaa408710bd864d88087a40c`.
Date: 2026-07-01.
Role: architect lane.

## Result

Confirmed findings: 1 Medium.

This pass focused on architecture boundaries, schema/migration/reconcile drift, docs/deploy ledger consistency, storage/runtime contracts, privacy guards, and cross-module invariants. I did not edit source code or existing review artifacts.

## Finding

### C84-ARCH-01 - Cycle 83 release ledger remains active and deploy-unclosed after its pushed HEAD

- Severity: Medium.
- Confidence: High.
- Citations:
  - `.context/plans/README.md:5` opens the active plan section, and `.context/plans/README.md:7` still lists the Cycle 83 implementation plan as active.
  - `.context/plans/cycle-83-2026-07-01-plan.md:8` makes deploy part of the Cycle 83 goal, and `.context/plans/cycle-83-2026-07-01-plan.md:40` requires signed commit/pull-rebase/push plus `npm run deploy`.
  - `.context/plans/cycle-83-2026-07-01-plan.md:44` through `.context/plans/cycle-83-2026-07-01-plan.md:50` mark review, implementation, and gates done, but leave commit/push and deploy unchecked.
  - `.context/plans/cycle-83-2026-07-01-plan.md:54` through `.context/plans/cycle-83-2026-07-01-plan.md:62` record gate evidence but no terminal commit/push/deploy evidence.
  - `AGENTS.md:17` and `CLAUDE.md:469` both define per-iteration deploy after every pushed `master` commit.
- Evidence: `git rev-parse HEAD origin/master` returns the same commit, `023ae28d41ee757caaa408710bd864d88087a40c`; `git verify-commit HEAD` reports a good signature. So the commit/push part happened, but the plan ledger does not say so, and no deploy result or explicit deploy-evidence gap is recorded.
- Failure scenario: Cycle 84+ reviewers and operators cannot distinguish "Cycle 83 was pushed and deployed" from "Cycle 83 was pushed but deploy evidence is missing" without redoing release forensics. This is the same ledger ambiguity class Cycle 83 closed for Cycle 82, now shifted to the latest completed cycle.
- Suggested fix: update `.context/plans/cycle-83-2026-07-01-plan.md` to mark commit/pull-rebase/push complete with signed `023ae28d` / `origin/master` evidence, record the `npm run deploy` result or an explicit deploy-evidence gap/supersession note, and move Cycle 83 from active to recent in `.context/plans/README.md`.

## Verified Clean Surfaces

- Schema/migration/reconcile: current migration journal ends at `0028_rate_limit_bucket_start_idx` in `apps/web/drizzle/meta/_journal.json:201` through `apps/web/drizzle/meta/_journal.json:206`, the SQL file creates the matching index at `apps/web/drizzle/0028_rate_limit_bucket_start_idx.sql:1`, the Drizzle schema exposes the same rate-limit index at `apps/web/src/db/schema.ts:214` through `apps/web/src/db/schema.ts:221`, and reconcile creates/ensures it at `apps/web/scripts/migrate.js:524` through `apps/web/scripts/migrate.js:531` plus `apps/web/scripts/migrate.js:682`. The journal integrity tests also pin monotonic `when` values and tag/file parity at `apps/web/src/__tests__/migration-journal.test.ts:75` through `apps/web/src/__tests__/migration-journal.test.ts:107`.
- Privacy guards: `publicSelectFields` still omits sensitive/internal keys at `apps/web/src/lib/data.ts:375` through `apps/web/src/lib/data.ts:404`; the canonical sensitive-key union and compile-time guard live at `apps/web/src/lib/data.ts:473` through `apps/web/src/lib/data.ts:476`; the symmetric fixture pins the admin-public set difference at `apps/web/src/__tests__/privacy-fields.test.ts:86` through `apps/web/src/__tests__/privacy-fields.test.ts:93` and search enrichment at `apps/web/src/__tests__/privacy-fields.test.ts:126` through `apps/web/src/__tests__/privacy-fields.test.ts:130`.
- Restore backup table allowlist: `APP_BACKUP_TABLES` includes the current app table set at `apps/web/src/lib/sql-restore-scan.ts:12` through `apps/web/src/lib/sql-restore-scan.ts:31`, and the test introspects the Drizzle schema to fail on future omissions at `apps/web/src/__tests__/sql-restore-scan.test.ts:163` through `apps/web/src/__tests__/sql-restore-scan.test.ts:190`.
- Storage/runtime contract: `CLAUDE.md:149` says `@/lib/storage` is not yet integrated; the quarantine test explains the hazard at `apps/web/src/__tests__/storage-quarantine.test.ts:4` through `apps/web/src/__tests__/storage-quarantine.test.ts:15` and enforces no imports outside the storage module at `apps/web/src/__tests__/storage-quarantine.test.ts:111` through `apps/web/src/__tests__/storage-quarantine.test.ts:132`.
- Deploy storage safety: Docker persists the three mutable stores and `site-config.json` through bind mounts at `apps/web/docker-compose.yml:24` through `apps/web/docker-compose.yml:28`; deploy runs compose before pruning at `apps/web/deploy.sh:55` and prunes only after health success at `apps/web/deploy.sh:99` through `apps/web/deploy.sh:104`, matching the `AGENTS.md:19` / `CLAUDE.md:477` safety contract.

## Deferred Not Re-Raised

- `C80-06`: `site-config.json` runtime/build-time contract remains deferred; no operator-contract decision is visible in the current delta.
- `C77-ARCH-01`: restore maintenance foreground admin mutation barrier remains deferred; no exit criterion evidence was found.
- `C76-04`, `C76-05`, `C75-08`, plus historical performance, semantic-search, settings re-encode, shared-view, and browser-matrix items remain carry-forward deferred items unless their recorded exit criteria are hit.
