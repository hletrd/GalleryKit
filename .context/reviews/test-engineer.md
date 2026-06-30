# Cycle 35 Test-Engineer Review

Reviewer: test-engineer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `96160854ebadca1606e9f99b2e6f5bc4689e366c`
Date: 2026-06-30 KST
Scope: read-only review of tests, quality gates, scanner fixtures, and high-risk regression paths. No source files were edited; this review artifact is the only write from this lane.

## Inventory

- Repo rules read: `AGENTS.md`; `CLAUDE.md` testing, lint-gate, deployment, service-worker, and touch-target sections.
- Gate scripts reviewed:
  - `apps/web/package.json`
  - `apps/web/vitest.config.ts`
  - `apps/web/playwright.config.ts`
  - `apps/web/scripts/run-e2e-server.mjs`
  - `apps/web/scripts/check-js-scripts.mjs`
  - `apps/web/scripts/check-api-auth.ts`
  - `apps/web/scripts/check-action-origin.ts`
  - `apps/web/scripts/check-public-route-rate-limit.ts`
- Scanner fixture tests reviewed:
  - `apps/web/src/__tests__/check-api-auth.test.ts`
  - `apps/web/src/__tests__/check-action-origin.test.ts`
  - `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
  - `apps/web/src/__tests__/touch-target-audit.test.ts`
  - `apps/web/src/__tests__/deploy-script-contract.test.ts`
  - `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`
- Browser/static asset tests reviewed:
  - `apps/web/src/__tests__/histogram.test.ts`
  - `apps/web/src/__tests__/sw-template-contract.test.ts`
  - `apps/web/public/histogram-worker.js`
  - `apps/web/public/sw.template.js`
  - `apps/web/src/components/histogram.tsx`
- E2E surface reviewed:
  - `apps/web/e2e/admin.spec.ts`
  - `apps/web/e2e/origin-guard.spec.ts`
  - `apps/web/e2e/public.spec.ts`
  - `apps/web/e2e/nav-visual-check.spec.ts`
  - `apps/web/e2e/test-fixes.spec.ts`
- High-risk code-path spot checks covered admin/server actions, public route handlers, upload/LR upload paths, DB restore/export, deploy contracts, service-worker cache behavior, migration reconcile tripwires, and scanner discovery.
- Prior deferrals checked: cycle 33 and cycle 34 deferred files. Historical low-priority carry-forward items were not re-raised without new current-HEAD evidence.

Focused read-only checks run:

- `node --check apps/web/public/histogram-worker.js`
- `node --check apps/web/public/sw.template.js`
- Pure scanner fixture: `checkActionSource(...)` accepted an imported `dangerousWrite()` before `requireSameOriginAdmin()`.
- Pure scanner fixture: `checkPublicRouteSource(...)` accepted an imported `dangerousWrite()` before a public route rate-limit gate.

## Findings

### TE35-01 - Histogram worker tests duplicate the algorithm instead of executing the shipped worker

Severity: Medium
Confidence: High

Citations:

- `apps/web/public/histogram-worker.js:4` installs the real browser worker `self.onmessage`.
- `apps/web/public/histogram-worker.js:19-36` computes the RGB/luminance bins sent back to the UI.
- `apps/web/src/components/histogram.tsx:541-542` loads `/histogram-worker.js?v=${IMAGE_PIPELINE_VERSION}` in production.
- `apps/web/src/__tests__/histogram.test.ts:62-138` tests luminance behavior by emitting a fake worker response.
- `apps/web/src/__tests__/histogram.test.ts:86-113` contains an in-test `computeHistogram` copy of the worker algorithm.
- `apps/web/scripts/check-js-scripts.mjs:7-9` syntax-checks only `apps/web/scripts`, not `apps/web/public`.

Problem:

The histogram test never evaluates `apps/web/public/histogram-worker.js`. It sends messages through `requestHistogramFromWorker`, then fabricates the worker response with a duplicated `computeHistogram` implementation in the test. That locks the React wrapper contract, but not the shipped worker code that photographers actually use for the color audit histogram.

Failure scenario:

A future change breaks the public worker file, changes its coefficient branch, drops `requestId`, posts `{ hist: ... }` instead of `{ histogram: ... }`, or changes loop bounds. The current test still passes because it supplies the expected response itself. `node --check` currently passes for the worker file, but no blocking gate asserts that syntax or behavior for this public static worker remains valid.

Suggested fix:

Execute the shipped worker source in a controlled test harness. A low-risk path is to load `public/histogram-worker.js` with `node:vm`, provide a fake `self.postMessage`, call `self.onmessage(...)`, and assert the returned histogram shape and P3/sRGB luminance bins. Alternatively extract the worker computation into a shared pure module and have both the worker and test import it, while keeping a source-contract check that the public worker delegates to that module. Extend `check-js-scripts` or a dedicated source-contract test to syntax-check public static JavaScript that is shipped directly.

### TE35-02 - Scanner fixtures miss imported side-effect helpers before required guards

Severity: Medium
Confidence: High

Citations:

- `apps/web/scripts/check-action-origin.ts:248-257` recognizes only a small hard-coded set of imported mutating function names.
- `apps/web/scripts/check-action-origin.ts:280-302` treats direct DB method calls and locally discovered mutating helpers as mutations, but not arbitrary imported side-effect helpers.
- `apps/web/src/__tests__/check-action-origin.test.ts:153-168` covers a local helper hiding a DB mutation, not an imported helper.
- `apps/web/scripts/check-public-route-rate-limit.ts:49-56` recognizes direct mutation method names only.
- `apps/web/scripts/check-public-route-rate-limit.ts:239-268` marks a public mutating route safe when it sees a limiter before any recognized mutation.
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:577-610` covers local helper mutations before rate limiting, not imported side-effect helpers.
- Existing action code relies on imported side-effect helpers such as `deleteOriginalUploadFile`, `cleanupOriginalIfRestoreMaintenanceBegan`, and `enqueueImageProcessing` in `apps/web/src/app/actions/images.ts:7-29`, with representative calls at `apps/web/src/app/actions/images.ts:370-418` and `apps/web/src/app/actions/images.ts:519-525`.

Problem:

The custom scanners have strong fixtures for direct DB calls and local helper calls, but their mutation model does not fail an imported helper call before the required provenance/rate-limit gate unless the helper name is manually listed. The two focused fixtures confirmed this:

- `checkActionSource` returned `OK` for `await dangerousWrite();` before `requireSameOriginAdmin()`.
- `checkPublicRouteSource` returned `OK` for `await dangerousWrite();` before `preIncrementShareAttempt(...)`.

Current inspected actions put the origin guard before the high-risk helper calls I checked, so this is a gate/test blind spot rather than a confirmed current bypass.

Failure scenario:

A future action refactor moves an imported helper that writes files, enqueues work, changes process state, or writes through a wrapped DB path above `requireSameOriginAdmin()`. Or a future public route calls an imported helper that records analytics or performs expensive work before its limiter. The gate can stay green because the pre-gate call is not in `MUTATING_FUNCTION_NAMES`, `MUTATING_CALL_METHOD_NAMES`, or the local-helper graph.

Suggested fix:

Add negative fixtures to both scanner test suites for imported side-effect helpers before the guard/limiter. Then harden the scanners with an explicit policy: either fail closed on unknown imported calls before a guard in mutating action files/routes, or maintain a reviewed allowlist of known pure imports and a reviewed denylist of imported mutating helpers used by this repo. The public-route scanner should apply the same imported-helper rule to expensive GET work before the limiter.

## Final Sweep

No full lint/typecheck/build/test/e2e gates were run in this read-only lane. The focused checks above were read-only and completed successfully. No cycle-33 deferred item was re-raised; the two findings above are new current-HEAD coverage gaps with direct scanner/test evidence.
