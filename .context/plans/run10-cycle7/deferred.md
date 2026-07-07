# Run-10 Cycle 7 Deferred Findings

Date: 2026-07-07
Status: active deferred register

Repo rules read before deferring: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, `README.md`, `apps/web/README.md`, and CLIP docs under `docs/superpowers/`. No `.cursorrules` or `CONTRIBUTING.md` exists.

Deferred work remains bound by repo policy: GPG-signed conventional commits with gitmoji, no `Co-Authored-By`, `git pull --rebase` before push, no force push/reset, and all required gates before deploy.

## Deferred Items

### DEF-C7-01 - Shared-group cached getter owns a hidden view-count write

- Original finding: `AGG-C7-02`
- Original severity/confidence: Low / High
- Citation: `apps/web/src/lib/data.ts:1331-1407`, `apps/web/src/lib/data.ts:1793-1797`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`
- Reason for deferral: Low-severity boundary cleanup; no current confirmed miscount or public bug, and this cycle prioritizes Medium correctness/security findings.
- Exit criterion: any new shared-group read caller is added, any view-count inconsistency is observed, or a future data-layer cleanup touches shared-group read APIs.

### DEF-C7-02 - CSP keeps `style-src 'unsafe-inline'`

- Original finding: `AGG-C7-04`
- Original severity/confidence: Low / Medium
- Citation: `apps/web/src/lib/content-security-policy.ts:138-155`
- Reason for deferral: The current source explicitly documents the production inline-style allowance as a framework/component compatibility tradeoff. Removing it safely requires a separate audit of React style attributes and third-party component runtime styles.
- Exit criterion: CSP work starts, a style-injection finding appears, or the app no longer needs inline style attributes/component inline styles.

### DEF-C7-03 - TLS termination requires live edge validation

- Original finding: `AGG-C7-05`
- Original severity/confidence: Conditional High / Medium
- Citation: `apps/web/nginx/default.conf:46-57`, `apps/web/nginx/default.conf:90-97`
- Reason for deferral: Live edge configuration is operator-owned. `apps/web/README.md` states the checked-in nginx template is "meant to sit behind a TLS-terminating edge" and says "if nginx is your public edge, add a real 443 server and redirect cleartext 80 traffic." This cycle cannot verify or alter the external TLS edge beyond deploy smoke.
- Exit criterion: operator provides host/edge access for validation, nginx template becomes the public edge, or HTTP public endpoint testing shows cleartext service without redirect.

### DEF-C7-04 - Proxy trust and rate-limit attribution need live topology validation

- Original finding: `AGG-C7-06`
- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/lib/rate-limit.ts:175-205`, `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:59-71`
- Reason for deferral: The repo documents this as deployment-topology dependent. `apps/web/README.md` says to configure nginx `real_ip` when another trusted edge sits in front and to keep `TRUSTED_PROXY_HOPS=1` for the shipped topology.
- Exit criterion: deploy topology changes, a load balancer/CDN is added in front of nginx, rate-limit attribution looks collapsed/spoofable, or operator asks for edge validation.

### DEF-C7-05 - Historical secret rotation cannot be proven from source

- Original finding: `AGG-C7-07`
- Original severity/confidence: Medium / High for historical risk, Low for current production state
- Citation: `README.md` and `CLAUDE.md` environment warnings, `apps/web/src/lib/session.ts:19-35`
- Reason for deferral: Requires production credentials/operator authority. Repo docs already state: "Historical git values must be treated as compromised and must not be reused" and instruct rotation of `SESSION_SECRET` and bootstrap/admin credentials if older examples were used.
- Exit criterion: operator provides production secret audit authority, any historical example secret is found live, or credential rotation work is explicitly requested.

### DEF-C7-06 - Restore child-process failure event-order coverage

- Original finding: `AGG-C7-09`
- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:572-854`
- Reason for deferral: Validation-only hardening that requires extraction or fakes around the restore child-process runner; no confirmed current failure path. This cycle schedules restore-adjacent correctness work in analytics instead.
- Exit criterion: restore code is refactored, a restore failure leaves maintenance state dirty, or a future cycle focuses on restore behavioral fakes.

### DEF-C7-07 - Deploy cleanup and proxy behavior need live-host validation

- Original finding: `AGG-C7-10`
- Original severity/confidence: Low/Medium / Medium
- Citation: `apps/web/deploy.sh:57-104`, `apps/web/nginx/default.conf:99-204`
- Reason for deferral: Live-host validation is operator/topology dependent. `AGENTS.md` and `CLAUDE.md` say deploy auto-prunes safely after `up -d`, while nginx template application is not performed by deploy.
- Exit criterion: deploy smoke fails, body-size/proxy behavior changes, operator provides a live validation window, or nginx host config is changed.

### DEF-C7-08 - Map still uses one-shot marker payload rather than viewport clustering

- Original finding: `AGG-C7-11`
- Original severity/confidence: Medium / High
- Citation: `apps/web/src/lib/data.ts:1736-1768`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-105`, `apps/web/src/components/map/map-client.tsx:80-140`
- Reason for deferral: This cycle schedules a truncation disclosure (`WP6`) that fixes the misleading cap. Full viewport/bounds API and marker clustering is a larger feature-level redesign.
- Exit criterion: production map-visible GPS rows approach the cap, real browser traces show `/map` hydration jank, or viewport-filtered map work is scheduled.

### DEF-C7-09 - Timeline and On This Day date-query indexing redesign

- Original finding: `AGG-C7-12`
- Original severity/confidence: Medium / High
- Citation: `apps/web/src/lib/data-timeline.ts:88-116`, `apps/web/src/lib/data-timeline.ts:125-145`, `apps/web/src/lib/data-timeline.ts:172-207`
- Reason for deferral: Fully fixing month/day requires schema work for generated/indexed columns and migration/reconcile changes. No production `EXPLAIN` evidence was gathered in this cycle.
- Exit criterion: production query plans show scans causing latency, gallery cardinality materially grows, or a schema-index cycle is scheduled.

### DEF-C7-10 - Destructive local e2e environment remains conditional

- Original finding: `AGG-C7-16`
- Original severity/confidence: Medium / High
- Citation: `apps/web/playwright.config.ts:48-87`, `apps/web/scripts/run-e2e-server.mjs:49-62`, `apps/web/scripts/seed-e2e.ts:181-215`
- Reason for deferral: This cycle will run e2e as required after source changes. Splitting a non-destructive smoke project from destructive seed/build coverage is a broader harness design task.
- Exit criterion: future review lanes need non-destructive runtime proof without a seeded DB, or e2e setup remains a repeated blocker.

### DEF-C7-11 - LR PAT upload lacks real auth-to-upload integration test

- Original finding: `AGG-C7-17`
- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/api/admin/lr/upload/route.ts:84-92`, `apps/web/src/lib/api-auth.ts:72-90`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:44-47`
- Reason for deferral: The route and auth wrapper already have separate behavior tests; a true end-to-end multipart/token/queue test requires disposable DB integration harness work beyond this cycle's scheduled e2e additions.
- Exit criterion: Lightroom/PAT upload route changes, token auth changes, or a disposable DB request-test harness is added.

### DEF-C7-12 - No coverage ratchet for critical files

- Original finding: `AGG-C7-20`
- Original severity/confidence: Medium / High
- Citation: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-39`
- Reason for deferral: Coverage ratchets are process/tooling policy and can destabilize a large existing suite if introduced mid-fix cycle. This cycle adds targeted tests for changed behavior.
- Exit criterion: CI policy work starts, repeated untested critical branches are found, or coverage baseline generation is explicitly requested.

### DEF-C7-13 - Admin token-management UI lacks behavior e2e/component coverage

- Original finding: `AGG-C7-21`
- Original severity/confidence: Low / High
- Citation: `apps/web/e2e/admin.spec.ts:20-42`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-128`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:167-199`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:250-325`
- Reason for deferral: Low-severity UI coverage gap; this cycle prioritizes public route e2e coverage and correctness fixes.
- Exit criterion: token UI changes, PAT management bugs appear, or admin e2e scope is expanded.

### DEF-C7-14 - Nav visual screenshots are artifacts, not assertions

- Original finding: `AGG-C7-22`
- Original severity/confidence: Low / High
- Citation: `apps/web/e2e/nav-visual-check.spec.ts:6-37`, `apps/web/e2e/nav-visual-check.spec.ts:58`, `apps/web/e2e/nav-visual-check.spec.ts:72`, `apps/web/e2e/nav-visual-check.spec.ts:85`
- Reason for deferral: Low-severity visual-regression process improvement; current test still asserts touch target and overlap metrics.
- Exit criterion: visual snapshot infrastructure is introduced, nav layout changes, or screenshots repeatedly catch issues only after manual review.

### DEF-C7-15 - CLIP activation tests are opt-in and one has known native teardown flake

- Original finding: `AGG-C7-23`
- Original severity/confidence: Low / Medium
- Citation: `apps/web/src/__tests__/clip-offline-load.test.ts:15-25`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`
- Reason for deferral: Production CLIP activation remains operator-only by repo policy; `CLAUDE.md` explicitly calls these pre-activation tests the manual gate because CI has no model weights.
- Exit criterion: CLIP model/runtime changes, production semantic search activation changes, or operator reports ambiguous CLIP preflight results.

### DEF-C7-16 - Moderate nested dependency advisories require upstream-safe releases

- Original finding: `AGG-C7-03`
- Original severity/confidence: Medium / High
- Citation: `apps/web/package.json:57`, `apps/web/package.json:80`, `package-lock.json` entries for `node_modules/next/node_modules/postcss`, `node_modules/@esbuild-kit/core-utils/node_modules/esbuild`, and `node_modules/drizzle-kit/node_modules/esbuild`.
- Reason for deferral: A safe update was attempted in this cycle: direct `next` was moved to latest stable `16.2.10` and direct `postcss` to latest stable `8.5.16`. `npm audit --workspace=apps/web --audit-level=moderate` still reports nested `next/node_modules/postcss@8.4.31` and `@esbuild-kit/core-utils/node_modules/esbuild@0.18.20`. The audit tool's only suggested fixes are `npm audit fix --force` downgrades to `next@9.3.3` and `drizzle-kit@0.18.1`, which conflicts with the repo/user rule to use latest stable framework/tool versions and would be a broad breaking dependency rollback. Security/correctness findings are normally not deferrable; this item is recorded as blocked because the available automated fix violates stronger repo policy and no non-downgrade patched upstream release is available in the checked registry state.
- Exit criterion: a stable `next` release no longer nests vulnerable PostCSS, a stable `drizzle-kit` release removes or patches the `@esbuild-kit`/esbuild chain, npm override support can be proven to replace the nested packages without lockfile breakage, or the project explicitly approves a dependency migration away from the vulnerable chain.
