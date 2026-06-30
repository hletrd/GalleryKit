# Cycle 40 Docs / Product / Runbook Drift Review

Scope: documentation-code drift, product/deploy runbook drift, README/CLAUDE/AGENTS consistency, package scripts, migration/runbook instructions, and current-source alignment.

HEAD reviewed: `490b93c5`.

## Inventory Built

- Primary docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Deploy/runbook files: `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, `apps/web/.env.local.example`.
- Package/script surfaces: root `package.json`, `apps/web/package.json`, `package-lock.json`.
- Migration surfaces: `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/00*.sql`, `apps/web/scripts/migrate.js`, migration journal/reconcile tests.
- Product/source surfaces sampled for doc claims: semantic search config/routes/scripts, CLIP path/model helpers, external upload API route, upload limit helpers, site config/SEO references, storage quarantine comments, paid-download removal guards, auto-alt-text script notes.
- Prior-cycle filter: `.context/reviews/cycle-39-2026-06-30/docs-product-deploy-local.md`, `.context/reviews/cycle-39-2026-06-30/_aggregate.md`, `.context/plans/cycle-39-2026-06-30-deferred.md`.
- Current-cycle neighbor artifacts checked for overlap: `perf-concurrency-deploy.md` and `security-privacy.md`.
- Installed prompt caveat: `~/.codex/agents/product-marketer-reviewer.md` and `~/.codex/agents/ui-ux-designer-reviewer.md` are BurstPick-specific. They would be inappropriate routing surfaces for GalleryKit product/docs review, but this is not a GalleryKit repo bug because the files are outside this workspace.

## Findings

No actionable new findings in this lane.

## Evidence

- AGENTS deploy/schema/quality-gate summary matches the current repo scripts and runbooks: root deploy is `./scripts/deploy-remote.sh` (`package.json:11-23`), documented root deploy policy is present (`AGENTS.md:15-20`), migration checklist points at `_journal.json` + `migrate.js` + privacy guards (`AGENTS.md:22-27`), and quality gates map to existing app scripts (`AGENTS.md:29-38`, `apps/web/package.json:8-27`).
- Remote deploy docs match the helper and script behavior. `README.md:119-129` documents `.env.deploy`, fallback env path, derived SSH fields, `DEPLOY_REMOTE_SCRIPT`, and `DEPLOY_CMD`; `scripts/deploy-remote.sh:15-56` implements that resolution and validates env-file ownership/permissions before sourcing; `.env.deploy.example:1-14` exposes the same fields.
- Deploy disk-hygiene docs match executable behavior. `AGENTS.md:17-20`, `README.md:197-202`, and `CLAUDE.md:470-492` describe post-health prune behavior and bind-mounted persistence; `apps/web/deploy.sh:32-81` waits for health/live success, then runs `docker container prune -f`, `docker image prune -af`, `docker builder prune -af`, and `docker volume prune -f` after `up -d --build`.
- Docker topology docs match compose/nginx/source. README documents host networking, localhost binding, `TRUST_PROXY=true`, bind mounts, and reverse-proxy `/uploads` behavior (`README.md:160-165`, `:184-202`; `apps/web/README.md:45-56`); compose sets host networking, `HOSTNAME=127.0.0.1`, `TRUST_PROXY=true`, and the documented data/resource/site-config mounts (`apps/web/docker-compose.yml:15-28`); nginx keeps `/api/admin/lr/upload` at 216 MiB ahead of the generic `/api/admin/` 2 MiB cap (`apps/web/nginx/default.conf:124-151`).
- Upload API docs align with route behavior. README/app README specify `POST /api/admin/lr/upload`, `X-GalleryKit-Token`, `lr:upload`, multipart `file` + `topic` with optional `title`/`description`, 200 MiB per-file / 2 GiB window / 100 file limits, and no generated filename in the response (`README.md:204-215`, `apps/web/README.md:87-96`). The route enforces the same scope and fields (`apps/web/src/app/api/admin/lr/upload/route.ts:1-18`, `:84-92`, `:188-249`) and uses the documented upload caps (`apps/web/src/lib/upload-limits.ts:1-21`).
- Semantic-search runbook matches current source. README and app README describe disabled-by-default production gating, offline CLIP weights, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, bounded scans, and sidecar backfill (`README.md:42`, `apps/web/README.md:60-81`); CLAUDE gives exact seed/backfill commands and activation steps (`CLAUDE.md:500-559`); source gates production mode behind the env flag and resolves offline model roots (`apps/web/src/lib/gallery-config.ts:66-125`, `apps/web/src/lib/clip-model.ts:181-210`, `apps/web/src/lib/clip-paths.ts:48-76`, `apps/web/scripts/backfill-clip-embeddings.ts:91-146`).
- Migration/runbook instructions are consistent with the non-monotonic journal and helper. AGENTS/CLAUDE require new journal `when` values to exceed the current max (`AGENTS.md:22-27`, `CLAUDE.md:426-447`); current journal has 29 entries, historical non-monotonic entries, and latest `0028_rate_limit_bucket_start_idx` at the max `1782812037323`; `migrate.js` reads journal entries by SQL hash, reconciles legacy schema, baselines missing hash rows, and post-checks every journal hash (`apps/web/scripts/migrate.js:180-193`, `:317-720`, `:721-821`). The historical-comment warning in `CLAUDE.md:448` also matches remaining migration/source comments about removed Lightroom/plugin/Florence/planned surfaces.
- Product-positioning docs remain aligned with source and guardrails. README says no editing/culling/scoring/payment surface (`README.md:29-46`), and CLAUDE permanently defers Stripe/paid downloads (`CLAUDE.md:576-578`); current source/tests retain paid-download removal guards and no active payment dependency. Storage docs correctly quarantine S3/MinIO switching as not integrated (`CLAUDE.md:149`, `apps/web/src/lib/storage/index.ts:1-9`).
- Env examples contain the operator variables documented in CLAUDE/README: upload caps, health/readiness, proxy trust, CLIP production gate/model root, semantic limits, backfill concurrency, and cleanup concurrency (`apps/web/.env.local.example:1-84` vs. `CLAUDE.md:84-119`, `README.md:131-168`).

## Not Re-raised

- Cycle-39 deferred migration/index work (`PERF-C39-03`, `PERF-C39-04`) remains migration-shaped and was not reclassified; no docs/source drift changed its severity.
- Cycle-39 broad scanner and sidecar-pagination deferred items remain outside this docs/product lane.
- The BurstPick-specific installed prompt files affect reviewer routing choice only; they are not committed GalleryKit artifacts and do not create repo documentation drift.

## Disposition

New findings: 0.

Recommendation: no docs/product/deploy runbook fix is scheduled from this lane for cycle 40.
