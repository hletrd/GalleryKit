# Cycle 75 Correctness/Data-Flow Review

Scope: feed routes, OG routes, data helpers, image queue/backfill/delete paths, restore maintenance, migration/reconcile contracts, public sharing/search routes.

## Findings

### C75-06 - Empty Atom feeds churn content ETags

- Severity: Low
- Confidence: High
- Citations: `apps/web/src/app/feed.xml/route.ts:108`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:118`
- Problem: empty root and topic feeds derive `feedUpdated` from `new Date().toISOString()`. Because that value is rendered into the XML, the content-derived ETag changes on every request.
- Failure scenario: a newly installed or empty topic feed never returns 304 for `If-None-Match`; every RSS/client revalidation receives a 200 with different XML even though no gallery state changed.
- Suggested fix: use a stable empty-feed timestamp and add route tests proving two empty-feed requests share an ETag and a conditional request returns 304.

## Inventory

Reviewed `CLAUDE.md`, recent plan/review ledgers, `apps/web/src/lib/data.ts`, queue/backfill/delete paths, restore/maintenance locks, migration journal/reconcile files, feed/OG/search routes, public/sharing actions, and feed conditional/source-contract tests.
