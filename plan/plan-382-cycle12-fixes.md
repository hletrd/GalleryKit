# Plan 382 - Cycle 12 Review Fixes

Status: IN PROGRESS
Cycle: 12/100
Source review aggregate: `.context/reviews/_aggregate.md`
Created: 2026-07-07 KST

## Repo Rules Checked Before Planning

- `CLAUDE.md`
- `AGENTS.md`
- `.context/plans/README.md`
- `.context/plans/deferred-carry-forward.md`
- `.context/plan/plan-c12.md`
- Relevant current and historical `.context/**` plan/review records
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`
- `.cursorrules` and `CONTRIBUTING.md`: not present

Registry state checked before dependency planning:

- `npm view next version dependencies.postcss dist-tags --json`: latest stable is `16.2.10`, still depends on `postcss: 8.4.31`.
- `npm view drizzle-kit version dependencies dist-tags --json`: latest stable is `0.31.10`, still depends on `@esbuild-kit/esm-loader` and `esbuild`.
- `npm view postcss version --json`: latest stable is `8.5.16`.
- `npm view esbuild version --json`: latest stable is `0.28.1`.

## Coverage Accounting

All 33 aggregate findings are covered:

- Scheduled here: `AGG-C12-01`, `AGG-C12-02`, `AGG-C12-03`, `AGG-C12-04`, `AGG-C12-17`.
- Deferred in `plan/plan-383-cycle12-deferred.md`: `AGG-C12-05` through `AGG-C12-16`, `AGG-C12-18` through `AGG-C12-33`.

Security/correctness/data-loss policy:

- `AGG-C12-01`, `AGG-C12-02`, `AGG-C12-03`, `AGG-C12-04`, and `AGG-C12-17` are scheduled because they are supply-chain, deployment-security, or release-confidence findings.
- No confirmed security, correctness, or data-loss finding is deferred.

## Work Packages

### WP1 - Make dependency audit green without downgrades

Findings: `AGG-C12-01`, `AGG-C12-02`

Tasks:

- Add lockfile-effective npm `overrides` for the nested `next -> postcss` and `@esbuild-kit/core-utils -> esbuild` paths while preserving latest stable direct package versions.
- Run `npm install` to update `package-lock.json`.
- Verify `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` is green. If it remains red because an override cannot affect the nested path safely, record the exact blocker in this plan before committing.
- Add a root/package script or CI quality step for production audit so the fixed condition remains visible.
- Keep the existing warning not to use `npm audit fix --force` if it suggests downgrading Next or Drizzle tooling.

Acceptance:

- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` passes, or the attempted lockfile-effective override is proven impossible without breaking npm/package compatibility and the blocker is recorded.
- Existing package versions remain on latest stable releases checked above.
- Full configured gates pass before commit.

### WP2 - Pin the production Docker base image digest

Finding: `AGG-C12-04`

Tasks:

- Resolve the current digest for the latest stable `node:24-slim` image from Docker registry tooling.
- Change both production Docker stages from mutable `node:24-slim` to `node:24-slim@sha256:<digest>`.
- Update the Dockerfile supply-chain comment so future changes use a deliberate digest refresh process.
- If registry tooling is unavailable locally, use an authoritative registry source and record the exact command/source in this plan.

Acceptance:

- Dockerfile base image changes are reviewable in git.
- `BASE_URL=https://gallery.atik.kr npm run build --workspace=apps/web` passes before commit.
- Deploy uses the pinned base successfully.

### WP3 - Add a non-destructive proxy-topology validation surface

Finding: `AGG-C12-03`

Tasks:

- Add a repo-owned, read-only validation script or documented command that operators can run against the public edge to detect unsafe forwarded-header behavior:
  - spoofed `X-Forwarded-Host` / `X-Forwarded-Proto` must not change same-origin acceptance;
  - `X-Forwarded-For` handling must not collapse all clients when behind a load balancer;
  - direct app-port exposure while `TRUST_PROXY=true` is explicitly flagged.
- Keep it non-destructive and config-driven; do not hardcode hostnames or credentials.
- Add a lightweight source/test contract so the validation surface remains discoverable.

Acceptance:

- The check is available from a package script or documented deploy runbook.
- No production network mutation occurs during tests.
- Full configured gates pass.

### WP4 - Add durable CLIP production preflight evidence

Finding: `AGG-C12-17`

Tasks:

- Add a scheduled/manual GitHub Actions workflow or quality-adjacent CI job that provisions/seeds CLIP model weights and runs `npm run test:clip:preflight --workspace=apps/web`.
- If full model seeding is too heavy for push/PR, keep it scheduled/manual and document that a recent successful run is required before enabling or changing production semantic search.
- Add a small source/test contract that ensures the workflow or script references `test:clip:preflight`, `CLIP_MODELS_ROOT`, `CLIP_OFFLINE_LOAD=1`, and `CLIP_INTEGRATION=1`.

Acceptance:

- Default push gates remain practical.
- There is a committed, runnable path for real-model CLIP preflight evidence.
- Existing CLIP unit tests still pass.

## Verification Gates

Run every configured gate against the whole repo before final commit/push:

- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `BASE_URL=https://gallery.atik.kr npm run build --workspace=apps/web`
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web` only if browser-flow coverage is required by code changes
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` for WP1

## Gate Warning Recorded

- Warning: `BASE_URL=https://gallery.atik.kr npm run build --workspace=apps/web` logged the existing sitemap fallback after `ECONNREFUSED 127.0.0.1:3306`.
- Severity/confidence: Low / High.
- Deferral reason: this cycle's local resource constraint explicitly forbids mutating the already-running MySQL containers, and the configured build gate does not provide an initialized local DB on 127.0.0.1:3306. The build exited 0 after falling back to the homepage-only sitemap.
- Exit criterion: re-open when the build gate is changed to provide an initialized disposable DB, or when sitemap generation is changed so production builds no longer attempt a DB-backed sitemap during static generation.

Then verify new commits since cycle start:

- `git log --format='%h %G? %GS %s' 173668ea0a0bb5f57a64cef581ac7b0f5abaef20..HEAD`

Every new commit must show `%G?` as `G` and signer `128F2D0C0729A5AB` / `9AC5BC170AFBDC3A05BF4FA1128F2D0C0729A5AB`.

## Progress

- [x] Prompt 1 aggregate written.
- [x] Prompt 2 plan written.
- [x] Completed plan archived: `plan/plan-376-cycle19-fixes.md` moved to `plan/done/`.
- [x] WP1 dependency audit override implemented and verified (`npm audit --workspace=apps/web --omit=dev --audit-level=moderate`: 0 vulnerabilities).
- [x] WP2 Docker base digest pinned and verified in source contract (`node:24-slim@sha256:b31e7a42fdf8b8aa5f5ed477c72d694301273f1069c5a2f71d53c6482e99a2fc`; resolved with `docker buildx imagetools inspect node:24-slim`).
- [x] WP3 proxy-topology validation surface implemented and verified; live pre-deploy probe exposed spoofed-forwarded-header influence, so app-side same-origin resolution was also hardened to prefer configured `BASE_URL` and the real `Host` header before `X-Forwarded-Host`.
- [x] WP4 CLIP preflight workflow/contract implemented and verified.
- [x] Full configured gates passed (`lint`, `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, `typecheck`, `build`, `test`, production `npm audit`).
- [ ] Signed commit pushed.
- [ ] Per-cycle deploy complete.
