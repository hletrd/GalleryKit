# Cycle 74 Code Reviewer Review

## Inventory

Examined read-only:

- Cycle 73 baseline: `.context/reviews/cycle-73-2026-07-01/_aggregate.md`, `code-reviewer.md`, plan/deferred artifacts.
- Latest patch at `92924220`: per-photo OG route, `data.ts`, feed conditional tests, OG fallback tests.
- Feed routes: `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`.
- Restore/backfill overlap paths: `db-actions.ts`, `restore-maintenance-durable.ts`, `admin-backfill-runner.ts`, `process-image.ts`, `backfill-color-pipeline.ts`.
- Validation run by reviewer: `npm test --workspace=apps/web -- --run src/__tests__/feed-conditional.test.ts src/__tests__/feed-sized-derivative.test.ts src/__tests__/og-route-rate-limit-behavior.test.ts` passed: 3 files, 37 tests.

## Findings

### C74-01 - Dead If-Modified-Since feed helper and comments contradict the ETag-only route contract

- Severity: Low.
- Confidence: High.
- File/line: `apps/web/src/lib/feed-conditional.ts:1`, `apps/web/src/app/feed.xml/route.ts:141`, `apps/web/src/app/feed.xml/route.ts:152`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:159`, `apps/web/src/__tests__/feed-sized-derivative.test.ts:68`.
- Problem: Cycle 73 intentionally moved feed 304 behavior to content-derived ETags and source-locks that the feed routes do not use `isFeedNotModified`. The helper and comments still describe If-Modified-Since behavior the routes no longer implement.
- Failure scenario: a maintainer follows the helper/comment trail and reintroduces IMS short-circuiting, recreating stale-settings feed 304 behavior. IMS-only clients also receive 200 responses despite comments implying conditional support.
- Suggested fix: keep the ETag-only contract, rewrite/deprecate the helper comments, update route comments, and add route tests proving IMS-only requests stay 200.

## Non-Findings

- Cycle 73 OG pending-row fix is wired correctly in the route.
- Restore/backfill overlap remains lock-fenced.
- Sidecar write-boundary behavior coverage remains the existing deferred `C73-05`, not a new source defect.
