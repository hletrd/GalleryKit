# Cycle 19 Document-Specialist Review

Date: 2026-06-30 KST
HEAD reviewed: `d4aea50f3e82f97077db2001dfec8fcccf7f1de8`
Scope: repository-wide documentation/code mismatch review. Review-only except for writing this report.

## Inventory

Read first: `AGENTS.md`, then `CLAUDE.md`.

Inventoried and inspected:

- Canonical docs: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`.
- Deploy/config surfaces: `.env.deploy.example`, `apps/web/.env.local.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, `apps/web/src/site-config.example.json`, `apps/web/src/site-config.json`.
- `.context` history: `.context/plans/README.md`, `.context/plans/cycle-19-plan.md`, `.context/plans/cycle-19-deferred.md`, relevant cycle-19 archive plans, current `.context/reviews/*.md`, recent document-specialist reports, and run/cycle aggregates used for provenance.
- Inline documentation and tests-as-docs: CLIP/semantic-search comments and tests, service-worker template/build tests, deploy-script contract tests, env parsing tests, action/auth/rate-limit source-contract tests, privacy/search/semantic tests, and i18n/user-facing messages.
- User-facing messages: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, especially semantic-search/settings/privacy/color copy.

Current worktree note: several other `.context/reviews/*.md` files were already modified before this report. I did not touch them.

## Findings

### DS19-01 - `CLIP_MODELS_ROOT` default is documented as the production bind mount, but code defaults to a cwd-relative path

Severity: Medium
Confidence: High

Files and regions:
- `CLAUDE.md:110-112`
- `CLAUDE.md:152`
- `CLAUDE.md:492-510`
- `apps/web/src/lib/clip-paths.ts:48-65`
- `apps/web/src/__tests__/clip-paths.test.ts:75-87`
- `apps/web/.env.local.example:70-75`

Mismatch:
The optional env table lists `CLIP_MODELS_ROOT` with default `/app/data/models/clip`. The implementation default is `DEFAULT_CLIP_MODELS_ROOT = 'data/models/clip'`, resolved against `cwd` when the env var is unset. The regression test explicitly pins the unset-env behavior as `/app/apps/web/data/models/clip` for a production-like cwd, while a separate test pins that only an explicit env value of `/app/data/models/clip` hits the production bind mount.

This also conflicts with the more precise CLAUDE text at `CLAUDE.md:152`, which says production `.env.local` MUST set the absolute `CLIP_MODELS_ROOT`.

Failure scenario:
An operator reads the env table, leaves `CLIP_MODELS_ROOT` unset because `/app/data/models/clip` appears to be the default, seeds weights into the bind mount, and enables production semantic search. The runtime loader resolves the unset env to the cwd-relative cache path instead, cannot find the seeded weights offline, and semantic/similar requests fail at runtime.

Fix:
Update the env table default to `data/models/clip` or `cwd/data/models/clip`, and say production must set `CLIP_MODELS_ROOT=/app/data/models/clip`. Consider uncommenting or marking it required in `.env.local.example` for production semantic search. Alternatively, change the resolver default to the production bind mount and update `clip-paths.test.ts`.

### DS19-02 - Semantic/CLIP operational env inventory is incomplete

Severity: Low
Confidence: High

Files and regions:
- `CLAUDE.md:88-112`
- `CLAUDE.md:540-544`
- `apps/web/README.md:62-64`
- `apps/web/.env.local.example:70-75`
- `apps/web/src/lib/clip-model.ts:53-64`, `apps/web/src/lib/clip-model.ts:94-110`
- `apps/web/src/lib/clip-embeddings.ts:22-44`
- `apps/web/src/__tests__/clip-model-contract.test.ts:32-38`
- `apps/web/src/__tests__/clip-semantic-limits-env.test.ts:30-87`

Mismatch:
The code exposes and tests four semantic/CLIP runtime knobs beyond the documented `CLIP_INFERENCE_CONCURRENCY`:

- `CLIP_INFERENCE_MAX_PENDING` default 32, max 1000.
- `CLIP_INFERENCE_QUEUE_TIMEOUT_MS` default 30000, max 300000.
- `SEMANTIC_SCAN_LIMIT` default 2000, hard clamp 25000.
- `SEMANTIC_TOP_K_MAX` default 50, hard clamp 25000.

CLAUDE documents `SEMANTIC_SCAN_LIMIT` and `SEMANTIC_TOP_K_MAX` only in the prose runtime-limits section, not in the optional env table or `.env.local.example`. The CLIP queue pending/timeout knobs are not documented in the README/env examples/CLAUDE env table at all, despite a source-contract test pinning their presence.

Failure scenario:
During a production semantic-search spike, an operator can discover `CLIP_INFERENCE_CONCURRENCY` from docs and raise model parallelism, but misses the hidden queue depth and timeout controls. The public semantic endpoint catches model-load/inference errors as 503 responses, so the deployment can look "configured but flaky" instead of obviously queue-budgeted. Separately, operators tuning large galleries may not find `SEMANTIC_SCAN_LIMIT` / `SEMANTIC_TOP_K_MAX` where all other operational env vars are listed.

Fix:
Add all four variables to CLAUDE's optional env table and `.env.local.example`, with defaults, caps, and short warnings. Keep the runtime-limits prose, but make it cross-reference the env table.

### DS19-03 - Sidecar runbook pins stale `tsx@4.21.0` while the repo has moved to `tsx` 4.22.x

Severity: Low
Confidence: High

Files and regions:
- `CLAUDE.md:340-353`
- `CLAUDE.md:503-527`
- `apps/web/package.json:80-84`
- `apps/web/package.json:8-10`

Mismatch:
The sidecar backfill/model-seed commands in CLAUDE hardcode `npx --yes tsx@4.21.0`, but the current app devDependency is `tsx` `^4.22.4`, and the local build scripts run the workspace `tsx`. Earlier review history treated `4.21.0` as matching the package baseline; that is no longer true.

Failure scenario:
A future script edit uses behavior covered by the checked-in `tsx` version and local gates, but the documented sidecar command runs an older one-off `tsx` binary. The sidecar path can fail in production while local `npm run build` / script typecheck remains green, or maintainers waste time debugging a version split that the runbook introduced.

Fix:
Update the three sidecar commands to the current tested `tsx` version, or document a deliberate policy such as "use the exact `tsx` version from `apps/web/package.json` when copying this command." If reproducibility is preferred, pin the same version as the workspace dependency rather than an older one.

### DS19-04 - Generated `sw.js` comment becomes false after version stamping

Severity: Low
Confidence: High

Files and regions:
- `apps/web/public/sw.template.js:21-26`
- `apps/web/public/sw.js:21-26`
- `apps/web/scripts/build-sw.ts:36-43`
- `CLAUDE.md:411`
- `apps/web/src/__tests__/sw-template-contract.test.ts:28-35`, `apps/web/src/__tests__/sw-template-contract.test.ts:194-198`

Mismatch:
The template correctly says `__SW_VERSION__ is replaced at build time by scripts/build-sw.ts`. The committed generated file now says `72f85842-p7 is replaced at build time by scripts/build-sw.ts`. The literal generated version is not what the build script searches for; `build-sw.ts` replaces `__SW_VERSION__` in the template and writes the resulting file.

Failure scenario:
A maintainer inspecting the shipped service worker reads the generated comment as if `72f85842-p7` is the replacement token. That can lead to direct edits in generated `sw.js`, incorrect search/replace assumptions, or confusion when the next prebuild overwrites the file from `sw.template.js`.

Fix:
Change the template comment to wording that remains true after stamping, for example: `SW_VERSION is stamped at build time by scripts/build-sw.ts from the template hash and IMAGE_PIPELINE_VERSION.` Then regenerate `public/sw.js`.

## Missed-Issue Sweep

Final sweep rechecked canonical docs, README files, package scripts, env examples, deploy helpers, Docker/nginx config, site config examples, migration/schema/index docs, source comments for cache/ETag/TOCTOU/color/HDR/semantic-search behavior, i18n messages, current cycle-19 `.context` plans/reviews, recent archived document-specialist reports, and tests that encode documentation contracts.

Not refiled because they matched current repo behavior or were intentionally historical:

- Next/React/TypeScript/Node version claims align with `apps/web/package.json`.
- README deploy docs align with host-network compose, bind mounts, auto-prune behavior, liveness/readiness split, upload caps, and trusted-proxy warnings.
- Semantic endpoint same-origin/rate-limit claims match `api/search/semantic/route.ts`; similar-photo endpoint is production-only as documented in its route comment.
- CLIP activation docs correctly describe operator-only production mode, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, forced pre-enable backfill, model-version filtering, and offline loading once `CLIP_MODELS_ROOT` is set correctly.
- Analytics CSP/script/privacy copy is aligned: production middleware and layout use `siteConfig.google_analytics_id`, and tests pass the site-config value into the CSP builder.
- Service-worker generation itself is implemented and tested; only the generated comment wording drifts.
- Prior cycle findings around LR upload setting forwarding, settings-hash scope, HDR SDR delivery copy, deploy helper fallback, and cache/TOCTOU wording were not duplicated.

Known limits: this pass did not run the full test suite, inspect live production/remote host state, inspect gitignored real `.env` files, or independently revalidate external browser/platform support claims. The findings above are repo-internal documentation/comment/runbook mismatches with direct source evidence.

Total findings: 4
- Critical: 0
- High: 0
- Medium: 1
- Low: 3
