# Code Reviewer — Cycle 1 Review

## SUMMARY
- Confirmed 2 actionable performance/maintainability issues after full-repo inspection.
- No current high-severity correctness or security bugs were confirmed in the reviewed code paths.

## INVENTORY
- Data helpers: `apps/web/src/lib/data.ts`
- Public route consumers: `apps/web/src/components/nav.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- Photo rendering: `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/lib/gallery-config-shared.ts`

## FINDINGS

### CR-01 — Public routes re-query `getTopics()` inside the same render tree instead of reusing a request-scoped cached helper
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:202-204`, `apps/web/src/components/nav.tsx:2-8`, `apps/web/src/app/[locale]/(public)/page.tsx:82-84`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:116-120`
- **Why it is a problem:** `Nav` and the page body both call the uncached `getTopics()` helper on hot public routes. The repo already uses `cache()` for similar SSR dedupe helpers, so this inconsistency creates avoidable duplicate topic queries on cache misses.
- **Concrete failure scenario:** A cold home/topic request renders layout + nav + page content, and topics are fetched more than once even though the result is identical for the request.
- **Suggested fix:** Export a cached `getTopicsCached` helper and use it on public-route render paths that share the same request.

### CR-02 — Photo viewer always advertises `100vw`, so browsers choose larger derivatives than the actual image pane needs on desktop
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/components/photo-viewer.tsx:202-223`
- **Why it is a problem:** When the desktop info sidebar is visible, the image pane is materially narrower than the viewport, but the `sizes` hint still tells the browser to treat it as full-width.
- **Concrete failure scenario:** Desktop viewers with the info pane open download a larger AVIF/WebP derivative than necessary, wasting bandwidth and decode work.
- **Suggested fix:** Compute a sidebar-aware `sizes` string for the viewer sources and keep the fallback behavior unchanged when the sidebar is closed.

## FINAL SWEEP
- Re-checked earlier stale review artifacts against current code. Previously reported request-origin, keyboard-photo-nav, and standalone-E2E issues are already fixed in the current checkout and were excluded from this review.
