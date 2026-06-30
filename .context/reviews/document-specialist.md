# Document Specialist Review - Cycle 22

Date: 2026-06-30 KST  
HEAD reviewed: `85b0291f02cf0ea5839c662d6b4c2233df8e1d2b`  
Scope: documentation, env examples, deployment docs/scripts, source comments, docs-backed tests, and representative implementation paths checked for doc/code drift. Review-only pass; no source-code edits, no commit, no push.

## Inventory

- Primary project docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Environment/deploy surfaces: `.env.deploy.example`, `apps/web/.env.local.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/scripts/entrypoint.sh`.
- API/security lint docs and tests: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/src/__tests__/check-api-auth.test.ts`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`, `apps/web/src/__tests__/deploy-script-contract.test.ts`, `apps/web/src/__tests__/nginx-config.test.ts`, `apps/web/src/__tests__/health-route.test.ts`.
- Runtime/config code checked against docs: upload limits, request-origin/proxy trust, health/live routes, CLIP constants/model/path/backfill, semantic/similar search routes, admin PAT upload route, migration/schema comments, storage quarantine comments.
- Historical docs checked for stale executable guidance: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`, previous `.context/reviews/document-specialist.md`.
- Official docs checked: Next.js Route Handlers docs, which document the convention as `route.js|ts` and the HTTP-method exports ([nextjs.org/docs/app/getting-started/route-handlers](https://nextjs.org/docs/app/getting-started/route-handlers)).

## Findings

### DOC22-01 - `CLAUDE.md` still hardcodes the deploy host despite config-driven deploy behavior

- Severity: Low
- Confidence: High
- Status: confirmed
- Region: `CLAUDE.md:462-464`, `AGENTS.md:15-19`, `.env.deploy.example:6-14`, `scripts/deploy-remote.sh:22-52`
- Documentation claim: `CLAUDE.md` says `npm run deploy` reads `.env.deploy`, “ssh-deploys to `gallery.atik.kr`,” and runs `apps/web/deploy.sh`.
- Authoritative local behavior: `scripts/deploy-remote.sh` chooses repo-root `.env.deploy`, `$DEPLOY_ENV_FILE`, or `$HOME/.gallerykit-secrets/gallery-deploy.env`, then derives the SSH command from `DEPLOY_HOST`, `DEPLOY_USER`, optional `DEPLOY_KEY`, and `DEPLOY_PATH`. `AGENTS.md` explicitly says not to hardcode hostnames/key paths in docs.
- Concrete failure scenario: a future operator or agent treats `gallery.atik.kr` as part of the deploy command contract and reintroduces a concrete hostname into automation or runbook changes, bypassing the env-driven deploy helper.
- Suggested fix: reword `CLAUDE.md:464` to “ssh-deploys to the host configured in `.env.deploy`” and, if useful, mention that the private production env currently targets the demo host without making it a public contract.

### DOC22-02 - `.env.local.example` omits several documented operator controls

- Severity: Low
- Confidence: High
- Status: risk
- Region: `apps/web/.env.local.example:38-79`, `CLAUDE.md:105-108`, `CLAUDE.md:340-356`, `apps/web/src/lib/view-retention.ts:13-53`, `apps/web/src/lib/admin-backfill-runner.ts:23-40`, `apps/web/scripts/backfill-color-pipeline.ts:27-28`
- Documentation claim: `CLAUDE.md` lists `VIEW_RETENTION_DAYS`, `ADMIN_BACKFILL_CONCURRENCY`, and `BACKFILL_CONCURRENCY` as supported operational variables, with non-trivial production semantics.
- Authoritative local behavior: code reads and applies all three: `VIEW_RETENTION_DAYS` changes analytics retention; `ADMIN_BACKFILL_CONCURRENCY` is clamped against the live DB pool budget; `BACKFILL_CONCURRENCY` controls sidecar color backfill concurrency. The env example includes `AUDIT_LOG_RETENTION_DAYS` and many CLIP/upload/proxy controls, but omits these three.
- Concrete failure scenario: an operator bootstraps from `apps/web/.env.local.example`, assumes it is the complete list of supported operational knobs, and misses retention/backfill settings during a disk-pressure or maintenance-window change.
- Suggested fix: add commented examples for `VIEW_RETENTION_DAYS=395`, `ADMIN_BACKFILL_CONCURRENCY=1`, and `BACKFILL_CONCURRENCY=2` near the existing audit/backfill/semantic sections, with the same short cautions used in `CLAUDE.md`.

### DOC22-03 - Lower-level comments still imply a bundled Lightroom plugin

- Severity: Low
- Confidence: Medium
- Status: likely
- Region: `README.md:42`, `README.md:200-211`, `apps/web/README.md:82-91`, `CLAUDE.md:158`, `apps/web/src/app/api/admin/lr/upload/route.ts:1-13`, `apps/web/src/app/api/admin/lr/upload/route.ts:60-65`, `apps/web/src/app/api/admin/lr/upload/route.ts:333-340`, `apps/web/src/app/api/admin/lr/upload/route.ts:348-353`, `apps/web/src/app/api/admin/lr/upload/route.ts:518-523`, `apps/web/src/lib/admin-tokens.ts:1-4`, `apps/web/src/lib/api-auth.ts:50-57`, `apps/web/src/db/schema.ts:192-196`, `apps/web/drizzle/0006_admin_tokens.sql:1-8`, `apps/web/nginx/default.conf:123-131`
- Documentation claim: the public docs correctly say GalleryKit exposes a PAT-authenticated upload API for external clients and does not bundle a Lightroom Classic plugin.
- Code/comment drift: adjacent implementation comments still say “Lightroom Classic publish plugin,” “the Lightroom plugin,” or “publish-plugin path.” Some comments are harmless shorthand for a compatible external client, but others read like the plugin is a shipped product surface.
- Concrete failure scenario: a contributor copies implementation comments into UI/help docs and accidentally promises a bundled Lightroom plugin, contradicting README and CLAUDE and creating support expectations around an artifact this repo does not ship.
- Suggested fix: normalize comments to “Lightroom-compatible publish API,” “external Lightroom publish client,” or “PAT upload route,” preserving the body-size, cross-origin PAT, and non-browser integration rationale.

### DOC22-04 - Historical CLIP plan contains obsolete snippets that contradict the current CLIP implementation

- Severity: Low
- Confidence: Medium
- Status: confirmed
- Region: `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:3-5`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:287-322`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:374-384`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:506-526`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:606-626`, `apps/web/src/lib/clip-paths.ts:51-66`, `apps/web/src/lib/clip-embedding-constants.ts:9-13`, `apps/web/src/lib/gallery-config-shared.ts:147-164`, `apps/web/src/lib/clip-embeddings.ts:14-20`
- Documentation claim: the plan banner says it is a historical record, not current instructions.
- Authoritative local behavior: current code uses `resolveClipModelsRoot()` so absolute `CLIP_MODELS_ROOT` values are honored verbatim, keeps the stub identity in `STUB_MODEL_VERSION`, and exposes settings validation through `isValidSettingValue`. The old plan snippets still show `process.env.CLIP_MODELS_ROOT ?? join(...)`, `GALLERY_SETTING_VALIDATORS`, and `CLIP_MODEL_VERSION`.
- Concrete failure scenario: a future model-upgrade task copies snippets from the historical plan and reintroduces the absolute-path bug that `clip-paths.ts` explicitly documents, or imports symbols that no longer exist.
- Suggested fix: add a stronger warning above the task snippets: “Do not copy code from this historical plan; use the linked current files as source of truth.” Optionally replace stale snippets with links to `clip-paths.ts`, `clip-embedding-constants.ts`, and `gallery-config-shared.ts`.

### DOC22-05 - Route-file extension comments overstate official Next.js route-handler support

- Severity: Low
- Confidence: Medium
- Status: risk
- Region: `apps/web/scripts/check-api-auth.ts:19-30`, `apps/web/scripts/check-public-route-rate-limit.ts:28-34`, `apps/web/src/__tests__/check-api-auth.test.ts:7-12`, `apps/web/src/__tests__/check-api-auth.test.ts:123-156`
- Documentation claim: scanner comments and tests say Next.js 16 App Router accepts `route.tsx`, `route.mjs`, and `route.cjs` identically.
- Official-doc check: the current official Next.js Route Handlers page documents Route Handlers as `route.js|ts` files and HTTP-method exports, not `.mjs`/`.cjs` variants. The repo does have working local `route.tsx` OG handlers, so `.tsx` is a local behavior; `.mjs`/`.cjs` support is not proven by an actual Next build fixture here.
- Concrete failure scenario: a contributor adds an admin API `route.mjs` because the scanner comment says Next resolves it. The scanner may analyze it, but if Next ignores or rejects that route convention differently than expected, the docs/tests create false confidence about what is actually deployed.
- Suggested fix: either change the comments to “the scanner intentionally audits these extensions defensively, even though the repo standard is `route.ts`/`route.tsx`,” or add a build-level fixture/evidence before claiming `.mjs`/`.cjs` are resolved identically by Next.

## Verified Clean Areas

- README directory tree now includes all three mutable runtime stores: `data/`, `public/uploads/`, and `public/resources`.
- Deploy/prune docs match `apps/web/deploy.sh`: stack starts before prune, mutable data is bind-mounted, and automatic `docker volume prune` does not use `-a`.
- Production URL guard docs match `apps/web/scripts/ensure-site-config.mjs`: missing/placeholder production `BASE_URL || site-config.url` fails the build.
- Health docs match code: Docker probes `/api/live`; `/api/health` is liveness-only unless `HEALTH_CHECK_DB=true`.
- Security lint-gate docs match scanner scope for admin API auth, action-origin guards, and public mutating route rate limits.
- CLIP activation docs match runtime behavior for `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, offline `CLIP_MODELS_ROOT`, `SEMANTIC_SCAN_LIMIT`, and `SEMANTIC_TOP_K_MAX`.
- Storage backend quarantine remains aligned: CLAUDE says local filesystem only, and `lib/storage` comments/tests keep the abstraction out of live upload/process/serve paths.

## Final Sweep / Skipped Files

- Broad search covered README/CLAUDE/AGENTS, env examples, deploy scripts, nginx/compose/Dockerfile, docs/superpowers, lint scanners, CLIP/search code, PAT upload code, storage quarantine, migration/schema comments, and representative tests.
- I did not line-review every historical file under `.context/plans/`, `.omx/`, `.omc/`, or `plan/`; those are large committed workflow histories. I sampled current cycle/previous document-specialist artifacts and checked active docs/code paths that future agents are likely to treat as authoritative.
- I did not run lint/typecheck/build/test gates; this was a review-only documentation artifact update with no production source-code change.

## Totals

- Findings: 5
- Highest severity: Low
