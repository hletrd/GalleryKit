# Run-10 Cycle 34 Verifier Review

Role: verifier lane
Repo: `/Users/hletrd/flash-shared/gallery`
Mode: review-only; no implementation or source behavior changes
Date: 2026-07-08 KST

## Inventory

Guidance read first: `AGENTS.md`, `CLAUDE.md`, and the local `code-review` skill. I then inventoried docs, deploy scripts, gates, tests, and the runtime code paths that back documented operational claims.

Relevant files and regions inspected:

- Workspace and repo contracts: `AGENTS.md:5-46`, `CLAUDE.md:1-765`, `README.md:171-177`, `apps/web/README.md:57-64`.
- Root and app scripts: `package.json:17-30`, `apps/web/package.json:5-30`, `scripts/deploy-remote.sh:1-93`, `apps/web/deploy.sh:1-108`.
- Runtime packaging and proxy config: `apps/web/Dockerfile:1-198`, `apps/web/docker-compose.yml:1-79`, `apps/web/nginx/default.conf:1-312`, `scripts/check-proxy-topology.mjs:1-134`.
- Schema and privacy contracts: `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/lib/data.ts:260-488`, `apps/web/src/__tests__/privacy-fields.test.ts:41-220`.
- Color/HDR and settings-hash contracts: `apps/web/src/lib/settings-hash.ts:44-183`, `apps/web/src/__tests__/settings-hash.test.ts:20-260`.
- CLIP semantic-search contracts: `apps/web/src/lib/clip-model.ts:53-216`, `apps/web/src/lib/clip-paths.ts:60-97`, `apps/web/src/app/api/search/semantic/route.ts:1-194`, `apps/web/src/app/api/search/similar/[id]/route.ts:1-171`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-42`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`.
- Public freshness and admin dynamism: public pages under `apps/web/src/app/[locale]/(public)/**/page.tsx` with `revalidate = 0`, admin pages under `apps/web/src/app/[locale]/admin/**` with `dynamic = "force-dynamic"`, and dynamic API routes under `apps/web/src/app/api/**`.
- Gate scripts and tests: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, migration journal/reconcile tests, deploy/nginx tests, and targeted privacy/settings tests.

## Verification Evidence

Fresh commands run in this lane:

```bash
npm run lint:api-auth --workspace=apps/web
npm run lint:action-origin --workspace=apps/web
npm run lint:public-route-rate-limit --workspace=apps/web
npm test --workspace=apps/web -- --run src/__tests__/migration-journal.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/settings-hash.test.ts src/__tests__/deploy-script-contract.test.ts src/__tests__/nginx-config.test.ts
```

Results:

- `lint:api-auth`: passed; admin API exports are wrapped by `withAdminAuth(...)`.
- `lint:action-origin`: passed; mutating non-auth server actions enforce same-origin provenance or carry explicit exemptions.
- `lint:public-route-rate-limit`: passed; public mutating or expensive route handlers have pre-increment rate limits or explicit exemptions.
- Targeted invariant suite: 7 test files passed, 156 tests passed.

Full `lint`, `typecheck`, `build`, full unit suite, Playwright E2E, production audit, live deploy, and live host checks were not run in this verifier lane.

## Confirmed Findings

No confirmed implementation-vs-documentation correctness gaps were found in the inspected scope.

The checked docs, scripts, code, and tests agree on these core invariants: signed conventional git workflow, env-driven deploy helper, Docker prune after successful health, no `docker volume prune -a`, migration journal monotonicity and reconcile coverage, public selector privacy omissions, settings-hash key coverage for color-impacting config, public-route rate-limit scanning, admin API auth scanning, action-origin scanning, public page no-cache behavior, and CLIP production gating.

## Likely Findings

No likely code-level findings are being reported. The remaining risks below are manual-validation risks because the repo intentionally cannot prove live host state, model-weight state, real proxy topology, or real upload memory envelope.

## Manual-Validation Risks

### M1. Host nginx limiter application is documented but not repo-verifiable

Severity: Medium
Confidence: High
Classification: Manual-validation risk

Evidence:

- `CLAUDE.md:516-526` says deploys do not touch host nginx and the public/`_next/image` limiter zones must be applied manually.
- `apps/web/nginx/default.conf:10-29` defines shared limiter zones and notes the limiter key is only correct when `$remote_addr` is the real client.
- `apps/web/nginx/default.conf:246-312` applies the `_next/image` and catch-all public limiters.
- `apps/web/deploy.sh:55-104` only performs Compose up, health checks, and Docker prune; it does not sync or reload host nginx.

Failure scenario:

An operator assumes `npm run deploy` activated the committed public and image rate limiters, but the host is still running an older nginx config. Public SSR and Next image optimizer traffic remain unthrottled. In a load-balancer topology without real-IP configuration, the opposite failure can also occur: all visitors share the load balancer IP bucket and receive unrelated 429s.

Concrete fix/verification:

Apply the committed nginx config on the host, run `nginx -t`, reload nginx, then burst-test `/` and `/_next/image` until overflow returns 429 while normal single-client page loads still succeed. In load-balancer topologies, configure and verify `real_ip` or PROXY protocol before accepting the limiter evidence.

### M2. CLIP production readiness depends on seeded host weights and manual preflight

Severity: Medium
Confidence: High
Classification: Manual-validation risk

Evidence:

- `CLAUDE.md:618-626` states CLIP weights are intentionally not in CI and the real ONNX/runtime preflight must be run manually with seeded weights.
- `apps/web/package.json:23` exposes `test:clip:preflight`, requiring `CLIP_MODELS_ROOT` and enabling offline/integration gates.
- `apps/web/src/__tests__/clip-offline-load.test.ts:15-42` skips unless `CLIP_OFFLINE_LOAD=1` and a seeded model root exist.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31` skips by default unless `CLIP_INTEGRATION=1`.
- `apps/web/Dockerfile:131-135` creates and exports `/app/data/models/clip`; it does not bake model weights into the image.
- `apps/web/src/lib/clip-model.ts:203-216` disables remote model loading and loads from the configured local cache.

Failure scenario:

The DB row or env gate is flipped to production mode on a host without the expected model snapshots or without a successful preflight. Semantic search then returns 503/errors or empty production results even though ordinary CI and local tests passed.

Concrete fix/verification:

Seed the model snapshots into the deployed `CLIP_MODELS_ROOT`, run the documented sidecar/backfill, then run `CLIP_MODELS_ROOT=<absolute-host-path> npm run test:clip:preflight --workspace=apps/web` on the deployment host. Record the preflight output and a production semantic query result before enabling the DB production gate.

### M3. Proxy topology check does not prove effective client-IP buckets

Severity: Medium
Confidence: High
Classification: Manual-validation risk

Evidence:

- `README.md:171-177` and `apps/web/README.md:57-64` require `TRUST_PROXY=true` only behind a trusted proxy that overwrites `X-Forwarded-*`.
- `apps/web/nginx/default.conf:20-28` and `apps/web/nginx/default.conf:59-71` warn that `$binary_remote_addr` and `X-Forwarded-For` behavior are only correct when nginx sees the real client or is configured for the upstream load balancer.
- `scripts/check-proxy-topology.mjs:7-16` explicitly says it cannot prove `X-Forwarded-For` or effective client-IP bucket behavior.
- `scripts/check-proxy-topology.mjs:131-134` reports effective client-IP bucket / XFF overwrite as `not-verified`.

Failure scenario:

The spoof-resistance check passes while all app or nginx rate-limit decisions still key on the load balancer IP. That can cause global lockouts under normal multi-user traffic, or it can make per-client throttles ineffective depending on where the wrong IP is trusted.

Concrete fix/verification:

Add or run an operational diagnostic that proves the effective client key from two distinct real clients through the production proxy chain. Pair `npm run check:proxy-topology -- --url <origin>` with nginx/app log evidence, and configure `set_real_ip_from` plus `real_ip_header X-Forwarded-For` or PROXY protocol where needed.

### M4. Large multipart upload RSS envelope remains unmeasured on the production host

Severity: Medium
Confidence: High
Classification: Manual-validation risk

Evidence:

- `CLAUDE.md:661-663` documents that on-host RSS measurement for multipart uploads is still pending, while upload caps default to 200 MiB total and 100 MiB per file.
- `AGENTS.md:29-39` lists broad gates, but none of those gates prove concurrent production-host memory behavior under real multipart uploads.

Failure scenario:

Operators raise upload caps or accept multiple concurrent large uploads assuming the pipeline is fully disk-streamed. If the framework or runtime buffers multipart `File` objects on heap before downstream image processing, the container can OOM or restart under concurrent admin uploads.

Concrete fix/verification:

Run a controlled production-like upload load test at the documented caps and expected concurrency, capture container RSS and restart evidence, then record the safe concurrency/memory budget in `CLAUDE.md` or an operational runbook. Add a repeatable smoke or load-test command if the budget becomes a release invariant.

## Final Sweep

Checked common missed issue classes:

- Docs claiming deploy behavior not backed by scripts/tests: no confirmed mismatch found for env-file selection, permission checks, bind mounts, health-before-prune, and no `volume prune -a`.
- Migration entry without journal or reconcile mirror: no confirmed mismatch found in targeted migration tests.
- Public selectors leaking admin-only fields: no confirmed mismatch found in `data.ts` or targeted privacy tests.
- Color/HDR setting key drift: no confirmed mismatch found in settings hash source or targeted tests.
- Public route doing expensive or mutating work before a limiter: scanner passed.
- Admin API route lacking `withAdminAuth(...)`: scanner passed.
- Mutating server action lacking same-origin return-early: scanner passed.
- Public page cache freshness drift: inspected public page exports use `revalidate = 0`; admin pages inspected use dynamic rendering.
- CLIP production routes lacking same-origin or production gating: no confirmed mismatch found in inspected semantic/similar route regions.

Skipped or outside this lane:

- Historical `.context/reviews/**` and `.context/plans/**` were inventoried but not exhaustively re-reviewed because `CLAUDE.md` and `AGENTS.md` are the current authority for this verifier pass.
- I did not run full blocking gates, Playwright E2E, production audit, production deploy, live nginx reload checks, real CLIP model preflight, real proxy-client-IP diagnostics, or upload RSS measurement.
- Pre-existing unrelated working-tree change observed: `.context/reviews/perf-reviewer.md`. I did not inspect or edit it.
