# Cycle 10 Code Review

Date: 2026-07-07  
Persona: code-reviewer  
Repository: `/Users/hletrd/flash-shared/gallery`

## Scope And Inventory

Built a repository inventory before review, excluding generated/cache directories such as `node_modules`, `.next`, coverage output, and `.claude/worktrees`.

- Inventory total: 909 non-generated files
- Extension mix: 529 `ts`, 111 `tsx`, 189 `md`, 30 `sql`, 13 `json`, 7 `mjs`, 6 `js`, plus static assets/config
- Main source areas inspected: `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`
- Documentation inspected: project `AGENTS.md` instructions from the prompt, `CLAUDE.md`, prior `.context/reviews/` and `.context/plans/` context

## Findings

No reportable findings.

I did not find a code-quality, logic, SOLID, maintainability, cross-file behavior, or edge-case defect that met the bar for a finding. The highest-risk areas reviewed have explicit guardrails and current verification coverage: admin action origin checks, admin API auth wrapping, public route rate limiting, upload quota/processing settlement, private original serving, privacy-sensitive field omission, semantic search gating, DB restore/mutation barriers, migration baselining, and queue/backfill concurrency.

## Evidence

- File inventory built first with `rg --files`; 909 non-generated files were in scope.
- Reviewed route inventory for all 12 route handlers, including admin DB download, Lightroom upload, upload serving, feeds, OG images, health/live, and semantic/similar search.
- Reviewed mutating server actions in `auth.ts`, `images.ts`, `topics.ts`, `tags.ts`, `settings.ts`, `seo.ts`, `sharing.ts`, `admin-users.ts`, `lr-tokens.ts`, `collections.ts`, `embeddings.ts`, and admin DB actions.
- Reviewed cross-file contracts in `api-auth.ts`, `action-guards.ts`, `request-origin.ts`, `proxy.ts`, `serve-upload.ts`, `rate-limit.ts`, `data.ts`, `smart-collections.ts`, `image-queue.ts`, `process-image.ts`, `migrate.js`, and Drizzle journal metadata.
- Final missed-issues sweep checked TODO/suppression/cast markers, DB write surfaces, migration journal monotonicity handling, and high-risk async queue/analytics/rate-limit paths.

Validation run:

- `npm run lint --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- `npm test --workspace=apps/web` passed: 343 test files passed, 2 skipped; 3163 tests passed, 4 skipped.
- `npm run build --workspace=apps/web` passed. During static generation, the sitemap builder logged `ECONNREFUSED 127.0.0.1:3306` and used its homepage-only fallback, then the build completed successfully.

## Residual Risk

- I did not run Playwright e2e because this review did not identify a browser-flow-specific defect requiring e2e reproduction.
- The build was run without a local MySQL server, so DB-backed static sitemap data was not exercised beyond the existing fallback path.
- This was a review-only pass; no source edits were made.
