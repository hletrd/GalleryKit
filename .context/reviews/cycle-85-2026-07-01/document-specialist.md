# Cycle 85/100 Document Specialist Review

Reviewed HEAD: `1d29b98861098a68a8107746997a5d81d70f03f1`.
Date: 2026-07-01.
Role: document-specialist lane.

## Scope And Inventory

Reviewed documentation, deployment scripts, package scripts, comments, and plan/review ledgers for drift against current repo behavior. This lane did not edit source, plans, or existing review artifacts.

Inventory checked:

- Repo authority and operating contract: `AGENTS.md`, `CLAUDE.md`.
- Public docs: `README.md`, `apps/web/README.md`.
- Package scripts: root `package.json`, `apps/web/package.json`.
- Deploy helpers/config: `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/.env.local.example`.
- Current cycle state: `.context/plans/README.md`, `.context/plans/cycle-84-2026-07-01-plan.md`, `.context/plans/cycle-84-2026-07-01-deferred.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-84-2026-07-01/_aggregate.md`, and Cycle 84 lane artifacts.
- Deferred baseline: Cycle 84 carry-forward deferred register and plan-index notes.

Severity summary: Critical 0, High 0, Medium 1, Low 0.

## Confirmed Findings

### C85-DOC-01 - Cycle 84 release ledger is open after its signed pushed HEAD

- Severity: Medium.
- Confidence: High for commit/push drift; Medium for deploy-state drift because this read-only lane did not run `npm run deploy` or inspect remote logs.
- File:line citations: `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/README.md:10`, `.context/plans/cycle-84-2026-07-01-plan.md:8`, `.context/plans/cycle-84-2026-07-01-plan.md:39`, `.context/plans/cycle-84-2026-07-01-plan.md:48`, `.context/plans/cycle-84-2026-07-01-plan.md:49`, `.context/plans/cycle-84-2026-07-01-plan.md:53`, `.context/plans/cycle-84-2026-07-01-plan.md:60`, `.context/plans/cycle-84-2026-07-01-plan.md:61`, `AGENTS.md:17`, `CLAUDE.md:469`, `package.json:22`.
- Evidence: `.context/plans/README.md` still lists Cycle 84 under "Active Current-Cycle Plans", while the Cycle 84 plan explicitly includes commit/push/deploy in its goal and validation steps but leaves both terminal progress boxes unchecked. The gate evidence ends at local gates and `git diff --cached --check`, with no terminal commit/push/deploy note. Read-only verification found `HEAD == origin/master == 1d29b98861098a68a8107746997a5d81d70f03f1`; `git verify-commit HEAD` reported a good GPG signature. The commit trailer records local gates and `Not-tested: npm run test:e2e --workspace=apps/web`, but no `npm run deploy` result.
- Why this is new, not a deferred re-raise: Cycle 84 fixed the same ledger class for Cycle 83 by moving Cycle 83 to recent state and recording the Cycle 83 deploy-evidence gap. The same ambiguity now exists for Cycle 84's own terminal state after the Cycle 84 fix commit was pushed.
- Failure scenario: Cycle 85+ reviewers or operators using committed ledgers cannot tell whether Cycle 84 was deployed, merely pushed, or completed out-of-band. That can cause repeated release forensics, duplicate deploy attempts, or an incorrect assumption that production already reflects signed HEAD `1d29b988`.
- Suggested fix: close the Cycle 84 ledger in the next implementation pass by recording signed commit/push evidence for `1d29b988`, adding `npm run deploy` evidence or an explicit deploy-evidence gap/supersession note, and moving Cycle 84 out of the active plan section once the terminal state is recorded.

## Non-Findings

- Cycle 83 ledger closure is no longer the active problem. Cycle 83 now records commit/push completion and an explicit deploy-evidence gap/supersession note at `.context/plans/cycle-83-2026-07-01-plan.md:49` through `.context/plans/cycle-83-2026-07-01-plan.md:64`, and `.context/plans/README.md:12` lists it under Recent Plans.
- Root deploy helper docs match implementation: `README.md:122` through `README.md:131` document root `.env.deploy` first with fallback override behavior, `.env.deploy.example:1` through `.env.deploy.example:16` documents the derived SSH fields, and `scripts/deploy-remote.sh:22` through `scripts/deploy-remote.sh:29` implements root `.env.deploy` before `$HOME/.gallerykit-secrets/gallery-deploy.env`.
- Package scripts expose the documented gates and deploy entrypoint: root `package.json:11` through `package.json:22` delegates lint/typecheck/test/e2e/security lint/deploy commands, and `apps/web/package.json:8` through `apps/web/package.json:27` defines the app-level gate scripts named in `AGENTS.md:31` through `AGENTS.md:38`.
- Deploy pruning and persistence docs match code: `apps/web/deploy.sh:55` starts Compose before cleanup, `apps/web/deploy.sh:57` through `apps/web/deploy.sh:77` requires health success, `apps/web/deploy.sh:99` through `apps/web/deploy.sh:104` prunes after health without `volume prune -a`, and `apps/web/docker-compose.yml:24` through `apps/web/docker-compose.yml:28` bind-mount the documented mutable stores and `site-config.json`.
- App README environment/deploy notes align with the root docs and scripts for `.env.local` permissions, build-time URL variables, health/liveness behavior, upload body caps, trusted proxy behavior, CLIP sidecar activation, and the PAT upload API.
- `C80-06` remains deferred and was not re-opened. The exit criterion in `.context/plans/cycle-84-2026-07-01-deferred.md:12` requires a dedicated site-config runtime/build-time operator-contract decision touching docs, compose, imports, and tests together; this lane found no such decision or new source/doc delta.
- `C77-ARCH-01`, `C76-04`, `C76-05`, `C75-08`, and historical performance/semantic-search/settings/browser-matrix/e2e carry-forward items remain deferred under `.context/plans/cycle-84-2026-07-01-deferred.md:13` through `.context/plans/cycle-84-2026-07-01-deferred.md:17`; this lane found no exit criteria met.

## Validation Evidence

- Read-only Git checks: `git status --short --branch`, `git log --oneline --decorate -n 12`, `git show --show-signature --no-patch --format=fuller HEAD`, `git rev-parse HEAD origin/master`, and `git verify-commit HEAD`.
- Read-only doc/code searches: targeted `rg` searches over docs, plan/review artifacts, deploy scripts, package scripts, env examples, Compose, Dockerfile, nginx config, and source comments.
- No lint/typecheck/build/test/e2e/deploy gates were run; this was a document-specialist review lane.
