# Cycle 10 Document-Specialist Review

**Date:** 2026-06-29
**HEAD reviewed:** `944bbdb0e930c0f4b03bc09b240a2dfcb93935f2`
**Scope:** PROMPT 1 documentation/code mismatch review only. This report is the only intended write.

## Inventory Summary

I reviewed the authoritative repo docs and their implementation touchpoints:

- Governing docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Package and CI gates: root `package.json`, `apps/web/package.json`, `.github/workflows/quality.yml`, `.github/dependabot.yml`.
- Deploy and operations: `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/scripts/ensure-site-config.mjs`.
- Migration/schema contracts: `apps/web/drizzle/meta/_journal.json`, migration SQL files, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, privacy/migration tests.
- Security and lint contracts: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, public/admin API route files, mutating action files, and related tests.
- Runtime/source behavior cited by docs: upload limits, health/live routes, trust-proxy rate limiting, CLIP semantic search routes/scripts/config, service-worker generation, generated `public/sw.js`, PWA tests, and operational sidecar scripts.
- Current committed review/plan docs were inventory-swept for active references; historical archived artifacts were not treated as authoritative current behavior unless canonical docs pointed at them.

## Findings

### CONFIRMED - MEDIUM - `AGENTS.md` omits the CI-blocking E2E gate from "all blocking" quality gates

**Files/regions:** `AGENTS.md:29-37`, `package.json:18`, `apps/web/package.json:20`, `.github/workflows/quality.yml:72-77`, `CLAUDE.md:575-578`, `apps/web/README.md:23-37`

**Confidence:** High

**Evidence:** `AGENTS.md:29` labels the listed commands as "Quality gates (all blocking)" but the list ends at ESLint, three security lints, typecheck, build, and Vitest (`AGENTS.md:31-37`). The repository does have a root `test:e2e` script (`package.json:18`) and app script (`apps/web/package.json:20`), and CI installs Playwright browsers and runs `npm run test:e2e` (`.github/workflows/quality.yml:72-77`). `CLAUDE.md` documents the E2E command in the testing section (`CLAUDE.md:575-578`), but the short-form agent gate list and `apps/web/README.md` script table (`apps/web/README.md:23-37`) do not present it as a normal gate.

**Failure scenario:** An agent or contributor following `AGENTS.md` as the short canonical checklist can run every listed "blocking" gate locally, skip Playwright, and still get a CI failure on push/PR. This is especially likely for routing, auth-origin, navigation, and browser-only regressions that unit tests do not exercise.

**Concrete fix:** Add `npm run test:e2e --workspace=apps/web` to `AGENTS.md` under Quality gates and add `npm run test:e2e` to the `apps/web/README.md` scripts table. If E2E is intentionally CI-only, rename the AGENTS heading so it does not claim the list is all blocking.

### CONFIRMED - LOW - `CLAUDE.md` describes service-worker versions as git-SHA based, but the generator uses template hash plus pipeline version

**Files/regions:** `CLAUDE.md:407`, `apps/web/scripts/build-sw.ts:4-12`, `apps/web/scripts/build-sw.ts:27-33`, `apps/web/public/sw.template.js:21-26`, `apps/web/public/sw.js:21-26`, `apps/web/package.json:10`

**Confidence:** High

**Evidence:** `CLAUDE.md:407` says `scripts/build-sw.ts` stamps `__SW_VERSION__` as `git short-SHA + -p{IMAGE_PIPELINE_VERSION}`. The generator says and does something different: it computes a SHA-256 hash over the service-worker template plus `PIPELINE=${IMAGE_PIPELINE_VERSION}`, slices it to 8 chars, and returns `<templateHash>-p<IMAGE_PIPELINE_VERSION>` (`apps/web/scripts/build-sw.ts:4-12`, `apps/web/scripts/build-sw.ts:27-33`). The current generated file contains `858bc13e-p7` (`apps/web/public/sw.js:21-26`). A read-only hash check of `sw.template.js` plus pipeline `7` also produced `858bc13e-p7`, while current HEAD short is `944bbdb0`.

**Failure scenario:** An operator or reviewer reading CLAUDE expects every commit to produce a new service-worker cache namespace. The actual behavior invalidates SW caches only when the template content or image pipeline version changes. That current behavior is reasonable, but the stale doc can lead to false stale-artifact reports or wrong cache-invalidation expectations after non-PWA commits.

**Concrete fix:** Update `CLAUDE.md:407` to say `scripts/build-sw.ts` stamps `__SW_VERSION__` from the service-worker template hash plus `IMAGE_PIPELINE_VERSION`, and that `public/sw.js` needs regeneration only when the template or pipeline version changes.

### CONFIRMED - LOW - Rate-limit convention docs classify semantic search as rollback-on-infrastructure-error, but the route intentionally does not rollback after expensive work begins

**Files/regions:** `apps/web/src/lib/rate-limit.ts:17-29`, `apps/web/src/app/api/search/semantic/route.ts:178-189`, `apps/web/src/app/api/search/semantic/route.ts:232-255`, `apps/web/src/__tests__/semantic-search-route.test.ts:182-187`, `apps/web/src/__tests__/semantic-search-route.test.ts:380-385`

**Confidence:** High

**Evidence:** The rate-limit convention comment lists `/api/search/semantic` under "**Rollback on infrastructure error**" and says the pre-incremented counter is rolled back when the underlying operation throws (`apps/web/src/lib/rate-limit.ts:17-20`). The route imports only `preIncrementSemanticAttempt`, charges at `apps/web/src/app/api/search/semantic/route.ts:178-189`, and explicitly returns errors without rollback once embedding or DB scan work begins (`apps/web/src/app/api/search/semantic/route.ts:232-255`). Tests lock the no-rollback behavior for charged oversized bodies and post-work server errors (`apps/web/src/__tests__/semantic-search-route.test.ts:182-187`, `apps/web/src/__tests__/semantic-search-route.test.ts:380-385`).

**Failure scenario:** Future route authors use `rate-limit.ts` as the project pattern guide and copy the wrong rollback semantics for a public CPU/DB-expensive route. They may refund failures after the guarded resource was consumed, weakening the DoS budget that the semantic route deliberately protects.

**Concrete fix:** Rewrite the pattern-2 prose in `apps/web/src/lib/rate-limit.ts` to distinguish cheap public read actions from semantic search. For semantic search, document the current rule: charge before body materialization, refund none after the charged request consumes body parsing, embedding CPU, or DB scan work; only pre-charge disabled/config/header gates are free.

## Likely Issues

None beyond the confirmed findings above.

## Final Missed-Issue Sweep

Final sweeps rechecked canonical docs against package scripts, CI workflow, deploy helper resolution, Docker/nginx body caps, health/live route behavior, migration journal/runbook behavior, privacy omit guards, CLIP activation and offline model loading, service-worker generation, generated `sw.js`, upload limits, public/admin route scanner behavior, and contract comments containing terms such as `blocking`, `production`, `deploy`, `rollback`, `__SW_VERSION__`, `must`, and `not wired`.

Already-aligned areas included deploy pruning and bind mounts, `.env.local` and `site-config` examples, health/readiness docs, upload and nginx limits, semantic-search production gating, migration hash postconditions, privacy-sensitive field guards, and the three security lint scanners aside from the semantic rollback prose above.

## Validation Evidence

- `rg`/line-number sweeps over `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, package scripts, CI, deploy scripts, Docker/nginx config, source routes, tests, docs, and generated artifacts.
- Read-only service-worker version check: hashing `apps/web/public/sw.template.js` plus `PIPELINE=7` produced `858bc13e-p7`, matching `apps/web/public/sw.js`.
- `git status --short --branch` checked before writing. Pre-existing dirty files were `.context/reviews/code-reviewer.md`, `.context/reviews/perf-reviewer.md`, and `.context/reviews/security-reviewer.md`; this review did not touch them.
- Not run: full lint, typecheck, build, unit suite, or E2E suite. This was a review-only documentation/source-contract task, and no application source was edited.
