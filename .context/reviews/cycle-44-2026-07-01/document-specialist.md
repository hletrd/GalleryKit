# Cycle 44 Document / Repo-Contract Review

Scope: docs/code/deploy drift, stale runbooks, migration rules, generated assets, package/tooling version claims, and operator instructions that could cause production mistakes.

## Findings

### DOC-C44-01 [MEDIUM, confidence High] - CLIP production activation docs omit the required container recreate/redeploy after adding the env opt-in

Where:
- `apps/web/README.md:74-79` tells operators to seed weights, backfill, set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` in `.env.local`, then set `admin_settings.semantic_search_mode='production'`.
- `CLAUDE.md:547-553` gives the same activation sequence.
- `apps/web/docker-compose.yml:18-22` loads `.env.local` into the container at container creation time.
- `apps/web/src/lib/gallery-config.ts:123-126` reads `process.env.SEMANTIC_SEARCH_ALLOW_PRODUCTION` in the already-running Node process.
- `apps/web/src/lib/gallery-config-shared.ts:206-211` heals a stored `production` mode to `disabled` unless that process env flag is true.

Failure scenario:

An operator follows the runbook literally on an already-running deploy: seed model weights, run the forced backfill sidecar with the env override, edit `.env.local`, then update the DB row to `production`. The live `gallerykit-web` process still has the old environment until compose recreates/restarts it, so both semantic and similar routes continue resolving production mode as disabled and return 503. This looks like a failed CLIP activation even though weights and embeddings are present.

Suggested fix:

Change the live runbook to make env application explicit. Either require setting `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` before the deploy/recreate that will serve production CLIP, or add a step after editing `.env.local` such as `npm run deploy` / `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build` before flipping the DB row. Add a final verification step that confirms the running container sees `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` before `admin_settings.semantic_search_mode='production'` is written.

### DOC-C44-02 [LOW, confidence High] - Cycle 43 closure context still marks the cycle active and terminal work incomplete after the source reached origin

Where:
- `.context/plans/README.md:5-8` still lists Cycle 43 as the active current-cycle plan.
- `.context/plans/cycle-43-2026-07-01-plan.md:42-49` marks implementation, tests, and gates done but leaves `Commit, push, deploy` unchecked.

Evidence:

`git status --short --branch` is clean on `master...origin/master`, and `git rev-parse HEAD origin/master` returns the same commit, `f417d86b60c4412f7140fc0a8a9f5bfee577fb90` (`fix(cycle-43): 🐛 harden lint guard provenance`). I did not find committed deploy evidence for that terminal Cycle 43 step.

Failure scenario:

A later agent treats Cycle 43 as still active, repeats already-landed source work, or assumes the production deploy happened because the source is pushed while the committed plan still leaves deploy unchecked. This is the same class of context drift Cycle 43 fixed for Cycle 42, now moved forward one cycle.

Suggested fix:

Update `.context/plans/README.md` and `.context/plans/cycle-43-2026-07-01-plan.md` to record the actual terminal state. If deploy completed, add the deploy evidence; if not, mark source committed/pushed and deploy pending/evidence not found explicitly.

## No New Finding

- Deploy helper and Docker prune contract matched docs: root `npm run deploy` delegates to `scripts/deploy-remote.sh`; host deploy runs `apps/web/deploy.sh`; prune occurs after health check and uses bind mounts plus `docker volume prune -f` without `-a`.
- Migration runbook matched implementation: non-monotonic journal handling, per-entry hash baselining, postcondition checks, and `reconcileLegacySchema` mirroring are present in `apps/web/scripts/migrate.js`; latest journal entry uses the current max `when` pattern.
- Generated service worker was current: computed `SW_VERSION` from `sw.template.js` plus `IMAGE_PIPELINE_VERSION=7` was `533c2634-p7`, matching `apps/web/public/sw.js`.
- PWA icon dimensions matched the generator contract: 192x192, 512x512, and maskable 512x512 PNGs exist.
- Package/tooling version claims were locally consistent: lockfile resolves Next 16.2.9, React 19.2.7, TypeScript 6.0.3, `@huggingface/transformers` 3.8.1, `onnxruntime-node` 1.21.0, `tsx` 4.22.4; Docker uses `node:24-slim` and `apps/web/package.json` requires Node >=24.
- Known carried-forward items were not re-raised: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`.
