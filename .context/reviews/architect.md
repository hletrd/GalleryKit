# Architect — Cycle 12 Provenance

Review target: `ff6532f4`. Review only.

## Inventory and architecture sweep

I inventoried the complete maintained source, test, script, migration, configuration, and operational surface (3,698 tracked files; 631 maintained TS/TSX/JS source files under `apps/web/src`; 30 scripts; 16 Playwright files; 33 migrations) after reading `AGENTS.md`, `CLAUDE.md`, the active plan/deferred pair, aggregate, and carry-forward register. The architecture sweep traced schema authority and lifetime across Drizzle declarations, historical SQL, reconcile/bootstrap, pending upgrades, CI, runtime queries, and deployment, then rechecked persistence, privacy, cache, single-writer, restore, and image-delivery boundaries.

## Current findings

### ARCH-C12-01 — Schema correctness has two write authorities but CI exercises only one

- Severity: **High**
- Confidence: **High**
- Status: **Confirmed architecture/validation split; no malformed current production schema claimed**
- Regions: fresh/bootstrap authority `apps/web/scripts/migrate.js:923-937`; upgrade authority `apps/web/scripts/migrate.js:948-970,1008-1015`; probe `apps/web/scripts/check-schema-convergence.mjs:82-102`; migration `apps/web/drizzle/0032_capture_date_indexes.sql:1-13`; CI `.github/workflows/quality.yml:67-79`

Fresh databases are authored by `reconcileLegacySchema` and then baseline all SQL hashes. Existing current installations are authored by pending migration SQL. The new gate bootstraps and degrades the reconcile-authored database, so its reference snapshot and repair operation share the same authority. It does not establish equivalence with the SQL-authored upgrade state.

Concrete failure: reconcile and 0032 can be internally consistent but mutually different, or 0032 can be unexecutable. CI still compares reconcile output with earlier reconcile output and passes. An existing installation then either fails the deploy or reaches a schema different from a fresh installation.

Suggested fix: model schema convergence as a differential invariant: database A = fresh reconcile/bootstrap; database B = exact prior release plus real pending SQL. Compare full structured snapshots A and B, then run reconcile on both and prove idempotence. A self-comparison of A is useful recovery coverage but cannot be the sole convergence oracle.

### ARCH-C12-02 — Reconcile's new structural abstraction is narrower than the schema contract

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed design defect; live drift occurrence is manual-validation**
- Regions: column helpers `apps/web/scripts/migrate.js:268-283`; index helpers `apps/web/scripts/migrate.js:319-344`; latest use sites `apps/web/scripts/migrate.js:502-506,753-765`; rich snapshot fields `apps/web/scripts/check-schema-convergence.mjs:44-53`

The schema snapshot knows column generation expressions, nullability, types, index visibility, uniqueness, direction, prefix, and type. The reconciliation helpers used for 0032 compare only column existence and index column-name order. Thus the observer is richer than the repair contract, and many detected structural dimensions have no repair operation.

Concrete failure: `capture_month` exists as a normal integer, or `idx_images_processed_capture_month_day` has the correct columns but is invisible. Reconcile reports no relevant change. The query either returns stale/empty results or loses the intended index plan, despite the architecture claiming exact current-schema convergence.

Suggested fix: define canonical column/index descriptors and make reconcile compare every material field it promises to converge. At minimum, generated-column definitions need type/nullability/extra/expression checks and the three 0032 indexes need visibility/non-unique/index-type/direction checks. Use the same normalized descriptors in the differential test.

### ARCH-C12-03 — Release-state ownership still ends before terminal publication

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed workflow architecture drift; deployment fact manual-validation**
- Regions: `.context/plans/cycle-11-2026-07-18-plan.md:5,77-79,109-121`; `.context/plans/README.md:34-44`; remote HEAD `ff6532f4`

The plan is necessarily committed before its own final push, but no post-push authority updates its terminal state. The repository therefore again records a signed remote cycle as pending.

Concrete failure: recovery tooling chooses a stale frontier or repeats terminal work.

Suggested fix: establish one post-publication status artifact owned by the orchestrator or next-cycle bootstrap, with signed push and deploy recorded as separate facts. Never infer deployment from remote equality.

## Final missed-issue sweep

I rechecked DB/file dual writes, advisory-lock and process-local topology, restore fences, cache/runtime configuration lifetime, privacy projections, source-selection ownership, and migration removal policy. Existing broad risks remain in the carry-forward register; no fourth fresh architecture issue survived deduplication.
