# Cycle 49 Docs / Deploy Drift Review

Perspective: document-specialist + deploy/docs drift reviewer.
Scope: documentation-code mismatches, deploy policy drift, operational runbook inaccuracies, gate/script mismatches, and stale claims.

## Inventory Examined

- Project operating docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Current cycle state: `.context/plans/README.md`, `.context/plans/cycle-48-2026-07-01-plan.md`, `.context/plans/cycle-48-2026-07-01-deferred.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-48-2026-07-01/_aggregate.md`, `.context/reviews/cycle-48-2026-07-01/perf-deploy-docs.md`.
- Deploy/runtime scripts and config: `package.json`, `apps/web/package.json`, `scripts/deploy-remote.sh`, `.env.deploy.example`, `.dockerignore`, `apps/web/.dockerignore`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `.omc/wiki/deploy-disk-hygiene-runbook.md`.
- Gate/script sources: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/scripts/check-js-scripts.mjs`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/nginx-config.test.ts` references.
- Git state evidence: `master` is clean and matches `origin/master` at `dc4f4acf docs(cycle-48): record review closure`; prior HEADs include `9d0dc208 docs(cycle-47): record deploy closure` and `d30694c8 fix(cycle-47): close review-cycle regressions`.

Prior deferred items `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08` were not re-raised; I found no new evidence that changes their severity or scheduling.

## Findings

### C49-DOCDEPLOY-01 - Cycle 48 closure state is stale after the Cycle 48 artifact commit

Severity: Low
Confidence: High

Evidence:
- `.context/plans/README.md:5-13` still lists Cycle 48 as the active current-cycle plan with deploy-ledger closure scheduled.
- `.context/plans/cycle-48-2026-07-01-plan.md:36-42` marks review aggregation, plan creation, scheduled fixes, and gates complete, but leaves `Commit, push, deploy` unchecked.
- `.context/reviews/_aggregate.md:3-7` still says Cycle 48 needs to push and deploy its artifact commit.
- Current git state shows `dc4f4acf` is already on local `master` and `origin/master`; that commit is the Cycle 48 review-closure artifact. Its commit body says final deploy evidence is reported after the commit rather than prewritten into the committed plan.
- The project deploy policy remains per-commit/per-iteration: `AGENTS.md:17`, `CLAUDE.md:467-469`, and root `package.json:22` wire `npm run deploy`. Runtime blast radius is low because `.context` and `*.md` are excluded from the Docker build context in `.dockerignore:4` and `.dockerignore:25`, but the committed coordination state is stale.

Failure scenario:
A later review or implementation lane reads the committed plan index and aggregate, treats Cycle 48 as still active or deploy-pending, and repeats deploy-ledger work or loses the actual production baseline. This recreates the workflow drift that Cycle 48 was supposed to close, even though the artifact commit itself is docs-only and Docker-ignored.

Suggested fix:
Update `.context/plans/README.md`, `.context/plans/cycle-48-2026-07-01-plan.md`, and `.context/reviews/_aggregate.md` to reflect the actual terminal state for commit/push. If `npm run deploy` completed after `dc4f4acf`, record that evidence; if it did not, mark deploy explicitly pending instead of leaving the cycle both active and partially complete.

### C49-DOCDEPLOY-02 - Action-origin gate docs still say `auth.ts` is excluded, but the scanner includes it

Severity: Low
Confidence: High

Evidence:
- `CLAUDE.md:620` says `lint:action-origin` scans `apps/web/src/app/actions/` while "excluding basename `auth`"; `CLAUDE.md:631` repeats that `auth.ts` is intentionally excluded by name.
- `AGENTS.md:33` compresses the gate as "every mutating server action must return-early on `requireSameOriginAdmin()`", which omits the auth-specific guard exception.
- The actual scanner recursively includes all supported action files via `walkForActionFiles` in `apps/web/scripts/check-action-origin.ts:63-80`; it does not exclude `auth.ts`.
- The scanner explicitly detects auth action files at `apps/web/scripts/check-action-origin.ts:1145` and accepts an auth-specific `hasTrustedSameOrigin` branch at `apps/web/scripts/check-action-origin.ts:1273-1280`.
- The unit tests lock that behavior: `apps/web/src/__tests__/check-action-origin.test.ts:799-810` requires `auth.*` files to be discovered, and `apps/web/src/__tests__/check-action-origin.test.ts:821-833` passes an auth mutator that exits on `hasTrustedSameOrigin` before mutation.

Failure scenario:
A maintainer follows the docs and assumes `auth.ts` is outside the gate, or expects every auth mutator to use `requireSameOriginAdmin()` instead of the approved login/logout/password-change origin helper. That creates false review assumptions and can send future fixes toward the wrong guard shape; the script is stricter than the docs, so the likely symptom is unexpected gate failures or incorrect documentation-driven refactors.

Suggested fix:
Rewrite the CLAUDE/AGENTS lint-gate wording to say: non-auth mutating actions must return early on `requireSameOriginAdmin()`, `auth.ts` is scanned with the approved `hasTrustedSameOrigin` shape, and public actions keep their documented `@action-origin-exempt` plus rate-limit-before-mutation contract.

### C49-DOCDEPLOY-03 - Remote deploy setup omits the permission step required by the deploy helper

Severity: Medium
Confidence: High

Evidence:
- The public setup path says to copy/edit/run: `README.md:119-129` shows `cp .env.deploy.example .env.deploy`, edit, then `npm run deploy`; `CLAUDE.md:679-683` shows the same copy/run flow; `AGENTS.md:18` tells agents to copy from `.env.deploy.example`.
- `.env.deploy.example` is committed with normal public file mode `100644`, and a normal `cp .env.deploy.example .env.deploy` creates a group/world-readable file on the common `022` umask path.
- The deploy helper refuses to source any deploy env file with group or world permissions: `scripts/deploy-remote.sh:65-72` computes the mode and exits with `Run: chmod 600 "$ENV_FILE"` when either group or world permissions are non-zero.

Failure scenario:
A new operator follows the documented deploy helper instructions exactly, creates `.env.deploy`, and the first `npm run deploy` aborts locally before SSH because the file is `0644`. In the per-iteration workflow this blocks the production deploy step and can lead to ad hoc retries or skipped deploy evidence, even though the helper is correctly failing closed around secrets.

Suggested fix:
Add `chmod 600 .env.deploy` immediately after the copy step in `README.md`, `CLAUDE.md`, and the `.env.deploy.example` comments. Optionally mention the same requirement in `AGENTS.md` so agent-run deploys do not rediscover the failure path.

## Non-Findings

- Docker prune policy and docs currently line up: `apps/web/deploy.sh:56-81`, `AGENTS.md:17-20`, `CLAUDE.md:471-492`, and `.omc/wiki/deploy-disk-hygiene-runbook.md:20-25` all agree on health-gated prune-after-up, bind-mounted persistence, and `docker volume prune -f` without `-a`.
- Nginx body-size and proxy docs match the checked-in config: `apps/web/nginx/default.conf:33`, `apps/web/nginx/default.conf:60`, `apps/web/nginx/default.conf:76-77`, `apps/web/nginx/default.conf:93-95`, `apps/web/nginx/default.conf:133-135`, and the matching README/CLAUDE descriptions.
