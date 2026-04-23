# Test Engineer Review — Cycle 5 (current checkout)

## Scope and inventory covered
Compared the current risk surface with existing unit/e2e coverage around public pagination and topic actions.

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### TE5-01 — No regression test protects a combined first-page pagination/count helper on public routes
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts`, public page entrypoints, `apps/web/src/__tests__/` (no coverage for page-result extraction)
- **Why it is a problem:** The current performance issue is easy to fix incorrectly unless the page-result derivation is locked by a focused unit test.
- **Concrete failure scenario:** A future optimization drops the extra row or misreports `totalCount`/`hasMore`, and the suite stays green.
- **Suggested fix:** Add a unit test for the new page-result normalization helper.

### TE5-02 — No test asserts malformed topic labels map to a label-specific error
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/actions/topics.ts:43-48`, `apps/web/src/app/actions/topics.ts:130-135`, `apps/web/src/__tests__/topics-actions.test.ts`
- **Why it is a problem:** The current suite covers reserved slugs/aliases but not mislabeled topic-form errors.
- **Concrete failure scenario:** The wrong error key persists or regresses without a failing test.
- **Suggested fix:** Add action tests that malformed labels return `invalidLabel` while malformed slugs still return `invalidSlug`.

## Final sweep
No new flaky e2e issue was confirmed in current HEAD.
