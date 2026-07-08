# Run-10 Cycle 38 Critic Review

Date: 2026-07-08 KST
Role: cycle-38 critic
Workspace: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `746b3e11` on `master`
Mode: whole-system critique only. Required edit scope was this file only.

## Provenance And Inventory

Required context read first: `AGENTS.md`, `CLAUDE.md`, and the `code-review` skill instructions.

Inventory built before reviewing:

- Governance/docs: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`, `.context/plans`, prior `.context/reviews`.
- Build/deploy/ops: root and app manifests, `.nvmrc`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `scripts/check-proxy-topology.mjs`, `apps/web/nginx/default.conf`, `.github/workflows/*`, Dependabot config.
- Runtime source: `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/src/i18n`, `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/site-config*.json`.
- Data/schema/scripts: `apps/web/drizzle`, migration metadata, `apps/web/scripts`, queue/backfill/restore/migration helpers.
- Test surface: `apps/web/src/__tests__`, `apps/web/e2e`, Playwright/Vitest configs, source-contract tests, security lint scripts.

Cross-file paths examined: admin auth and PAT upload, browser upload and processing queue, public page/search rate limits, restore maintenance fences, migration postconditions, semantic-search activation, CLIP model loading, smart collections, privacy field guards, service worker generation, nginx edge proxying, Docker build/runtime dependency handling, deploy health/prune behavior, CI gates, and e2e public smoke coverage.

Excluded from source review: generated/vendor/runtime directories such as `node_modules`, `.next`, `.git`, local upload/data directories, and binary screenshot artifacts. I did not intentionally skip any review-relevant source area. I did not edit production code.

## Confirmed Issues

### CRT38-01 - Failed deploys exit before disk cleanup on the disk-constrained host

- Severity: Medium
- Confidence: High
- Classification: confirmed operations issue
- Region: `apps/web/deploy.sh:51-56`, `apps/web/deploy.sh:73-77`, `apps/web/deploy.sh:79-104`, `apps/web/src/__tests__/deploy-script-contract.test.ts:44-56`
- Failure scenario: the deploy script builds and starts the container, waits up to 90 seconds, and exits immediately if the new container never becomes healthy. The Docker cleanup block that removes stopped containers, stale images, BuildKit cache, and dangling volumes only runs after that health gate. The comments state that the deploy host previously hit 100 percent disk and broke the next `git pull`; repeated failed builds can therefore leave the largest reclaim target, BuildKit/image cache, in place exactly when recovery needs free space.
- Concrete fix: add an `EXIT` or failure-path cleanup that runs safe best-effort pruning after logging the failed container. At minimum prune BuildKit cache and stopped containers on failure; keep the current successful-deploy cleanup and preserve the no-`volume prune -a` guarantee. Add a contract test proving the failure branch performs bounded cleanup after `docker logs`.

## Likely Issues

### CRT38-02 - Smart collection authoring bypasses its own validation in the documented workflow

- Severity: Medium
- Confidence: Medium
- Classification: likely product/testability issue
- Region: `CLAUDE.md:172`, `apps/web/src/app/actions/collections.ts:16-58`, `apps/web/src/components/admin-nav.tsx:15-26`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:90-108`, `apps/web/src/lib/smart-collections.ts:316-328`, `apps/web/src/__tests__/collections-action-behavior.test.ts:154-173`, `apps/web/e2e/public.spec.ts:160-167`
- Failure scenario: the hardened create/update actions validate `query_json`, and tests cover those actions. But the project documentation says there is no admin UI/API surface and rows are currently authored by direct DB INSERT. That path bypasses the validator in `collections.ts`. If an operator inserts malformed JSON, an unsupported predicate, or a query that later becomes invalid after schema evolution, the public route catches parse/compile errors and returns `notFound()` with no operator-facing diagnostic. The e2e route smoke only proves one seeded valid row renders.
- Concrete fix: either ship an admin Collections UI that uses the validated server actions, or provide an operator CLI/import script that calls `parseSmartCollectionQuery` before writing. Add an admin health check or script that scans all `smart_collections.query_json` rows and reports invalid private/public rows before they become silent public 404s. Consider logging the collection id/slug on public parse/compile failure while still hiding details from visitors.

### CRT38-03 - Real CLIP readiness is outside the standard push/build gate

- Severity: Medium
- Confidence: High
- Classification: likely operations/testability issue
- Region: `apps/web/package.json:21-23`, `.github/workflows/quality.yml:54-83`, `.github/workflows/clip-preflight.yml:1-46`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `CLAUDE.md:169`
- Failure scenario: standard CI runs lint, typecheck, audit, unit tests, e2e, and build, but not `test:clip:preflight`. The CLIP preflight is only manual or scheduled. The offline-load test is skipped unless `CLIP_OFFLINE_LOAD=1`, `CLIP_INTEGRATION=1`, `CLIP_MODELS_ROOT` is set, and the exact seeded ONNX path exists. A semantic-search code change can therefore merge with green standard CI while the production host lacks weights, has stale weights, or cannot load the offline model path required for `semantic_search_mode=production`.
- Concrete fix: make the CLIP preflight required when semantic-search, CLIP model, embedding, Docker volume, or runbook files change. If full preflight is too expensive for every push, add a path-filtered required job and a host-side pre-deploy check that verifies the mounted `CLIP_MODELS_ROOT`, model revision, and a small text/image embedding smoke before allowing production mode.

## Manual-Validation Risks

### CRT38-04 - Public edge limiter and real-client-IP behavior are source-documented but not source-proved

- Severity: Medium
- Confidence: High
- Classification: manual-validation risk
- Region: `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:274-307`, `apps/web/deploy.sh:51-56`, `scripts/check-proxy-topology.mjs:7-16`, `scripts/check-proxy-topology.mjs:131-134`, `CLAUDE.md:514-526`
- Failure scenario: public SSR pages and several public routes depend on the checked-in nginx catch-all limiter and correct real-client-IP topology. The deploy script rebuilds and starts Docker but does not install or reload the host nginx config. The topology checker explicitly says it verifies forwarded host/proto spoof resistance but not whether inbound `X-Forwarded-For` is overwritten or whether the intended client-IP bucket is used. Production can therefore be stale, unthrottled, or accidentally bucket all visitors under a load balancer address, causing either flood exposure or false 429s.
- Concrete fix: add an operator evidence gate for nginx changes: compare the live `nginx -T` relevant server block to the committed template, run `nginx -t`, reload, perform a functional burst/429 probe for the public catch-all and `_next/image`, and prove effective client keying from logs or a temporary diagnostic. Longer term, manage nginx/CDN config as deployable infrastructure instead of a manually applied template.

### CRT38-05 - Browser upload memory capacity remains an empirical production assumption

- Severity: Medium
- Confidence: Medium
- Classification: manual-validation risk
- Region: `apps/web/nginx/default.conf:132-147`, `apps/web/src/app/actions/images.ts:87-160`, `apps/web/src/app/api/admin/lr/upload/route.ts:250-358`, `CLAUDE.md:657-663`
- Failure scenario: nginx and application byte caps prevent many oversized requests, and the upload code has disk/quota/metadata gates. That does not prove the production host's memory headroom under worst-case multipart buffering plus Sharp/libvips derivative fan-out. A browser upload batch near the allowed totals, a PAT upload, and background processing can all be logically within limits while still driving RSS high enough to kill the single web instance or degrade foreground requests.
- Concrete fix: run a production-sized load probe with representative maximum JPEG/HEIF files and concurrent browser/PAT uploads while recording container RSS, libvips concurrency, DB pool pressure, and queue latency. Use the measured headroom to set `UPLOAD_MAX_TOTAL_BYTES`, nginx body sizes, queue concurrency, and any container/systemd memory limits. Keep the test artifact in `.context/reviews` or ops docs so future cap changes have a baseline.

## Final Sweep

Commonly missed checks revisited: generated service worker freshness, privacy-field omissions, admin API auth wrappers, server-action same-origin guards, public route rate-limit scanner, migration journal shape, Docker native optional dependency pinning, deploy secret permission checks, public smart-collection visibility, semantic-search body limits, PAT upload quota settlement, and nginx longest-prefix body-size routing.

No additional confirmed issue survived that sweep. Notable no-findings:

- Service worker generation is source-locked by template/build tests; `public/sw.js` matched its generated inputs during review.
- Admin API, action-origin, and public-route rate-limit scanners passed in the current workspace.
- Docker native optional dependency versions are pinned to lockfile versions and covered by `deploy-script-contract.test.ts:258-287`.
- The smart-collection server actions themselves correctly validate input and are authenticated; the risk is the documented direct-DB authoring path and missing operator UI/validation surface.

Relevant files skipped: none, excluding generated/vendor/runtime/binary artifacts listed above. I did not line-read every one of the hundreds of test files after inventory; I followed references from risky runtime paths and reviewed the relevant source-contract, unit, and e2e tests that validate those paths.

## Validation Evidence

Commands run during this critique:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed.
- `npm run lint --workspace=apps/web` - passed.
- `npm run audit:prod` - passed with 0 vulnerabilities.

Not run: full `npm test --workspace=apps/web`, `npm run build --workspace=apps/web`, and Playwright e2e. This was a review-only assignment and the findings above are source-backed; those broader gates remain the next validation step before changing code.
