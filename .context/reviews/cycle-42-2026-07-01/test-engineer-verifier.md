# Cycle 42 Test-Engineer / Verifier Review

Scope: review only, no source edits. Focused on test coverage, scanner fixtures, build/typecheck/test gaps, flaky risks, and whether current gates prove the repo invariants. Baseline HEAD inspected: `6efd00a8`.

## Context Read

- Repo guidance: `AGENTS.md`, `CLAUDE.md`.
- Latest live cycle artifacts: `.context/reviews/cycle-41-2026-07-01/_aggregate.md`, `.context/plans/cycle-41-2026-07-01-plan.md`, `.context/plans/cycle-41-2026-07-01-deferred.md`, `.context/reviews/cycle-41-2026-07-01/verifier-test-engineer.md`.
- Prior live cycle artifacts: `.context/reviews/cycle-40-2026-07-01/_aggregate.md`, `.context/plans/cycle-40-2026-07-01-deferred.md`, `.context/reviews/cycle-40-2026-07-01/test-verifier.md`.
- Historical context checked: `.context/plans/archive/plan-136-cycle42-fixes.md`, `.context/plans/user-injected/pending-next-cycle.md`.
- Gate config and tests/scripts: root `package.json`, `apps/web/package.json`, `apps/web/tsconfig*.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, the three custom scanners and their fixture suites, `public-actions.test.ts`, `cycle-10-source-contracts.test.ts`, and E2E specs.

## Verification Evidence

- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- check-action-origin check-public-route-rate-limit check-api-auth public-actions cycle-10-source-contracts` passed: 5 files, 195 tests.
- `npm run check:js-scripts --workspace=apps/web` passed and reported `Checked 8 JavaScript script files.`

The findings below are scanner/test blind spots reproduced with focused synthetic fixtures. I did not find an active violation in the current source.

## Findings

### TV-C42-01: `lint:action-origin` accepts inverted public analytics rate-limit gates

Severity: MEDIUM
Confidence: HIGH

Exact citations:
- `apps/web/scripts/check-action-origin.ts:541` starts `publicActionCallsRateLimitBeforeMutation`.
- `apps/web/scripts/check-action-origin.ts:549` hard-codes public limiter names.
- `apps/web/scripts/check-action-origin.ts:552` treats any call to those names as a limiter expression.
- `apps/web/scripts/check-action-origin.ts:571` treats any captured limiter-result identifier use as a limiter check.
- `apps/web/scripts/check-action-origin.ts:586` accepts an `if` as the rate-limit gate when the branch exits.
- `apps/web/scripts/check-action-origin.ts:898` routes mutating `@action-origin-exempt` public actions through that carve-out.
- Positive-only fixtures exist at `apps/web/src/__tests__/check-action-origin.test.ts:1051`, `apps/web/src/__tests__/check-action-origin.test.ts:1066`, and `apps/web/src/__tests__/check-action-origin.test.ts:1082`; no fixture rejects `!isViewRecordRateLimited(...)`, `overLimit === false`, `.status === 'ok'`, or `.status !== 'rateLimited'`.
- Current source uses the correct positive shape at `apps/web/src/app/actions/public.ts:423`, `apps/web/src/app/actions/public.ts:456`, and `apps/web/src/app/actions/public.ts:485`.
- Behavior/source-contract coverage proves the current path calls the real limiter before writes (`apps/web/src/__tests__/public-actions.test.ts:241`, `apps/web/src/__tests__/public-actions.test.ts:311`, `apps/web/src/__tests__/cycle-10-source-contracts.test.ts:10`), but it does not prove scanner polarity.

Failure scenario:

```ts
/** @action-origin-exempt: public analytics endpoint */
export async function recordView(params) {
  if (!isViewRecordRateLimited(params.ip, Date.now())) return;
  await db.insert(viewRows).values({ ok: true });
}
```

I verified that this fixture currently reports `OK (public rate-limited action)`. The same is true for `if (overLimit === false) return`, `if (result.status === 'ok') return`, and `if (result.status !== 'rateLimited') return`. Those shapes return for under-limit callers and continue to the insert for over-limit callers, so a future public analytics action could invert the protection while the gate stays green.

Fix:

Mirror the stricter polarity logic already used by `check-public-route-rate-limit.ts`: accept only positive over-limit checks. Add `check-action-origin.test.ts` fixtures that fail for `!isViewRecordRateLimited(...)`, `overLimit === false`, `false === overLimit`, `.status === 'ok'`, and `.status !== 'rateLimited'`; keep positive fixtures for `isViewRecordRateLimited(...)`, `overLimit`, `overLimit === true`, and `.status === 'rateLimited'`.

### TV-C42-02: public analytics scanner accepts action-local limiter name shadowing

Severity: LOW
Confidence: HIGH

Exact citations:
- `apps/web/scripts/check-action-origin.ts:549` uses a name set, not lexical provenance, for public limiter recognition.
- `apps/web/scripts/check-action-origin.ts:552` recursively finds calls by identifier text.
- `apps/web/scripts/check-action-origin.ts:586` accepts that call as a gate before mutation.
- Existing public-action fixtures cover ignored calls and catch/finally ordering (`apps/web/src/__tests__/check-action-origin.test.ts:336`, `apps/web/src/__tests__/check-action-origin.test.ts:350`, `apps/web/src/__tests__/check-action-origin.test.ts:372`) but not a local declaration that shadows a trusted limiter name.

Failure scenario:

```ts
/** @action-origin-exempt: public analytics endpoint */
export async function recordView(params) {
  function checkViewRecordRateLimit() {
    return { status: 'ok' };
  }
  if ((await checkViewRecordRateLimit(params.ip, Date.now())).status === 'rateLimited') return;
  await db.insert(viewRows).values({ ok: true });
}
```

I verified that this fixture currently reports `OK (public rate-limited action)`. The real `public.ts` helper body is behavior-tested via `incrementRateLimit` / `checkRateLimit` expectations, so current production code is not the issue. The missing regression lock is that the scanner can be satisfied by an action-local no-op helper with the same name.

Fix:

Reject public-action bodies that declare `function`, `const`, `let`, or parameter names shadowing `isViewRecordRateLimited`, `checkViewRecordRateLimit`, `preIncrementLoadMoreAttempt`, or `checkLoadMoreRateLimit`. Add a fixture that defines an action-local `checkViewRecordRateLimit` and expects `EXEMPT COMMENT ON MUTATING ACTION`.

### TV-C42-03: JS script syntax checker succeeds on zero discovered files

Severity: LOW
Confidence: HIGH

Exact citations:
- `apps/web/scripts/check-js-scripts.mjs:7` defines the scan roots.
- `apps/web/scripts/check-js-scripts.mjs:27` filters missing roots away instead of failing.
- `apps/web/scripts/check-js-scripts.mjs:38` runs `node --check` for discovered files only.
- `apps/web/scripts/check-js-scripts.mjs:42` always reports the count, including zero.
- `apps/web/package.json:15` and `apps/web/package.json:27` make this part of the blocking `typecheck` gate.
- The sibling scanner CLIs fail closed on zero discovery (`apps/web/scripts/check-api-auth.ts:186`, `apps/web/scripts/check-public-route-rate-limit.ts:847`) and have discovery tests (`apps/web/src/__tests__/check-api-auth.test.ts:115`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:1058`). No equivalent `check-js-scripts` test exists.

Failure scenario:

If `appDir` or `scanRoots` drifts, or JS operational scripts move out of `apps/web/scripts`, `npm run typecheck:scripts` can still pass while checking zero JS files. That is smaller than the already-deferred semantic JS-checking work (`TV-40-03`); this finding is only about fail-closed discovery.

Fix:

Add `if (files.length === 0) { console.error(...); process.exit(1); }` to `check-js-scripts.mjs`, and add a lightweight regression test/source-contract mirroring the existing scanner discovery guards.

## Non-Findings / Residual Risk

- The Cycle 41 public-route and action-origin scanner findings are present in current fixtures and should not be re-raised.
- `lint:api-auth` has approved-import provenance tests for `withAdminAuth`, including alias and local-spoof cases.
- Broader JS semantic checking remains correctly deferred as `TV-40-03`; I did not reclassify it as cycle-safe.
- Playwright admin flow coverage remains environment-gated but intentionally guarded by the existing CI/admin-credential check in `apps/web/e2e/admin.spec.ts:6`.
