# Cycle 29 Tracer Review

Date: 2026-06-30
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD inspected: `b4fa1f64`
Mode: Prompt 1 review only. No product-code fixes implemented.

## Scope and Method

Read first, per instruction:
- `AGENTS.md`
- `CLAUDE.md`

Inventory and tracing commands used:
- `rg --files apps/web/src apps/web/scripts apps/web/drizzle apps/web/e2e apps/web`
- targeted `rg -n` sweeps for upload, restore, maintenance, semantic/search, embeddings, auth, rate limits, migrations, deploy, backfill, and privacy field contracts
- route inventory with `find apps/web/src/app/api -name route.ts -o -name route.tsx`
- focused line-by-line reads with `nl -ba ... | sed -n ...`

This review validates behavior from code paths, not comments. Comments were used only as hints and were checked against implementation.

## Flow Traces

### Uploads

Browser upload enters `uploadImages` in `apps/web/src/app/actions/images.ts:114-632`. The causal chain is:
- restore maintenance, same-origin, and admin checks at `images.ts:116-126`
- upload tracker quota claim before file writes at `images.ts:191-247`, settled at `images.ts:601-603`
- upload-processing contract lock at `images.ts:177-180`
- strict config snapshot and disk precheck at `images.ts:183-270`
- original write/metadata validation via `saveOriginalAndGetMetadata` in `apps/web/src/lib/process-image.ts:887-1037`
- GPS-strip and HDR policy branches at `images.ts:361-401`
- DB insert and tag insert at `images.ts:419-503`
- queue enqueue with processing snapshot at `images.ts:505-537`

Lightroom/PAT upload follows the same safety shape in `apps/web/src/app/api/admin/lr/upload/route.ts:182-486`, with `withAdminAuth` wrapping the route at `lr/upload/route.ts:548-554`, content-length checks, upload tracker claim, topic validation, upload-contract lock, strict config, disk precheck, original save, GPS/HDR gates, DB insert, and queue enqueue.

Queue processing claims the per-image advisory lock in `apps/web/src/lib/image-queue.ts:470-497`, rejects work during restore maintenance at `image-queue.ts:513-518`, verifies the row remains unprocessed before encoding at `image-queue.ts:579-584`, and cleans variants if the row is deleted before the final processed update at `image-queue.ts:679-699`.

No confirmed upload auth, quota, or original-path bypass found in this pass.

### Restore Maintenance

Restore enters `restoreDatabase` in `apps/web/src/app/[locale]/admin/db-actions.ts:365-566`. The main causal controls are:
- same-origin/admin checks before body work at `db-actions.ts:366-374`
- DB restore advisory lock at `db-actions.ts:390-398`
- upload-processing contract lock for the restore window at `db-actions.ts:400-411`
- color and semantic backfill locks at `db-actions.ts:413-447`
- durable maintenance marker begin at `db-actions.ts:449-490`
- view-buffer, image-queue, and tracked background DB-write drain at `db-actions.ts:492-497`
- restore execution and post-restore migrations at `db-actions.ts:503-506` and `db-actions.ts:723-744`
- marker clear, queue resume, and lock release in `db-actions.ts:507-541`

The durable marker and fail-closed sync live in `apps/web/src/lib/restore-maintenance-durable.ts:1-104`; process-local checks live in `apps/web/src/lib/restore-maintenance.ts:1-60`. Background audit and analytics writes are now routed through `trackBackgroundDbWrite` (`apps/web/src/lib/background-db-writes.ts:5-31`, `apps/web/src/lib/audit.ts:86-93`, `apps/web/src/app/actions/public.ts:431-504`) and drained before import.

No confirmed stale-write restore race found in the currently inspected restore path.

### Public Privacy and Search

The canonical public field contract is built by omission from `adminSelectFields` in `apps/web/src/lib/data.ts:368-408`; the map variant allows only latitude/longitude beyond the public set at `data.ts:410-489`. `PrivacySensitiveKeys` is defined at `data.ts:459-477`; the symmetric fixture contract is in `apps/web/src/__tests__/privacy-fields.test.ts:7-132`.

Text search uses its own guarded `searchFields` in `data.ts:1490-1534`, then searches title/description/camera/lens/topic/labels/tags/aliases while requiring `images.processed = true` at `data.ts:1545-1621`.

Semantic and similar result enrichment share `searchEnrichmentSelectFields` with a compile-time privacy guard in `apps/web/src/lib/search-enrichment-fields.ts:29-47`. Route-level denylist coverage is also present in `apps/web/src/__tests__/search-route-privacy.test.ts:1-65`.

No confirmed public leakage of original filenames, GPS outside map-visible routes, processing errors, ICC descriptor, internal pipeline version, or upload user id found in the traced public search paths.

### Semantic Search

Public semantic POST resolves runtime mode through `getGalleryConfig()` in `apps/web/src/app/api/search/semantic/route.ts:189-203`, then scans only the active model version at `semantic/route.ts:263-279`. Similar search is production-only and reads only `PRODUCTION_MODEL_VERSION` rows in `apps/web/src/app/api/search/similar/[id]/route.ts:116-177`.

The runtime production gate heals stored `semantic_search_mode = production` to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` in `apps/web/src/lib/gallery-config.ts:123-140`.

One sidecar mismatch is listed below as TRC29-01.

### Image Processing and Backfill

Normal queue processing uses per-image advisory locks, row-state checks, output verification, affected-row cleanup, bounded queue concurrency, and restore quiescence in `apps/web/src/lib/image-queue.ts:91-108`, `image-queue.ts:470-699`, and `image-queue.ts:1060-1114`.

The in-app color backfill runner takes the global color backfill lock and a per-image processing claim around the full re-encode/detect/update window (`apps/web/src/lib/admin-backfill-runner.ts:348-381`, `admin-backfill-runner.ts:485-630`).

The operator color sidecar takes only the global color backfill lock in `apps/web/scripts/backfill-color-pipeline.ts:305-328`, then re-encodes candidates selected at `backfill-color-pipeline.ts:338-349` through `reprocessRow` at `backfill-color-pipeline.ts:198-274` and batched updates at `backfill-color-pipeline.ts:409-473`. The concurrency gap is listed as a manual-validation risk in TRC29-02.

### Route Auth and Rate Limits

Admin API route inventory found:
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`

Both are wrapped with `withAdminAuth` (`download/route.ts:105-109`, `lr/upload/route.ts:548-554`). The lint gate enforcing this pattern is `apps/web/scripts/check-api-auth.ts:1-199`.

Mutating public API routes are scanned by `apps/web/scripts/check-public-route-rate-limit.ts:1-260`. Public semantic POST and similar GET use same-origin checks and semantic-specific pre-increment helpers (`semantic/route.ts:107-184`, `similar/[id]/route.ts:80-113`). OG GET routes are not part of the mutating-route scanner by design, but both traced OG routes call rate-limit helpers before DB/CPU-heavy work.

The proxy/IP topology risk is listed as TRC29-03.

### Deploy and Migrations

Container startup runs migrations before starting Next: `apps/web/Dockerfile:151-158`. The migrator baselines legacy/fresh schemas, runs Drizzle migrations, and asserts committed journal hashes are present in `apps/web/scripts/migrate.js:758-818`. Deploy starts the compose service and waits on Docker health or `/api/live` in `apps/web/deploy.sh:28-54`.

The deploy health criterion remains liveness-only by code (`apps/web/Dockerfile:140-143`, `apps/web/src/app/api/live/route.ts:1-9`). A readiness validation gap is listed as TRC29-04.

## Findings

### TRC29-01 - Likely Issue - Semantic embedding sidecar bypasses the runtime mode resolver

Severity: Low
Confidence: High
Status: Likely issue

Evidence:
- Runtime resolver heals stored production to disabled unless the operator env flag is set: `apps/web/src/lib/gallery-config.ts:123-140`
- Public semantic route uses that resolver before serving search: `apps/web/src/app/api/search/semantic/route.ts:189-203`
- Similar route also uses that resolver and serves only production mode: `apps/web/src/app/api/search/similar/[id]/route.ts:116-124`
- In-app embedding action uses `getGalleryConfig()` before choosing model version: `apps/web/src/app/actions/embeddings.ts:85-103`
- Sidecar instead reads raw `admin_settings.value` and treats any value other than `disabled` as enabled: `apps/web/scripts/backfill-clip-embeddings.ts:87-93`, `backfill-clip-embeddings.ts:116-124`

Failure scenario:
1. The DB contains `semantic_search_mode = production`, but the deployment does not have `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`.
2. Runtime search resolves that state to disabled, so `/api/search/semantic` returns `semantic_not_configured`.
3. An operator runs `npx tsx scripts/backfill-clip-embeddings.ts` without `--force`.
4. The sidecar sees raw `production !== disabled`, treats semantic search as enabled, and writes stub embeddings under `STUB_MODEL_VERSION`.
5. The script reports useful work even though the served runtime is disabled. On a large gallery this wastes CPU/DB writes and can mislead the operator about readiness.

Fix:
Use the same resolver as runtime (`getGalleryConfig()` or an extracted shared semantic-mode resolver) in the sidecar. Without `--force`, require the resolved mode to match the target mode: default/stub backfill should require resolved `stub`, and `--production` should require resolved `production` plus `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`. Keep `--force` as the explicit pre-enable override.

### TRC29-02 - Risk Needing Manual Validation - Color sidecar lacks per-image processing claims

Severity: Low
Confidence: Medium
Status: Risk needing manual validation

Evidence:
- Queue workers protect each encode/update with `gallerykit:image-processing:{id}`: `apps/web/src/lib/image-queue.ts:470-497`, `image-queue.ts:543-699`
- In-app color backfill runner takes the same per-image claim around re-encode, detection, and DB update: `apps/web/src/lib/admin-backfill-runner.ts:348-381`, `admin-backfill-runner.ts:485-630`
- Operator color sidecar only takes the global color backfill lock: `apps/web/scripts/backfill-color-pipeline.ts:305-328`
- The sidecar re-encodes files before the DB update in `backfill-color-pipeline.ts:198-274`, then updates in batches at `backfill-color-pipeline.ts:409-473`

Failure scenario:
1. A future or operator-triggered flow reprocesses a row using the queue's per-image lock while the sidecar is running.
2. The sidecar does not observe that per-image claim and can write the same derivative filenames concurrently.
3. The final DB row may come from one process while derivative bytes come from another, especially if settings differ or one path fails after writing only part of the variant set.

Current mitigating evidence:
- The normal queue path rechecks `processed = false` before encoding (`image-queue.ts:579-584`), while the sidecar selects `processed = true` candidates (`backfill-color-pipeline.ts:338-349`).
- `retryFailedImage` currently selects only `processed = false AND processing_error IS NOT NULL` at `apps/web/src/app/actions/images.ts:1209-1230`.
- Delete races are handled by affected-row cleanup in the sidecar (`backfill-color-pipeline.ts:446-469`).

Fix:
Mirror the in-app runner's per-image claim in `backfill-color-pipeline.ts` before `reprocessRow`, holding it through the corresponding row update or derivative-only update. If the intended contract is "sidecar never overlaps any per-image queue work because all candidates are processed", lock that invariant with a source test so future retry/reprocess flows cannot accidentally widen the queue candidate set.

### TRC29-03 - Risk Needing Manual Validation - Proxy IP chain can collapse rate limits behind an upstream TLS/load balancer

Severity: Medium
Confidence: Medium
Status: Risk needing manual validation

Evidence:
- Docker enables `TRUST_PROXY=true`: `apps/web/docker-compose.yml:20-23`
- App IP extraction trusts `x-forwarded-for` chains based on `TRUSTED_PROXY_HOPS`, then falls back to `x-real-ip`: `apps/web/src/lib/rate-limit.ts:164-187`
- nginx sets both `X-Real-IP` and `X-Forwarded-For` to `$remote_addr` in every proxied location, for example `apps/web/nginx/default.conf:67-71`, `default.conf:84-88`, `default.conf:141-145`, `default.conf:192-197`
- The nginx config explicitly describes this listener as an internal HTTP hop behind a TLS-terminating edge/load balancer: `apps/web/nginx/default.conf:25-30`

Failure scenario:
1. A TLS/load-balancer edge forwards all visitors to this nginx listener.
2. nginx is not configured with `real_ip_header` / trusted upstream ranges, so `$remote_addr` is the load balancer address.
3. nginx overwrites `X-Forwarded-For` with that same `$remote_addr` instead of preserving the true client chain.
4. `getClientIp()` sees a one-hop chain, cannot select a client before the trusted suffix, falls back to `X-Real-IP`, and all users share the load-balancer IP for app-side login/search/semantic/OG/share buckets.
5. Abuse by one client can throttle everyone, and security/audit metadata loses real client attribution.

Fix:
For deployments behind an upstream edge, configure nginx `real_ip_header X-Forwarded-For` and `set_real_ip_from <trusted edge ranges>`, then set `X-Forwarded-For` to a preserved/normalized client chain. Alternatively have the edge connect directly to the app with a verified header contract and set `TRUSTED_PROXY_HOPS` to the actual trusted suffix length. Add an nginx/source test for the intended forwarded-header contract.

### TRC29-04 - Risk Needing Manual Validation - Deploy success uses liveness, not DB-backed readiness

Severity: Low
Confidence: High
Status: Risk needing manual validation

Evidence:
- Docker healthcheck is `/api/live`, intentionally liveness-only: `apps/web/Dockerfile:140-143`
- `/api/live` always returns `{ status: 'ok' }`: `apps/web/src/app/api/live/route.ts:1-9`
- `/api/health` can check DB only when `HEALTH_CHECK_DB=true` and returns 503 during restore maintenance: `apps/web/src/app/api/health/route.ts:7-42`
- Deploy accepts either Docker health or a direct `/api/live` curl as success: `apps/web/deploy.sh:34-54`
- The app does run migrations before `server.js`, so migration failure prevents the liveness route from starting: `apps/web/Dockerfile:151-158`

Failure scenario:
1. `node apps/web/scripts/migrate.js` succeeds and Next starts.
2. Immediately after startup, DB connectivity breaks, restore maintenance remains active, or a runtime-only DB credential/network issue appears.
3. `/api/live` still returns 200 and Docker health becomes healthy.
4. `npm run deploy` reports success and proceeds to prune Docker artifacts, while user-facing DB-backed pages and admin flows may be failing.

Fix:
Keep Docker's restart health liveness-only if desired, but make `deploy.sh` use a bounded readiness check such as `/api/health` with `HEALTH_CHECK_DB=true` or a dedicated deploy-readiness endpoint that verifies DB connectivity and not-in-restore-maintenance. If avoiding DB health in normal container health is intentional, split deploy readiness from Docker liveness explicitly.

## Confirmed Issues

No confirmed security bypass, privacy leak, restore stale-write race, upload quota bypass, or migration postcondition failure was found in the traced code paths.

## Likely Issues

- TRC29-01: semantic embedding sidecar uses raw DB mode instead of the runtime semantic-mode resolver.

## Risks Requiring Manual Validation

- TRC29-02: color sidecar lacks per-image processing claims; current candidate predicates mitigate it, but the sidecar is weaker than the in-app runner.
- TRC29-03: deployed proxy topology must preserve real client IPs; current nginx template can collapse buckets behind an upstream edge unless real-IP handling is configured.
- TRC29-04: deploy success is liveness-based, not DB/readiness-based.

## Missed-Issues Sweep

Final sweeps performed before writing:
- `rg -n "uploadImages|saveOriginalAndGetMetadata|enqueueImageProcessing|retryFailedImage|restoreDatabase|runRestore|quiesceImageProcessingQueueForRestore|drainBackgroundDbWritesForRestore"`
- `rg -n "semanticSearchMode|SEMANTIC_SEARCH_ALLOW_PRODUCTION|PRODUCTION_MODEL_VERSION|STUB_MODEL_VERSION|imageEmbeddings|SEMANTIC_SCAN_LIMIT"`
- `rg -n "withAdminAuth|requireSameOriginAdmin|preIncrement|checkAndIncrement|rateLimit|TRUST_PROXY|X-Forwarded-For|X-Real-IP"`
- `rg -n "migrate|__drizzle_migrations|_journal|reconcileLegacySchema|HEALTHCHECK|api/live|api/health|docker compose|deploy"`
- API route inventory under `apps/web/src/app/api`

I rechecked the previous-cycle stale background write hypothesis. Current code tracks public analytics and audit writes through `trackBackgroundDbWrite` and drains them before restore import, so that prior issue is not present in the inspected HEAD.

## Covered File Summary

Documentation:
- `AGENTS.md`
- `CLAUDE.md`

Upload and image pipeline:
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/advisory-locks.ts`

Restore, maintenance, deploy, migrations:
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/restore-maintenance-durable.ts`
- `apps/web/src/lib/background-db-writes.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`

Public privacy/search/semantic:
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/search-route-privacy.test.ts`

Backfill:
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`

Auth, route scanners, rate limits, proxy:
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/nginx/default.conf`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
