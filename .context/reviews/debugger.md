# Debugger — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Bug-hunt sweep

Re-checked baseline gates (this cycle):
- `npm run lint --workspace=apps/web`: clean (exit 0)
- `npm run lint:api-auth --workspace=apps/web`: clean
- `npm run lint:action-origin --workspace=apps/web`: clean
- `tsc --noEmit -p apps/web/tsconfig.json`: clean (exit 0)
- `vitest run`: 379/379 across 59 files

Looked for race conditions, dangling resource lifetimes, and error-path regressions in cycle-5 commits.

## New findings

### C6L-DBG-01 — Strip-and-persist (control chars) vs. reject (Unicode formatting) is a deliberate two-layer policy; document inline [INFO] [Low confidence]

**File:** `apps/web/src/app/actions/seo.ts:71-78` (vs. the topics/images patterns).

**Why a problem.** SEO settings strip-and-persist control characters silently, which is correct for paste workflows. The pending Unicode-formatting check is a *separate* policy that *rejects* (because no admin would intentionally paste an RLO into the gallery title). Without an inline comment recording the two-layer reasoning, a future contributor will eventually try to "harmonise" the patterns into one shape and accidentally reject benign smart-quote/non-breaking-space inputs.

**Suggested fix.** Add a one-line comment in the cycle-6 fix commit explaining the strip-vs-reject layering.

## No active runtime regressions detected.
