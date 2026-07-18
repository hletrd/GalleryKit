# Code Reviewer — Cycle 12 Provenance

Review target: `ff6532f4` (`master == origin/master`), 2026-07-18 KST. Review only; no product or plan edits.

## Inventory and validation

I read `AGENTS.md`, all 779 lines of `CLAUDE.md`, the active Cycle 11 plan/deferred pair, the aggregate and historical carry-forward records, then inventoried the full maintained implementation surface before tracing the Cycle 11 changes. The inventory contained 3,698 tracked files; 639 files under `apps/web/src` (631 TS/TSX/JS), including 372 Vitest files, 81 App Router files, 116 library files, and 61 component files; 30 scripts; 16 Playwright files; 12 route handlers; 13 server-action modules; and 33 SQL migrations plus journal/reconcile/build/deploy configuration. The cross-file sweep covered request/action admission, DB/file lifecycles, restore/queue fencing, privacy projections, migration/bootstrap/upgrade paths, generated-column query ownership, image derivative persistence, responsive delivery, and current release state.

Focused validation passed 4 files / 39 tests: schema-convergence gate, pending-migration routing, timeline data, and real Sharp orientation/delivered-width coverage. Those green tests are relevant evidence for the gaps below: they do not execute the latest SQL upgrade path or perturb structural attributes beyond column names.

## Current findings

### CR-C12-01 — The new live schema gate never executes migration 0032's production upgrade path

- Severity: **High**
- Confidence: **High**
- Status: **Confirmed validation defect; current 0032 SQL appears correct by inspection; live existing-DB upgrade remains manual-validation**
- Regions: `apps/web/scripts/migrate.js:923-937,940-970,1008-1032`; `apps/web/scripts/check-schema-convergence.mjs:82-102`; `apps/web/drizzle/0032_capture_date_indexes.sql:1-13`; `.github/workflows/quality.yml:67-79`; `apps/web/src/__tests__/migrate-pending-migrations.test.ts:96-111,348-363`

The CI job initializes an empty database. The empty-database branch creates the current schema through `reconcileLegacySchema`, baselines every journal hash, and makes Drizzle migration a no-op. The convergence script then drops selected artifacts and invokes `reconcileLegacySchema` again. In contrast, a real gallery at the 0031 cursor takes the pending-tail branch and executes `0032_capture_date_indexes.sql`. No live test creates that 0031 state and runs the SQL.

Concrete failure: a syntax error, invalid `DROP INDEX`, wrong statement order, or MySQL-version incompatibility in 0032 can leave both CI phases green because neither phase evaluates that file. Production upgrade reaches the pending-tail path, executes the bad statement, and fails after earlier MySQL DDL has auto-committed. The unit test only proves that a supplied `migrateFn` rejection propagates; it never supplies the real 0032 SQL to MySQL.

Suggested fix: add a second disposable database/fixture at the exact 0031 journal cursor and 0031 schema, run the real `runMigrations`/Drizzle path through 0032, and compare its resulting `INFORMATION_SCHEMA` snapshot with a separately bootstrapped current database. Keep the existing reconcile degradation/idempotence lane; the two lanes prove different authorities.

### CR-C12-02 — Latest generated columns are repaired by name, not by definition

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed reconciliation defect; occurrence on a live database is manual-validation**
- Regions: `apps/web/scripts/migrate.js:268-283,502-506`; `apps/web/src/db/schema.ts:40-46`; query consumer `apps/web/src/lib/data-timeline.ts:117-136`; drift simulation `apps/web/scripts/check-schema-convergence.mjs:73-80`

`ensureColumn` returns success whenever a column name exists. The new `capture_month` and `capture_day` calls therefore do not verify unsigned `tinyint`, stored generation, or the `MONTH(capture_date)` / `DAY(capture_date)` expressions, even though `ensureColumnDefinition` already exists for structural convergence.

Concrete failure: a legacy or manually repaired database contains ordinary nullable integer columns named `capture_month` and `capture_day`. Reconcile accepts them, creates the new composite index, and the deploy reports success. Existing and newly updated rows can retain null/stale values, so the On This Day widget silently omits matching photos while the source query and index names look correct.

Suggested fix: use definition-aware reconciliation for both generated columns, checking `COLUMN_TYPE`, `IS_NULLABLE`, `EXTRA`, and normalized `GENERATION_EXPRESSION`; replace a mismatched definition with explicit `MODIFY COLUMN ... GENERATED ALWAYS ... STORED`. Extend the destructive probe to mutate the definitions without removing the names.

### CR-C12-03 — Cycle 11 remains recorded as unpublished after signed remote publication

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed repository-state mismatch; deployed SHA/status remains manual-validation**
- Regions: `.context/plans/cycle-11-2026-07-18-plan.md:3-5,77-79,109-121`; `.context/plans/README.md:34-44`; commits `2c96191d` through `ff6532f4`

The active plan says publication is in progress and leaves signed push unchecked, while Git proves good signatures for the Cycle 11 commits and `HEAD == origin/master == ff6532f4`.

Concrete failure: a recovery agent follows the authoritative active plan and repeats publication work or starts from `7e40e95c`. Deploy completion cannot be inferred from Git, so that checkbox must remain evidence-qualified rather than guessed.

Suggested fix: reconcile the signed/pushed facts, preserve deploy as unknown unless the orchestrator supplies evidence, archive Cycle 11, and advance the active index. Introduce a terminal post-push record so each next cycle does not have to repair the previous cycle's state.

## Final missed-issue sweep

I rechecked the latest process-image validation and cleanup paths, search navigation behavior, migration journal monotonicity, privacy omissions, route/action guards, schema query ordering, and historical duplicate findings. No fourth current code-review finding survived source tracing and historical deduplication.
