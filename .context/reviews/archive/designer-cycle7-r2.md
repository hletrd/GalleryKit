# Designer (UI/UX) Review — Cycle 7 (R2)

**Date:** 2026-04-19
**Reviewer:** designer
**Scope:** Frontend components, accessibility, responsive design

## Findings

### UX-7R2-01: `searchImages` result exposes internal filenames to client [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/lib/data.ts` lines 598-604
- **Description:** The `SearchResult` type includes `filename_jpeg`, `filename_webp`, `filename_avif` — internal UUID-based filenames that are not meaningful to users. The search results are returned to the client via `searchImagesAction` in `public.ts`. If the search UI renders these filenames (e.g., as fallback text or debug info), it would expose internal implementation details. Currently the search component appears to only use display fields, but the type contract leaks this data unnecessarily.
- **Fix:** Remove filename fields from `SearchResult` or create a public-safe variant.
- **Cross-agent:** Also flagged by security-reviewer (SEC-7R2-01) and code-reviewer (CR-7R2-02).

### UX-7R2-02: `Search` component lacks ARIA role for results list [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/components/search.tsx`
- **Description:** The search component uses a combobox/dropdown pattern but the results list may lack proper ARIA roles (`listbox`, `option`) for screen reader compatibility. Without these, screen readers may not announce search results properly.
- **Fix:** Verify the search component uses appropriate ARIA roles for combobox pattern per WAI-ARIA Authoring Practices.

### UX-7R2-03: Back-to-top button focus management [LOW] [LOW confidence]
- **File:** `apps/web/src/components/home-client.tsx` lines 334-350
- **Description:** The back-to-top button correctly uses `aria-hidden` and `tabIndex=-1` when invisible. However, when the button becomes visible and a user activates it, focus remains on the button rather than moving to the top of the page. For keyboard users, this means they must Tab again from the button position rather than continuing from the top.
- **Fix:** After scrolling to top, move focus to the first focusable element or the `<main>` landmark.

## Previously Deferred Items Confirmed (No Change)

All previously deferred items from cycles 5-39 remain deferred.
