# Verifier Review — Cycle 13

Review target: `8bd8999f`. Review only.

## Verification coverage

I read the full repository instructions and current plan/review history, inventoried all maintained implementation and test surfaces, and sampled every route/action/schema/script boundary before tracing the Cycle 12 schema and timeline changes end to end. The maintained inventory contains 631 TS/TSX/JS source files, 372 Vitest files, 13 Playwright specs, 30 scripts, and 34 migrations.

Current evidence: ESLint, API-auth lint, action-origin/mutation-barrier lint, public-route-rate-limit lint, app/script typecheck, and production audit all pass; the audit reports zero vulnerabilities. Focused `data-timeline`, `data-timeline-behavior`, and `schema-convergence-gate` tests pass 25/25. All Cycle 12 commits are GPG-good and local/remote master both resolve to `8bd8999f`.

## Findings

### VER-C13-01 — Archive upper-bound behavior fails on the exact accepted maximum year

- Severity: **Medium**
- Confidence: **High**
- Label: **Confirmed by source trace and manual MySQL validation**
- Exact regions: `apps/web/src/app/[locale]/(public)/year/[year]/layout.tsx:18-23`; `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:37-43,82-99`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:68-79`; `apps/web/src/lib/data-timeline.ts:97-107,202-209`; missing boundary coverage `apps/web/src/__tests__/data-timeline-behavior.test.ts:59-91`

Verified good: normal-year ranges, December rollover, generated year/month/day columns, latest migration fixture enforcement, real pending-upgrade execution, and strict query/action gates are all represented in source/tests.

Verified failure: both archive pages admit year 9999, while the common helper constructs `[9999-01-01, 10000-01-01)`. Executing the same comparison on MySQL 8.4 with the repository's strict mode returned `ERROR 1525 (HY000)` for the upper literal. The focused tests remain green because their only whole-year case is 2025.

Concrete scenario: `/en/year/9999` and `/en/timeline?year=9999` pass application validation, invoke `getTimelineImages(9999)`, and fail at the DB instead of returning a stable public response.

Fix: centralize the archive-year domain, make the top-year query representable without an out-of-domain exclusive sentinel, and prove the real routes/helper at both edges in MySQL-backed coverage.

### VER-C13-02 — Cycle 12 is remotely published but its plan still denies that fact

- Severity: **Low**
- Confidence: **High**
- Label: **Confirmed publication mismatch; deployment manual-validation**
- Exact regions: `.context/plans/cycle-12-2026-07-18-plan.md:3-5,101-114`; `.context/plans/README.md:34-48`

Verified evidence: `git log --format='%G?' ff6532f4..HEAD` reports `G` for all four commits and `git rev-parse HEAD origin/master` returns `8bd8999f` twice. The progress list still leaves signed push unchecked. I found no independent production SHA/deploy transcript for Cycle 12.

Concrete scenario: release recovery repeats a completed push or treats `ff6532f4` as current.

Fix: record signed publication complete, retain deploy as unknown, then advance/archive the ledger according to the repository convention.

## Final verification sweep

I revalidated guard discovery, privacy compile/runtime fixtures, migration journal ordering and hashes, generated definitions, timeline ordering, restore/file cleanup fences, upload configuration snapshots, responsive derivative descriptors, service-worker/cache policy, and known deferred risks. No additional verifier finding survived confirmation.
