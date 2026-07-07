# Cycle 17 Verifier Review

Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `fc15b235` (`fix(build): 🐛 avoid module.require in mysql helper`)
Role: verifier subagent, read-only correctness review plus this report write.

I did not implement fixes, deploy, stop services, delete files, modify production state, or inspect gitignored secrets. Before this report write, `git status --short` already showed modified review-lane files: `.context/reviews/code-reviewer.md` and `.context/reviews/perf-reviewer.md`.

## Inventory Built First

Verification-relevant inventory was built from `rg --files`, repo instructions, active plans/reviews, and the current cycle-16 commit range now on `master`.

- Governance and repo contracts: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`, `.context/plans/README.md`, `.context/plans/cycle-16-2026-07-08-plan.md`, `.context/plans/cycle-16-2026-07-08-deferred.md`, `.context/reviews/_aggregate.md`, current review files in `.context/reviews/`, and archived plan/review hits screened with `rg`.
- Package, toolchain, and gates: `package.json`, `apps/web/package.json`, `apps/web/eslint.config.mjs`, `apps/web/tsconfig*.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, custom lint scripts, and package manager/runtime declarations.
- Deploy and operations: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, `apps/web/scripts/mysql-connection-options.js`, `.env.deploy.example`, and app env examples.
- Schema and migrations: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/meta/*.json`, `apps/web/scripts/migrate.js`, and migration coverage tests.
- Privacy/data surfaces: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, public query helpers, and `apps/web/src/__tests__/privacy-fields.test.ts`.
- Security and mutation gates: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/proxy.ts`, admin/public API routes, server actions, and `apps/web/scripts/check-*.ts`.
- Recent cycle-16 implementation surfaces: `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/lib/advisory-locks.ts`, `apps/web/src/lib/advisory-lock-release.ts`, `apps/web/src/lib/messages/*`, `apps/web/src/components/admin-nav.tsx`, image-delete/archive UI paths, MySQL runtime SSL helpers, and CLIP backfill script/tests.
- Tests examined or executed: `settings-backfill-required-action`, `settings-semantic-mode-action`, `admin-user-delete-audit-detach`, `embeddings-action-behavior`, `mysql-runtime-ssl`, `client-source-contracts`, `backfill-clip-embeddings-reembed`, `privacy-fields`, `migration-journal`, `migrate-reconcile-coverage`, `migrate-pending-migrations`, and `drizzle-config-behavior`.

I did not line-review generated output (`.next`, `node_modules`, coverage/build artifacts), binary image assets, screenshot artifacts, or logs. Historical `.context` archives were screened for relevant carry-forward and release-ledger patterns rather than read line by line; current active plan/review artifacts were read directly.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed; every admin API export checked as wrapped by `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`: passed; mutating non-auth server actions checked for `requireSameOriginAdmin()` or explicit approved exemption/rate-limited public action.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public mutating/expensive routes checked for a pre-increment helper or approved exemption.
- `npm test --workspace=apps/web -- settings-backfill-required-action settings-semantic-mode-action admin-user-delete-audit-detach embeddings-action-behavior mysql-runtime-ssl client-source-contracts backfill-clip-embeddings-reembed`: passed, 7 files / 59 tests.
- `npm test --workspace=apps/web -- privacy-fields migration-journal migrate-reconcile-coverage migrate-pending-migrations drizzle-config-behavior`: passed, 6 files / 128 tests.
- Migration journal script/check: 30 SQL files and 30 journal entries; no missing SQL, no extra journal entry. The historical non-monotonic `when` entries around `0006`-`0017` remain known/documented; current postcondition tests and hash coverage passed.
- `git log --oneline -6`: HEAD and `origin/master` include the cycle-16 fix commits through `fc15b235`, after the plan's `4b237f7e` start point.

Full `npm run lint`, `npm run typecheck`, `npm run build`, full `npm test`, and `npm run test:e2e` were not rerun in this verifier lane. The active cycle-16 plan records those gates as passed, but the ledger state itself is one of the findings below.

## Confirmed Issues

### VER-17-01 - Cycle 16 release ledger is stale after the fix commits reached `origin/master`, and deploy completion remains unproven

Severity: Medium
Confidence: High
Status: Confirmed issue

Evidence:

- `.context/plans/cycle-16-2026-07-08-plan.md:3` still says `Status: IMPLEMENTED - GATES GREEN; COMMIT/PUSH/DEPLOY PENDING`.
- `.context/plans/cycle-16-2026-07-08-plan.md:137` still leaves `WP5 gates green; commit, push, and deploy pending` unchecked.
- `.context/plans/README.md:34-37` still lists the Cycle 16 plan/deferred register as the active current-cycle plan set from start HEAD `4b237f7e`.
- `.context/plans/cycle-16-2026-07-08-plan.md:141-150` records all required local gates and e2e as passed, so the remaining pending state is specifically release-ledger/deploy completion, not missing local gate evidence.
- `git log --oneline -6` shows the cycle-16 implementation commits are now on current `master` through `fc15b235`; the plan start was `4b237f7e`.

Why this is a problem:

Repo policy in `AGENTS.md` requires per-iteration commit/push/deploy accounting. The current committed plan state no longer tells an operator whether Cycle 16 is still waiting for commit/push, whether the pushed fixes were deployed, or whether deployment was intentionally skipped/deferred. That makes the runbook less trustworthy than the actual git state.

Concrete failure scenario:

A later agent or operator reads `.context/plans/README.md` and the active Cycle 16 plan, sees commit/push/deploy pending, and either repeats already-pushed work or assumes deployment still needs to happen without knowing which commit should be deployed. The opposite failure is also possible: someone sees the fixes on `origin/master` and assumes production is current, while no committed deploy evidence exists for `fc15b235`.

Suggested fix:

Update `.context/plans/cycle-16-2026-07-08-plan.md` and `.context/plans/README.md` with terminal evidence: signed commit hashes, origin/master match, pull-rebase/push status, deploy command result, and smoke evidence. If deploy was not run, record that explicitly as an open release item with the exact commit intended for deploy.

### VER-17-02 - `updateGallerySettings` comments still describe the old soft-warning-only behavior after the hard coordination lock was added

Severity: Low
Confidence: High
Status: Confirmed issue

Evidence:

- `apps/web/src/app/actions/settings.ts:190-200` says byte-impacting keys "have no admission fence at all" and that the action should surface a soft signal "Rather than a hard block".
- The current implementation does add a hard coordination gate for those same backfill-relevant changes: `apps/web/src/app/actions/settings.ts:227-232` acquires `LOCK_COLOR_PIPELINE_BACKFILL` and returns `colorBackfillSettingsLocked` when unavailable.
- The release path confirms this is a real lock lifecycle, not only a warning calculation: `apps/web/src/app/actions/settings.ts:275-282` releases `LOCK_COLOR_PIPELINE_BACKFILL`.
- The targeted test now asserts the hard-block behavior: `apps/web/src/__tests__/settings-backfill-required-action.test.ts:242-255` expects `updateGallerySettings({ image_quality_avif: '70' })` to resolve to `{ error: 'colorBackfillSettingsLocked' }` and not call the transaction.

Why this is a problem:

This is a docs/comments-as-claim mismatch inside a correctness-sensitive action. The code and tests now enforce a brief admission fence during color backfill coordination, while the local comment tells future maintainers the opposite.

Concrete failure scenario:

A future maintainer changes this action while chasing settings/backfill behavior, trusts the stale comment, and removes or weakens the lock path because they believe the intended contract is only a soft "requires backfill" signal. That would reopen the stale-byte race Cycle 16 fixed.

Suggested fix:

Revise the comment at `apps/web/src/app/actions/settings.ts:190-200` to describe both pieces of the current contract: compute `requiresBackfill` as the soft UI signal, and acquire the shared color-backfill advisory lock as a short hard coordination fence before persisting byte-impacting settings.

## Likely Issues

No additional likely source-code issues were promoted. The recent action connection-acquisition fixes, advisory-lock release helper, MySQL runtime SSL helper, privacy omissions, migration postconditions, auth/origin/rate-limit lint gates, and targeted behavior tests all matched the stated contracts under the lightweight checks run here.

## Risks Needing Manual Validation

- Production deploy/startup was not run by this verifier. This matters because Cycle 16's release ledger still lacks deploy evidence for current HEAD, and deploy is an external-production operation.
- Live production DB migration state, live nginx/proxy topology, deployed CLIP model weights, and production semantic-search operator state were not validated. The repo documents those as operator-state boundaries; this review only checked local source, scripts, tests, and committed docs.
- Full gates were not rerun in this verifier lane. The active plan records full lint/typecheck/build/test/e2e as passed, and this verifier reran focused policy and contract checks, but the plan's stale status should be corrected before relying on it as the terminal release record.

## Final Missed-Issues Sweep

Final sweep covered the active plan/review ledger, current `master` commits since Cycle 16 start, settings/backfill lock behavior, action error-handling fixes, migration/privacy invariants, custom lint gates, deploy scripts, and runbook claims. No relevant tracked source/config/script/test file in the inventory above was intentionally skipped. Skipped material was limited to generated artifacts, binary assets, screenshots, logs, `node_modules`, and historical archive content that was screened by search but not line-read because it does not define the current runtime contract.
