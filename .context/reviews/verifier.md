# Verifier Review - Cycle 13

Date: 2026-07-07
Reviewer: verifier
HEAD reviewed: `d8fcb3d62a88d09bb69458e3672129ed902318ba` (`fix(security): 🐛 prefer host for origin checks`)
Mode: evidence-based correctness review against AGENTS.md, CLAUDE.md, tests, route contracts, data privacy rules, release gates, and UI behavior.

Application source and plans were not edited. Only this assigned review artifact was written.

## Inventory

Behavior-critical files inventoried before inspection:

- Governance and stated behavior: `AGENTS.md` from the prompt, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `/Users/hletrd/.agents/skills/code-review/SKILL.md`.
- Current-cycle delta from `173668ea..HEAD`: `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`, `scripts/check-proxy-topology.mjs`, `package.json`, `package-lock.json`, `apps/web/Dockerfile`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/__tests__/request-origin.test.ts`, `apps/web/src/__tests__/cycle12-ops-contracts.test.ts`, and current review/plan artifacts.
- Route/auth contracts: all `apps/web/src/app/actions/*`, `apps/web/src/app/api/**/route.{ts,tsx}`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/proxy.ts`.
- Data privacy and public selectors: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/db/schema.ts`.
- Stateful/runtime subsystems: upload/image actions, image queue/backfill, restore maintenance, CLIP semantic routes/model/backfill scripts, migration runner/journal, single-writer/proxy topology, deploy/Docker/nginx files.
- UI behavior contracts: public/admin route pages and components under `apps/web/src/app/[locale]`, `apps/web/src/components/**`, touch target/focus/a11y tests, and Playwright e2e inventory.

Fresh validation evidence:

- `npm run lint:api-auth --workspace=apps/web`: pass; 2 admin API routes OK.
- `npm run lint:action-origin --workspace=apps/web`: pass; all mutating server actions enforce same-origin provenance or documented public rate-limit/exempt posture.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: pass; public API route scanner OK.
- `npm test --workspace=apps/web -- --run src/__tests__/request-origin.test.ts src/__tests__/cycle12-ops-contracts.test.ts src/__tests__/privacy-fields.test.ts`: pass; 3 files / 32 tests.
- `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/password-form-a11y.test.ts src/__tests__/analytics-link-touch-targets.test.ts src/__tests__/gps-map-link-touch-targets.test.ts`: pass; 5 files / 36 tests.
- `npm run typecheck --workspace=apps/web`: pass.
- `npm run lint --workspace=apps/web`: pass.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`: pass; 0 vulnerabilities.
- `npm run build --workspace=apps/web`: pass. Build emitted a sitemap fallback warning because local MySQL was not listening on `127.0.0.1:3306`; the build completed successfully and tracked files remained clean.
- Direct predicate check: with `BASE_URL=https://gallerykit-ci.invalid`, `TRUST_PROXY=true`, `Host: 127.0.0.1:3100`, and `Origin: http://127.0.0.1:3100`, `hasTrustedSameOrigin()` returns `false`.

## Findings

### VER-C13-01 - CI E2E runtime inherits non-local `BASE_URL` and rejects localhost same-origin actions

Severity: High
Confidence: High

File/region:
- `.github/workflows/quality.yml:27-37`
- `apps/web/playwright.config.ts:15-29`
- `apps/web/playwright.config.ts:78-85`
- `apps/web/scripts/run-e2e-server.mjs:49-57`
- `apps/web/scripts/run-e2e-server.mjs:95-110`
- `apps/web/src/lib/request-origin.ts:45-67`
- `apps/web/src/app/actions/auth.ts:99-103`

Issue:
The required quality workflow sets `BASE_URL=https://gallerykit-ci.invalid` for the whole job. Playwright's default local target is `http://127.0.0.1:3100`, and `run-e2e-server.mjs` only overrides `BASE_URL` for the build child process. The runtime `server.js` child inherits the workflow-level `BASE_URL`, and current same-origin logic treats configured `BASE_URL` as the authoritative expected origin.

Concrete failure scenario:
CI reaches `npm run test:e2e`. The browser opens `http://127.0.0.1:3100/admin` and submits the admin login form. The request carries localhost `Origin`/`Host`, but the server expects `https://gallerykit-ci.invalid`, so `login()` returns `authFailed` before authentication/rate-limit work. Admin e2e flows that need mutating server actions cannot pass in the required quality workflow even though local builds and unit tests pass.

Suggested fix:
Separate build-time public metadata origin from runtime E2E origin. For local Playwright runs, start the runtime server with `BASE_URL=http://${host}:${port}` or unset `BASE_URL` for the runtime child so `Host` drives local same-origin checks. Keep the build child override for metadata validation, and add a regression test/source contract that `run-e2e-server.mjs` does not leak a non-local `BASE_URL` into the local runtime server.

### VER-C13-02 - Proxy topology checker does not actually verify `X-Forwarded-For` scrubbing

Severity: Medium
Confidence: High

File/region:
- `scripts/check-proxy-topology.mjs:7-10`
- `scripts/check-proxy-topology.mjs:61-68`
- `scripts/check-proxy-topology.mjs:108-119`
- `apps/web/src/lib/request-origin.ts:60-80`
- `apps/web/src/lib/rate-limit.ts:175-198`
- `README.md:172-174`

Issue:
The proxy topology helper says a safe edge overwrites `X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Forwarded-For` before traffic reaches the app. The implemented spoof probe only observes whether spoofed forwarded host/proto changes same-origin evaluation: it sends one syntactically invalid `POST` with spoofed forwarded headers, treats `400/404/405/415/429/503` as success, and errors only on `403` or `5xx`. Current same-origin logic also prefers `BASE_URL` or `Host` over `X-Forwarded-Host`, so an edge can pass the probe while still forwarding attacker-controlled `X-Forwarded-For`.

Concrete failure scenario:
An operator runs `npm run check:proxy-topology -- --url https://gallery.example.com` against a proxy that correctly preserves `Host` but appends or forwards inbound `X-Forwarded-For`. The check passes because the request fails at content-type validation before rate-limit identity is observable. In production with `TRUST_PROXY=true`, `getClientIp()` trusts the forwarded chain and selects the client before the trusted suffix; attacker-supplied XFF entries can therefore split login/search/share/semantic budgets and weaken per-IP rate limiting even though the deployed topology check reported success.

Suggested fix:
Either stop claiming the helper verifies XFF, or add an explicit XFF-sensitive check. A practical option is an opt-in active rate-limit probe that sends valid, charged requests through the same public endpoint and verifies repeated requests with different spoofed XFF values still hit one edge-derived bucket. If that is too invasive, add a dedicated read-only diagnostic endpoint available only in a deploy-check mode that returns the server-side `getClientIp()` decision without mutating state.

### VER-C13-03 - Proxy topology checker accepts unexpected statuses as success

Severity: Low
Confidence: High

File/region:
- `scripts/check-proxy-topology.mjs:51-59`
- `scripts/check-proxy-topology.mjs:61-69`

Issue:
`classifyBaseline()` and `classifySpoof()` reject `403` and `>=500`, and allow a small known set of expected pre-work failures. They do not reject other unexpected non-500 statuses. A `200`, `204`, `302`, `401`, or other non-listed status falls through as success even though the helper text says the probes should fail before mutation/rate-limit work.

Concrete failure scenario:
A misrouted proxy sends the semantic probe to a login page, CDN fallback, or custom 200 handler. The topology check exits successfully instead of flagging that the probe did not hit the expected route contract. Operators get a false-positive deploy check and may miss a broken or bypassed edge/app path.

Suggested fix:
Make both classifiers explicit allowlists. After accepting the intended statuses, throw on every other status with a message that includes the route and status. Keep the baseline/spoof messages distinct so operators can tell route misrouting from same-origin spoof failures.

### VER-C13-04 - Quality workflow still does not exercise the production Docker build path

Severity: Medium
Confidence: High

File/region:
- `.github/workflows/quality.yml:48-83`
- `apps/web/Dockerfile:50-62`
- `apps/web/Dockerfile:76-85`

Issue:
The default quality workflow installs the workspace, runs lint/typecheck/security gates/audit/unit/e2e, and runs `npm run build`, but it never builds the Docker image that production deploys. The Dockerfile has deployment-only behavior that local `npm run build` cannot cover: explicit Linux native package installs for Sharp/libvips, Parcel watcher, SWC, Next SWC, and Lightning CSS in the build stage, plus a separate production dependency stage that verifies `require('sharp')`.

Concrete failure scenario:
A dependency update changes a native package version or workspace hoisting shape. CI remains green because the workspace build uses the normal `npm ci` tree, while production deploy fails in Docker when the manually pinned Linux native package list is stale or incomplete. This is especially easy to miss because the Dockerfile intentionally duplicates lockfile-sensitive native versions outside `package.json`.

Suggested fix:
Add a CI job or workflow step that runs `docker build -f apps/web/Dockerfile .` for the production target architecture, or at least a fast source/lockfile assertion that every manually installed native package/version in the Dockerfile matches `package-lock.json`. Keep the full Docker build as the stronger release gate because it also validates standalone output copying and runtime dependency layout.

## Verified Non-Findings

- Current request-origin hardening is consistent with the stated same-origin posture: `BASE_URL` is authoritative when configured, `Host` wins over spoofable forwarded host when present, right-most forwarded proto/host fallback is tested for trusted-proxy mode, and missing `Origin`/`Referer` fails closed by default.
- Admin API, mutating server action, and public API rate-limit lint gates all passed fresh. I also inspected the semantic and similar-search routes around their same-origin, maintenance, body/ID validation, pre-increment rate-limit, semantic-mode, model-version, and public enrichment contracts.
- Public privacy selectors are still guarded by explicit public allowlists and symmetric sensitive-key tests. `searchEnrichmentSelectFields` is shared by semantic/similar routes and carries the compile-time privacy guard.
- UI touch-target and focus/a11y source-contract tests passed for the reviewed public/admin component surfaces.
- Production dependency audit is now green at the reviewed lockfile.
- Build/typecheck/lint passed. The build warning was a non-fatal sitemap DB fallback caused by absent local MySQL, not a compile failure.

## Final Sweep

Searched and inspected around: current-cycle changed files, route auth wrappers, action-origin scanner output, public rate-limit scanner output, request-origin callers, proxy trust/XFF handling, CLIP preflight workflow and model loader, Docker native dependency pins, data privacy selectors, semantic search enrichment, migration/reconcile rules, UI touch-target tests, and current review aggregates. No source or plan files were modified. The skipped full e2e suite is covered by the unchanged workflow and was not rerun locally in this verifier pass because the source delta is release/proxy-gate oriented and targeted UI/source checks plus build passed.
