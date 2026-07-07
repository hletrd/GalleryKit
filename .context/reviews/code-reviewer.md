# Cycle 13 Code Review - code-reviewer

Date: 2026-07-07
Repository: `/Users/hletrd/flash-shared/gallery`
Review boundary: `173668ea0a0bb5f57a64cef581ac7b0f5abaef20..d8fcb3d6`
Reviewer focus: code quality, logic, SOLID/maintainability, edge cases, and cross-file interactions.

## Inventory

I first built the review inventory from `git diff --name-status 173668ea..HEAD` and then read every review-relevant changed file, not a sample.

Changed paths:

- Review/context docs only: `.context/reviews/_aggregate.md`, `.context/reviews/architect-document-specialist.md`, `.context/reviews/code-reviewer.md`, `.context/reviews/designer-ui-ux-reviewer.md`, `.context/reviews/perf-debugger-tracer.md`, `.context/reviews/security-reviewer.md`, `.context/reviews/verifier-test-engineer.md`
- Plan docs only: `plan/done/plan-376-cycle19-fixes.md`, `plan/plan-382-cycle12-fixes.md`, `plan/plan-383-cycle12-deferred.md`
- Reviewed source/config/test files: `.github/workflows/clip-preflight.yml`, `.github/workflows/quality.yml`, `apps/web/Dockerfile`, `apps/web/src/__tests__/cycle12-ops-contracts.test.ts`, `apps/web/src/__tests__/request-origin.test.ts`, `apps/web/src/lib/request-origin.ts`, `package-lock.json`, `package.json`, `scripts/check-proxy-topology.mjs`

Cross-file interaction files read for behavior validation:

- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/playwright.config.ts`
- `apps/web/scripts/run-e2e-server.mjs`
- `apps/web/scripts/check-js-scripts.mjs`
- `apps/web/nginx/default.conf`
- `apps/web/package.json`
- `apps/web/scripts/download-clip-models.ts`
- `apps/web/src/__tests__/clip-offline-load.test.ts`
- `apps/web/src/__tests__/clip-semantic-integration.test.ts`
- representative E2E specs/helpers around admin login and origin guard

Validation evidence gathered:

- `npm run lint --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web -- --pretty false` passed; npm warned that `--pretty` is an unknown npm config.
- Focused tests passed: `request-origin.test.ts`, `cycle12-ops-contracts.test.ts`, `semantic-search-route.test.ts`.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate --json` passed with 0 vulnerabilities.
- `npm ci --dry-run --workspace=apps/web` passed.
- `node --check scripts/check-proxy-topology.mjs` passed.
- Registry check on 2026-07-07: latest stable values remain `next@16.2.10`, `drizzle-kit@0.31.10`, `postcss@8.5.16`, and `esbuild@0.28.1`.

## Confirmed Issues

### CR-C13-01 - CI/local E2E server inherits a non-local `BASE_URL`, so same-origin admin actions reject localhost browser requests

Severity: High
Confidence: High
Status: Confirmed issue
Exact file/region:

- `.github/workflows/quality.yml:27-37` sets `BASE_URL=https://gallerykit-ci.invalid` for the whole job.
- `apps/web/playwright.config.ts:15-29` runs Playwright against `http://127.0.0.1:<port>` by default.
- `apps/web/playwright.config.ts:78-85` starts the local server through `scripts/run-e2e-server.mjs`.
- `apps/web/scripts/run-e2e-server.mjs:49-57` preserves parent env in child commands.
- `apps/web/scripts/run-e2e-server.mjs:95-100` overrides `BASE_URL` only for the build child process.
- `apps/web/scripts/run-e2e-server.mjs:106-110` starts the runtime server without overriding or unsetting `BASE_URL`.
- `apps/web/src/lib/request-origin.ts:45-67` now prefers configured `BASE_URL` as the expected same-origin origin.
- `apps/web/src/app/actions/auth.ts:99-103` rejects login when `hasTrustedSameOrigin()` fails.

Failure scenario:

The required CI E2E job exports `BASE_URL=https://gallerykit-ci.invalid`, then Playwright opens the local server at `http://127.0.0.1:3100`. The runtime server inherits the CI `BASE_URL`, so `hasTrustedSameOrigin()` expects `https://gallerykit-ci.invalid` while the browser sends `Origin: http://127.0.0.1:3100`. Admin login and other same-origin protected server actions reject before auth.

I validated the core predicate directly:

`BASE_URL=https://gallerykit-ci.invalid TRUST_PROXY=true` with `Host/Origin=http://127.0.0.1:3100` returns `false` from `hasTrustedSameOrigin()`.

Suggested fix:

Separate build-time public metadata origin from runtime E2E origin. In `run-e2e-server.mjs`, pass the actual local origin to the runtime server, for example `BASE_URL=http://${host}:${port}` at `spawn(... server.js ...)`, or explicitly unset `BASE_URL` for the runtime child and rely on `Host` for local E2E. Keep the production behavior of preferring `BASE_URL` intact.

### CR-C13-02 - `check:proxy-topology` claims to validate `X-Forwarded-For`, but its probe returns before IP/rate-limit code runs

Severity: Medium
Confidence: High
Status: Confirmed issue
Exact file/region:

- `scripts/check-proxy-topology.mjs:7-10` says the safe edge overwrites `X-Forwarded-For`.
- `scripts/check-proxy-topology.mjs:98-119` sends `Content-Type: text/plain` probes to `/api/search/semantic`.
- `apps/web/src/app/api/search/semantic/route.ts:117-127` rejects non-JSON content type before protected work.
- `apps/web/src/app/api/search/semantic/route.ts:173-184` is where `getClientIp()` and `preIncrementSemanticAttempt()` actually run.
- `apps/web/src/lib/rate-limit.ts:175-205` is the `X-Forwarded-For` trust logic the probe is supposed to validate.
- `apps/web/nginx/default.conf:59-71` documents the deployment contract whose failure mode is bad `X-Forwarded-For` handling.
- `apps/web/src/__tests__/cycle12-ops-contracts.test.ts:20-31` only asserts that the script contains `X-Forwarded-For`, not that any probe reaches IP selection.

Failure scenario:

An unsafe edge forwards client-supplied `X-Forwarded-For` through to an app running `TRUST_PROXY=true`. The operator runs `npm run check:proxy-topology -- --url ...`; the script sends a malformed semantic-search POST, the route returns `400` at content-type validation, and the script classifies that as pass. `getClientIp()` is never called, so spoofed or collapsed client IP handling is not tested.

Suggested fix:

Either stop claiming this script validates `X-Forwarded-For`, or add a real read-only diagnostic that exercises `getClientIp()` without mutation. If using the semantic route, the probe must reach the pre-increment path and then observe a meaningful signal; otherwise it remains a string-presence check, not a topology check.

### CR-C13-03 - `check:proxy-topology` accepts unexpected non-500 statuses as success

Severity: Low
Confidence: High
Status: Confirmed issue
Exact file/region:

- `scripts/check-proxy-topology.mjs:51-59`
- `scripts/check-proxy-topology.mjs:61-69`

Failure scenario:

`classifyBaseline()` and `classifySpoof()` reject `403` and `>=500`, and allow a small known set, but they do not reject other unexpected statuses. A `200`, `204`, `302`, `401`, or other non-500 response falls through as success even though the help text says the probes should fail before mutation/rate-limit work.

Suggested fix:

Make the classifiers allowlist-only. After the known-safe status set, throw on every other status with a message that includes the status and probe type. Treat edge-side fail-closed statuses deliberately instead of relying on fallthrough.

## Likely Risk

### CR-C13-04 - Audit overrides leave the npm dependency tree invalid under `npm ls`

Severity: Medium
Confidence: Medium
Status: Likely risk with confirmed tooling failure
Exact file/region:

- `package.json:7-15`
- `package-lock.json:378-388`
- `package-lock.json:6353-6366`
- `package-lock.json:8809-8820`
- `package-lock.json:9437-9458`

Failure scenario:

The production audit is now green, but `npm ls postcss esbuild --all` exits with `ELSPROBLEMS` because `postcss@8.5.16` violates Next's exact `postcss: 8.4.31` dependency metadata and `esbuild@0.28.1` violates `@esbuild-kit/core-utils`'s `~0.18.20` dependency metadata. Current `npm ci --dry-run`, lint, typecheck, and focused tests pass, so this is not a current build failure. The risk is that dependency diagnostics, future npm behavior, or tooling that treats `npm ls` as a health check reports the workspace as invalid even while the audit gate is green.

Suggested fix:

Prefer an upstream-compatible release when available. If the out-of-range overrides are intentionally accepted as the short-term security tradeoff, add an explicit source/CI contract documenting that `npm ls` is expected to be red for these exact override edges, and avoid using `npm ls` as a dependency-health proof until the upstream ranges catch up.

## Non-Findings Checked

- The `BASE_URL` preference in `request-origin.ts` is directionally correct for production spoofed forwarded-host hardening; the confirmed issue is the local E2E runtime inheriting a non-local CI value.
- `npm audit --omit=dev` is green after the dependency override change.
- The CLIP preflight workflow runs a seed step and then the existing offline/integration tests with `CLIP_MODELS_ROOT`, `CLIP_OFFLINE_LOAD=1`, and `CLIP_INTEGRATION=1`; I did not find a code-level defect in the workflow itself.
- Docker base-image digest pinning is applied to both production base stages.
- Admin API auth, mutating action origin checks, and public route rate-limit static gates pass.

## Final Sweep

Final sweep covered auth/origin checks, proxy and forwarded-header trust, public API rate-limit ordering, CI workflow env propagation, local E2E server env propagation, dependency override behavior, Docker digest pinning, CLIP preflight seed/load wiring, root/app script syntax coverage, and source-string tests added for operational contracts.

Skipped files: none in the review-relevant source/config/test inventory. Plan and review documents were read for boundary/context but not reviewed as executable source.
