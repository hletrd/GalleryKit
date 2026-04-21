# Cycle 7 Designer Review (manual fallback)

## Inventory
- Reviewed public gallery/search/photo surfaces and admin image-management previews from source plus current passing Playwright coverage.
- Focused on thumbnail delivery, share affordances, and user-visible wording/behavior alignment.

## Confirmed Issues

### U7-01 — Tiny search/admin previews still pull the largest JPEG derivative
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/components/search.tsx:208-215`, `apps/web/src/components/image-manager.tsx:342-349`, `apps/web/src/lib/process-image.ts:393-406`
- **Why it is a problem:** 48px and 128px preview slots request the base JPEG alias instead of a small derivative, creating unnecessary latency and bandwidth for high-resolution galleries.
- **Concrete failure scenario:** opening search or the admin table on a slower device causes visible thumbnail pop-in and extra CPU usage because large JPEGs are decoded for tiny preview slots.
- **Suggested fix:** use a shared helper to choose the nearest small generated JPEG derivative for thumbnail-sized surfaces.

## No additional blocking accessibility findings
- Existing keyboard/focus/loading semantics looked consistent with the current source and prior passing browser checks; no new WCAG-blocking issue was re-confirmed in this fallback pass.
