# Cycle 42 Document / Deploy Drift Review

Date: 2026-07-01
HEAD reviewed: `6efd00a8`
Lane: documentation, deploy/runbook, migration, environment/config drift only. No source implementation performed.

## Inventory

Reviewed:

- Governance and deploy policy: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`.
- Runtime/deploy surfaces: `package.json`, `apps/web/package.json`, `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/.env.local.example`.
- Migration/restore surfaces: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, restore-maintenance runbook/script.
- Current context state: `.context/reviews/_aggregate.md`, `.context/reviews/cycle-41-2026-07-01/*`, `.context/plans/README.md`, `.context/plans/cycle-41-2026-07-01-plan.md`, `.context/plans/cycle-41-2026-07-01-deferred.md`, and recent carry-forward deferred files.

Stale/BurstPick prompt surfaces were not used as authoritative GalleryKit guidance. Cycle 41 document findings were rechecked and are now fixed at current HEAD: the CLIP sidecar examples include the `tsconfig.json` mount, and root README GPS copy matches the lock-after-first-photo runtime behavior.

## Findings

### DOC-C42-01 - Root deploy docs omit the build-time nature of `NEXT_UPLOAD_BODY_MAX_BYTES`

Severity: Low
Confidence: High

Evidence:

- Root README's sample environment block lists upload-related knobs through `UPLOAD_MAX_TOTAL_BYTES` and `UPLOAD_MAX_FILES_PER_WINDOW`, but not `NEXT_UPLOAD_BODY_MAX_BYTES`: `README.md:135-153`.
- The same deploy note tells operators to set `BASE_URL`, `IMAGE_BASE_URL`, or `UPLOAD_MAX_TOTAL_BYTES` before `next build` / Docker build, but omits `NEXT_UPLOAD_BODY_MAX_BYTES`: `README.md:159-160`.
- The variable is documented elsewhere as the Next.js Server Action body-size limit: `CLAUDE.md:119`; the app env example also documents it: `apps/web/.env.local.example:50-52`.
- Runtime config consumes it during Next config evaluation for `serverActions.bodySizeLimit` and `proxyClientMaxBodySize`: `apps/web/next.config.ts:92-100`.
- The Docker path treats it as a build-time value: Compose forwards it as a build arg at `apps/web/docker-compose.yml:7-11`, and the Dockerfile converts that arg into the builder env at `apps/web/Dockerfile:70-77`. A source-contract test already locks that forwarding: `apps/web/src/__tests__/deploy-script-contract.test.ts:85-90`.

Failure scenario:

An operator tuning upload/restore transport limits from the root deploy guide sees `UPLOAD_MAX_TOTAL_BYTES` called out as pre-build, but not `NEXT_UPLOAD_BODY_MAX_BYTES`. They adjust only runtime `.env.local` expectations or miss the body parser cap entirely, then the rebuilt app still uses the previous/default Server Action body-size limit. The app-level upload/restore caps remain safe, but custom transport-limit tuning fails in a way that looks like an nginx or upload bug.

Fix:

Add `NEXT_UPLOAD_BODY_MAX_BYTES=278921216` to the root README environment example and include it in the pre-build variable list at `README.md:160`. The wording should say this value is baked through Next config during build, while app-level per-file and restore limits still enforce the actual safety caps.

### DOC-C42-02 - Current context still marks Cycle 41 active and deploy state incomplete after the Cycle 41 fix is pushed

Severity: Medium
Confidence: High

Evidence:

- Project policy says `npm run deploy` from repo root is required after every commit pushed to `master`: `AGENTS.md:17`.
- The plans index still lists Cycle 41 as active: `.context/plans/README.md:5-9`.
- The Cycle 41 plan explicitly requires signing, pull-rebase, pushing, and deploying with `npm run deploy`: `.context/plans/cycle-41-2026-07-01-plan.md:42`.
- The same plan leaves the terminal "Commit, push, deploy" checkbox unchecked: `.context/plans/cycle-41-2026-07-01-plan.md:44-50`.
- Current git state shows `master` at `6efd00a8` tracking `origin/master` with no ahead/behind delta; the commit subject is `fix(cycle-41): 🐛 close scanner and sharing gaps`. That proves commit/push have happened, while the committed plan/index still present Cycle 41 as active/incomplete. I did not find committed deploy evidence for this specific Cycle 41 terminal step.

Failure scenario:

A later review or implementation lane reads the committed context, treats Cycle 41 as still active or not pushed/deployed, and either repeats already-landed implementation work or assumes the production deploy happened without evidence. Because this repo has no staging environment and deploy is the per-iteration production gate, an ambiguous terminal state is operational drift even when the source commit itself is correct.

Fix:

Update `.context/plans/README.md` and `.context/plans/cycle-41-2026-07-01-plan.md` to reflect the terminal state. If `npm run deploy` was completed, record the deploy evidence in the plan or a committed closure note. If it was not completed, leave a clear "deploy pending" note instead of mixing pushed source state with an active-cycle index.

## Confirmed Aligned / Not Re-raised

- Remote deploy helper docs align with `scripts/deploy-remote.sh`: root `.env.deploy` fallback before `$HOME/.gallerykit-secrets/gallery-deploy.env`, permission refusal before sourcing, derived SSH fields, `DEPLOY_REMOTE_SCRIPT`, and `DEPLOY_CMD`.
- Docker deploy safety docs align with `apps/web/deploy.sh`: `git pull --ff-only`, `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build`, bounded health wait, then prune of stopped containers, unused images, builder cache, and dangling volumes only.
- Nginx body-size and forwarded-header docs align with `apps/web/nginx/default.conf`: 2 MiB default, 64 KiB login, 250 MiB DB restore, 216 MiB dashboard upload, dedicated 216 MiB `/api/admin/lr/upload`, trusted forwarded proto preservation, and overwritten `X-Forwarded-For`.
- Migration guidance aligns with `apps/web/scripts/migrate.js` and `_journal.json`: new migrations need strictly greater `when` values, reconcile coverage for fresh/legacy baselines, and the post-condition asserts every committed journal hash is recorded.
- Backup/restore runbook claims align with runtime: DB dumps are SQL-only, backup/restore CLI TLS requires `DB_SSL_CA` for non-local DB hosts unless `DB_SSL=false`, restore runs post-import migrations, and filesystem-backed originals/derivatives/resources remain outside SQL dump rollback.
