# Debugger — Cycle 13

Review target: `8bd8999f`. Review only.

## Inventory and debugging scope

I read the complete repo instructions and inventoried all 951 maintained files before tracing the latest migration/reconcile/query changes and the broader failure surfaces. The pass followed fresh bootstrap, prior-cursor upgrade, malformed-schema recovery, public timeline and year routes, query-bound construction, privacy projection, auth/restore barriers, upload/delete cleanup, queue shutdown, and operational recovery. I also searched all production source for swallowed exceptions, mutation exemptions, filesystem/process use, timers, and unchecked numeric/range parsing.

## DBG-C13-01 — accepted maximum year deterministically builds an invalid MySQL `DATETIME` bound

- Severity: **Medium**
- Confidence: **High**
- Label: **Confirmed** (live MySQL 8.4 reproduction)
- Exact regions: `apps/web/src/lib/data-timeline.ts:97-107,202-209`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:68-79,93-101`; `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:37-43,82-99`

`archiveRange(9999)` advances the exclusive upper year to `10000` and returns `end: '10000-01-01 00:00:00'`. Both public surfaces admit this input: the timeline accepts every four-digit string, and the year route explicitly accepts integers through 9999. `getTimelineImages()` binds the invalid end value into `capture_date < end`.

Concrete scenario: request `/en/year/9999` or `/en/timeline?year=9999`. A disposable MySQL 8.4 table containing `9999-12-31 23:59:59` reproduced `ERROR 1525 (HY000): Incorrect DATETIME value: '10000-01-01 00:00:00'`; the page query rejects and the public request becomes a server error instead of a valid archive response. The timeline also treats `0000` as valid and constructs year-zero bounds, unlike the year route.

Fix: centralize a single supported-year validator and range builder. Reject year 0 consistently. For year 9999, omit the impossible upper predicate (the type has no later valid value) or use an equivalent closed bound through `9999-12-31 23:59:59.999999`; keep normal years on the existing half-open range. Add route and data-layer boundary tests.

## Final missed-issue sweep

I ruled out new migration cursor/hash skips, incorrect generated-year definitions, reconcile idempotence failures, privacy leakage, explicit-year promise duplication for normal years, and index-definition recovery regressions. Abort, retry, cleanup, shutdown, and restore paths produced no second debugger finding.
