# Test Engineer — Cycle 5 (review-plan-fix loop, 2026-04-25)

## Inventory scope
- `apps/web/src/__tests__/validation.test.ts` (post C4L-SEC-01).
- `apps/web/src/__tests__/topics-actions.test.ts`, `images-actions.test.ts` for end-to-end action behaviour.
- Cycle 4 baseline: 372 vitest tests; cycle 5 baseline run: 376/376 passing across 59 files.

## New findings

### C5L-TE-01 — Coverage gap for admin-string Unicode-formatting at action-call boundary [LOW] [High confidence]

**Files:**
- `apps/web/src/__tests__/topics-actions.test.ts`, `images-actions.test.ts`
- `apps/web/src/__tests__/validation.test.ts`

**Why a problem.** Cycle 3 and Cycle 4 added `validation.test.ts` cases for `isValidTopicAlias` and `isValidTagName` Unicode rejection, but no end-to-end check that the corresponding **server actions** (`createTopicAlias`, `createTag`) actually reject the bad input. The action-level test is the one that survives if `validation.ts` is ever refactored. For the upcoming C5L-SEC-01 fix on `topic.label` / `image.title` / `image.description`, the same gap will exist unless action-level tests are added in the same cycle.

**Concrete failure scenario.** A future refactor moves bidi-rejection out of a validator into a different helper. Unit tests still pass on the unused helper while the server action silently accepts the bad input.

**Suggested fix.** When implementing C5L-SEC-01:
1. Add `validation.test.ts` parity coverage if a new helper is introduced.
2. Add at least one test in `topics-actions.test.ts` verifying `createTopic`/`updateTopic` rejects an RLO-bearing label.
3. Add at least one test in `images-actions.test.ts` verifying `updateImageMetadata` rejects an RLO-bearing title and a ZWSP-bearing description.

## Cross-agent agreement
Overlaps with security-reviewer (C5L-SEC-01 fix bundle), code-reviewer (parity argument).
