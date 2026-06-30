# Cycle 43 Code Reviewer + Critic Review

Reviewed HEAD `82a21b82` (`fix(cycle-42): 🐛 harden review-cycle guardrails`) against the Cycle 42 aggregate, plan, and deferred register. I treated `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08` as deferred baseline items and did not re-raise them.

## Confirmed Issues

### C43-01 - `lint:action-origin` still accepts public analytics limiter-name shadowing through exported action parameters

Severity: Medium. Confidence: High.

Code region: `apps/web/scripts/check-action-origin.ts:600-631`, `apps/web/scripts/check-action-origin.ts:641-645`, and `apps/web/scripts/check-action-origin.ts:1043-1046`. Regression coverage gap: `apps/web/src/__tests__/check-action-origin.test.ts:1216-1230`.

`publicActionCallsRateLimitBeforeMutation()` now rejects nested function declarations, nested parameters, and variable declarations whose names shadow trusted public limiter helpers. However, it receives only the exported action body, and `actionBodyShadowsRateLimit()` starts walking at `body.statements`. That means it never inspects the exported action's own parameters. The later recognizer still treats any call expression whose callee text is `isViewRecordRateLimited`, `preIncrementLoadMoreAttempt`, `checkViewRecordRateLimit`, or `checkLoadMoreRateLimit` as a trusted limiter call. The exemption branch then records `OK (public rate-limited action)` for a mutating public action.

Concrete failure scenario:

```ts
/** @action-origin-exempt: public analytics endpoint */
export async function recordView(id, checkViewRecordRateLimit = () => ({ status: 'ok' })) {
  if (checkViewRecordRateLimit().status === 'rateLimited') return;
  db.insert(imageViews).values({ imageId: id });
}
```

I verified this exact shape with `checkActionSource(...)`; it returns `passed: ["OK (public rate-limited action): src/app/actions/public.ts::recordView"]` and no failures, even though the real DB-backed limiter is never called. The existing Cycle 42 regression only covers a nested local function shadow, so the top-level parameter shadow remains untested.

Suggested fix: make the public-action scanner inspect the exported function/arrow/function-expression parameters before accepting the public rate-limit exemption, or pass the owner/function node into `publicActionCallsRateLimitBeforeMutation()`. Reject any binding pattern that introduces one of the trusted limiter names inside the exported action scope. Add focused tests for exported function parameters, exported arrow-function parameters, and defaulted parameters that shadow each trusted limiter name.

## Likely Issues

None found beyond the confirmed scanner gap above.

## Risks Requiring Manual Validation

None newly identified. The production CLIP web-bootstrap/backfill coordination concern remains the already-deferred Cycle 42 item `PA-42-02`.

## Review Evidence

- Built a review inventory of 790 relevant repository paths across `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, messages, public assets, and review/plan context.
- Read the required context: `AGENTS.md`, `CLAUDE.md`, common review scope, code-reviewer prompt, critic prompt, latest aggregate, and Cycle 42 plan/deferred files.
- Inspected current Cycle 42 diff, admin/public route guard scripts, auth/session paths, public analytics actions, shared-group rendering, lightbox color pip behavior, data-layer query/privacy boundaries, JSON-LD sinks, and operational script surfaces.
- Validation run:
  - `npm run lint --workspace=apps/web` - passed
  - `npm run lint:api-auth --workspace=apps/web` - passed
  - `npm run lint:action-origin --workspace=apps/web` - passed
  - `npm run lint:public-route-rate-limit --workspace=apps/web` - passed
  - `npm run check:js-scripts --workspace=apps/web` - passed
  - `npm run typecheck --workspace=apps/web` - passed
  - `npm test --workspace=apps/web` - passed: 277 files, 2685 tests

Not run: `npm run build --workspace=apps/web` and Playwright e2e. This was a read-only review lane except for writing this review artifact.
