# Cycle 63 Code / Debug / Trace Review

Reviewer: code-quality / logic / debugger / tracer lane
Date: 2026-07-01
Start HEAD: `ecfda466cab14cd6a9ffbe03e6dc7d42023c8e82`

## Context Read

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/plans/cycle-62-2026-07-01-plan.md`
- `.context/plans/cycle-62-2026-07-01-deferred.md`
- `.context/reviews/cycle-62-2026-07-01/_aggregate.md`
- `.context/reviews/cycle-62-2026-07-01/code-debug-trace.md`

## Inventory

Recent changes reviewed from `0bf3371c..ecfda466`:

- Plan/review ledgers: `.context/plans/README.md`, `.context/plans/cycle-61-2026-07-01-plan.md`, `.context/plans/cycle-62-2026-07-01-plan.md`, `.context/plans/cycle-62-2026-07-01-deferred.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-62-2026-07-01/*`.
- Ignore rules: `.gitignore`.
- Source/test changes: `apps/web/src/lib/sql-like.ts`, `apps/web/src/__tests__/cycle-11-source-contracts.test.ts`, `apps/web/src/__tests__/data-tag-names-sql.test.ts`, `apps/web/src/__tests__/semantic-search-route.test.ts`.

Cross-file interactions traced:

- Public keyword search: `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/sql-like.ts`, `apps/web/src/components/search.tsx`.
- Smart-collection LIKE consumers: `apps/web/src/lib/smart-collections.ts`, `apps/web/src/__tests__/smart-collections.test.ts`.
- Semantic-search maintenance ordering: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/__tests__/semantic-search-route.test.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/restore-maintenance.ts`.
- Raw LIKE inventory across `apps/web/src`, `apps/web/scripts`, and `apps/web/drizzle`.

Deferred items checked but not re-raised: `C62-04`, `C61-06`, `C61-07`, `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`.

## Findings

No new correctness, logic, race-condition, state-consistency, maintainability, or recent-cycle regression findings were identified in this lane.

## Evidence

- Cycle 62 scheduled fixes are explicit in the plan: ledger closure, semantic maintenance no-work coverage, and MariaDB-safe LIKE escape (`.context/plans/cycle-62-2026-07-01-plan.md:12`, `.context/plans/cycle-62-2026-07-01-plan.md:13`, `.context/plans/cycle-62-2026-07-01-plan.md:14`).
- Cycle 62 terminal state is recorded as complete, including gates, signed commit, push, deploy, and post-deploy public-search smoke (`.context/plans/cycle-62-2026-07-01-plan.md:47`, `.context/plans/cycle-62-2026-07-01-plan.md:58`, `.context/plans/cycle-62-2026-07-01-plan.md:65`, `.context/plans/cycle-62-2026-07-01-plan.md:67`, `.context/plans/cycle-62-2026-07-01-plan.md:70`, `.context/plans/cycle-62-2026-07-01-plan.md:71`).
- The current aggregate points at Cycle 62 and keeps only `C62-04` plus older carry-forward items deferred (`.context/reviews/_aggregate.md:3`, `.context/reviews/_aggregate.md:12`). The detailed aggregate confirms the prior public-search outage was `ESCAPE '\\'` and schedules the helper change rather than a UI-only fix (`.context/reviews/cycle-62-2026-07-01/_aggregate.md:34`, `.context/reviews/cycle-62-2026-07-01/_aggregate.md:41`).
- The shared LIKE helper now escapes the escape marker plus wildcard characters and emits `ESCAPE '!'`, which avoids the deployed MariaDB parse failure while preserving literal `%` and `_` searches (`apps/web/src/lib/sql-like.ts:5`, `apps/web/src/lib/sql-like.ts:10`).
- All public keyword-search branches use the shared helper: main image/topic fields, tag-name fallback, and topic-alias fallback (`apps/web/src/lib/data.ts:1581`, `apps/web/src/lib/data.ts:1586`, `apps/web/src/lib/data.ts:1621`, `apps/web/src/lib/data.ts:1626`). The public action still validates and rate-limits before calling `searchImages`, and rolls back attempts on search execution failure (`apps/web/src/app/actions/public.ts:237`, `apps/web/src/app/actions/public.ts:255`, `apps/web/src/app/actions/public.ts:306`, `apps/web/src/app/actions/public.ts:308`).
- Smart-collection contains predicates import the same helper for direct text fields and tag subqueries (`apps/web/src/lib/smart-collections.ts:17`, `apps/web/src/lib/smart-collections.ts:222`, `apps/web/src/lib/smart-collections.ts:266`).
- Raw LIKE inventory found no other app-side public search helper bypass. The only remaining raw `LIKE` outside tests/helper consumers is `apps/web/scripts/migrate-capture-date.js:58`, a fixed migration condition for timestamp strings.
- Regression coverage now compiles a Drizzle predicate and asserts both `ESCAPE '!'` and the escaped parameter shape `%100!%!_!!%` (`apps/web/src/__tests__/data-tag-names-sql.test.ts:217`, `apps/web/src/__tests__/data-tag-names-sql.test.ts:229`, `apps/web/src/__tests__/data-tag-names-sql.test.ts:231`).
- Semantic search still returns restore-maintenance `503` before body, limiter, config, or DB work (`apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/semantic/route.ts:113`, `apps/web/src/app/api/search/semantic/route.ts:176`, `apps/web/src/app/api/search/semantic/route.ts:191`, `apps/web/src/app/api/search/semantic/route.ts:270`). The added test asserts no body read, no limiter/rollback, no config, and no DB select on that branch (`apps/web/src/__tests__/semantic-search-route.test.ts:161`, `apps/web/src/__tests__/semantic-search-route.test.ts:174`, `apps/web/src/__tests__/semantic-search-route.test.ts:179`).
- The new deferred Cycle 62 item is correctly scoped as accessibility polish, not a current functional correctness defect (`.context/plans/cycle-62-2026-07-01-deferred.md:7`, `.context/plans/cycle-62-2026-07-01-deferred.md:12`).

## Validation

- `git status --short` was clean before writing this review artifact.
- `git diff --name-status 0bf3371c..ecfda466` showed only review/plan files, `.gitignore`, `apps/web/src/lib/sql-like.ts`, and three focused test files as recent changes.
- `rg -n 'containsLike|escapeLikePattern|\bLIKE\b|\.like\(|\bilike\(|\bESCAPE\b' apps/web/src apps/web/scripts apps/web/drizzle --glob '!**/.next/**'` was used to inventory LIKE surfaces.
- `npm test --workspace=apps/web -- cycle-11-source-contracts data-tag-names-sql semantic-search-route public-actions` passed: 4 files, 62 tests.
- `npm test --workspace=apps/web -- smart-collections search-short-query-guard semantic-search-params semantic-search-rate-limit` passed: 4 files, 64 tests.

## Residual Risks

- Full lint, typecheck, build, full Vitest, deploy, and live public-search smoke were not rerun in this review lane; Cycle 62 plan records those gates as passed for the implementation cycle.
- Deferred items remain deferred with explicit exit criteria. This pass found no new evidence that changes their severity or makes them scheduled now.
