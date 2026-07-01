# Cycle 64 Code / Debug / Trace Review

Reviewer: code/debug/tracer lane
Date: 2026-07-01
Start HEAD: `efdbaf9a4971e8c59051fe422c8b44d6e9dd455f`

## Inventory

Current HEAD is the Cycle 63 docs closeout commit. The runtime source change under review is `254a68c2`, with `efdbaf9a` only updating plan ledger docs.

Reviewed context:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/plans/cycle-63-2026-07-01-plan.md`
- `.context/plans/cycle-63-2026-07-01-deferred.md`
- `.context/reviews/cycle-63-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-63-2026-07-01/code-debug-trace.md`

Recent runtime/test files reviewed:

- `apps/web/src/components/search.tsx`
- `apps/web/src/__tests__/search-status-source.test.ts`
- `apps/web/src/__tests__/search-stale-response.test.ts`
- `apps/web/src/__tests__/search-disclaimer.test.ts`
- `apps/web/src/__tests__/search-semantic-toggle-source.test.ts`
- `apps/web/src/__tests__/search-short-query-guard.test.ts`
- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx`
- `apps/web/src/__tests__/analytics-link-touch-targets.test.ts`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`
- `apps/web/src/__tests__/sw-template-contract.test.ts`

## Findings

### C64-CDT-01 - Search mode reset leaves stale active result selection

- Severity/confidence: Low / High.
- File/line: `apps/web/src/components/search.tsx:152`, `apps/web/src/components/search.tsx:162`, `apps/web/src/components/search.tsx:282`, `apps/web/src/components/search.tsx:440`, `apps/web/src/components/search.tsx:456`, `apps/web/src/components/search.tsx:495`, `apps/web/src/components/search.tsx:532`.
- Evidence: `clearSearchState()` clears request ownership, abort state, loading, results, status, and `settledQuery`, but it does not reset `activeIndex` or clear `resultRefs`. The semantic toggle handler calls that reset before changing modes, and the query/mode effect then runs a fresh search. `performSearch()` clears `resultRefs.current` at search start but does not reset `activeIndex`. Rendered results still apply stale selection state through `aria-activedescendant`, `aria-selected`, and Enter activation when `activeIndex >= 0`. The query-change path correctly resets `activeIndex`, but the semantic-mode reset path does not.
- Failure scenario: a visitor searches, arrows to result 4, toggles semantic search, and waits for the new result set. Result 4 in the new mode can render/announce as selected even though the visitor has not navigated the new list; pressing Enter from the input can activate that stale positional selection.
- Fix direction: make `clearSearchState()` reset `activeIndex` to `-1` and clear `resultRefs.current`, then pin it with a source-contract test beside the semantic toggle search ownership test.

## Validation Commands Run

- `git status --short` - clean.
- `git rev-parse HEAD` - `efdbaf9a4971e8c59051fe422c8b44d6e9dd455f`.
- `git diff --name-status ecfda466..efdbaf9a` - inventoried Cycle 63 source/test/doc files.
- `git diff --check` - pass.
- `npm test --workspace=apps/web -- search-status-source search-stale-response search-disclaimer search-semantic-toggle-source search-short-query-guard analytics-link-touch-targets sw-template-contract` - pass: 7 files, 40 tests.
- `npm run typecheck --workspace=apps/web` - pass.
- `npm run lint --workspace=apps/web` - pass.
- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.

## Residual Risks

- Full `npm run build`, full `npm test`, and Playwright e2e were not rerun in this review lane.
- Search review remains mostly source-contract based. Browser/screen-reader runtime timing for live-region announcements was not exercised here.
