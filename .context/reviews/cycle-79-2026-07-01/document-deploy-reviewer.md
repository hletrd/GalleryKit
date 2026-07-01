# Cycle 79 Documentation + Deploy Drift Review

Reviewed HEAD: `9cc143d06f3b4f9fe1862316c0f449f745926829`

Scope: `AGENTS.md`, `CLAUDE.md`, root/app package scripts, Dockerfile, deploy helpers, compose config, migration runbook/tests, Cycle 77/78 plan/review ledgers, and deploy/runtime dependency contract tests.

Validation run:

- `npm test --workspace=apps/web -- --run src/__tests__/deploy-script-contract.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/migrate-reconcile-coverage.test.ts` - pass: 3 files, 101 tests.

## Findings

### C79-DOCDEP-01 - Cycle 78 release ledger still reads active and undeployed

- Severity: Medium
- Confidence: High
- Citations: `AGENTS.md:17`, `CLAUDE.md:469`, `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/cycle-78-2026-07-01-plan.md:3`, `.context/plans/cycle-78-2026-07-01-plan.md:48`, `.context/plans/cycle-78-2026-07-01-plan.md:50`, `.context/plans/cycle-78-2026-07-01-plan.md:51`, `.context/reviews/_aggregate.md:3`, `.context/reviews/_aggregate.md:12`
- Problem: project policy says every commit pushed to `master` is followed by `npm run deploy`, but Cycle 78's plan index still marks Cycle 78 as the active current-cycle plan and the Cycle 78 plan leaves commit/push and deploy unchecked. The review pointer also still says Cycle 78 findings are scheduled, even though current HEAD is `9cc143d0` and `origin/master` points at that commit.
- Failure scenario: a future reviewer/operator treats Cycle 78 as still in progress or assumes the runtime Sharp fix is deployed because HEAD advanced, while the committed ledger provides no terminal deploy evidence. This recreates the stale-cycle ambiguity that Cycle 78 itself fixed for Cycle 77.
- Suggested fix: update the Cycle 78 plan with terminal commit/push evidence for `9cc143d0` and either deploy evidence or an explicit deploy-not-run/blocker. Move Cycle 78 from "Active Current-Cycle Plans" into recent/closed state, and advance `.context/reviews/_aggregate.md` only after Cycle 79 aggregate exists.

### C79-DOCDEP-02 - Dockerfile runner-stage comment says prod-deps are only for migrations, but runtime now depends on them

- Severity: Low
- Confidence: High
- Citations: `apps/web/Dockerfile:68`, `apps/web/Dockerfile:69`, `apps/web/Dockerfile:70`, `apps/web/Dockerfile:77`, `apps/web/Dockerfile:80`, `apps/web/Dockerfile:141`, `apps/web/Dockerfile:142`, `apps/web/Dockerfile:143`, `apps/web/next.config.ts:45`, `apps/web/next.config.ts:50`, `CLAUDE.md:363`, `CLAUDE.md:497`
- Problem: Cycle 78 correctly added runtime Sharp native optional dependency installation and a `require('sharp')` smoke check in the `prod-deps` stage, and Next explicitly externalizes `sharp`/CLIP native packages. But the runner-stage comment above `COPY --from=prod-deps /app/node_modules` still says production dependencies are "for migrate.js" and "only for the migration script."
- Failure scenario: a future Docker cleanup trusts the stale comment and removes or narrows the `prod-deps` copy as migration-only, breaking runtime uploads, topic covers, CLIP image embedding, or OG generation that require externalized native packages from `/app/node_modules`.
- Suggested fix: rewrite the runner-stage comment to say the copied prod-deps tree serves both `migrate.js` (`argon2`, `mysql2`, `drizzle-orm`) and runtime external packages (`sharp`, `@huggingface/transformers`/`onnxruntime-node` as applicable). Keep the Cycle 78 `deploy-script-contract.test.ts` runtime Sharp smoke assertion.

## Confirmed Non-Findings

- Root deploy helper drift: root `npm run deploy` calls `scripts/deploy-remote.sh` (`package.json:22`); the helper selects `.env.deploy`, `$HOME/.gallerykit-secrets/gallery-deploy.env`, or `DEPLOY_ENV_FILE`, derives SSH from env fields, and enforces `chmod 600` before sourcing (`scripts/deploy-remote.sh:22`, `scripts/deploy-remote.sh:31`, `scripts/deploy-remote.sh:65`, `scripts/deploy-remote.sh:76`, `scripts/deploy-remote.sh:82`, `scripts/deploy-remote.sh:87`). This matches the operator docs (`AGENTS.md:17`, `AGENTS.md:18`, `README.md:120`, `README.md:131`, `CLAUDE.md:678`, `CLAUDE.md:680`).
- Deploy prune/runtime persistence drift: docs require prune-after-up, bind-mounted data, and no `volume prune -a` (`AGENTS.md:19`, `CLAUDE.md:475`, `CLAUDE.md:477`, `README.md:200`). `apps/web/deploy.sh` health-checks the new container before pruning and uses `docker volume prune -f` only (`apps/web/deploy.sh:55`, `apps/web/deploy.sh:57`, `apps/web/deploy.sh:73`, `apps/web/deploy.sh:99`, `apps/web/deploy.sh:103`); compose persists only the documented bind mounts (`apps/web/docker-compose.yml:24`, `apps/web/docker-compose.yml:25`, `apps/web/docker-compose.yml:26`, `apps/web/docker-compose.yml:27`, `apps/web/docker-compose.yml:28`).
- Migration runbook alignment: docs require strictly increasing new journal `when` values and a `reconcileLegacySchema` mirror (`AGENTS.md:24`, `AGENTS.md:25`, `AGENTS.md:26`, `CLAUDE.md:440`, `CLAUDE.md:443`, `CLAUDE.md:444`). The latest journal entry is `0028_rate_limit_bucket_start_idx` with a later `when` than prior entries (`apps/web/drizzle/meta/_journal.json:201`, `apps/web/drizzle/meta/_journal.json:204`, `apps/web/drizzle/meta/_journal.json:205`), and the targeted migration journal/reconcile tests passed.
- Runtime/sidecar dependency docs mostly match current code: docs warn not to `npm install` inside `gallerykit-web` and direct one-off TypeScript scripts to sidecars (`AGENTS.md:20`, `CLAUDE.md:345`, `CLAUDE.md:363`, `CLAUDE.md:497`, `CLAUDE.md:499`). The Dockerfile now installs and smokes runtime Sharp native deps in `prod-deps` (`apps/web/Dockerfile:63`, `apps/web/Dockerfile:71`, `apps/web/Dockerfile:77`, `apps/web/Dockerfile:80`), and the source contract test pins that behavior (`apps/web/src/__tests__/deploy-script-contract.test.ts:268`, `apps/web/src/__tests__/deploy-script-contract.test.ts:273`, `apps/web/src/__tests__/deploy-script-contract.test.ts:275`).
