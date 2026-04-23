# Code Review — Cycle 6 (2026-04-23)

## Scope and inventory covered
Reviewed the current HEAD across `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, `apps/web/src/__tests__`, `apps/web/e2e`, config files, and repo docs (`CLAUDE.md`, `AGENTS.md`, `README.md`, `apps/web/README.md`, `.context/plans/README.md`).

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### CR6-01 — Public route renders still serialize independent server reads before the first byte
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:95-110`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:90-125`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:104-123`, `apps/web/src/app/[locale]/layout.tsx:55-64`
- **Why it is a problem:** These entrypoints await independent reads (`getSeoSettings`, `getGalleryConfig`, `getTagsCached`, `getTopicsCached`, `getMessages`, `isAdmin`) in serial chains instead of issuing them together.
- **Concrete failure scenario:** Cold public requests pay extra DB/session round-trip latency before HTML can stream, which increases TTFB on the most-trafficked pages.
- **Suggested fix:** Collapse independent reads into `Promise.all` groups so only true data dependencies remain sequential.

### CR6-02 — Infinite scroll always performs one redundant fetch when the remaining result count is an exact multiple of the page size
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/actions/public.ts:11-25`, `apps/web/src/components/load-more.tsx:29-43`
- **Why it is a problem:** `loadMoreImages()` returns only rows, and the client infers exhaustion with `newImages.length < limit`. When the last page is exactly `limit` rows, the client cannot know it is done and triggers one extra request.
- **Concrete failure scenario:** A 60-image gallery with page size 30 always causes a third empty server action + DB query after the second real page loads.
- **Suggested fix:** Return `hasMore` from the action by overfetching one row (or using the paginated helper), then update the client to stop without the empty round-trip.

## Final sweep
Rechecked prior cycle findings against current HEAD; older split count-query and invalid-label issues are already fixed and are not carried forward.
