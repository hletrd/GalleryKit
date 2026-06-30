# Verifier Review - Cycle 24/100

Role: verifier  
Review target: current HEAD `0cc094dd76d51e88fe163c0b7075e3f0b341f74c` (`fix(deploy): allow mounted deploy env ownership`)  
Workspace: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-06-30

## Scope And Inventory

I reviewed current HEAD, not prior-cycle assumptions. `git status --short` was clean before the review artifact edit.

Relevant behavior under review: the repo-level deploy helper must read the gitignored root `.env.deploy` when present, allow this checkout's mounted env file even when its numeric owner differs from the local user, keep unsafe permission refusal before sourcing, derive the SSH deploy command from config, and delegate production deploy to `apps/web/deploy.sh` without weakening the documented Docker prune/data-persistence invariants.

Relevant files inventoried and examined:

- Deploy helper and direct entrypoint: `scripts/deploy-remote.sh`, `package.json`.
- Deploy docs/contracts: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.env.deploy.example`.
- Host deploy/runtime config: `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`.
- Build-context persistence guards: `.dockerignore`, `apps/web/.dockerignore`.
- Test contracts directly covering this surface: `apps/web/src/__tests__/deploy-script-contract.test.ts`, plus related source-contract references in `apps/web/src/__tests__/cycle-21-source-contracts.test.ts` and `apps/web/src/__tests__/client-source-contracts.test.ts`.

I also ran repo-wide targeted searches for deploy/env/prune terms across tracked docs, plans, reviews, tests, and scripts to avoid sampling only the changed file.

## Confirmed Issues

None.

The HEAD diff is limited to `scripts/deploy-remote.sh:61-63`, changing the prior non-owner hard failure into a warning. The surrounding checks still reject group/world write or execute bits before sourcing the env file at `scripts/deploy-remote.sh:65-73`, and the file is sourced only after those checks at `scripts/deploy-remote.sh:75-78`.

Why this matches the contract:

- Root `.env.deploy` precedence and fallback are implemented at `scripts/deploy-remote.sh:22-29`, matching `CLAUDE.md:662-671`, `README.md:120-130`, `AGENTS.md:17-18`, and `.env.deploy.example:1-4`.
- The deploy command remains config-derived from `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`, `DEPLOY_PATH`, and optional `DEPLOY_REMOTE_SCRIPT` at `scripts/deploy-remote.sh:31-52`; `DEPLOY_CMD` remains the explicit escape hatch at `scripts/deploy-remote.sh:80-83`.
- `package.json:11-22` routes `npm run deploy` to `./scripts/deploy-remote.sh`.
- Host deploy still starts the stack before pruning at `apps/web/deploy.sh:28-59`, and `docker volume prune` remains `-f` only, not `-a`.
- Compose persistence still uses narrow bind mounts for data, uploads, resources, and read-only site config at `apps/web/docker-compose.yml:24-28`, matching the persistence guarantees in `AGENTS.md:19`, `CLAUDE.md:471-473`, and `README.md:196-198`.
- Build contexts still exclude mutable runtime public data at `.dockerignore:16-20` and `apps/web/.dockerignore:7-10`.

## Likely Issues

None identified.

The only subtle area is local secret-file hygiene: `scripts/deploy-remote.sh:69` intentionally rejects group/world write or execute bits, not group/world read bits. That is consistent with the HEAD commit's stated constraint and preserves the pre-existing permission model. I did not classify it as a current defect because the docs describe `.env.deploy` as gitignored SSH target configuration, not as a private-key material file, and the current local mounted `.env.deploy` is `0644`, non-owner, and readable.

## Risks Needing Manual Validation

1. Live remote deploy was not exercised in this verifier pass.
   - Severity: Low
   - Confidence: High
   - Code/docs region: `scripts/deploy-remote.sh:85-86`, `CLAUDE.md:463-473`, `apps/web/deploy.sh:10-32`.
   - Scenario: local helper validation passes, but the remote host rejects SSH, `git pull --ff-only`, Docker build, or runtime startup for environment-specific reasons.
   - Fix/validation: run `npm run deploy` only in an authorized deploy iteration, then probe `/api/live` and inspect deploy output for the post-`up -d` prune/`df -h /` lines.

2. Non-owner env behavior depends on the mounted file being readable by the current user.
   - Severity: Low
   - Confidence: High
   - Code/docs region: warning at `scripts/deploy-remote.sh:61-63`, source at `scripts/deploy-remote.sh:75-78`.
   - Scenario: another checkout has a non-owned `.env.deploy` with mode `0600`; the helper no longer fails at the owner check, but `source "$ENV_FILE"` fails with permission denied.
   - Fix/validation: keep the mounted file readable by the local user or set `DEPLOY_ENV_FILE` to a readable path. If future policy requires non-owner `0600` support, use filesystem ownership/ACLs outside this script rather than weakening the source-time permission boundary.

## Validation Evidence

- `bash -n scripts/deploy-remote.sh && bash -n apps/web/deploy.sh` passed.
- Temporary-env smoke: `DEPLOY_ENV_FILE=<0600 temp file>` with `DEPLOY_CMD='printf helper-ok'` executed successfully.
- Temporary-env permission checks: mode `0622` and mode `0611` both refused before sourcing with "Refusing to source deploy env file with unsafe permissions".
- Temporary-env read-permitted check: mode `0644` executed successfully, matching the intended local mounted `.env.deploy` behavior.
- `npm test --workspace=apps/web -- --run src/__tests__/deploy-script-contract.test.ts` passed: 1 file, 8 tests.
- `npm run typecheck --workspace=apps/web -- --help` unintentionally ran the app typecheck prerequisite before printing npm help for the second script; the app typecheck portion passed through Next route type generation and `tsc -p tsconfig.typecheck.json --noEmit`. I did not count this as full typecheck coverage because `typecheck:scripts` was not run normally.
- Local `.env.deploy` metadata was checked without reading secret values: regular file, mode `644`, uid/gid `3000`, readable by current user, not owned by current user. `.env.deploy` is gitignored by `.gitignore:18`.

## Final Sweep And Skipped Files

Final sweep covered deploy helper command construction, env-file precedence, unsafe permission checks, config-driven SSH derivation, docs alignment, Docker deploy prune ordering, bind-mount persistence guarantees, Docker build-context excludes, and direct test contracts for those invariants.

Skipped as not relevant to this HEAD behavior: application feature source under `apps/web/src/**` outside the deploy/source-contract tests, migrations, binary/image fixtures, generated `.next` output, screenshots, local `.omx`/`.omc` state, and historical `.context` artifacts except where targeted searches established deploy-contract context. I did not read secret contents from `.env.deploy` or `apps/web/.env.local`.

Verdict: no confirmed or likely correctness issue in current HEAD for the deploy-helper ownership change.
