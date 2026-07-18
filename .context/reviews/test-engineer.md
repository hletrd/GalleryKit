# Test Engineer — Cycle 12 Provenance

Review target: `ff6532f4`, 2026-07-18 KST. Review only.

## Inventory and validation map

I inventoried all 372 Vitest files and 16 Playwright files against the 639-file `apps/web/src` surface, 30 scripts, 12 route handlers, 13 server-action modules, and 33 migrations. I mapped the latest schema, image, and search changes to unit, source-tripwire, live-MySQL, and browser coverage, then checked the configured gate ordering and the prior-cycle acceptance claims. Focused Vitest passed 4 files / 39 tests.

## Current findings

### TEST-C12-01 — No executable test upgrades a prior-release database with the real latest SQL

- Severity: **High**
- Confidence: **High**
- Status: **Confirmed coverage gap; current migration text is not claimed broken**
- Regions: CI `.github/workflows/quality.yml:67-79`; probe `apps/web/scripts/check-schema-convergence.mjs:82-102`; routing unit `apps/web/src/__tests__/migrate-pending-migrations.test.ts:96-111,348-363`; source-only gate `apps/web/src/__tests__/schema-convergence-gate.test.ts:12-31`; migration `apps/web/drizzle/0032_capture_date_indexes.sql:1-13`

The source gate checks strings and ordering. The routing test uses a mocked connection and synthetic migration function. The live gate starts from a fresh reconcile-authored database and calls reconcile after degradation. None builds the previous release schema and executes the actual pending migration file through Drizzle.

Concrete counterexample: replace a 0032 statement with invalid SQL while keeping the journal tag and reconcile source intact. Every assertion in `schema-convergence-gate.test.ts` still passes, the live fresh initialization baselines the bad file without running it, and the degradation probe still succeeds. Only an existing-database deploy discovers the failure.

Suggested fix: keep two disposable MySQL databases in the gate. Initialize one at HEAD through fresh bootstrap. Initialize the second with the previous migration set/schema, then run the unmodified production migration entry point against the complete current journal. Assert recorded hashes and compare full snapshots. Add a red-team fixture proving malformed SQL fails this lane.

### TEST-C12-02 — The drift matrix tests absence, not malformed same-named objects

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed coverage gap exposing a confirmed helper limitation**
- Regions: drift setup `apps/web/scripts/check-schema-convergence.mjs:73-80`; column helper `apps/web/scripts/migrate.js:268-283`; index helper `apps/web/scripts/migrate.js:319-344`; snapshot dimensions `apps/web/scripts/check-schema-convergence.mjs:44-53`; latest objects `apps/web/scripts/migrate.js:502-506,753-765`

The probe drops generated columns and changes only index column lists. It never preserves an object name while corrupting generation expression, stored/virtual mode, type, nullability, index visibility, uniqueness, direction, or type. Yet the snapshot explicitly records those attributes, creating false breadth: they are compared after the narrow mutations but never challenged.

Concrete failure: make `capture_month` a plain nullable integer or mark the same-column composite index invisible. The probe has no case for either state, and current helpers accept them by name/column list.

Suggested fix: parameterize degradation cases and run independent restore/idempotence checks for wrong generated expression, plain/generated, virtual/stored, type/nullability, missing index, old column list, and invisible index. Require every material snapshot dimension either to be repairable and tested or explicitly excluded from the convergence promise.

### TEST-C12-03 — On This Day's new database semantics are asserted with source text and a JavaScript imitation

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed test-oracle gap; current query is correct by source inspection**
- Regions: `apps/web/src/__tests__/data-timeline.test.ts:49-89,184-207`; production query `apps/web/src/lib/data-timeline.ts:117-136`; generated schema `apps/web/src/db/schema.ts:40-46`; Cycle 11 acceptance claim `.context/plans/cycle-11-2026-07-18-plan.md:44-48,96-103`

The test asserts that source strings mention `eq(images.capture_month, month)` and then proves cross-year behavior with an unrelated JavaScript `Date` filter. It does not insert MySQL rows, verify generated values, run the Drizzle query, confirm leap-day/null matching, or inspect the query plan. Thus it cannot validate the behavior or the claimed index use.

Concrete failure: the generated expression could compute the wrong value, the query could bind/order incorrectly, or the intended index could be invisible; the source strings and JavaScript imitation still pass.

Suggested fix: in the disposable MySQL lane, insert null, normal cross-year, nonmatching, and February 29 capture dates; call or reproduce the real Drizzle query and verify exact ids/order/limit. Run `EXPLAIN FORMAT=JSON` (with sufficient representative rows if necessary) or at minimum assert the intended usable index definition separately rather than claiming sargability from source text.

## Final missed-issue sweep

I rechecked the real Sharp delivered-width test, search RSC listener timing/activation, security lint tests, privacy symmetry, migration journal/post-condition coverage, browser seed assumptions, and expected CLIP skips. No fourth independent current coverage gap survived deduplication.
