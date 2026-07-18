# Debugger — Cycle 12 Provenance

Review target: `ff6532f4`. Review only.

## Inventory and debugging scope

I inventoried the full maintained repo surface and traced the Cycle 11 changes through their actual runtime branches. For schema work, I followed empty DB initialization, journal baselining, an existing DB at the prior cursor, Drizzle execution, reconcile degradation, and the On This Day consumer. I also checked image fan-out/cleanup, search activation, request guards, restore/queue error handling, and release recovery. Focused Vitest passed 39/39; the green result is part of the reproduction because the failing production branch is absent from those tests.

## Current findings

### DBG-C12-01 — The test and production schema paths fork before migration SQL is reached

- Severity: **High**
- Confidence: **High**
- Status: **Confirmed root cause/control-flow reproduction; executing a deliberately broken migration against MySQL was not performed**
- Regions: `apps/web/scripts/migrate.js:923-937,940-970,1008-1015`; `apps/web/scripts/check-schema-convergence.mjs:82-102`; `apps/web/src/__tests__/migrate-pending-migrations.test.ts:96-111,348-363`; `apps/web/drizzle/0032_capture_date_indexes.sql:1-13`

Root cause: CI begins with no gallery tables, so `prepareLegacyDatabaseIfNeeded` runs reconcile and inserts all migration hashes. `runMigrations` sees the latest hash already represented and does not execute 0032. The convergence command mutates that same reconcile-authored schema and calls reconcile directly. Production begins with gallery tables and a 0031 hash cursor, so the missing 0032 entry is left for Drizzle and its SQL is executed.

Deterministic failure scenario: introduce any MySQL error into the 0032 SQL while leaving reconcile correct. The existing `npm run init`, convergence command, source tripwires, and focused 39-test set remain capable of passing; an existing 0031 database fails on the real DDL. The rejection-propagation unit test is not a substitute because it injects a synthetic function and never parses or runs the migration file.

Suggested fix: create a disposable 0031 DB, record hashes only through 0031, invoke the real migration runner, and assert 0032's hash plus schema equivalence. Add a test-only mutation or fixture that proves the lane goes red when the SQL is invalid, preventing future accidental routing back through bootstrap.

### DBG-C12-02 — Same-named malformed generated columns survive every reconcile

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed root cause by helper trace; live malformed-column reproduction is manual-validation**
- Regions: `apps/web/scripts/migrate.js:268-283,502-506`; `apps/web/scripts/check-schema-convergence.mjs:73-80`; `apps/web/src/lib/data-timeline.ts:117-136`

Root cause: the degradation test drops the columns, which selects the only branch `ensureColumn` can repair. It never replaces their definitions while retaining their names. `ensureColumn` checks only whether `columnInfo` returned a row.

Concrete failure: change `capture_day` to a plain nullable `tinyint`, then run reconcile. It performs no column ALTER, and the On This Day query continues to trust `capture_day` as a database-maintained value. Rows can disappear from the widget with no application error.

Suggested fix: route these fields through `ensureColumnDefinition`, normalize MySQL's generation-expression representation, and test wrong type, plain-vs-generated, wrong expression, and virtual-vs-stored variants.

### DBG-C12-03 — Recovery metadata points at the pre-publication state

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed repository-state bug; deploy completion unknown**
- Regions: `.context/plans/cycle-11-2026-07-18-plan.md:3-5,77-79,109-121`; `.context/plans/README.md:34-44`

`HEAD` and `origin/master` both resolve to signed `ff6532f4`, but the recovery plan says signed publication is pending from start HEAD `7e40e95c`.

Concrete failure: a resumed run diagnoses or republishes from the wrong frontier.

Suggested fix: record the proven remote publication, retain deploy as unknown without independent evidence, and rotate the active plan.

## Negative hypotheses and final missed-issue sweep

I ruled out journal timestamp regression, missing privacy omissions, generated-column null behavior for a correctly defined schema, the new derivative-width cap, and search link activation as causes of the schema issue. Abort/cleanup paths, retry queues, action/route exception handling, and cache invalidation produced no fourth fresh debugger finding.
