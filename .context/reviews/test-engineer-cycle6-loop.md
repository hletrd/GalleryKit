# Test Engineer — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Inventory scope
- `apps/web/src/__tests__/validation.test.ts` (post C5L-SEC-01).
- `apps/web/src/__tests__/seo-actions.test.ts` (or absence thereof).
- Cycle-6 baseline: 379 vitest tests across 59 files (pre-fix).

## New findings

### C6L-TE-01 — No action-level test coverage for SEO Unicode-formatting rejection [LOW] [High confidence]

**Files:**
- `apps/web/src/__tests__/seo-actions.test.ts` (target — exists or to be created)
- `apps/web/src/__tests__/validation.test.ts`

**Why a problem.** The C5L-SEC-01 fix added action-level tests for `topic.label`, `image.title`, `image.description`. The pending C6L-SEC-01 fix on `seo_title`/`seo_description`/`seo_nav_title`/`seo_author` will need the same coverage; otherwise a future refactor that pulls the rejection out of `updateSeoSettings` will pass the validation-level unit tests while the action silently accepts the bad input.

**Suggested fix.** When implementing C6L-SEC-01:
1. Add at least four `seo-actions.test.ts` cases — one per affected field — verifying the action returns the matching error code on RLO-bearing input.
2. Add at least two ZWSP test cases (one short field, one description) to ensure invisible-character rejection is covered too.
3. If a `containsUnicodeFormatting` helper is introduced (per C6L-ARCH-01), add a tiny unit test in `validation.test.ts` covering null/empty/clean/dirty inputs.

### C6L-TE-02 — Existing helper consumers have no test coverage for the truthiness branch [INFO] [Medium confidence]

**File:** `apps/web/src/__tests__/validation.test.ts`.

**Why a problem.** `isValidTopicAlias` and `isValidTagName` apply `UNICODE_FORMAT_CHARS.test(...)` unconditionally on a trimmed string. The new `images.ts` consumer requires nullability handling. If `containsUnicodeFormatting` lands, its branch coverage on `null` / `undefined` / `''` is worth a single targeted test to prevent future regressions.

## Cross-agent agreement
Overlaps with security-reviewer (C6L-SEC-01 fix bundle), code-reviewer (parity argument), architect (helper extraction).
