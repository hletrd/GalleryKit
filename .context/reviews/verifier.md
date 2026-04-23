# Verifier Review — Cycle 5 (current checkout)

## Scope and inventory covered
Validated current public-page behavior and topic action error handling directly from code.

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### VER5-01 — Public page `hasMore`/`totalCount` proof still depends on a second exact-count query
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:108-114`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:116-123`, `apps/web/src/lib/data.ts:253-276`
- **Why it is a problem:** The code proves correctness by asking the DB twice for the same filter set instead of binding count proof to the paginated result itself.
- **Concrete failure scenario:** Initial public requests remain slower than necessary even though the same UI information can be obtained from one query.
- **Suggested fix:** Return paginated rows with an attached total-count window value and derive `hasMore` from an overfetch row.

### VER5-02 — Topic label control-character rejection returns the wrong error key
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/actions/topics.ts:43-48`, `apps/web/src/app/actions/topics.ts:130-135`
- **Why it is a problem:** The code path is rejecting the label, but the emitted error says the slug is invalid.
- **Concrete failure scenario:** The UI gives incorrect operator guidance and the test suite does not lock this contract.
- **Suggested fix:** Introduce and use `invalidLabel`.

## Final sweep
Current HEAD no longer reproduces the earlier locale-segment and histogram-request bugs.
