# Cycle 78 Test/Verifier Review

HEAD reviewed: `9286bef1`.

## Inventory

- Repo guidance: `AGENTS.md`, `CLAUDE.md`, Cycle 77 aggregate/plan/deferred artifacts.
- Test surface: 303 Vitest test files, 5 Playwright spec files.
- Focused validation run passed in delegated lane: 7 files, 230 tests.
- Custom lint scripts passed in delegated lane: `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`.

## Findings

### C78-TV-01 - Cycle 77 verification ledger still reads active and undeployed

- Severity: Medium
- Confidence: High
- Citations: `AGENTS.md:17`, `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/cycle-77-2026-07-01-plan.md:49`, `.context/plans/cycle-77-2026-07-01-plan.md:50`, `.context/plans/cycle-77-2026-07-01-plan.md:54`
- Problem: deploy is per-iteration policy after pushing to `master`, but the Cycle 77 plan still has commit/push and deploy unchecked, while the plans index still lists Cycle 77 as active. Gate evidence stops at local tests/build and does not record deploy outcome.
- Failure scenario: later review lanes treat Cycle 77 as still active or assume deployment happened without evidence; production may lag current `master` with no ledger signal.
- Suggested fix: update the Cycle 77 plan/index with terminal commit/push/deploy evidence, or explicitly record deploy not run/blocker. Move Cycle 77 out of “Active Current-Cycle Plans” after closure.

### C78-TV-02 - Public-route rate-limit scanner false-positives on marker text in strings/comments

- Severity: Low
- Confidence: High
- Citations: `apps/web/scripts/check-public-route-rate-limit.ts:60`, `apps/web/scripts/check-public-route-rate-limit.ts:621`, `apps/web/scripts/check-public-route-rate-limit.ts:623`, `apps/web/scripts/check-public-route-rate-limit.ts:901`
- Problem: `bodyContainsExpensiveGetWork()` calls `body.getText()` and checks raw substring markers like `ImageResponse`, `getImage`, and `sharp`. That includes string literals and comments, so cheap GET handlers can be classified as expensive.
- Evidence: synthetic scanner check for `export async function GET(){ const note = 'ImageResponse is not used here'; ... }` produced `MISSING RATE LIMIT`.
- Failure scenario: a cheap operational route with a doc string/comment mentioning a marker fails CI or gets a spurious `@public-no-rate-limit-required` exemption.
- Suggested fix: make the marker fallback AST-aware or strip comments/strings before marker fallback. Add fixtures for marker text inside string and comment.

### C78-TV-03 - Sidecar timestamp regression lock is source-count brittle

- Severity: Low
- Confidence: High
- Citations: `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:193`, `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:206`, `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:207`, `apps/web/scripts/backfill-color-pipeline.ts:467`, `apps/web/scripts/backfill-color-pipeline.ts:485`
- Problem: the Cycle 77 sidecar freshness test counts raw occurrences of `updated_at = CURRENT_TIMESTAMP` across the whole script and only requires at least two. It is not anchored to the two `flushBatch` UPDATE templates.
- Failure scenario: a future edit removes the timestamp from one update branch while another unrelated occurrence or comment preserves the count; stale OG validator regressions pass tests.
- Suggested fix: assert the full-success and derivative-only `flushBatch` SQL templates each contain the timestamp assignment.
