# Code Reviewer — Cycle 13

Review target: `8bd8999f` (`master == origin/master`), 2026-07-18 KST. Review only; no implementation or plan changes.

## Inventory and method

I read `AGENTS.md`, all 780 lines of `CLAUDE.md`, the current Cycle 12 plan/deferred pair, the current aggregate, and the consolidated historical registers before inventorying the maintained repository. The inventory covered 3,705 tracked files; 722 implementation/test/migration files under `apps/web/src`, `apps/web/scripts`, `apps/web/e2e`, and `apps/web/drizzle`; 631 maintained TS/TSX/JS source files; 372 Vitest files; 81 App Router files; 116 libraries; 61 components; 13 server-action modules; 12 route handlers; 30 scripts; 34 SQL migrations; and deployment/build configuration. Cross-file tracing covered request validation, public/private projections, uploads and derivative persistence, restore/mutation fencing, background work, migration/bootstrap/upgrade convergence, caches, public archive queries, and release provenance.

Current lint, API-auth lint, action-origin/mutation-barrier lint, public-route-rate-limit lint, typecheck, and production dependency audit all passed. Three focused archive/schema test files passed 25/25. A disposable MySQL 8.4 instance was used only to validate the date-range boundary and was removed afterward.

## Findings

### CR-C13-01 — Accepted year 9999 produces an out-of-range MySQL bound and a public 500

- Severity: **Medium**
- Confidence: **High**
- Label: **Confirmed**
- Exact regions: `apps/web/src/lib/data-timeline.ts:97-107,202-209`; `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:37-43,82-99`; `apps/web/src/app/[locale]/(public)/year/[year]/layout.tsx:18-23`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:68-79,93-101`

Both year-in-review guards explicitly accept `9999`, and the timeline query accepts any four digits. `archiveRange(9999)` then emits `end = '10000-01-01 00:00:00'`, which is outside MySQL `DATETIME`'s supported domain. The page passes that string to `lt(images.capture_date, end)`.

Concrete scenario: request `/en/year/9999` or `/en/timeline?year=9999`. The arithmetic guard accepts it, the data query binds the exclusive year-10000 upper bound, and MySQL 8.4 in the repository's strict SQL mode returns `ERROR 1525 (HY000): Incorrect DATETIME value: '10000-01-01 00:00:00'`; the public route becomes a 500 instead of an empty archive or valid year-9999 page. The same SQL predicate was executed against MySQL 8.4 to confirm the failure.

Fix: give archive parsing one shared domain-aware validator and make `archiveRange` total over that accepted domain. Either reject years that cannot use a next-year exclusive bound, or special-case 9999 with a valid inclusive maximum / generated-year predicate. Apply the same parser to the route segment and query-string surfaces, and add route/helper tests for 0000, 0001, 9998, and 9999.

### CR-C13-02 — Cycle 12's source publication is still recorded as pending

- Severity: **Low**
- Confidence: **High**
- Label: **Confirmed for signed push; deployment remains manual-validation**
- Exact regions: `.context/plans/cycle-12-2026-07-18-plan.md:3-5,76-78,101-114`; `.context/plans/README.md:34-48`

The active plan says publication/deploy is pending and leaves “Signed commits pushed” unchecked. Git shows all four Cycle 12 commits from `0c49d53b` through `8bd8999f` with good GPG signatures and `HEAD == origin/master == 8bd8999f`.

Concrete scenario: a recovery agent treats the active plan as the terminal ledger and repeats publication or starts from the old `ff6532f4` frontier. Git does not prove a deploy, so only the signature/push half is stale.

Fix: reconcile the signed/pushed facts from Git, keep deploy explicitly unknown unless independent evidence exists, archive Cycle 12 under the repository's release-ledger convention, and advance the active index.

## Final missed-issue sweep

I rechecked public route identifiers, timeline/date semantics, schema journal monotonicity, real-upgrade fixture cleanup, generated-column/index parity, public privacy omissions, action/route enforcement, derivative-width propagation, restore and delete lifecycles, cache/runtime configuration boundaries, and current deferred findings. No third current code-review issue survived source tracing and historical deduplication.
