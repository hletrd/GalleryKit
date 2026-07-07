# Review-Plan-Fix Cycle 18 Code Review

Role lane: code-reviewer
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Write scope: `.context/reviews/code-reviewer.md`

## Scope

Read first, per repo policy:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/plans/cycle-17-2026-07-08-plan.md`
- `.context/plans/cycle-17-2026-07-08-deferred.md`

Inventory built with `rg --files` / `find` before findings:

- 619 TypeScript/TSX/JS/MJS files under `apps/web/src`.
- 80 app route/action/page files, 114 library modules, 61 components.
- 357 unit-test files, 12 e2e files, 28 scripts, 33 Drizzle migration/meta files.
- 443 live review files across API routes, server actions, libraries, components, scripts, public assets, e2e, and migrations.

I reviewed the current implementation rather than relying on stale reports: auth/session/PAT wrappers, server-action origin guards, public route rate-limit contracts, upload and Lightroom ingest, backup/restore, image queue and restore fences, smart collections, sharing, analytics recording, public selectors/privacy guards, Drizzle schema/migration reconciliation, generated service worker parity, deploy scripts, and selected tests that lock current contracts.

## Validation Evidence

Static guard checks run:

- `npm run lint:api-auth --workspace=apps/web` - PASS.
- `npm run lint:action-origin --workspace=apps/web` - PASS.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - PASS.

Additional evidence:

- `apps/web/public/sw.template.js` and `apps/web/public/sw.js` differ only by `SW_VERSION`, confirming generated service-worker parity.
- Current backup/restore code no longer matches the stale cycle-17 connection-acquisition finding: `dumpDatabase()` catches setup/acquisition failures inside its structured result path, and `restoreDatabase()` catches `connection.getConnection()` failures before lock setup.
- Existing untracked `.context/reviews/cycle-8-2026-07-07/perf-reviewer.md` was not touched.

Not run: full ESLint, typecheck, build, Vitest, Playwright, live DB restore, browser manual QA, or production profiling. This lane is a read-only code review plus report write.

## Findings Summary

- Confirmed issues: 0
- Likely issues: 0
- Manual-validation risks: 0

## Confirmed Issues

No new code-review findings.

Evidence: the high-risk correctness surfaces I checked have current guards and cleanup paths in place:

- Admin API exports are wrapped by `withAdminAuth(...)`.
- Mutating server actions are covered by same-origin guard lint, including DB backup/restore and PAT/token actions.
- Public mutating or expensive routes/actions have rate-limit coverage or explicit audited exemptions.
- Upload/LR upload paths settle quota claims on validation, DB, restore-maintenance, and post-save failures.
- Smart collection predicates validate column/operator/value shape before compilation and public collection pages fail closed on missing/private/invalid query rows.
- Public image-serving paths use containment checks and no-store/admin bypasses; generated service-worker source is in sync with its template apart from the stamped version.
- Schema/migration reconciliation mirrors the currently reviewed table/column/index state for the checked active surfaces.

## Likely Issues

None found.

## Manual-Validation Risks

None specific to the code-review lane beyond the validation gap noted above. The performance lane carries forward current runtime-capacity risks with line evidence in `.context/reviews/perf-reviewer.md`.
