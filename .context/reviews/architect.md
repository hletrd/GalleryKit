# Architect Review — Cycle 13

Review target: `8bd8999f`. Review only.

## Inventory and architecture sweep

I read the full architecture/operations runbook and current plan history, then inventoried the complete maintained system: 3,705 tracked files; 631 TS/TSX/JS source files; 81 App Router files; 116 libraries; 61 components; 30 scripts; 34 migrations; 372 unit-test files; 13 Playwright specs; plus build, CI, Docker, nginx, and deploy assets. The cross-file sweep traced authority and lifetime across route validation, data access, schema/migration/reconcile paths, DB/file transactions, restore and background coordination, privacy projections, cache/runtime configuration, and release-state ownership.

## Findings

### ARCH-C13-01 — Archive year policy and archive range representation have incompatible domains

- Severity: **Medium**
- Confidence: **High**
- Label: **Confirmed architecture defect**
- Exact regions: route-segment policy `apps/web/src/app/[locale]/(public)/year/[year]/layout.tsx:18-23` and `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:37-43,82-99`; query-string policy `apps/web/src/app/[locale]/(public)/timeline/page.tsx:68-79`; range authority `apps/web/src/lib/data-timeline.ts:97-107,202-209`; schema domain `apps/web/src/db/schema.ts:42-47`

Three layers independently define the archive year contract. The route-segment layer declares 1..9999 valid; the timeline layer declares any four digits valid (including 0000); and the data layer models every year as a half-open interval ending at January 1 of `year + 1`. MySQL `DATETIME` cannot represent that end for 9999. The abstraction is therefore partial over the domain its callers promise.

Concrete scenario: a legitimate maximum `capture_date` can be stored in the schema, and `/year/9999` is explicitly valid, but querying that year requires the invalid sentinel `10000-01-01`; MySQL 8.4 rejects it and the public page fails. `/timeline?year=0000` exposes the opposite policy mismatch.

Fix: establish one domain object/parser used by both route forms and the data function. Make range construction return a discriminated top-year form (for example `gte(start)` plus `lte(DATETIME_MAX)`) or query the stored `capture_year` when appropriate; never encode an unrepresentable sentinel. Put the domain boundary in one unit and one live-DB contract test.

### ARCH-C13-02 — Terminal release state still has no owner after the plan commit

- Severity: **Low**
- Confidence: **High**
- Label: **Confirmed workflow architecture drift; deployment manual-validation**
- Exact regions: `.context/plans/cycle-12-2026-07-18-plan.md:3-5,101-114`; `.context/plans/README.md:34-48`; remote frontier `8bd8999f`

The plan must be committed before its own final push, but no post-publication actor owns updating it. Consequently the authoritative active plan again says signed push is pending after the signed commits are on `origin/master`.

Concrete scenario: a resumed cycle chooses an obsolete source frontier or repeats publication. A remote Git ref still cannot establish deployment, so combining push and deploy into one terminal status invites either stale source facts or invented host facts.

Fix: add a separate post-publication ledger event owned by the orchestrator or the next-cycle bootstrap, with independently evidenced `signed`, `pushed`, and `deployed` fields. Reconcile Cycle 12's first two facts and preserve deployment as unknown absent host evidence.

## Final missed-issue sweep

I rechecked single-writer assumptions, pooled advisory-lock release, restore-generation fencing, pending cleanup durability, DB/file dual writes, migration and reconcile authorities, background pool budgets, privacy selection ownership, static/runtime cache boundaries, derivative URL truthfulness, and the consolidated deferred architecture register. No third fresh architectural issue survived deduplication.
