# Cycle 17/100 Critic Review

Date: 2026-07-08 KST
Role: critic subagent
Scope: whole-repository critique from `/Users/hletrd/flash-shared/gallery`
Mode: review-only; no fixes implemented

## Inventory And Coverage

Policy/context read before judging:

- `AGENTS.md` project rules, including commit/deploy/schema/quality-gate requirements.
- `CLAUDE.md` operational model, security model, CLIP semantic-search boundaries, migration runbook, single-writer topology, and deploy policy.
- Current cycle/review material: `.context/reviews/critic.md` from cycle 16, `.context/reviews/_aggregate.md`, `.context/plans/README.md`, `.context/plans/cycle-16-2026-07-08-plan.md`, `.context/plans/cycle-16-2026-07-08-deferred.md`, plus relevant prior plan/review anchors.

Critique-relevant repository inventory:

- Application/source: `apps/web/src` has 618 TS/TSX files including routes/actions/components/lib/db/tests; non-test source count is 262.
- Tests: `apps/web/src/__tests__` has 361 unit/source-contract test files; `apps/web/e2e` has 12 Playwright files.
- Scripts/config/deploy: 28 files under `apps/web/scripts`; root and workspace `package.json`; `.github/workflows/quality.yml`; `apps/web/Dockerfile`; `apps/web/docker-compose.yml`; `apps/web/deploy.sh`; `apps/web/nginx/default.conf`.
- Schema/migrations: 33 files under `apps/web/drizzle`, including `meta/_journal.json`.
- Docs/plans/reviews: `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/plans/*`, `.context/reviews/*`, `plan/*`.
- Generated/runtime exclusions for this critique: `node_modules`, `.git`, `.next`, `apps/web/.next`, ignored runtime data/uploads, ignored `.claude/worktrees`, and ignored runtime `.omc`/`.omx` state except where artifact pollution itself is a finding.

Validation evidence collected:

- `git rev-parse HEAD` and `origin/master` both returned `fc15b235ca7a244d79b54981bd059926ca7c745a`; `git status --short --branch` showed `## master...origin/master` plus unrelated dirty review files (`code-reviewer.md`, `perf-reviewer.md`) already present.
- Targeted tests passed: `npm test --workspace=apps/web -- settings-backfill-required-action.test.ts admin-user-delete-audit-detach.test.ts embeddings-action-behavior.test.ts client-source-contracts.test.ts images-action-toctou-claim.test.ts data-tag-names-sql.test.ts pending-session-revocations.test.ts` -> 7 files / 62 tests passed.
- Guard scripts previously run in this critic lane and passed: `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`.
- Full `lint`, `typecheck`, `build`, full unit suite, full e2e, Docker build, and live deploy were not rerun in this critic lane.

## Confirmed Issues

### C17-CRIT-01 - Cycle 16 provenance ledger still advertises pending commit/push/deploy after `origin/master` advanced

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- Files/regions:
  - `.context/plans/cycle-16-2026-07-08-plan.md:3` says `IMPLEMENTED - GATES GREEN; COMMIT/PUSH/DEPLOY PENDING`.
  - `.context/plans/cycle-16-2026-07-08-plan.md:137` leaves WP5 unchecked as `gates green; commit, push, and deploy pending`.
  - `.context/plans/README.md:34-37` still lists Cycle 16 as the active current-cycle plan/deferred register from start HEAD `4b237f7e`.
  - `CLAUDE.md:505-507` and `AGENTS.md` make per-iteration deploy part of the project policy.
- Why this is a problem: The code history says the cycle was committed and pushed: local `HEAD` equals `origin/master` at `fc15b235`. The plan ledger still says commit/push/deploy are pending and keeps Cycle 16 as active, while no current committed deploy-evidence update distinguishes "pushed but deploy not run" from "fully deployed".
- Concrete failure scenario: The next planner or operator treats Cycle 16 as still active and either repeats work already pushed, skips a required per-iteration deploy because the plan looks pre-deploy and stale, or starts Cycle 17 aggregation from the wrong terminal state.
- Suggested fix: Update the Cycle 16 plan and plan index with a terminal state: final pushed commit, deploy command/log status, and any explicit deploy gap if deploy did not run. Move Cycle 16 into completed/recent plans and create the Cycle 17 active ledger from `fc15b235`.

### C17-CRIT-02 - Tracked and nested `.omc` runtime artifacts still pollute repository inventories

- Severity: Low-Medium
- Confidence: High
- Status: Confirmed issue; carried from prior aggregate but still present
- Files/regions:
  - `.gitignore:16-17` ignores `.omc` and `.omx/`.
  - `git ls-files | rg '(^|/)\\.omc(/|$)'` still reports `.omc/plans/plan-cycle12-fixes.md`.
  - `git status --ignored --short` reports ignored nested runtime state at `apps/web/.omc/`, `apps/web/public/fonts/.omc/`, and `apps/web/src/__tests__/.omc/`.
  - `.context/plans/cycle-16-2026-07-08-deferred.md:55` defers `AGG-C16-47` because removal requires destructive confirmation.
- Why this is a problem: Runtime/orchestration state inside source, tests, and fonts directories makes "whole repo" inventories noisy and can cause source-hygiene tools, review agents, or future test globbing to reason over non-product state. The tracked root `.omc` file also contradicts the ignore policy.
- Concrete failure scenario: A future broad scanner or copy/deploy helper includes nested `.omc` files, leaking agent state into reports/artifacts or producing false positives from non-source JSON under `src/__tests__`.
- Suggested fix: After explicit destructive-action confirmation, remove tracked `.omc` files and clean ignored nested `.omc` directories. Add a small CI/source-hygiene check that fails if tracked `.omc`/`.omx` paths reappear.

### C17-CRIT-03 - Settings backfill test narrative now contradicts the implemented admission fence

- Severity: Low
- Confidence: High
- Status: Confirmed documentation/test-maintenance issue
- Files/regions:
  - `apps/web/src/__tests__/settings-backfill-required-action.test.ts:1-8` still says the byte-impacting settings "have no admission fence".
  - `apps/web/src/app/actions/settings.ts:227-231` now acquires the color backfill settings lock and returns `colorBackfillSettingsLocked` when a relevant change races an active color backfill.
  - `apps/web/src/app/actions/settings.ts:280` releases the same lock through `releasePooledAdvisoryLocks`.
- Why this is a problem: The behavioral fix is real, but the leading test comment describes the pre-fix invariant. That matters in this repo because reviewers and planners heavily mine test comments/source-contract comments as current decision records.
- Concrete failure scenario: A future agent reads the test header, concludes there is intentionally no admission fence, and schedules or implements a duplicate/competing lock strategy instead of preserving the current color-backfill coordination.
- Suggested fix: Rewrite the header to distinguish the two concepts: settings can still be changed after images exist and return `requiresBackfill`, but active color backfill now has a short admission fence for byte-impacting changes.

## Likely Issues

### C17-CRIT-04 - Admin backfill lock acquisition error paths still release possibly tainted pooled connections

- Severity: Medium
- Confidence: Medium
- Status: Likely issue needing focused fault-injection validation
- Files/regions:
  - `apps/web/src/lib/admin-backfill-runner.ts:324-342` catches `GET_LOCK` query errors in `acquireBackfillLock()` and calls `lockConn.release()` before rethrowing.
  - `apps/web/src/lib/admin-backfill-runner.ts:363-379` does the same for per-image `acquireImageProcessingClaim()`.
  - `apps/web/src/lib/admin-backfill-runner.ts:345-352` explicitly documents that returning a connection that still holds the global backfill lock to the pool can block future work.
  - `apps/web/src/lib/upload-processing-contract-lock.ts:57-67` uses stronger destroy/release-helper discipline on an analogous lock error path once acquisition may have happened.
- Why this is a problem: MySQL advisory locks are connection-scoped. If a `GET_LOCK` request completes server-side but the client observes a query error before receiving/parsing the row, plain `release()` can return a session that may still hold the lock to the pool. This is the same class of lock-leak risk the repo has already hardened in release paths.
- Concrete failure scenario: A transient protocol/network fault during `SELECT GET_LOCK('gallerykit_color_pipeline_backfill', 0)` leaves the pooled connection holding the global backfill lock. Subsequent admin backfill attempts report "already running" or settings updates return locked until that pooled session is destroyed or the process restarts.
- Suggested fix: Treat `GET_LOCK` query failures as possibly tainted: destroy the connection or use a helper that attempts `RELEASE_LOCK` and destroys on failure. Add tests that simulate rejected `query()` on both lock acquisition helpers and assert the connection is not returned cleanly to the pool.

## Risks Needing Manual Validation

### C17-RISK-01 - High-risk flows still rely on source-contract tests rather than behavior/concurrency tests

- Severity: High for regression detection, not a confirmed runtime bug
- Confidence: High
- Status: Known risk; deferred in Cycle 16, still valid
- Files/regions:
  - `.context/plans/cycle-16-2026-07-08-deferred.md:28-30` defers logout revocation, upload quota concurrency, and tag aggregation behavior proof gaps.
  - `apps/web/src/app/actions/auth.ts:286-312` implements pending session revocation on not-revoked logout.
  - `apps/web/src/__tests__/pending-session-revocations.test.ts:88-112` verifies important logout/restore/maintenance wiring by source strings.
  - `apps/web/src/app/actions/images.ts:232-319` implements synchronous upload quota claim and topic-query rollback.
  - `apps/web/src/__tests__/images-action-toctou-claim.test.ts:17-56` verifies the ordering/rollback by source slicing.
  - `apps/web/src/lib/data.ts:1682-1729` implements tag search via `EXISTS` while preserving full tag aggregation.
  - `apps/web/src/__tests__/data-tag-names-sql.test.ts:234-248` verifies the query shape by source strings.
- Why this is a problem: These are exactly the flows where tiny reorderings or query-builder changes can reintroduce races/privacy/search regressions while still satisfying string-level assertions. The current source looks aligned, but the tests mostly prove shape, not behavior under failure/concurrency.
- Concrete failure scenario: A future refactor extracts upload quota handling into a helper that still contains the same strings but moves the first `await` before the claim, reopening the concurrent upload limit bypass. The source-contract test can pass while the behavior regresses.
- Suggested fix: Add behavior tests with mocked DB/pool failures and concurrency harnesses for the upload action, restore/logout session revocation, and tag search result rows. Keep source contracts only as supplementary guardrails.

### C17-RISK-02 - Production Docker image correctness remains deploy-time, not CI-time

- Severity: Medium
- Confidence: High
- Status: Known risk; deferred but still important after the latest standalone bundling fix
- Files/regions:
  - `.github/workflows/quality.yml:48-83` runs install, lint, typecheck, audit, unit tests, e2e, and `npm run build`, but does not build the production Docker image.
  - `apps/web/Dockerfile:50-62` and `apps/web/Dockerfile:76-85` install Linux-native packages with manually pinned architecture-specific package versions.
  - `apps/web/src/__tests__/mysql-runtime-ssl.test.ts:65-67` now source-checks the CommonJS helper for standalone bundling compatibility.
  - `.context/plans/cycle-16-2026-07-08-deferred.md:53` preserves `AGG-C16-45`.
- Why this is a problem: The most production-specific surface is the Dockerfile and standalone bundle/native package overlay. CI's `next build` can pass while the production container fails on a native binary pin or standalone runtime helper, as Cycle 16's MySQL helper fix illustrates.
- Concrete failure scenario: A package update changes an optional native package version in `package-lock.json`; CI stays green because it never executes the Dockerfile overlay, but deploy fails or the container crashes at startup due to a missing Linux native module.
- Suggested fix: Add either a Docker build gate for the production image or a targeted lockfile-vs-Dockerfile native package pin checker. Keep deploy as the final operational proof, but do not leave the first Dockerfile validation until deployment.

## Refuted Or Already Addressed Suspicions

- Row-scoped image delete titles are implemented correctly: `apps/web/src/components/image-manager.tsx:458` computes `deleteTargetTitle` inside the `images.map()` row, and lines `557`, `563`, `569`, and `571` use that row-scoped value.
- Timeline/year archive prefetch suppression is present: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:252` and `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:212` use `prefetch={false}`.
- Photo-viewer desktop info sidebar transition is now shorter: `apps/web/src/components/photo-viewer.tsx:754` uses `duration-200`.
- Settings/backfill coordination is no longer the old unfenced state: `settings.ts:227-231` fences active backfills, and the targeted settings test passed.
- Admin user delete and embeddings backfill now handle connection acquisition failures with localized/typed errors: `admin-users.ts:295-304`, `embeddings.ts:202`, and the targeted tests passed.
- The MySQL standalone helper no longer uses `module.require`: `apps/web/scripts/mysql-connection-options.js:1` uses `process.getBuiltinModule('node:fs')`, and `mysql-runtime-ssl.test.ts:65-67` pins that contract.

## Final Missed-Issues Sweep

- Re-ran broad searches over policy/deploy/lock/source-contract/Docker/OMC surfaces and compared Cycle 16 scheduled fixes against current source and tests.
- No relevant category was intentionally skipped: source, tests, scripts, docs, migrations, workflow, Docker, deploy, and plan/review surfaces were inventoried and selectively deep-read around high-risk boundaries.
- Not exhaustively line-read: generated dependencies/build outputs, runtime data/uploads, ignored `.claude/worktrees`, and historical review archives beyond the current aggregate/current plan/deferred plus targeted prior anchors.
- Remaining highest-risk manual assumptions are the documented single-writer topology (`CLAUDE.md:245-247`), operator-managed nginx/proxy deployment (`CLAUDE.md:511-515`), CLIP live activation proof (`CLAUDE.md:553-600`), and plaintext backup operator boundary (`CLAUDE.md:226`). These are policy-accepted boundaries, not newly confirmed code defects in this pass.
