# Cycle 35 Verifier Review

Role: cycle-35 verifier subagent
Repo: `/Users/hletrd/flash-shared/gallery`
Mode: review-only; no product-code edits
Date: 2026-07-08 KST

## Inventory / Scope Reviewed

Required guidance read first:

- `AGENTS.md:1-50`
- `CLAUDE.md:1-765`
- Code-review skill: `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Verification-relevant inventory built before reviewing:

- App source: 627 TypeScript/TSX files under `apps/web/src`.
- Unit tests: 363 Vitest test files under `apps/web/src/__tests__`.
- E2E tests: 9 Playwright specs under `apps/web/e2e`.
- Scripts: 29 files under `apps/web/scripts`.
- App Router page/layout/route files: 43.
- Primary behavior contracts inspected: root/app READMEs, `AGENTS.md`, `CLAUDE.md`, package scripts, Docker/Compose/nginx/deploy scripts, migration journal and reconcile code, public/admin data selectors, semantic-search routes, upload/original paths, service worker contract tests, admin API/action/public-route lint scripts, and test gates.

High-signal files/regions manually checked:

- Git/deploy/schema/gate contracts: `AGENTS.md:15-39`, `CLAUDE.md:510-666`.
- Package and gate scripts: `apps/web/package.json:8-30`.
- Deploy and pruning behavior: `apps/web/deploy.sh:51-108`.
- Docker persistence and CLIP model mount: `apps/web/Dockerfile:125-180`, `apps/web/docker-compose.yml:1-35`.
- Nginx public/image/admin limits and proxy assumptions: `apps/web/nginx/default.conf:1-90`, `apps/web/nginx/default.conf:240-305`.
- Proxy diagnostic limits: `scripts/check-proxy-topology.mjs:7-16`, `scripts/check-proxy-topology.mjs:129-134`.
- Privacy/public selectors: `apps/web/src/lib/data.ts:251-488`, `apps/web/src/lib/search-enrichment-fields.ts:1-47`.
- Upload/original storage boundary: `apps/web/src/lib/upload-paths.ts:12-66`, `apps/web/src/lib/upload-paths.ts:173-202`.
- CLIP manual preflight gates: `apps/web/src/__tests__/clip-offline-load.test.ts:1-42`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:1-31`.

## Verification Evidence

Fresh commands run:

```bash
npm run lint:api-auth --workspace=apps/web
npm run lint:action-origin --workspace=apps/web
npm run lint:public-route-rate-limit --workspace=apps/web
npm run typecheck --workspace=apps/web
npm run test --workspace=apps/web -- src/__tests__/privacy-fields.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/deploy-script-contract.test.ts src/__tests__/nginx-config.test.ts src/__tests__/sw-template-contract.test.ts src/__tests__/free-download-contract.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/check-api-auth.test.ts
npm run lint --workspace=apps/web
npm run audit:prod
npm test --workspace=apps/web
GALLERYKIT_TYPECHECKED=1 npx next build   # run from apps/web; avoids prebuild generators
```

Results:

- Admin API auth lint: passed.
- Server action origin/barrier lint: passed.
- Public route rate-limit lint: passed.
- Typecheck: passed, including app tests and scripts.
- Targeted contract suite: 10 files passed, 402 tests passed.
- ESLint: passed.
- Production dependency audit: passed, `found 0 vulnerabilities`.
- Full unit suite: 361 files passed, 2 skipped; 3394 tests passed, 4 skipped.
- Direct production compiler build: passed on Next.js 16.2.10.
- Worktree remained unchanged before report write except ignored `.next/` build output.

## Findings

No confirmed implementation-vs-documentation correctness findings were found.

No likely code-level findings were found. The inspected docs, scripts, code, and tests line up on the reviewed contracts: admin API wrapping, server-action origin and restore-barrier coverage, public route rate limits, privacy-sensitive field omissions, public map exception shape, migration journal/reconcile coverage, deploy prune safety, Docker bind mounts, private originals, CLIP production gating, service worker generation contract, and build/type/test/audit gates.

## Missing Verification / Manual Risks

### M1. Host nginx limiter application remains outside repo-verifiable evidence

Severity: Medium
Confidence: High
Classification: Risk / manual-verification gap

Evidence:

- `CLAUDE.md:516-526` states deploys do not touch host nginx and limiter activation requires manual host apply/reload.
- `apps/web/nginx/default.conf:10-19` defines `public` and `nextimage` zones.
- `apps/web/nginx/default.conf:254-294` applies the `/_next/image` and catch-all public limiters.
- `apps/web/deploy.sh:51-108` rebuilds/restarts the app and prunes Docker; it does not sync or reload host nginx.

Concrete failure scenario:

An operator deploys the commit and assumes the checked-in nginx rate limiters are live, but the host still runs an older config. Public SSR pages or Next image optimizer requests remain unthrottled, or an LB-fronted topology keys all visitors into one `$binary_remote_addr` bucket and creates unrelated 429s.

Suggested fix:

Apply the committed nginx template on the host, run `nginx -t`, reload, then burst-test `/` and `/_next/image` until overflow returns 429 while normal page loads still succeed. For LB/CDN-fronted hosts, first configure `real_ip` or PROXY protocol so `$binary_remote_addr` is the real client.

### M2. CLIP production readiness depends on seeded host weights and env-gated preflight

Severity: Medium
Confidence: High
Classification: Risk / manual-verification gap

Evidence:

- `CLAUDE.md:558-626` documents that CLIP weights are not baked and the real preflight is the production activation proof.
- `apps/web/package.json:21-23` exposes `test:clip:preflight`.
- `apps/web/src/__tests__/clip-offline-load.test.ts:15-42` skips unless `CLIP_OFFLINE_LOAD=1` and seeded weights exist.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31` skips unless `CLIP_INTEGRATION=1`.
- `apps/web/Dockerfile:131-175` creates `/app/data/models/clip` but does not include model weights.

Concrete failure scenario:

`SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` and the DB row are enabled before the host has the expected model snapshots and production embeddings. Ordinary CI/unit tests still pass, but production semantic search returns 503/errors or no useful results.

Suggested fix:

Seed weights into the deployed `CLIP_MODELS_ROOT`, run the documented production backfill, then run `CLIP_MODELS_ROOT=<abs-models-root> npm run test:clip:preflight --workspace=apps/web` on the deployment host before flipping the DB production mode.

### M3. Proxy topology diagnostic does not prove effective client-IP buckets

Severity: Medium
Confidence: High
Classification: Risk / manual-verification gap

Evidence:

- `apps/web/nginx/default.conf:20-28` warns that nginx limiter keys need real-IP configuration in LB-fronted topologies.
- `apps/web/nginx/default.conf:59-71` documents that overwriting `X-Forwarded-For` with `$remote_addr` is correct only when nginx sees the real client.
- `scripts/check-proxy-topology.mjs:7-16` says the probe cannot prove XFF overwrite or intended client-IP bucket selection.
- `scripts/check-proxy-topology.mjs:129-134` reports `not-verified=effective client-IP bucket or X-Forwarded-For overwrite`.

Concrete failure scenario:

The spoof-resistance check passes, but app and nginx rate limits still key on a load balancer IP. This can either globally lock out legitimate users or weaken per-client abuse protection depending on the proxy chain.

Suggested fix:

Add an operational proof that observes the effective rate-limit key from two distinct real client IPs through the production edge, paired with nginx/app logs. Configure `set_real_ip_from` plus `real_ip_header X-Forwarded-For` or PROXY protocol where needed.

### M4. Large multipart upload RSS envelope is explicitly not measured

Severity: Medium
Confidence: High
Classification: Risk / manual-verification gap

Evidence:

- `CLAUDE.md:661-663` documents the memory envelope and says on-host RSS measurement is still pending.
- `AGENTS.md:29-39` defines the blocking gates, but none measure production-host multipart RSS under concurrent large uploads.

Concrete failure scenario:

Admins upload several near-cap files concurrently, or operators raise caps, assuming the pipeline is fully disk-streamed. Framework multipart buffering plus Sharp work can exceed container memory and restart the process.

Suggested fix:

Run a controlled production-like upload load test at the documented caps and expected concurrency, record container RSS/restart evidence, then add the safe concurrency budget to the ops runbook if it becomes a release invariant.

## Claims Not Backed By Local Automated Evidence

- Live host nginx reload status and real limiter behavior are documented but not proven by repo tests.
- Real CLIP production model loading/ranking is intentionally skipped without seeded model weights.
- Effective production client-IP bucket selection cannot be proven by the checked-in spoof probe alone.
- Real upload RSS behavior under max-size concurrent multipart uploads is not covered by unit/build gates.
- Playwright E2E and admin E2E were not run in this verifier lane; admin E2E requires explicit credentials/enabled flags.
- The full `npm run build --workspace=apps/web` wrapper was not run because its `prebuild` step regenerates tracked PWA assets. I ran `GALLERYKIT_TYPECHECKED=1 npx next build` directly after typecheck, and `sw-template-contract.test.ts` covered the generated service worker contract.
- No production deploy or live host checks were run.

## Final Sweep

Common missed issues checked:

- Destructive deploy cleanup: `apps/web/deploy.sh:99-104` uses `docker volume prune -f`, not `volume prune -a`, and only after health passes.
- Admin API routes: scanner passed for all admin API route handlers.
- Mutating server actions: scanner passed for same-origin return-early and restore-mutation barrier coverage/exemptions.
- Expensive public routes: scanner passed for rate-limit helpers or explicit exemptions.
- Privacy fields: `apps/web/src/lib/data.ts:374-488` and `apps/web/src/lib/search-enrichment-fields.ts:29-47` include compile-time guards; targeted tests passed.
- Legacy public originals: `apps/web/src/lib/upload-paths.ts:173-202` fails closed in production when legacy public originals exist, and migration/startup call sites were present.
- Migration journal: all journal entries had matching SQL; targeted migration tests passed.
- Ignored local runtime files under `apps/web/public/uploads/`, `apps/web/public/resources/`, and ignored `.next/` build output were observed but are not committed source and were not used as product-code findings.

Skipped files:

- Historical `.context/reviews/**`, `.context/plans/**`, `.omc/**`, `.omx/**`, `.claude/**`, and ignored runtime/generated files were inventoried but not exhaustively re-reviewed. Current authority for this pass was `AGENTS.md`, `CLAUDE.md`, current source, current scripts, and current tests.
