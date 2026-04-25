# Test Engineer — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Inventory scope
- `apps/web/src/__tests__/validation.test.ts` (post C5L-SEC-01).
- `apps/web/src/__tests__/seo-actions.test.ts` (target — exists or to be created).
- Cycle-6 baseline: 379 vitest tests across 59 files (pre-fix).

## New findings

### C6L-TE-01 — No action-level test coverage for SEO Unicode-formatting rejection [LOW] [High confidence]

**Files:**
- `apps/web/src/__tests__/seo-actions.test.ts`
- `apps/web/src/__tests__/validation.test.ts`

**Why a problem.** C5L-SEC-01 added action-level tests for `topic.label`, `image.title`, `image.description`. C6L-SEC-01 needs the same coverage; otherwise a future refactor that pulls the rejection out of `updateSeoSettings` will pass validation-level unit tests while the action silently accepts the bad input.

**Suggested fix.** When implementing C6L-SEC-01:
1. Add ≥4 `seo-actions.test.ts` cases — at minimum one per affected field — verifying the action returns the matching error code on RLO-bearing input.
2. Add ≥2 ZWSP test cases (one short field, one description) for invisible-character rejection.
3. If a `containsUnicodeFormatting` helper is introduced (per C6L-ARCH-01), add a tiny unit test in `validation.test.ts` covering null/empty/clean/dirty inputs.

### C6L-TE-02 — Helper truthiness-branch coverage [INFO] [Medium confidence]

**File:** `apps/web/src/__tests__/validation.test.ts`.

**Suggested fix.** Add a single test for `containsUnicodeFormatting(null)`, `(undefined)`, `('')`, `('clean')`, `('dirty‮')` to cover the truthiness branch.

## Cross-agent agreement
Overlaps with security-reviewer (C6L-SEC-01 fix bundle), code-reviewer (parity argument), architect (helper extraction).
