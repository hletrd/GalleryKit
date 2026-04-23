# Critic Review — Cycle 5 (current checkout)

## Scope and inventory covered
Re-reviewed the public render stack, data helpers, and topic admin flows after the latest cycle-4 fixes.

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### CRT5-01 — The hottest public routes still pay for duplicated filtered reads before render
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:108-114`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:116-123`, `apps/web/src/lib/data.ts:253-276`
- **Why it is a problem:** The repo already applies request-scoped caching elsewhere, but first-page public rendering still performs two separate filtered DB reads to learn data that can be derived from one query.
- **Concrete failure scenario:** Public traffic spends extra DB budget before anything user-visible changes.
- **Suggested fix:** Fold first-page count into the page query and derive `hasMore` from the same result set.

### CRT5-02 — Topic form validation still misattributes malformed label input to the slug field
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/actions/topics.ts:43-48`, `apps/web/src/app/actions/topics.ts:130-135`
- **Why it is a problem:** The defensive validation is correct, but the error mapping is misleading.
- **Concrete failure scenario:** Admins fix the wrong field after a rejection.
- **Suggested fix:** Return a label-specific translation key.

## Final sweep
No broader rewrite is warranted; these are small, high-signal follow-ups on current HEAD.
