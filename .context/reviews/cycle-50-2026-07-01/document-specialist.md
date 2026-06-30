# Cycle 50 Docs / Deploy Drift Review

Perspective: document-specialist / docs-deploy-drift lane.
Scope: README, CLAUDE.md, AGENTS.md, deploy docs/scripts, env examples, migration runbooks, and operator-facing comments that could mislead operators.

## Inventory

- Project/operator docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Deploy/runtime surfaces: `package.json`, `apps/web/package.json`, `scripts/deploy-remote.sh`, `.env.deploy.example`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, `.dockerignore`, `apps/web/.dockerignore`.
- Environment examples and config docs: `apps/web/.env.local.example`, `.env.deploy.example`, `apps/web/src/site-config.example.json`, `apps/web/src/site-config.json`.
- Migration/runbook surfaces: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts` by inventory.
- Deploy/runbook contract tests: `apps/web/src/__tests__/deploy-script-contract.test.ts`, `apps/web/src/__tests__/nginx-config.test.ts`, `apps/web/src/__tests__/cycle-22-source-contracts.test.ts`, `apps/web/src/__tests__/content-security-policy.test.ts`.
- Current review/planning state: `.context/reviews/_aggregate.md`, `.context/reviews/cycle-49-2026-07-01/_aggregate.md`, `.context/reviews/cycle-49-2026-07-01/docs-deploy-drift.md`, `.context/plans/cycle-49-2026-07-01-plan.md`, `.context/plans/cycle-49-2026-07-01-deferred.md`.
- Git state: clean worktree before writing this artifact; HEAD `3a02f7ee` / `origin/master` (`fix(cycle-49): preserve viewing and topic-route guarantees`).

## Findings

No actionable new docs/deploy-drift findings found in this lane.

## Evidence

- Remote deploy permission drift from Cycle 49 is fixed, not re-raised: `README.md:123-127` now includes `chmod 600 .env.deploy`; `CLAUDE.md:679-684` includes the same step; `.env.deploy.example:1-4` tells operators the helper refuses group/world-readable env files; `scripts/deploy-remote.sh:65-72` enforces that contract before sourcing.
- Action-origin docs drift from Cycle 49 is fixed, not re-raised: `AGENTS.md:33` documents the auth-specific `hasTrustedSameOrigin` guard shape; `CLAUDE.md:619-624` says `auth.ts` is scanned and uses that approved branch; scanner behavior remains aligned through `apps/web/scripts/check-action-origin.ts` and its tests.
- Deploy disk-hygiene docs and script agree: `AGENTS.md:17-20`, `CLAUDE.md:471-508`, `README.md:197-199`, and `apps/web/deploy.sh:56-81` all describe prune-after-healthy-up, bind-mounted data, and `docker volume prune -f` without `-a`. `apps/web/src/__tests__/deploy-script-contract.test.ts:21-55` pins prune ordering and no all-volume prune.
- Build-time/runtime env propagation is documented and wired: `README.md:161-164`, `apps/web/docker-compose.yml:7-11`, `apps/web/Dockerfile:70-77`, and `apps/web/src/__tests__/deploy-script-contract.test.ts:85-92` all agree on `BASE_URL`, `IMAGE_BASE_URL`, `UPLOAD_MAX_TOTAL_BYTES`, and `NEXT_UPLOAD_BODY_MAX_BYTES`.
- Nginx body caps and proxy trust docs match config: `README.md:164-167`, `apps/web/README.md:51-54`, `CLAUDE.md:590`, and `apps/web/nginx/default.conf:33`, `:60`, `:76-77`, `:93-95`, `:133-135` agree on the 2 MiB / 64 KiB / 250 MiB / 216 MiB route caps and trusted forwarded-header shape. `apps/web/src/__tests__/nginx-config.test.ts:19-45` pins these claims.
- Site config and Google Analytics docs match code: `README.md:52-68`, `apps/web/README.md:45-47`, `apps/web/src/site-config.example.json:1-10`, `apps/web/src/proxy.ts:44-48`, and `apps/web/src/app/[locale]/layout.tsx:147-157` show file-backed `google_analytics_id` controls GA loading and CSP allowance. `apps/web/src/__tests__/content-security-policy.test.ts:5-52` covers the GA CSP branch.
- Migration runbook claims match the migrator wrapper and journal tests: `AGENTS.md:24-27` and `CLAUDE.md:430-459` describe strictly advancing future `when` values, per-entry hash baselining, and postcondition failure; `apps/web/scripts/migrate.js:180-195`, `:720-823`, and `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:44-75`, `:113-119` pin the implementation and the historical inversion allowlist.
- CLIP/semantic-search operator docs remain dark-gated and aligned: `README.md:42`, `apps/web/README.md:60-82`, `CLAUDE.md:515-564`, `apps/web/.env.local.example:75-84`, `apps/web/Dockerfile:98-102`, and `apps/web/scripts/backfill-clip-embeddings.ts:95-113` all require model seeding plus `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` before production mode.
- Prior carry-forward items were intentionally not re-raised: `.context/plans/cycle-49-2026-07-01-deferred.md:7-12` still carries `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`; I found no new evidence changing severity or scheduling for this lane.

## Exclusions

- Cycle 49 findings are not re-filed here. The current HEAD is the Cycle 49 fix commit, and the docs/deploy-specific Cycle 49 findings (`C49-03`, `C49-04`, `C49-05`) are either visibly fixed in current docs or were workflow-state updates outside this lane's new-finding scope.
- Historical `.omc/` and older `plan/` artifacts were treated as historical unless they contradicted current operator-facing docs. No such live contradiction was found.
