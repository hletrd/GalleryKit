# Cycle 37 Test Engineer / Verifier Review

Date: 2026-06-30 KST
Reviewed HEAD: `d6c3a8f69911c84a63985a59827d4597def922d4`
Lane: regression coverage, flaky/incorrect guard tests, custom lint gates, build/test evidence gaps
Scope: read-only source review. I wrote only this review artifact.

## Inventory

Guidance and prior-cycle context:

- `AGENTS.md` instructions provided in the prompt
- `CLAUDE.md`
- `.context/reviews/cycle-36-2026-06-30/_aggregate.md`
- `.context/reviews/cycle-36-2026-06-30/test-engineer.md`
- `.context/plans/cycle-36-2026-06-30-plan.md`
- `.context/plans/cycle-36-2026-06-30-deferred.md`

Cycle-36 implementation surface inspected:

- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`

Regression tests inspected:

- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- `apps/web/src/__tests__/admin-tokens.test.ts`
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`

Adjacent source sampled for current-shape evidence:

- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/*.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- public route files discovered by `lint:public-route-rate-limit`

## Findings

### C37-TE-01 - Wrapped action regression tests still allow multi-callback wrappers to hide an unguarded mutator

Severity: High
Confidence: High

Files:

- `apps/web/scripts/check-action-origin.ts:622`
- `apps/web/scripts/check-action-origin.ts:631`
- `apps/web/scripts/check-action-origin.ts:819`
- `apps/web/src/__tests__/check-action-origin.test.ts:542`
- `apps/web/src/__tests__/check-action-origin.test.ts:570`

`functionBodyFromExpression()` unwraps an exported call expression by returning the first async arrow/function argument it finds. The export evaluator then treats that one returned body as the whole exported action body. The new tests cover a single-callback wrapper such as `cache(async function mutateFoo() { ... })` and a hidden variable body `wrap(hidden)`, but they do not cover wrappers with more than one async callback.

Reproduced false negative against current HEAD:

```ts
import { requireSameOriginAdmin } from '@/lib/action-guards';

export const mutateFoo = wrap(
  async function guardOnly() {
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
  },
  async function runMutation() {
    await db.delete(rows).where(eq(rows.id, 1));
  },
);
```

`checkActionSource(...)` reports this as `OK: apps/web/src/app/actions/example.ts::mutateFoo` because it inspects only `guardOnly`; it never evaluates `runMutation`.

Failure scenario: a future server-action helper grows a validation callback plus a runner callback, or an author uses a wrapper shaped like `withAction(schema, handler)`. The scanner can pass because an earlier callback contains `requireSameOriginAdmin()`, while the actual mutation callback is unguarded. That reopens the cycle-36 class of fail-open action-origin coverage.

Suggested fix: make wrapped action support deliberately narrow. For example, accept only known one-callback wrappers such as `cache(async function ...)`, or require exactly one function-like async argument. If a call expression has zero or more than one function-like argument, fail closed with `UNSUPPORTED exported call wrapper`. Add a negative fixture for a two-callback wrapper where the first callback is guarded and the second mutates, plus a positive fixture for the current `cache(async function getCurrentUser)` exempt shape.

## Coverage Notes

- I did not re-raise cycle-36 deferred performance/UX items (`PERF-C36-*`, `C36-DES-*`); this pass found no new evidence that changes their severity or makes them scheduled now.
- The public route scanner change is covered for `serveUploadFile(...)` and bodyless named `GET` re-exports. Current upload fallback routes now carry explicit `@public-no-rate-limit-required` comments and the gate reports both as exempt.
- The PAT fix has two useful layers: `verifyToken()` now joins `admin_users`, and `migrate-reconcile-coverage.test.ts` source-pins every live FK name to an explicit `ensureForeignKey(...)` call. I did not find a fresh test gap there. The remaining operational edge is expected: if a legacy DB already contains orphan rows, adding an FK can fail until an operator handles data cleanup; the commit message explicitly rejected destructive cleanup without approval.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed; 2 admin API route files checked.
- `npm run lint:action-origin --workspace=apps/web`: passed; current source skips the read-only cached `getCurrentUser` via explicit exemption.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; 10 public route files checked.
- `npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/admin-tokens.test.ts src/__tests__/migrate-reconcile-coverage.test.ts`: passed, 229 tests.
- `npm run lint --workspace=apps/web`: passed.
- `npm run typecheck --workspace=apps/web`: passed, including Next typegen and script typecheck.
- `npm test --workspace=apps/web`: passed, 274 files passed / 2 skipped; 2628 tests passed / 4 skipped.
- `npm run build --workspace=apps/web`: passed. Local MySQL was unavailable, and sitemap generation used its documented homepage-only fallback after `ECONNREFUSED 127.0.0.1:3306`.

Not run: `npm run test:e2e --workspace=apps/web`. Cycle 36 did not change browser flows, and this review focused on lint/test/build guard coverage.

## Final Sweep Note

Commonly missed areas checked this cycle: wrapped server-action export shapes, source-contract tests that only prove comments/name presence, helper-backed public GET routes, bodyless route re-exports, FK repair coverage, and whether generated build artifacts dirtied tracked files. The only fresh actionable gap I found is the multi-callback wrapped-action false negative above.
