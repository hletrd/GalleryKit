# Document Specialist Review - Cycle 21

Date: 2026-06-30 KST
HEAD reviewed: `1ed96484dc7d42cd9688a72c4edc449270ee8ab1`
Scope: README, CLAUDE, AGENTS, `.context` plans/reviews, env examples, deploy/runbooks, contract comments, and `docs/superpowers` checked against implementation behavior. Review-only pass; no commit or push. Existing modified files in `.context/reviews/architect.md`, `debugger.md`, `test-engineer.md`, and `tracer.md` were present before this report and were not touched.

## Inventory

- Primary docs:
  - `AGENTS.md` - short operational policy, deploy/schema/quality-gate rules.
  - `CLAUDE.md` - architecture, security, color/HDR, CLIP, migration, deployment, lint gates.
  - `README.md`, `apps/web/README.md` - public setup/deploy/env/semantic-search documentation.
- `.context`:
  - `.context/plans/README.md`, `.context/plan/plan-cycle21.md`, active/done/archive plan files.
  - `.context/reviews/**` active role reports and archived role/aggregate reports.
- `docs/superpowers`:
  - `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`.
  - `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`.
- Operational/code contract surfaces:
  - `.env.deploy.example`, `apps/web/.env.local.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`.
  - `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/process-topic-image.ts`, CLIP downloader/backfill/path files, storage quarantine comments/tests, route/auth/rate-limit lint scripts.
  - Migration/schema docs in `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, and `apps/web/src/db/schema.ts`.

## Findings

### DOC21-01 - CLAUDE hardcodes the deploy host despite the config-driven deploy helper

- Severity: Low
- Confidence: High
- Region: `CLAUDE.md:462-464`, `AGENTS.md:15-18`, `README.md:108-118`, `.env.deploy.example:6-14`, `scripts/deploy-remote.sh:22-52`
- Documentation claim: `CLAUDE.md` says `npm run deploy` "ssh-deploys to `gallery.atik.kr`" after reading `.env.deploy`.
- Code/project behavior: `scripts/deploy-remote.sh` selects `.env.deploy`, `$DEPLOY_ENV_FILE`, or `$HOME/.gallerykit-secrets/gallery-deploy.env`, then derives the SSH command from `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`, and `DEPLOY_PATH`. `.env.deploy.example` uses `DEPLOY_HOST=example.com`, and AGENTS explicitly says not to hardcode hostnames or key paths.
- Failure scenario: A future operator or agent treats `gallery.atik.kr` as the deploy target baked into the command instead of the current production value living in a gitignored env file. That can lead to wrong runbook edits or hardcoded hostnames creeping back into scripts/docs.
- Suggested fix: Reword `CLAUDE.md:464` to "ssh-deploys to the host configured in `.env.deploy` (the project production env currently targets the demo host)" and keep concrete hostnames in the private env file.

### DOC21-02 - README directory tree omits two persisted runtime stores

- Severity: Low
- Confidence: High
- Region: `README.md:64-81`, `README.md:184-186`, `CLAUDE.md:38-39`, `CLAUDE.md:572`, `apps/web/docker-compose.yml:24-28`, `apps/web/src/lib/upload-paths.ts:12-38`, `apps/web/src/lib/process-topic-image.ts:11-25`
- Documentation claim: The root README directory tree lists `public/uploads/` as the only persisted app runtime directory under `apps/web/`.
- Code/project behavior: originals resolve to `apps/web/data/uploads/original` or `data/uploads/original`; topic resources resolve to `apps/web/public/resources` or `public/resources`; Docker Compose bind-mounts `./data`, `./public/uploads`, and `./public/resources`. CLAUDE and the later README Docker section correctly identify all three mutable stores.
- Failure scenario: A reader using the root tree as a backup/deployment checklist can persist processed derivatives but miss private originals or runtime topic cover resources. The later Docker section mitigates this, but the top-level structure remains misleading.
- Suggested fix: Add `data/` and `public/resources/` to the README tree, matching CLAUDE's repository structure and the compose/deploy persistence contract.

### DOC21-03 - Code comments still imply a bundled Lightroom plugin at several contract points

- Severity: Low
- Confidence: Medium
- Region: `README.md:40`, `CLAUDE.md:158`, `CLAUDE.md:574`, `apps/web/src/app/api/admin/lr/upload/route.ts:1-8`, `apps/web/src/app/api/admin/lr/upload/route.ts:60-65`, `apps/web/src/app/api/admin/lr/upload/route.ts:333-340`, `apps/web/src/app/api/admin/lr/upload/route.ts:348-353`, `apps/web/src/app/api/admin/lr/upload/route.ts:518-523`, `apps/web/src/lib/api-auth.ts:50-57`, `apps/web/src/db/schema.ts:192-196`, `apps/web/drizzle/0006_admin_tokens.sql:1-8`, `apps/web/nginx/default.conf:123-131`
- Documentation claim: Product docs say the repo ships a server API / Lightroom-compatible PAT upload route and does not bundle or distribute a Lightroom Classic plugin.
- Code-comment drift: Several comments still say "Lightroom Classic publish plugin", "the Lightroom plugin", or "publish-plugin path". The route header itself is correct ("does not bundle or distribute a Lightroom plugin"), but adjacent comments and schema/migration/nginx comments use plugin wording as if a plugin is part of the product contract.
- Failure scenario: A future contributor copies the lower-level comments into user-facing docs or UI and accidentally promises a Lightroom plugin, reopening a support/documentation gap the README and CLAUDE deliberately avoid.
- Suggested fix: Normalize these comments to "Lightroom-compatible publish API", "external Lightroom publish client", or "PAT upload route" while preserving the body-size and non-browser integration rationale.

### DOC21-04 - Historical CLIP superpower plan still contains obsolete code snippets despite being marked complete

- Severity: Low
- Confidence: Medium
- Region: `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:3-5`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:301`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:378-381`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:509-525`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:610-625`, `apps/web/src/lib/clip-paths.ts:60-65`, `apps/web/src/lib/gallery-config-shared.ts:147-164`, `apps/web/src/lib/clip-embedding-constants.ts`, `apps/web/src/lib/clip-embeddings.ts:14-20`
- Documentation claim: The plan banner says it is historical and not current instructions, but it remains in `docs/superpowers` as a detailed task-by-task implementation surface.
- Code/project behavior: Current CLIP path resolution uses `resolveClipModelsRoot()` to honor absolute `CLIP_MODELS_ROOT`; the old snippet uses `process.env.CLIP_MODELS_ROOT ?? join(process.cwd(), 'data/models/clip')`, the exact absolute-path pitfall later fixed in `clip-paths.ts`. The plan also references `GALLERY_SETTING_VALIDATORS` and `CLIP_MODEL_VERSION`, while the current code exposes validators through `isValidSettingValue` and the stub identity through `STUB_MODEL_VERSION`.
- Failure scenario: A future agent skims past the historical banner and copies stale snippets for a CLIP model upgrade, reintroducing the absolute-path bug or trying to import symbols that no longer exist.
- Suggested fix: Add a short "Do not copy code snippets from this historical plan" warning near the file-structure/task sections, or replace obsolete snippets with links to the current authoritative files (`clip-paths.ts`, `gallery-config-shared.ts`, `clip-embedding-constants.ts`).

## Verified Clean Areas

- CLIP production activation docs now match code for `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, `CLIP_MODELS_ROOT`, scan/top-K defaults (`2000` / `50`), hard cap (`25000`), and repeat-until-no-`SEMANTIC_SCAN_LIMIT` backfill guidance.
- Deploy prune docs match `apps/web/deploy.sh`: prune runs after `docker compose up -d --build`, mutable data is bind-mounted, and automatic `docker volume prune` omits `-a`.
- Storage-backend quarantine is documented and guarded: CLAUDE says local filesystem only, `lib/storage` comments say not wired into live upload/process/serve, and `storage-quarantine.test.ts` fails if app code starts importing it without updating policy.
- Migration docs match the hash/postcondition behavior in `migrate.js`, including the monotonic `_journal.json.when` requirement and reconcile checklist.
- Health/liveness docs match code: Docker probes `/api/live`; `/api/health` probes DB only with `HEALTH_CHECK_DB=true`.
- Security lint-gate docs match the scanner entry points and scope for admin API auth, action origin checks, and public mutating route rate-limit checks.

## Missed-Issues Sweep

- Rechecked prior cycle document-specialist items: `SEMANTIC_TOP_K_MAX` docs/examples are now `50`; CLIP backfill runbooks now mention repeat-on-scan-limit; the previous advisory-lock scope note is fixed in current CLAUDE.
- Ran targeted searches for stale terms and policy contracts: deploy host/env vars, CLIP model/version symbols, `semantic_search_enabled`, `Lightroom plugin`, `publish-plugin`, `public/resources`, `data/uploads/original`, storage/S3/MinIO, Stripe/paid-download removal, `NEXT_UPLOAD_BODY_MAX_BYTES`, `TRUST_PROXY`, health probes, and lint exemption tags.
- Did not run test/build gates; this was a review-only documentation artifact update with no production code change.

## Totals

- Findings: 4
- Highest severity: Low
