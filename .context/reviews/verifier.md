# Cycle 6 - Verifier Lane Report

Date: 2026-07-07
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `423fa6c1f599` (`docs(plans): close cycle-5 deploy recovery ledger`)
Mode: verifier, read-only source review. The only intended write is this artifact.

## Inventory

I inventoried the review surface before checking claims, per `.context/reviews/prompts/verifier.md:1-5` and `.context/reviews/prompts/common_review_scope.md:1-14`.

Primary docs and invariants examined:
- `AGENTS.md:17-38` - deploy, migration, privacy, and gate policy.
- `CLAUDE.md:140-161`, `CLAUDE.md:190-238`, `CLAUDE.md:652-670`, `CLAUDE.md:699+` - security architecture, PAT contract, page/rate-limit notes, lint gates, deploy notes.

Route/auth/action guards examined:
- `apps/web/scripts/check-api-auth.ts:1-208` and `apps/web/src/__tests__/check-api-auth.test.ts:14-178`.
- `apps/web/scripts/check-action-origin.ts:1-1180` and `apps/web/src/__tests__/check-action-origin.test.ts:27-542`.
- `apps/web/scripts/check-public-route-rate-limit.ts:1-998` and `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:6-1268`.
- `apps/web/src/lib/api-auth.ts:58-144`, `apps/web/src/lib/request-origin.ts:45-109`, `apps/web/src/lib/action-guards.ts:37-44`.
- Current route/action inventory from the lint gates: 2 admin API routes, 10 public route files, all files under `apps/web/src/app/actions/`, plus `apps/web/src/app/[locale]/admin/db-actions.ts` and `apps/web/src/app/actions.ts`.

Privacy and migration surfaces examined:
- `apps/web/src/lib/data.ts:251-430`, `apps/web/src/lib/search-enrichment-fields.ts:1-47`, `apps/web/src/lib/data-timeline.ts:1-73`.
- `apps/web/src/__tests__/privacy-fields.test.ts:7-167`.
- `apps/web/src/db/schema.ts:19-125`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js:180-227`, `apps/web/scripts/migrate.js:348-751`, `apps/web/scripts/migrate.js:758-958`.
- `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:1-120`, `apps/web/src/__tests__/migrate-pending-migrations.test.ts:1-320`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:1-254`.

Deploy/gate surfaces examined:
- `package.json:1-23`, `apps/web/package.json:1-72`.
- `scripts/deploy-remote.sh:1-93`, `apps/web/deploy.sh:1-108`, `apps/web/src/__tests__/deploy-script-contract.test.ts:23-293`.
- `apps/web/e2e/origin-guard.spec.ts:1-88`, `apps/web/e2e/helpers.ts:28-148`.

## Confirmed Issues

None found in the reviewed source surfaces.

The implementation and tests match the stated behavior for the specific invariants requested:
- Admin API route exports are scanned recursively under `src/app/api/admin` and must be direct `withAdminAuth(...)` exports from the approved module (`check-api-auth.ts:17-43`, `check-api-auth.ts:63-94`, `check-api-auth.ts:121-177`). Current gate output showed both admin API routes OK.
- Cookie-auth admin API requests perform same-origin verification before `isAdmin()` (`api-auth.ts:114-129`); PAT-auth requests intentionally bypass same-origin only when a verified token has the required scope (`api-auth.ts:68-111`, `admin-tokens.ts:141-168`). Scope and response-header behavior are tested in `api-auth-response-headers.test.ts:50-149`, and the LR route is source-locked to `allowTokenScope: 'lr:upload'` in `lr-upload-hdr-gate.test.ts:63-66`.
- Mutating server actions are covered by recursive discovery (`check-action-origin.ts:83-113`) and require an effective top-level guard plus early return before protected reads/writes (`check-action-origin.ts:984-1030`). Auth actions use the approved `hasTrustedSameOrigin` shape (`auth.ts:77-103`, `auth.ts:267-287`, `auth.ts:290-297`).
- Public mutating/expensive API routes are scanned, excluding admin routes, and must call approved pre-increment helpers before protected work or carry a reasoned exemption (`check-public-route-rate-limit.ts:1-18`, `check-public-route-rate-limit.ts:133-138`, `check-public-route-rate-limit.ts:391-469`, `check-public-route-rate-limit.ts:934-968`). Current gate output showed all 10 public routes OK.
- Public image field privacy is guarded at three levels: explicit omissions in `data.ts:374-407`, compile-time guards in `search-enrichment-fields.ts:43-47` and `data-timeline.ts:62-67`, and symmetric runtime tests in `privacy-fields.test.ts:91-128` plus enrichment/timeline checks in `privacy-fields.test.ts:139-166`.
- Migration safety is covered by journal monotonicity/post-condition tests (`migration-journal-monotonicity.test.ts:56-119`), pending-vs-drift path tests (`migrate-pending-migrations.test.ts:89-175`), DML-baseline refusal tests (`migrate-pending-migrations.test.ts:209-318`), and reconcile source tripwires for tables, columns, indexes, FKs, and drops (`migrate-reconcile-coverage.test.ts:76-254`). `migrate.js` also enforces the same post-condition after `drizzle.migrate()` (`migrate.js:933-958`).
- Deploy scripts preserve the documented disk hygiene contract: remote target is config-driven (`deploy-remote.sh:22-53`), env files are permission-checked before sourcing/Compose consumption (`deploy-remote.sh:55-85`, `deploy.sh:15-43`), health is checked before pruning (`deploy.sh:57-77`), and Docker prune runs only after a healthy `up -d` without `volume prune -a` (`deploy.sh:79-104`). The deploy contract tests pin these points (`deploy-script-contract.test.ts:23-106`, `deploy-script-contract.test.ts:222-293`).

## Likely Issues

None.

I did not find a gap where the current code contradicts the documented invariants for route guards, privacy guards, migrations, deploy scripts, or the local quality gates.

## Risks Requiring Manual Validation

### VER-C6-R1 - Authenticated cross-origin e2e coverage is conditional, not proven by this local verifier run

- Severity: Medium evidence risk
- Confidence: High
- File/region: `apps/web/e2e/origin-guard.spec.ts:27-73`; `apps/web/e2e/helpers.ts:28-45`, `apps/web/e2e/helpers.ts:120-148`.

Evidence: The e2e suite has the right authenticated test shape: it creates a real session cookie and expects a spoofed `Origin` request to `/api/admin/db/download` to return 403 (`origin-guard.spec.ts:55-73`). But that branch is skipped unless `adminE2EEnabled` is true (`origin-guard.spec.ts:55-56`), and admin enablement depends on local plaintext credentials or explicit env (`helpers.ts:28-45`). I did not run `npm run test:e2e --workspace=apps/web` in this verifier lane.

Concrete failure scenario: a future Next/Playwright/server integration change breaks cookie-authenticated admin API origin checks only at runtime. The unit scanner and mocked `api-auth` tests still pass, while the authenticated e2e branch would have caught the real HTTP behavior if the env were configured and the suite were run.

Suggested fix: run the e2e suite with admin credentials for release validation, or make the authenticated origin-guard test a required CI job with the documented local disposable DB/session setup. Keep the unauthenticated smoke (`origin-guard.spec.ts:33-53`) as a cheap route-existence guard, but do not treat it as proof of the authenticated origin branch.

### VER-C6-R2 - Production deploy/smoke evidence is not established by local gates

- Severity: Medium manual-validation risk
- Confidence: High
- File/region: `AGENTS.md:17-19`; `scripts/deploy-remote.sh:55-93`; `apps/web/deploy.sh:51-76`, `apps/web/deploy.sh:79-104`; `deploy-script-contract.test.ts:23-106`.

Evidence: The deploy policy requires `npm run deploy` after pushed master commits (`AGENTS.md:17`). The scripts and tests prove the local deploy helper shape and safety contract, but I did not execute `npm run deploy` or verify the remote host. Local `npm run build --workspace=apps/web` passed; during static generation the local DB was unavailable and sitemap correctly fell back to homepage-only, then the build completed with exit 0.

Concrete failure scenario: all local gates pass and the deploy scripts remain source-valid, but the remote deploy env file is missing/unsafe, SSH target config is wrong, Docker health never reaches healthy, or the host has a runtime-only issue. None of those are falsified by source tests or local build.

Suggested fix: for an iteration intended to reach production, run the repo-root deploy path with the configured deploy env, then record the remote deploy exit code and a smoke check against `/api/live` or the public homepage. If deploy is intentionally out of scope for a verifier-only artifact, carry this as manual validation rather than claiming production behavior.

## Verification Evidence

Commands run at HEAD:
- `npm run lint:api-auth --workspace=apps/web` - PASS. Output listed 2 admin routes OK.
- `npm run lint:action-origin --workspace=apps/web` - PASS. Output ended with "All mutating server actions enforce same-origin provenance."
- `npm run lint:public-route-rate-limit --workspace=apps/web` - PASS. Output listed 10 public routes OK.
- Targeted invariant suite:
  `npm test --workspace=apps/web -- src/__tests__/privacy-fields.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/migrate-pending-migrations.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/deploy-script-contract.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/api-auth-response-headers.test.ts src/__tests__/semantic-search-rate-limit.test.ts`
  - PASS: 10 files, 354 tests.
- `npm run typecheck --workspace=apps/web` - PASS. Included `next typegen`, app `tsc`, JS script checker, and script `tsc`.
- `npm run lint --workspace=apps/web` - PASS.
- `npm test --workspace=apps/web` - PASS: 336 passed, 2 skipped files; 3126 passed tests, 4 skipped tests.
- `npm run build --workspace=apps/web` - PASS. Build completed after the expected local-DB-unavailable sitemap fallback.

Not run:
- `npm run test:e2e --workspace=apps/web` - not run in this lane; see VER-C6-R1.
- `npm run deploy` - not run in this lane; see VER-C6-R2.

## Final Sweep

Final sweep checks:
- Re-read the common verifier prompt and required scope before writing.
- Confirmed current API/action route inventory with `find` and lint gate output.
- Checked source-level guard implementation, scanner implementation, scanner fixtures, and actual route/action behavior instead of relying on comments alone.
- Checked privacy field omissions, compile-time guards, and runtime symmetric allowlist tests across `data.ts`, `data-timeline.ts`, and semantic/similar enrichment.
- Checked migration journal policy, reconcile coverage, DML-baseline refusal, pending migration handling, and deploy post-condition.
- Checked deploy script ordering, env-file permission checks, config-driven SSH wrapper, health-before-prune, and no all-volume prune.
- Verified the main non-e2e gates fresh at HEAD.

Worktree note: while this verifier pass was running, other review artifacts under `.context/reviews/` appeared modified independently, currently including `critic.md` and `perf-reviewer.md`. I did not inspect or revert them, and this report intentionally writes only `.context/reviews/verifier.md`.
