# Tracer — Cycle 12 Provenance

Review target: `ff6532f4` (`master` / `origin/master` at review start). Review only; no product code or plan was modified.

## Inventory and causal method

I read `AGENTS.md`, all of `CLAUDE.md`, the active/archive review-plan frontier, and the complete tracked implementation inventory before tracing competing hypotheses across: request authentication/admission to mutation; upload settings to queue/backfill to persisted derivative metadata; schema/journal/reconcile to CI convergence proof; capture-date storage/indexes to public timeline rendering; restore quiescence to post-import migration; delete transactions to durable file cleanup; and signed commit to remote publication. Historical findings were checked against current source and excluded when fixed or already represented by an unfired carry-forward criterion.

Fresh guard/audit validation passed, as did 137 focused tests. No local MySQL server was running, so DB execution-plan measurements are called out rather than inferred as observed latency.

## TRC-C12-01 — the convergence gate compares `reconcileLegacySchema` with itself and is not migration-generic

- Severity: **High (schema-validation infrastructure; no current live-schema drift confirmed)**
- Confidence: **High**
- Status: **Confirmed causal blind spot; actual current/production schema parity requires manual validation**
- Exact regions: fresh bootstrap ownership `apps/web/scripts/migrate.js:917-937`; convergence baseline and hard-coded degradation `apps/web/scripts/check-schema-convergence.mjs:11,28-35,38-102`; source-contract coverage `apps/web/src/__tests__/schema-convergence-gate.test.ts:12-31`; CI ordering `.github/workflows/quality.yml:72-78`.

Trace:

1. CI initializes an empty DB.
2. Empty DB initialization does not execute the migration chain; `prepareLegacyDatabaseIfNeeded()` builds the current schema through `reconcileLegacySchema()` and then baselines every journal hash.
3. The convergence script snapshots that reconcile-produced schema as its truth.
4. `simulateLegacyDrift()` removes only the two generated capture fields and three index shapes from migration 0032.
5. The same `reconcileLegacySchema()` restores those hard-coded artifacts, and the script compares the result with its own earlier output.
6. The latest-tag assertion forces a maintainer to rename `EXPECTED_LATEST_MIGRATION`, but neither it nor the unit test forces the drift scenario or canonical schema expectation to cover that new migration.

Competing hypothesis—“the snapshot is an independent Drizzle/migration contract”—is disproved by the fresh-bootstrap branch at `migrate.js:920-937`: both sides originate from the same reconcile implementation. Competing hypothesis—“pinning the latest tag makes the probe generic”—is disproved by the fixed SQL at `check-schema-convergence.mjs:73-80` and the source-only assertion at `schema-convergence-gate.test.ts:13-16`.

Concrete failure scenario: migration 0033 declares `foo INT NOT NULL DEFAULT 0`, but its reconcile mirror mistakenly creates `foo VARCHAR(255) NULL`. After the expected-tag string is updated, fresh CI init creates the wrong reconcile version, the baseline snapshot records that wrong version, the simulator only damages migration-0032 artifacts, and the second reconcile reproduces the same wrong baseline. The new “convergence” gate passes while migration SQL, Drizzle schema, fresh bootstrap, and upgraded production disagree.

Suggested fix: make the proof independent and migration-generic. Build two disposable schemas—one from the canonical current contract and one upgraded from a prior-release fixture through the committed migration/reconcile paths—and compare structured `information_schema` output. At minimum, key downgrade fixtures by migration tag and fail unless the latest tag has an explicit degradation/upgrade scenario; also compare the reconcile result against a canonical schema snapshot not produced by that same reconcile run.

## TRC-C12-02 — timeline admission is bounded at the photo query but unbounded at the year-list predecessor

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed causal/query-shape defect; row-count latency requires manual validation**
- Exact regions: `apps/web/src/lib/data-timeline.ts:145-165,192-227`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:21,63-96`; indexes `apps/web/src/db/schema.ts:131-138`.

Trace: uncached `/timeline` request → `getTimelineYears()` applies `YEAR()` and `DISTINCT` across every processed capture-date entry → only after that promise resolves can the page choose its default year → `getTimelineImages()` then performs the correctly range-bounded, limit-501 query. An explicit `?year=2025` does not remove the predecessor: the page still awaits the full year scan before starting the already-known year's photo query.

Competing hypothesis—“migration 0032 makes every timeline query sargable”—holds for on-this-day month/day lookup and range-bounded archive rows, but not for the distinct `YEAR(capture_date)` expression. Competing hypothesis—“the result is cached”—is disproved at the route boundary by `revalidate = 0` and the absence of a cache wrapper on `getTimelineYears()`.

Concrete failure scenario: as the gallery grows, timeline TTFB and DB CPU rise with total image count even when the requested year contains only a few photos. Repeated public requests multiply the scan on the documented single-writer database.

Suggested fix: persist/index `capture_year` or maintain a bounded year summary, query it without applying a function to every capture timestamp, and parallelize explicit-year row retrieval with year-list retrieval. Confirm with `EXPLAIN ANALYZE` at representative cardinalities.

## Final missed-issue sweep

I retraced derivative-size production through all three persistence paths and every public consumer (the Cycle 11 maximum-width break is fixed); search result presentation through Next Link request behavior (prefetch suppression is coherent); schema mutation safety (local/disposable/explicit guards are present); auth/restore/cleanup failure paths; and capture-date queries against every current composite index. No third causal break survived competing-hypothesis checks.
