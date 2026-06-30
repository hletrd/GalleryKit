# Cycle 43 Test-Engineer / Verifier Review

Scope: review only, no implementation, no commit, no push, no deploy. Focused on missing coverage, flaky tests, unproven behavior, custom lint gates, privacy/touch-target fixtures, and regression risk. Baseline HEAD inspected: `82a21b82`.

## Context Read

- Repo guidance: `AGENTS.md`, `CLAUDE.md`.
- Review prompts: `.context/reviews/prompts/common_review_scope.md`, `.context/reviews/prompts/test-engineer.md`, `.context/reviews/prompts/verifier.md`.
- Latest aggregate and cycle-42 state: `.context/reviews/_aggregate.md`, `.context/reviews/cycle-42-2026-07-01/_aggregate.md`, `.context/reviews/cycle-42-2026-07-01/test-engineer-verifier.md`, `.context/plans/cycle-42-2026-07-01-plan.md`, `.context/plans/cycle-42-2026-07-01-deferred.md`.

## Inventory Reviewed

- Repo inventory: `rg --files` reported 820 files.
- Test/lint surface: `apps/web/src/__tests__/`, `apps/web/e2e/`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/scripts/check-js-scripts.mjs`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/tsconfig*.json`.
- Risk surfaces checked: server actions, public/admin API routes, privacy field fixtures, touch-target audit, scanner fixtures, latest cycle-42 fixes, and carried deferred items.

## Verification Evidence

- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- check-action-origin check-public-route-rate-limit check-js-scripts-contract privacy-fields touch-target-audit` passed: 5 files, 190 tests.
- Ad hoc scanner probes confirmed the two findings below. Current-source greps found no active shadowed `requireSameOriginAdmin` / `preIncrement*` declarations in the scanned action/API route files.

## Confirmed Issues

### TV-C43-01: Custom lint gates accept approved guard/rate-limit identifiers after local shadowing

Severity: MEDIUM
Confidence: HIGH

Exact citations:
- `apps/web/scripts/check-action-origin.ts:128-142` records local names imported from `@/lib/action-guards`.
- `apps/web/scripts/check-action-origin.ts:245-264` accepts a `requireSameOriginAdmin()` call when the callee text is in that approved-name set, without checking whether a closer function-scope binding shadows the import.
- `apps/web/src/__tests__/check-action-origin.test.ts:979-1008` covers a pure local spoof and an unapproved import, but not "approved import plus handler-local shadow".
- `apps/web/scripts/check-public-route-rate-limit.ts:177-197` records approved rate-limit import local names.
- `apps/web/scripts/check-public-route-rate-limit.ts:303-332` accepts a rate-limit call by identifier text from that approved-name set.
- `apps/web/scripts/check-public-route-rate-limit.ts:389-412` treats that call or captured result as the gate before protected work, again without lexical shadow detection.
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:981-1007` covers a pure local helper and an unapproved import, but not a local binding that shadows an approved import.

Failure scenario:

```ts
import { requireSameOriginAdmin } from '@/lib/action-guards';

export async function deleteFoo(id: number) {
  const requireSameOriginAdmin = async () => null;
  const originError = await requireSameOriginAdmin();
  if (originError) return { error: originError };
  await db.delete(foo).where(eq(foo.id, id));
}
```

`checkActionSource()` currently reports this as `OK`, even though the call resolves to the local no-op, not the imported same-origin guard. The same pattern passes `checkPublicRouteSource()` for a public route that imports `preIncrementShareAttempt` and then declares `const preIncrementShareAttempt = () => false` inside the handler before a public mutation.

Suggested fix:

Track lexical bindings for approved guard/rate-limit names inside exported action/handler bodies, including parameters, `function`, `const`, `let`, and destructuring bindings. Fail when a trusted imported name is shadowed before the accepted call. Add regression fixtures for both scanners: approved import plus local shadow should fail, while approved import without shadow should continue to pass.

### TV-C43-02: Read-only action exemptions accept non-dominating or fake auth calls before protected reads

Severity: MEDIUM
Confidence: HIGH

Exact citations:
- `apps/web/scripts/check-action-origin.ts:170-188` adds aliases for `isAdmin`, `getCurrentUser`, and `getSession` from any import module, not just an approved auth module.
- `apps/web/scripts/check-action-origin.ts:545-561` treats any call expression whose identifier matches those names as read auth.
- `apps/web/scripts/check-action-origin.ts:564-584` sets `sawAuth = true` after such a statement and allows later protected reads; it does not prove that unauthenticated control flow returned before the read.
- `apps/web/scripts/check-action-origin.ts:1053-1064` uses that helper to skip a reasoned read-only exemption.
- Existing positive fixtures at `apps/web/src/__tests__/check-action-origin.test.ts:535-562` cover the good `if (!(await isAdmin())) return ...` shape, but there is no fixture for an ignored `await isAdmin()`, a conditional-only auth call, or `isAdmin` imported from an unapproved module.

Failure scenario:

```ts
import { db } from '@/db';

/** @action-origin-exempt: read-only admin getter */
export async function listSecrets(flag: boolean) {
  if (flag) await isAdmin();
  return db.select().from(secrets);
}
```

`checkActionSource()` currently returns `SKIP (exempt comment)` for this shape. On the `flag === false` path, the protected read runs without any auth check. A similar fixture with `import { isAdmin as canAdmin } from './not-auth'` and a normal-looking `if (!(await canAdmin())) return []` also passes because alias provenance is not checked.

Suggested fix:

For read-only exemptions, require the same kind of effective top-level guard proof used for mutating actions: an approved auth helper or `requireSameOriginAdmin()` call must feed a return-early branch that dominates protected reads. Restrict recognized auth aliases to approved modules, and add fixtures for ignored auth calls, conditional-only auth calls, and fake-module aliases.

## Likely Issues

None.

## Risks Requiring Manual Validation

None new. I did not re-raise cycle-42 scheduled items or carried deferred items (`PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`) without new severity-changing evidence.

## Non-Findings

- Privacy guard coverage remains present for `publicSelectFields`, `timelineSelectFieldKeys`, and `searchEnrichmentSelectFields`; the focused `privacy-fields` suite passed.
- Touch-target stale-budget detection is present and the focused `touch-target-audit` suite passed.
- Cycle-42 scanner fixes for positive-only public analytics gates, limiter-name shadowing inside public action bodies, namespace/relative DB protected reads, and JS-script zero discovery are present in current tests/source.
