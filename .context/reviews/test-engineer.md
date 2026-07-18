# Test Engineer — Cycle 13

Review target: `8bd8999f`. Review only.

## Inventory and validation map

I inventoried 366 Vitest files and 14 Playwright TypeScript files against 631 source `.ts`/`.tsx` files, 30 scripts, 12 route handlers, 13 action modules, and 34 migrations. I mapped the latest schema/timeline changes to unit, source-contract, disposable-MySQL, and browser coverage, then ran the security guardrails, typecheck, dependency audit, and 145 focused tests. All passed.

## TEST-C13-01 — archive boundary tests omit both admitted endpoint years

- Severity: **Medium**
- Confidence: **High**
- Label: **Confirmed coverage gap exposing a confirmed runtime defect**
- Exact regions: production range `apps/web/src/lib/data-timeline.ts:97-107`; admitted route values `apps/web/src/app/[locale]/(public)/timeline/page.tsx:74-79` and `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:37-43,82-86`; tests `apps/web/src/__tests__/data-timeline-behavior.test.ts:59-91`; Playwright status test `apps/web/e2e/not-found-status.spec.ts:35-44`

The pure range suite covers only 2025 and validates December rollover without challenging the maximum `DATETIME` year. The browser suite checks an invalid nonnumeric year but not `0000` or `9999`. Direct execution proves `archiveRange(9999)` returns `10000-01-01`, and MySQL 8.4 rejects that literal.

Concrete scenario: all configured tests stay green while `/year/9999` and `/timeline?year=9999` fail in production; `/timeline?year=0000` also follows a validation contract different from `/year/0000`.

Fix: add table-driven pure tests for 0, 1, 9998, and 9999; behavior tests for the maximum-year query predicate; and HTTP/E2E assertions that both public surfaces share the same valid/invalid-year contract.

## TEST-C13-02 — the live schema gate never executes or explains the new distinct-year query

- Severity: **Medium**
- Confidence: **High**
- Label: **Confirmed coverage gap; production latency requires manual validation**
- Exact regions: production query `apps/web/src/lib/data-timeline.ts:150-166`; source-only test `apps/web/src/__tests__/data-timeline.test.ts:100-106`; live schema semantics `apps/web/scripts/check-schema-convergence.mjs:185-224`; source gate `apps/web/src/__tests__/schema-convergence-gate.test.ts:24-38`

The new live lane proves `capture_year` generation and explains only the month/day query. The year-discovery acceptance test merely searches source strings. It therefore missed that `capture_date IS NOT NULL` prevents the `(processed, capture_year)` index from covering the real query. MySQL 8.4 reproduced `used_key_parts: ['processed']` and no `using_index`; the equivalent `capture_year IS NOT NULL` query used both parts and was index-only.

Concrete scenario: migration, schema snapshot, source tests, and live date semantics all pass while the performance-critical public query retains avoidable base-row reads at full gallery cardinality.

Fix: run the actual distinct-year SQL/compiled query in the disposable database, seed duplicate years plus nulls, assert exact results, and validate plan key parts/covering access. Keep plan assertions tolerant of harmless cost/row-estimate variation.

## Final missed-issue sweep

The final matrix rechecked real pending SQL execution, migration hashes, malformed generated/index recovery, idempotence, leap-day/null/order semantics, privacy symmetry, action/API scanners, upload/delete failure tests, restore cleanup, timer shutdown, and browser route coverage. No third test finding survived.
