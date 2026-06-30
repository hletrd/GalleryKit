# Cycle 28 Document Specialist Review

Reviewer: cycle-28 document-specialist
Repository: `/Users/hletrd/flash-shared/gallery`
Scope: repository-wide documentation/code mismatch review against authoritative repo docs, runbooks, comments, env examples, README files, CLAUDE.md, AGENTS.md, docs, package scripts, deploy/migration instructions, and tests.
Mode: Prompt 1 review only. No fixes implemented.

## Inventory First

I first inventoried the review-relevant text surfaces, then checked documentation claims against implementation and contract tests. Binary assets, build outputs, dependency directories, screenshots, generated session state, and historical logs were excluded from mismatch authority unless they explicitly carried current operator instructions.

Authoritative root/project docs examined:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `.env.deploy.example`
- `package.json`
- `package-lock.json` metadata for workspace/dependency agreement

App docs, env examples, and configuration examined:

- `apps/web/README.md`
- `apps/web/.env.local.example`
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.typecheck.json`
- `apps/web/tsconfig.scripts.json`
- `apps/web/vitest.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/tailwind.config.ts`
- `apps/web/components.json`
- `apps/web/drizzle.config.ts`

Deploy, migration, and operator scripts examined:

- `scripts/deploy-remote.sh`
- Every file under `apps/web/scripts/` was inventoried and scanned for operator/runbook claims.
- Direct line review was performed for `apps/web/scripts/migrate.js`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/download-clip-models.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/scripts/run-e2e-server.mjs`, and lint/check scripts when they backed documented quality gates.

Schema and migration surfaces examined:

- Every committed migration under `apps/web/drizzle/*.sql`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/drizzle/meta/0000_snapshot.json`
- `apps/web/drizzle/meta/0001_snapshot.json`
- `apps/web/src/db/schema.ts`
- `apps/web/scripts/migrate.js`

Source and source-comment surfaces examined:

- All files under `apps/web/src/` were inventoried and scanned for review-relevant comments, constants, exported contracts, route behavior, privacy filters, upload limits, color/HDR settings, semantic-search gates, deploy/runtime assumptions, and rate-limit/auth/origin claims.
- Direct line review was performed for the matched implementation anchors behind the findings and for the major documented contracts: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/clip-paths.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/gallery-config.ts`, upload/serve routes, health/live routes, and admin action/API guard surfaces.

Tests examined:

- All files under `apps/web/src/__tests__/` were inventoried and scanned for documented contract claims.
- Direct line review was performed for contract tests covering deploy scripts, nginx caps, semantic search, CLIP paths/offline loading, upload limits, process-image pixel caps, privacy fields, migration journals/reconcile coverage, health/live routes, action-origin/API-auth/public-route-rate-limit lints, and touch-target audit.
- All files under `apps/web/e2e/` were inventoried and scanned for deployment/runtime claim relevance.

Docs and historical planning/review surfaces examined:

- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`
- `.context/plans/README.md`
- `.context/plans/` and `.context/reviews/` were inventoried for current-cycle carry-forward signals. Historical/archive files and generated artifacts were not treated as current authority when they had archive/historical banners or were prior review records.

Explicit exclusions from authority:

- `node_modules/`, `.git/`, `.next/`, Playwright/Vitest output, screenshots, binary image fixtures, `.omx/state/`, generated session/worktree artifacts, and archived review/plan history unless referenced by current docs.
- The CLIP `docs/superpowers/...` files were examined but treated as historical because both carry status banners directing readers to current code, `apps/web/README.md`, and `CLAUDE.md`.

## Findings

### DOC-C28-01 - CLIP backfill script's embedded production sidecar example omits the originals data mount

Status: Confirmed
Severity: Medium
Confidence: High

Evidence:

- `apps/web/scripts/backfill-clip-embeddings.ts:9-20` gives an inline production `docker run --rm` example. It mounts `src`, `scripts`, and `.../data/models/clip:/app/data/models/clip:ro`, but it does not mount the full `apps/web/data` tree or `/app/data/uploads/original`.
- The same script's production mode resolves and embeds private originals: `apps/web/scripts/backfill-clip-embeddings.ts:173-178` calls `resolveOriginalUploadPath(filenameOriginal)` and fails the row when the original path cannot be found.
- `apps/web/src/lib/upload-paths.ts:27-38` resolves private originals from `UPLOAD_ORIGINAL_ROOT` or cwd-relative `data/uploads/original`; `apps/web/src/lib/upload-paths.ts:58-69` returns `null` if neither the private nor legacy candidate exists.
- The authoritative current CLIP runbook in `CLAUDE.md:523-535` mounts `<deploy-root>/apps/web/data:/app/data` for the production backfill sidecar and sets `CLIP_MODELS_ROOT=/app/data/models/clip`.

Problem:

The script-local runbook contradicts the current CLAUDE.md runbook. It gives operators a command that has model weights but not the original image files required by `--production`.

Concrete failure scenario:

An operator follows the inline script header instead of CLAUDE.md. The sidecar starts, connects to the DB, selects processed images, then `resolveOriginalUploadPath()` cannot find `/app/data/uploads/original/...` because that path was never mounted. Each selected row increments `failed`; no production embeddings are written. If this is missed before flipping production semantic search, the public semantic/similar paths can remain unavailable or empty of meaningful results even though the model-weight seed appeared complete.

Suggested fix:

Update the header example in `apps/web/scripts/backfill-clip-embeddings.ts` to mirror the current CLAUDE.md sidecar: mount `<deploy-root>/apps/web/data:/app/data`, keep `src` and `scripts` read-only, and pass `-e CLIP_MODELS_ROOT=/app/data/models/clip`. Optionally add an explicit note that production backfill needs originals under `/app/data/uploads/original`, not only the CLIP model directory.

### DOC-C28-02 - Scientific-notation pixel-cap comments/test title claim `256e6` equals the 256 MiB default

Status: Confirmed
Severity: Low
Confidence: High

Evidence:

- `apps/web/src/lib/process-image.ts:345-347` says `Number('256e6') === 268435456`.
- The code immediately below actually uses `Number(process.env.IMAGE_MAX_INPUT_PIXELS ?? '')` and falls back to `256 * 1024 * 1024` only when the env value is invalid or non-positive: `apps/web/src/lib/process-image.ts:352-357`.
- The regression test title repeats the same wrong implication: `apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts:65-70` names the case "256e6 -> 268_435_456" but asserts `256_000_000`.
- Authoritative env docs use the plain default integer: `CLAUDE.md:102` and `apps/web/.env.local.example:35` document `268435456`.

Problem:

The implementation is correct, but two maintenance comments are mathematically false. `Number('256e6')` is `256000000`, not `268435456`. The default `268435456` comes from `256 * 1024 * 1024`, not from parsing `256e6`.

Concrete failure scenario:

A maintainer tuning decompression-bomb limits sees the comment/test title and believes `IMAGE_MAX_INPUT_PIXELS=256e6` is equivalent to the documented default. It is lower by 12,435,456 pixels. That could cause confusing near-threshold upload rejections and makes the env-parser regression test harder to trust because its name contradicts its assertion.

Suggested fix:

Change the comment and test title to say that `Number('256e6') === 256000000`, while the unset fallback remains `256 * 1024 * 1024 === 268435456`. Alternatively use `268435456` as the example env value when referring to the documented default.

### DOC-C28-03 - CLAUDE.md names a concrete production target despite the config-driven deploy policy

Status: Risk
Severity: Low
Confidence: Medium

Evidence:

- `AGENTS.md:17-18` says `npm run deploy` reads gitignored `.env.deploy`, the deploy host and SSH credentials are config-driven, and hostnames/key paths should stay in `.env.deploy`.
- `scripts/deploy-remote.sh:31-52` derives the SSH target from `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`, and `DEPLOY_PATH`.
- `.env.deploy.example:6-14` uses placeholder values and keeps the real target out of the committed example.
- `CLAUDE.md:465-467` says the current production target is `gallery.atik.kr`.

Problem:

The helper implementation and short-form AGENTS policy are config-driven, but the detailed runbook still hardcodes a concrete production hostname. This is not a code bug, and it may have been intentional status context, but it weakens the "keep hostnames in `.env.deploy`" policy and creates a stale-ops risk if the target changes.

Concrete failure scenario:

A future operator or agent reads CLAUDE.md as authoritative and treats `gallery.atik.kr` as the deployment target even if `.env.deploy` has been rotated to a different host. In the other direction, if the hostname is sensitive, the committed runbook leaks it despite the environment-file policy.

Suggested fix:

Remove the concrete hostname from CLAUDE.md or rephrase it as "the configured deploy host from `.env.deploy`". If a named host is intentionally allowed in docs, adjust AGENTS.md to clarify that the "do not hardcode" rule applies to scripts/examples/secrets rather than status prose.

## Confirmed Matches And Non-Findings

- Semantic-search production empty-state docs match code and tests: `apps/web/src/app/api/search/semantic/route.ts:285-289`, `apps/web/src/__tests__/semantic-route-production.test.ts:33-42`, and `apps/web/src/__tests__/semantic-search-route.test.ts:296-297` all agree on `503` plus `semantic_no_embeddings`.
- CLIP historical docs under `docs/superpowers/` are explicitly non-current: the spec banner at `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:4` and plan banner at `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:5` direct operators to current code, README, and CLAUDE.md. I did not file their design-time snippets as drift.
- Deploy-prune policy matches implementation: AGENTS/CLAUDE/README describe prune-after-up and `docker volume prune -f` without `-a`; `apps/web/deploy.sh:77-80` implements that sequence, and deploy-script contract tests pin it.
- Nginx upload caps, app upload caps, health/live routes, migration journal monotonicity, privacy-field omission, action/API guard lint commands, touch-target audit, and TypeScript script/app split all matched the current docs and tests on this pass.

## Missed-Issues Sweep

Final sweep commands covered broad terms for deploy, migration, schema, semantic search, CLIP, env defaults, sidecars, Docker pruning, health checks, privacy/sensitive fields, origin/auth guards, upload limits, touch targets, historical banners, and stale comments across `AGENTS.md`, `CLAUDE.md`, `README.md`, env examples, package scripts, `apps/web/scripts`, `apps/web/src`, `apps/web/e2e`, `apps/web/drizzle`, and `docs/`.

No review-relevant file was intentionally skipped. Generated artifacts, dependency/build outputs, binary fixtures, and explicitly historical/archive records were excluded from current-authority findings as noted in the inventory.

## Summary

Finding count: 3

- Medium: 1 confirmed operator-runbook mismatch.
- Low: 1 confirmed comment/test-title numeric mismatch, 1 deployment-doc policy risk.
- Fixes implemented: none, per Prompt 1 review-only instruction.
