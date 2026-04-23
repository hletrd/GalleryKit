# Architect Review — Cycle 5 (current checkout)

## Scope and inventory covered
Reviewed architectural seams around public read helpers and topic-action validation.

## Findings summary
- Confirmed Issues: 1
- Likely Issues: 0
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### ARCH5-01 — Public route composition still lacks a single pagination seam for rows + count
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:253-276`, `apps/web/src/app/[locale]/(public)/page.tsx:108-114`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:116-123`
- **Why it is a problem:** The current architecture exposes count and row fetching as separate calls even though the hottest consumers always need both for the same filter set.
- **Concrete failure scenario:** Public route implementations keep duplicating the same query planning and DB work.
- **Suggested fix:** Add a dedicated paginated public-image helper that returns `images`, `totalCount`, and `hasMore` together.

## Final sweep
No larger boundary change is needed; a small data-layer seam is enough.
