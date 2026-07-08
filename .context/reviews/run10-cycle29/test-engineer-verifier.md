# Run-10 Cycle 29/100 Test-Engineer + Verifier Review

Date: 2026-07-08 KST
Reviewed HEAD: `d985f549afa73b23cdccf5d8fea30f4bfc840847`
Scope: fresh current-HEAD review only; test coverage gaps, flaky/weak tests, gate adequacy, source-contract tests, regression locks, build/lint/typecheck risks.

## Inventory

Primary contracts and gates inspected:

- `CLAUDE.md:682-704` documents blocking lint/typecheck/build/test gates and the server-action same-origin + mutation-barrier scanner contract.
- `apps/web/package.json:8-29` wires `lint`, `typecheck`, `build`, Vitest, Playwright, `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, and `test:clip:preflight`.
- `.github/workflows/quality.yml:1-67` runs lint, typecheck, custom security lint gates, production audit, unit tests, DB init, Playwright, and build on push/PR.
- `.github/workflows/clip-preflight.yml:1-37` runs the gated real CLIP preflight separately on schedule/manual dispatch.
- `apps/web/scripts/check-action-origin.ts:92-171` is the current action-origin discovery expansion from Cycle 28.
- `apps/web/src/__tests__/check-action-origin.test.ts:1-1821`, `apps/web/src/__tests__/cycle-28-source-contracts.test.ts:27-74`, and `apps/web/src/__tests__/cycle-29-source-contracts.test.ts:8-90` are the most relevant current source-contract/regression locks.
- `apps/web/e2e/admin.spec.ts:20-43` and `apps/web/e2e/admin.spec.ts:73-103` remain the authenticated admin browser coverage baseline.

Prior current-cycle context reviewed:

- `.context/plans/run10-cycle27/deferred.md`
- `.context/plans/run10-cycle28/plan.md`
- `.context/plans/run10-cycle28/deferred.md`
- `.context/reviews/run10-cycle28/_aggregate.md`
- `.context/reviews/run10-cycle28/test-verifier.md`
- `.context/reviews/photographer-r29/_aggregate.md`
- `.context/plans/photographer-r29/plan.md`

## Validation Evidence

- `npm run lint:action-origin --workspace=apps/web` passed at current HEAD. Evidence: the scanner reported all current action files as OK, skipped with reasoned exemptions, or public-rate-limited, then printed `All mutating server actions enforce same-origin provenance.`
- `npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/cycle-28-source-contracts.test.ts src/__tests__/cycle-29-source-contracts.test.ts` passed: 3 files, 136 tests.
- Static inventory found no current inline function-level `'use server'` action under `apps/web/src/app`; the first finding is a gate-completeness gap for a valid future Next.js action shape, not a current vulnerable action body.
- I did not run full lint/typecheck/build/unit/e2e for this review lane.

## Findings

### C29-TE-01 - `lint:action-origin` still cannot see inline function-level Server Actions in route components

Severity: High  
Confidence: Medium-High

Regions:

- `apps/web/scripts/check-action-origin.ts:92-114`
- `apps/web/scripts/check-action-origin.ts:117-132`
- `apps/web/scripts/check-action-origin.ts:155-171`
- `apps/web/scripts/check-action-origin.ts:1701-1704`
- `CLAUDE.md:691-704`
- `apps/web/src/__tests__/check-action-origin.test.ts:1039-1087`
- `apps/web/src/__tests__/cycle-28-source-contracts.test.ts:68-74`
- Official Next.js reference: `https://nextjs.org/docs/app/api-reference/directives/use-server`

Problem:

Cycle 28 hardened discovery for top-level `'use server'` modules under `src/app`, but the gate still only reasons about module-level action files. Next.js also supports function-level inline Server Functions by placing `'use server'` at the top of an async function body. The current detector `hasTopLevelUseServerDirective()` only scans leading module statements, and `checkForUnscannedUseServerFiles()` only rejects files with a top-level directive. The fixture tests cover recursive action-file discovery and source-string presence for the top-level detector, but there is no test that an inline `'use server'` action inside `page.tsx` / `layout.tsx` / another server component is banned or scanned.

Concrete failure scenario:

A future admin route adds:

```tsx
export default function AdminWidget() {
  async function deleteThing(formData: FormData) {
    'use server';
    await db.delete(things).where(eq(things.id, Number(formData.get('id'))));
  }
  return <form action={deleteThing}>...</form>;
}
```

That is a valid Server Action shape in Next.js. Because the file has no top-level `'use server'`, `lint:action-origin` does not scan it for `requireSameOriginAdmin()` or `acquireAdminMutationSlot()`. Current tests and the current no-inline-action repository still pass.

Suggested fix:

Add an AST pass over `src/app/**/*.{ts,tsx,js,jsx,mts,cts}` that detects function bodies whose directive prologue contains `'use server'`. Either fail all inline Server Actions with a clear message directing authors to `src/app/actions/`, or route those files through the same mutating-export/body checks with explicit support for inline action functions. Add a fixture/source-contract test that creates or simulates an inline action under an admin route and proves the gate fails.

### C29-TE-02 - The new unscanned top-level action-module detector is locked only by source-string assertions

Severity: Medium  
Confidence: High

Regions:

- `apps/web/scripts/check-action-origin.ts:155-171`
- `apps/web/scripts/check-action-origin.ts:1701-1704`
- `apps/web/src/__tests__/cycle-28-source-contracts.test.ts:68-74`
- `apps/web/src/__tests__/check-action-origin.test.ts:1039-1087`

Problem:

The Cycle 28 detector itself is useful: the CLI now calls `checkForUnscannedUseServerFiles(actionFiles)` before scanning the approved action files. The regression lock is weak, though. `cycle-28-source-contracts.test.ts` only asserts that the scanner source contains `path.join(REPO_SRC, 'app')`, `UNSCANNED SERVER ACTION MODULE`, and `hasTopLevelUseServerDirective(file)`. It does not execute the CLI or a helper against a fixture containing an out-of-directory top-level `'use server'` file. `check-action-origin.test.ts` still only proves `walkForActionFiles()` recursion under an arbitrary root, not that the whole-repo unscanned-module guard fails closed.

Concrete failure scenario:

A refactor leaves `checkForUnscannedUseServerFiles()` and the error string in the file but accidentally removes the call at `check-action-origin.ts:1702`, narrows `appDir`, or filters too much from `discoverAppSourceFiles()`. Because the real repository currently has no unscanned top-level action modules, `npm run lint:action-origin` stays green; because the source strings remain, `cycle-28-source-contracts.test.ts` stays green too.

Suggested fix:

Make the detector testable as behavior, not prose. Export a pure helper such as `findUnscannedUseServerFiles(appRoot, approvedFiles)` and fixture it with a temp `src/app/[locale]/admin/(protected)/analytics/actions.ts` containing top-level `'use server'`, or run the CLI in a temp copied/minimal tree and assert non-zero exit plus `UNSCANNED SERVER ACTION MODULE`. Keep the source-string smoke only as a secondary check if desired.

## Carried-Forward Context, Not Counted As New

- `AGG-C28-05` remains open: authenticated Playwright still covers categories/tags/users/password/db/settings but not every first-class admin nav destination. Current evidence is still `apps/web/src/components/admin-nav.tsx:15-25`, `apps/web/e2e/admin.spec.ts:20-43`, and `apps/web/e2e/admin.spec.ts:73-103`. The Cycle 28 exit criterion has not fired, so I did not refile it as a new finding.
- `AGG-C28-08` remains operator/deployment validation, not a repo-code test failure: nginx/proxy real-IP behavior still needs manual topology validation against `apps/web/nginx/default.conf:20-28` and `apps/web/nginx/default.conf:59-71`.
- Photographer R29 `R29-CRIT-1` is fixed at current HEAD: `apps/web/src/lib/admin-backfill-runner.ts:675-865` wraps state/config/queue work in try/finally and releases the lock in `finally`; `apps/web/src/lib/admin-backfill-runner.ts:909-919` adds the fire-and-forget `.catch()`. `apps/web/src/__tests__/admin-backfill-runner-leak.test.ts:102-145` and `:168-199` lock the early-throw/no-poison behavior.

## Summary

New findings: 2.

- High: 1
- Medium: 1
- Low: 0
