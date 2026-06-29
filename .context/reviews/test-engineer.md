# Test Engineer Review - review-plan-fix Cycle 4

**Date:** 2026-06-29  
**HEAD:** `10b500bb30399f7c66812a5ad899f070f88d5501`  
**Role:** test-engineer  
**Scope:** current HEAD only. Focused on test coverage gaps, flaky tests, regression locks, TDD shape, fixture adequacy, and whether critical contracts are actually tested. No application code was edited.

## Inventory

Required repo instructions read first: `AGENTS.md` and `CLAUDE.md`.

Current HEAD test and behavior-surface inventory:

- Unit tests: 245 tracked `*.test.ts` / `*.test.tsx` files under `apps/web/src/__tests__`.
- E2E tests: 5 Playwright specs under `apps/web/e2e`.
- Source under test: 231 non-test TS/TSX files under `apps/web/src`.
- API routes: 8 App Router route modules under `apps/web/src/app/api`.
- Server actions: 13 action modules under `apps/web/src/app/actions`.
- Critical custom gates reviewed: `check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, `touch-target-audit.test.ts`, focus/source-contract tests, privacy/schema/migration drift tests, E2E admin/origin smoke tests.
- Operational/build contracts reviewed: `.github/workflows/quality.yml`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/scripts/run-e2e-server.mjs`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, Docker/compose tests.
- Relevant prior history checked just enough to avoid stale duplicates: top-level `.context/reviews/test-engineer.md` from cycle 3 and `run9-cycle8/test-engineer.md`.

Validation evidence:

- `npm test --workspace=apps/web -- check-public-route-rate-limit.test.ts public-actions.test.ts client-source-contracts.test.ts` - pass, 3 files / 52 tests.
- Direct checker probe for the public-route rate-limit scanner false negative:
  `checkPublicRouteSource("if (false) preIncrement...; await db.insert...")` returned passed with no failures.
- No committed `.only` tests found. Expected skips remain CLIP model-seeded integration tests and admin E2E local-credential skips.

## Findings

### TE-C4-01 - Public mutating-route rate-limit scanner still passes unreachable helper calls

Severity: Medium  
Confidence: High  
Status: Confirmed coverage gap / confirmed scanner false negative

Exact region:

- `apps/web/scripts/check-public-route-rate-limit.ts:107-150`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:153-205`

Problem:

`bodyCallsRateLimitBeforeMutation()` is statement-order aware, and cycle 3's broader nested-function blind spot is partially fixed. However, it still treats any rate-limit helper call inside a top-level statement as effective, even when the call is in an unreachable branch. The current fixtures reject after-mutation calls, nested local functions, nested callbacks, and rollback-only helpers, but they do not cover a dead branch such as `if (false) preIncrementSemanticAttempt(...)`.

Concrete failure scenario:

A future public `POST` route ships this shape:

```ts
export async function POST() {
  if (false) preIncrementSemanticAttempt(ip, Date.now());
  await db.insert(rows).values(payload);
  return Response.json({ ok: true });
}
```

The lint gate reports OK even though no request is charged before the mutation. A bot can then flood the route while `npm run lint:public-route-rate-limit` and CI stay green.

Concrete fix/test to add:

Add a failing fixture to `check-public-route-rate-limit.test.ts` for `if (false) preIncrement...` before `db.insert(...)`, plus at least one branch-only variant where the helper is under a condition that does not dominate the mutation. Then make `bodyCallsRateLimitBeforeMutation()` accept only a top-level executed pre-increment guard shape, for example `if (preIncrement*(...)) return ...;`, or fail closed for conditional statements whose rate-limit call does not dominate the later mutation.

### TE-C4-02 - Deploy disk-hygiene and data-safety contract has no regression test

Severity: Medium  
Confidence: High  
Status: Confirmed coverage gap

Exact region:

- `apps/web/deploy.sh:31-56`
- `scripts/deploy-remote.sh:22-72`
- `AGENTS.md:17-19`
- `CLAUDE.md:452-475`

Problem:

The repo documents the deploy script as a load-bearing operational contract: every pushed iteration deploys, `apps/web/deploy.sh` must prune Docker only after `docker compose up -d --build`, and automatic `docker volume prune` must omit `-a` so bind-mounted data remains safe. There is no test or source-contract guard for any of this. Existing config tests cover nginx/Dockerfile/compose details, but `rg "deploy.sh|volume prune|container prune|image prune|builder prune" apps/web/src/__tests__` finds no coverage for the deploy scripts.

Concrete failure scenario:

A future edit moves pruning before `up -d`, changes `docker volume prune -f` to `docker volume prune -af`, removes `builder prune`, or hardcodes a remote deploy target in `scripts/deploy-remote.sh`. CI remains green because no test reads either script. In production, that can either reintroduce the disk-full outage class or turn a routine deploy into a data-loss/host-specific operation.

Concrete fix/test to add:

Add a small source-contract test such as `deploy-script-contract.test.ts` that reads `apps/web/deploy.sh` and `scripts/deploy-remote.sh` and asserts:

- `docker compose -f apps/web/docker-compose.yml up -d --build` appears before any `docker * prune`.
- `docker container prune -f`, `docker image prune -af`, `docker builder prune -af`, and `docker volume prune -f` are present.
- automatic `docker volume prune -af` / `--all` is absent.
- `scripts/deploy-remote.sh` derives from `.env.deploy` / `DEPLOY_ENV_FILE` / `$HOME/.gallerykit-secrets/...`, not a hardcoded host or key path.

### TE-C4-03 - Production site-config validator is only exercised indirectly with the happy-path CI URL

Severity: Medium  
Confidence: High  
Status: Confirmed coverage gap

Exact region:

- `apps/web/scripts/ensure-site-config.mjs:4-43`
- `.github/workflows/quality.yml:27-34` and `.github/workflows/quality.yml:51-52`
- `apps/web/package.json` `prebuild` script

Problem:

`ensure-site-config.mjs` is the production build/deploy guard that fails missing `src/site-config.json`, missing production base URLs, non-absolute URLs, non-http(s) schemes, and placeholder hosts (`example.com`, localhost, loopback). The CI workflow copies the example config and sets a valid `BASE_URL=https://gallerykit-ci.invalid`, so the normal build only exercises the happy path. There is no unit or subprocess test that asserts the failure cases remain loud.

Concrete failure scenario:

A future refactor accidentally removes the placeholder-host check or stops requiring an absolute production URL. CI still passes because the workflow always supplies a valid `BASE_URL`. A production build can then bake `example.com`, `localhost`, or another invalid canonical origin into metadata/OG behavior, weakening the SSRF/canonical-origin hardening described in `CLAUDE.md`.

Concrete fix/test to add:

Add a focused subprocess test for `scripts/ensure-site-config.mjs`. Run it in a temp cwd containing `src/site-config.json` fixtures and assert exit code plus stderr for:

- missing config file,
- `NODE_ENV=production` with no URL,
- `NODE_ENV=production` with `siteConfig.url=https://example.com`,
- `NODE_ENV=production` with a relative or `file:` URL,
- success when `BASE_URL=https://gallerykit-ci.invalid` overrides the example config.

For easier TDD, the script could first extract pure validation into an exported helper, then keep one subprocess test proving the CLI exits correctly.

## Closed Prior Items / Non-Findings

- Cycle 3 public analytics recorder gap is closed at current HEAD: `public-actions.test.ts` imports `recordPhotoView`, `recordTopicView`, and `recordSharedGroupView`, and covers valid writes, invalid-input short-circuit, restore-maintenance short-circuit, and exhausted per-IP budget behavior.
- Cycle 3 admin metadata static allowlist gap is closed at current HEAD: `client-source-contracts.test.ts` still checks known contracts, but also walks admin `page.tsx` files and accepts page or ancestor metadata providers.
- Cycle 3 public-route scanner nested-helper gap is partially closed: fixtures now reject nested local functions and nested callbacks before mutation. TE-C4-01 is the narrower remaining unreachable-branch gap.
- The action-origin scanner is stronger than the public-route scanner on dead branches: `check-action-origin.test.ts` explicitly covers `if (false) await requireSameOriginAdmin()`.
- CI is configured to run lint, typecheck, security lint gates, unit tests, DB init, Playwright E2E, and build. Admin E2E is expected to run in GitHub Actions because `CI=true` and plaintext E2E credentials are supplied.
- The nav visual-check spec still writes manual screenshots, but it now has DOM target-size and overlap assertions. I am not re-filing that as a current actionable gap.

## Final Missed-Issues Sweep

Swept for focused/skipped tests, manual screenshot-only coverage, source-contract vacuity, scanner fixture gaps, public analytics rate limits, admin metadata route drift, deploy/build operational contracts, CI gate ordering, environment-gated CLIP tests, and recent prior test-engineer findings.

Coverage statement: the application test posture is strong for core runtime behavior, security lint gates, migrations/schema drift, privacy field guards, color/HDR processing, CLIP contracts, upload processing, admin actions, and accessibility/touch-target source scans. The remaining gaps are mostly test harness/operational-regression locks: one confirmed lint false negative and two production/deploy contracts that are documented and critical but not directly tested.
