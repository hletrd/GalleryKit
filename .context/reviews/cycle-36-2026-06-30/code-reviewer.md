# Cycle 36 Code Reviewer / Debugger Review

Reviewed HEAD: `bdfb38a1c39bd828c07851d3d096602441b4122c`
Date: 2026-06-30 KST

## Inventory

- Commit under review: `fix(cycle-35): close upload and lint guard gaps`.
- Changed implementation files inspected:
  - `apps/web/src/lib/serve-upload.ts`
  - `apps/web/scripts/check-action-origin.ts`
  - `apps/web/scripts/check-public-route-rate-limit.ts`
- Changed regression tests inspected:
  - `apps/web/src/__tests__/serve-upload.test.ts`
  - `apps/web/src/__tests__/check-action-origin.test.ts`
  - `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
  - `apps/web/src/__tests__/histogram.test.ts`
- Changed planning/review artifacts inventoried for cycle-35 closed findings:
  - `.context/reviews/_aggregate.md`
  - `.context/plans/cycle-35-2026-06-30-plan.md`
  - `.context/plans/cycle-35-2026-06-30-deferred.md`
  - `.context/plans/cycle-33-2026-06-30-deferred.md`

Cycle-35 closed findings were not re-raised. The serve-upload descriptor fix and shipped-histogram-worker test looked consistent with their intended fixes. The findings below are new scanner false-positive paths found while inspecting the changed lint-gate code.

## Findings

### C36-CR-01 - Guard and limiter branches may mutate before returning while the scanner still passes

- Severity: High
- Confidence: High
- Files:
  - `apps/web/scripts/check-action-origin.ts:226`
  - `apps/web/scripts/check-action-origin.ts:235`
  - `apps/web/scripts/check-action-origin.ts:537`
  - `apps/web/scripts/check-action-origin.ts:592`
  - `apps/web/scripts/check-action-origin.ts:441`
  - `apps/web/scripts/check-action-origin.ts:496`

`statementReturnsOnGuard()` accepts an `if (originError) { ... }` guard block when any direct statement in the block is a `return`. `functionCallsRequireSameOriginAdmin()` then returns `true` immediately when it sees that shape, before checking whether the guard branch itself performs a DB write, audit write, revalidation, or imported side-effect call. `functionCallsAuthSameOriginGuard()` has the same class of issue through `statementExitsEarly()`: it proves "there is an exit somewhere" but not "the branch exits before side effects."

The public-action exemption path has the same branch-order bug. In `publicActionCallsRateLimitBeforeMutation()`, `processStatement()` marks a limiter `if` as the gate before calling `visitMutation(statement)`, so mutations inside the limiter's own returning branch are treated as after the gate rather than as work that happens before the request is rejected.

Validated failure scenarios:

```ts
import { requireSameOriginAdmin } from '@/lib/action-guards';

export async function deleteFoo(id) {
  const originError = await requireSameOriginAdmin();
  if (originError) {
    await db.delete(foo).where(eq(foo.id, id));
    return { error: originError };
  }
  return { success: true };
}
```

`checkActionSource()` reports `passed: ["OK: actions/fixture.ts::deleteFoo"]`, even though a hostile cross-origin request would take the `originError` branch and execute the mutation before returning the error.

```ts
/** @action-origin-exempt: public analytics action, rate-limited before write */
export async function recordThing() {
  if (isViewRecordRateLimited('1.2.3.4', Date.now())) {
    await db.insert(views).values({ ok: true });
    return { error: 'rateLimited' };
  }
  return { success: true };
}
```

`checkActionSource()` reports `passed: ["OK (public rate-limited action): actions/public.ts::recordThing"]`, even though the over-limit branch mutates before rejecting.

Fix: make the guard/limiter recognizers prove that the rejecting branch is side-effect-free before its guaranteed exit. One conservative implementation is to accept only a direct `return`/`throw`/`redirect(...)` as the first effective branch statement, or to walk branch statements in order and fail if `nodeContainsMutatingCall()` or `statementContainsPreOriginAuthRead()` appears before the exit. Add negative fixtures for a mutating `if (originError) { ...; return ... }` block, an auth-file `if (!hasTrustedSameOrigin(...)) { ...; return ... }` block, and a public rate-limit branch that mutates before returning.

### C36-CR-02 - Action-origin local mutating-helper discovery is order-dependent and non-transitive

- Severity: High
- Confidence: High
- Files:
  - `apps/web/scripts/check-action-origin.ts:633`
  - `apps/web/scripts/check-action-origin.ts:641`
  - `apps/web/scripts/check-action-origin.ts:652`
  - `apps/web/scripts/check-action-origin.ts:531`
  - `apps/web/scripts/check-action-origin.ts:542`

`checkActionSource()` builds `localMutatingFunctions` in a single pass. Each helper body is checked against the set as it exists at that moment. If a wrapper helper is declared before the helper that performs the actual mutation, the wrapper is never revisited after the later helper is added. A pre-guard call through that wrapper is therefore treated as pure and the exported action can pass.

Validated failure scenario:

```ts
import { requireSameOriginAdmin } from '@/lib/action-guards';

async function writeFirst() {
  await actuallyWrite();
}

async function actuallyWrite() {
  await db.insert(rows).values({ ok: true });
}

export async function updateFoo(id) {
  await writeFirst();
  const originError = await requireSameOriginAdmin();
  if (originError) return { error: originError };
  return { success: true };
}
```

`checkActionSource()` reports `passed: ["OK: actions/fixture.ts::updateFoo"]`, so a future action can move a write behind one local wrapper before `requireSameOriginAdmin()` and keep `npm run lint:action-origin` green.

Fix: use the same fixed-point call-graph approach already present in `apps/web/scripts/check-public-route-rate-limit.ts:486`: repeatedly scan local function bodies until no new mutating helper names are discovered, then run the pre-guard checks with the stable set. Add a fixture where a wrapper declared before the real mutator runs before the same-origin guard.

## Validation

- `npm run lint:action-origin --workspace=apps/web`: passed on current source.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed on current source.
- `npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/serve-upload.test.ts src/__tests__/histogram.test.ts`: passed, 130 tests.
- Additional `npx tsx -e` fixtures reproduced both scanner false-positive paths above.
