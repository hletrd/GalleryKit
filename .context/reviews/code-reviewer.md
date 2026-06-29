# Code Reviewer — review-plan-fix cycle 2

**Date:** 2026-06-29
**HEAD:** `3d1387045e0d7f1e06fb48756e412228bbdaf08d` (`master`, clean at review start)
**Role:** code-reviewer
**Scope:** repository-wide code quality, logic, maintainability, failure-mode, and regression review. No application code edited.

## Inventory Coverage

Inventory was built before review from `git status`, `git log`, package/config reads, source-tree enumeration, test/script/migration enumeration, and current `.context` review/plan docs.

Review-relevant inventory covered:

- Instructions/context: `AGENTS.md`, `CLAUDE.md`, current top-level `.context/reviews/{code-reviewer,debugger,architect,test-engineer}.md`, latest `run9-cycle8` review artifacts, `run10-cycle2` plan/deferred docs, and `user-injected/pending-next-cycle.md`.
- Package/config/deploy: root `package.json`, `apps/web/package.json`, `.nvmrc`, `.github/workflows/quality.yml`, `next.config.ts`, TS/ESLint/Vitest/Playwright configs, Dockerfile, compose, nginx, deploy scripts, root `.dockerignore`, app `.dockerignore`, env examples.
- Runtime source inventory: all `apps/web/src` families: 73 app files, 55 component files, 93 lib files, 3 DB files, 1 i18n file, and 5 other source files.
- Guardrail/test inventory: 247 test files under `apps/web/src/__tests__`, e2e files under `apps/web/e2e`, 27 scripts, and all 25 SQL migrations plus drizzle metadata.
- Current behavior spot-checks: admin API wrappers, action-origin guards, public route rate limits, privacy field projections, upload/serve paths, semantic search routes, image queue/backfill paths, migration journal/runbook, raw SQL/process execution, and recent commits after prior review artifacts.

Targeted validation run:

```text
npm test --workspace=apps/web -- similar-route semantic-search-route image-types-shutter pagination nginx-config
7 files passed, 57 tests passed
```

## Confirmed Issues

### CQ-01 — `.claude/` is gitignored but not dockerignored, so local agent worktrees enter the Docker build context

**Severity:** Medium
**Confidence:** High
**Status:** Confirmed
**Location:** `.gitignore:30`, `.dockerignore:1-22`, `apps/web/docker-compose.yml:4-6`, `apps/web/Dockerfile:67-75`

The repository correctly treats `.claude/` as local, untracked agent/runtime state in `.gitignore:30`, but the root Docker ignore file does not exclude it. The production compose build uses the repository root as the Docker context (`apps/web/docker-compose.yml:4-6`), and the builder stage copies that whole context with `COPY . .` (`apps/web/Dockerfile:67-75`). In this checkout `.claude/` exists and is about 36 MiB, including a nested worktree.

Concrete failure scenario: a normal `npm run deploy` / compose build sends `.claude/` to Docker and copies it into the builder layer. That makes builds slower and less reproducible, and it can expose local agent artifacts, logs, or worktree files to build cache/layer inspection even though Git intentionally excludes them. The existing `apps/web/.dockerignore` is not sufficient for this build, because Docker reads the ignore file from the root context, not from the Dockerfile directory.

Suggested fix: add `.claude` / `.claude/` to the root `.dockerignore`. Consider adding a small source-contract test that local-agent directories ignored in `.gitignore` (`.claude/`, `.omc`, `.omx/`, `.agent/`) remain excluded from the root Docker context.

## Refuted / Current Non-Findings

- The prior semantic similar-search limiter issue is fixed. Current `apps/web/src/app/api/search/similar/[id]/route.ts:115-153` no longer rolls back after target DB lookup or scan failures, and `similar-route` tests passed.
- The prior shutter-speed `1/Infinity` issue is fixed by `Number.isFinite(denominator)` in `apps/web/src/lib/image-types.ts:121-127`, and `image-types-shutter` tests passed.
- The prior admin-dashboard `parseInt('1e3')` issue is fixed through `parsePageParam()` at `apps/web/src/lib/pagination.ts:12-16`, and `pagination` tests passed.
- The root Docker context is covered by a root `.dockerignore`; the issue is specifically the missing `.claude/` entry, not an absent root ignore file.
- Migration journal non-monotonicity remains historical and documented; current `migrate.js` hash post-conditions and migration tests cover the known Drizzle skip behavior. I did not re-file it as a current defect.

## Risks / Maintainability Notes

- Large-file risk remains real in `apps/web/src/lib/process-image.ts` (1725 lines), `apps/web/src/lib/data.ts` (1728 lines), and `apps/web/src/app/actions/images.ts` (1205 lines). This is a maintainability risk, but not a newly confirmed behavioral failure in this pass.
- `OnThisDayWidget` and timeline month grouping still use server-local `Date` methods (`components/on-this-day-widget.tsx:15-17`, `app/[locale]/(public)/timeline/page.tsx:67-70`, `lib/data-timeline.ts:237-242`). I did not file this as confirmed because the product has not specified viewer-local versus server-local calendar semantics, and MySQL `DATETIME` values are intentionally timezone-less.

## Final Sweep

Final missed-issue sweep covered: public/admin route handlers, server-action guards, rate-limit rollback placement, privacy projections, raw SQL and process execution, Docker/deploy context, cache headers, migration journal state, recent commits since prior review artifacts, parse/number/date edge cases, and high-churn large modules.

Verdict: **1 confirmed Medium code-quality/deploy hygiene issue; no confirmed runtime logic regression found in current HEAD.**
