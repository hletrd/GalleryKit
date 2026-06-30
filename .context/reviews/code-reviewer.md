# Cycle 35 Code Reviewer Review

Reviewer: code-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `96160854ebadca1606e9f99b2e6f5bc4689e366c`
Date: 2026-06-30 KST
Scope: read-only code-quality/correctness/maintainability review lane. No source, test, plan, git, or commit changes were made by this lane; this review artifact is the only file updated.

## Inventory

Required context read:

- `AGENTS.md`
- `CLAUDE.md` sections covering architecture, security, privacy, runtime topology, upload/color pipeline, migration/deploy rules, lint gates, and testing policy
- `review-plan-fix` and `code-review` skill guidance supplied/loaded for this lane
- Cycle 33 deferred baseline:
  - `.context/plans/archive/80-deferred-cycle33.md`
  - `.context/reviews/archive/_aggregate-cycle33.md`
- Current active review/plan baseline:
  - `.context/reviews/_aggregate.md`
  - `.context/reviews/code-reviewer.md` before update
  - `.context/plans/cycle-34-2026-06-30-plan.md`
  - `.context/plans/cycle-34-2026-06-30-deferred.md`

Repository state:

- `git rev-parse --short=12 HEAD`: `96160854ebad`
- Current HEAD is `fix(cycle-34): close upload and auth lint regressions`
- `git status --short` was clean before this artifact update

Inventory built:

- 211 review-relevant implementation files under:
  - `apps/web/src/app/actions/`
  - `apps/web/src/app/api/`
  - `apps/web/src/lib/`
  - `apps/web/src/components/`
  - `apps/web/src/db/`
  - `apps/web/scripts/`
- 38 App Router route/page/layout files under `apps/web/src/app/`
- 281 test/e2e files under `apps/web/src/__tests__/` and `apps/web/e2e/`

Highest-risk files/patterns inspected:

- Cycle 34 changed code:
  - `apps/web/src/app/api/admin/lr/upload/route.ts`
  - `apps/web/scripts/check-action-origin.ts`
  - `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts`
  - `apps/web/src/__tests__/check-action-origin.test.ts`
- Related upload/browser parity and quota surfaces:
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/lib/upload-tracker.ts`
  - `apps/web/src/lib/upload-tracker-state.ts`
  - `apps/web/src/lib/upload-processing-contract-lock.ts`
  - `apps/web/src/lib/action-guards.ts`
  - `apps/web/src/lib/request-origin.ts`
- Broad guard surfaces:
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/app/actions/{admin-users,collections,embeddings,images,lr-tokens,public,seo,settings,sharing,tags,topics}.ts`
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/scripts/check-api-auth.ts`
  - `apps/web/scripts/check-public-route-rate-limit.ts`
- Supporting repo contracts:
  - root and app `package.json`
  - route/action guard tests
  - prior active/deferred review plans

Review commands/evidence:

- `git show --stat --patch HEAD -- apps/web/scripts/check-action-origin.ts apps/web/src/__tests__/check-action-origin.test.ts apps/web/src/__tests__/lr-upload-hdr-gate.test.ts apps/web/src/app/api/admin/lr/upload/route.ts`
- `npm run lint:action-origin --workspace=apps/web`: passed on current HEAD.
- In-memory `npx tsx` fixture probes against `checkActionSource()` showed the finding below reproduces even though current production action call sites all use the safe `if (originError) return ...` shape.

Cycle 33 deferred findings were treated as baseline and not re-raised. No Cycle 33 deferred item had new code evidence, severity change, or scheduling pressure from this lane.

## Findings

### C35-CODE-01 - Generic action-origin scanner accepts inverted binary `originError` checks

Severity: High
Confidence: High

Region:

- `apps/web/scripts/check-action-origin.ts:192-203`
- `apps/web/scripts/check-action-origin.ts:208-219`
- `apps/web/src/__tests__/check-action-origin.test.ts:37-48`
- `apps/web/src/lib/action-guards.ts:37-43`

Issue:

The generic server-action same-origin scanner validates any binary expression that merely mentions the guard variable. `conditionChecksGuardVariable()` returns true for all binary expressions where either side is `originError`, without checking the operator or the other operand:

- `originError === null`
- `originError === false`
- `originError && false`
- any other binary expression containing `originError`

`statementReturnsOnGuard()` then treats the `if` as a valid provenance guard when the `then` branch returns. That means a future mutating action can accidentally invert or neutralize the guard and still pass `npm run lint:action-origin`.

Current production call sites are safe: a direct grep of `apps/web/src/app/actions/**` and `apps/web/src/app/[locale]/admin/db-actions.ts` found only the intended truthy pattern, e.g. `if (originError) return ...`. The defect is in the security-critical lint gate, not a live action bypass at this HEAD.

Reproduction evidence:

An in-memory fixture shaped like this was accepted as `OK: actions/fixture.ts::updateFoo`:

```ts
import { requireSameOriginAdmin } from '@/lib/action-guards';

export async function updateFoo() {
  const originError = await requireSameOriginAdmin();
  if (originError === null) return { ok: false };
  await db.update(foo).set({ ok: true });
}
```

Because `requireSameOriginAdmin()` returns a string on untrusted origin and `null` on trusted origin, the fixture exits for trusted same-origin requests and mutates for hostile cross-origin requests. The scanner also accepted `originError === false` and `originError && false`, which never early-return on the actual unauthorized string.

Concrete failure scenario:

1. A future mutating server action follows the expected prologue but writes `if (originError === null) return ...` by mistake.
2. `npm run lint:action-origin --workspace=apps/web` still passes because the binary condition mentions `originError`.
3. Cross-origin requests receive a non-null error string, skip the inverted `then` branch, and continue into the DB mutation.

Suggested fix:

Tighten `conditionChecksGuardVariable()` so it only accepts proven unauthorized-branch checks. At minimum, accept the current canonical `if (originError)` pattern and fail closed on arbitrary binary expressions. If explicit comparisons are needed, allow only semantically equivalent non-null checks such as `originError !== null` / `originError != null` with a nullish literal on the other side. Add negative fixtures for `originError === null`, `originError === false`, and `originError && false`, plus a positive fixture for the canonical pattern.

## Final sweep

The Cycle 34 LR upload fix was reviewed against the prior finding: quota checks now run before `tryAcquireLrMultipartParseSlot()`, acquisition remains before `request.formData()`, and the source-contract test asserts those ordering constraints. No remaining parse-slot leak was confirmed in this lane.

The Cycle 34 auth-specific scanner fix was also reviewed: it now requires the `!hasTrustedSameOrigin(...)` untrusted-origin branch and rejects the direct inverted branch in tests. The new finding above is the analogous generic `requireSameOriginAdmin()` binary-condition gap.

No additional new reportable findings were confirmed in this pass. Broad structural/performance items already recorded as deferred (for example upload tracker eviction shape, health DB disclosure, group view-count retry limits, CSV export memory use, `data.ts` size, process-image link/unlink race, and LR behavior-test depth) were not re-raised because this review found no new severity-changing evidence.

Skipped/coverage note:

- Generated/build output such as `apps/web/.next/**`, runtime data/uploads, screenshots, and archived historical review images were intentionally skipped.
- This lane did not run the full lint/typecheck/build/test gate set because it was a read-only code-review lane. It did run `lint:action-origin` and targeted in-memory scanner probes to validate the reported guardrail finding.
