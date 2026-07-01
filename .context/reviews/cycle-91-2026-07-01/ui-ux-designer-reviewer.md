# Cycle 91 UI/UX Designer Reviewer

Perspective: senior UI/UX review for GalleryKit as a photographer-facing publishing gallery, not a culling/editing tool.

HEAD reviewed: `c648634b666f59c29cfe40ea5bbd547bc98d1885`.

## Executive Summary

No confirmed rendered UI defect was found in this pass. The remaining confirmed issue is a low-severity accessibility regression-test mismatch: the lightbox test asserts an obsolete image-label contract while the component now uses a live status counter for photo position. Design readiness from source evidence is solid for public gallery navigation, photo viewing, search, map fallback, touch targets, focus rings, reduced motion, and English/Korean key parity; a seeded browser pass is still needed for visual overlap and real keyboard traversal.

## Confirmed Finding

### UX-C91-01 - LOW - Lightbox position announcement test is stale and can pass without proving the current accessible UI

Severity: LOW
Confidence: High
Status: confirmed test issue
Surface: lightbox accessibility regression coverage

Evidence:

- Test name: `AC-3: lightbox image aria-label references currentIndex/totalCount` (`apps/web/src/__tests__/a11y-us-p15.test.ts:57`).
- The test only checks broad source regexes for `currentIndex` / `totalCount` (`apps/web/src/__tests__/a11y-us-p15.test.ts:60`) and `currentIndex + 1` / `totalCount` formatting (`apps/web/src/__tests__/a11y-us-p15.test.ts:62`).
- The component explicitly avoids putting positional ARIA on the `<img>` so its descriptive alt text remains the accessible name (`apps/web/src/components/lightbox.tsx:528`, `apps/web/src/components/lightbox.tsx:531`).
- The actual position announcement is a separate status counter (`apps/web/src/components/lightbox.tsx:676`, `apps/web/src/components/lightbox.tsx:679`, `apps/web/src/components/lightbox.tsx:681`).

Failure scenario:

If a later edit removes the status counter, changes its `aria-label`, or drops `aria-live`, the current test may still pass because unrelated code/comments contain `currentIndex`, `totalCount`, and the visible `N / total` expression. Screen-reader users would lose the lightbox position update while CI reports the old image-label test as green.

Concrete fix:

Update `a11y-us-p15.test.ts` to reflect the live-region contract. Assert that `lightbox.tsx` contains a `role="status"` block with `aria-live="polite"` and `aria-label={t('aria.photoPosition', { current: currentIndex + 1, total: totalCount })}`. Rename the test away from "image aria-label" and avoid matching comments or unrelated source spans.

## UI/UX Coverage Notes

Information architecture:

- Public nav is labelled, sticky, localized, and uses active state (`apps/web/src/components/nav-client.tsx:92`, `apps/web/src/components/nav-client.tsx:143`).
- Admin nav exposes the expected management destinations with active state (`apps/web/src/components/admin-nav.tsx:15`, `apps/web/src/components/admin-nav.tsx:36`).
- Home/gallery hierarchy includes H1 plus an sr-only H2 before card H3s (`apps/web/src/components/home-client.tsx:259`, `apps/web/src/components/home-client.tsx:280`).

Affordances, keyboard, and focus:

- Search uses dialog focus trap, combobox/listbox semantics, keyboard instructions, and focus restoration (`apps/web/src/components/search.tsx:414`, `apps/web/src/components/search.tsx:440`, `apps/web/src/components/search.tsx:485`, `apps/web/src/components/search.tsx:350`).
- Photo viewer and lightbox expose keyboard shortcuts for navigation, info, fullscreen, color/histogram modes, and slideshow (`apps/web/src/components/photo-viewer.tsx:371`, `apps/web/src/components/lightbox.tsx:309`).
- Focus-visible and target-size regression scanners are committed (`apps/web/src/__tests__/focus-visible-links-scan.test.ts:15`, `apps/web/src/__tests__/touch-target-audit.test.ts:9`).

WCAG 2.2 and responsive states:

- Global reduced-motion handling suppresses animation/transition duration and hover zoom transforms (`apps/web/src/app/[locale]/globals.css:253`, `apps/web/src/app/[locale]/globals.css:275`).
- Public map has a skip link and DOM list alternative to Leaflet markers (`apps/web/src/app/[locale]/(public)/map/page.tsx:75`, `apps/web/src/app/[locale]/(public)/map/page.tsx:93`).
- Touch target floor is reflected in button variants (`apps/web/src/components/ui/button.tsx:24`, `apps/web/src/components/ui/button.tsx:27`).

Loading, empty, and error states:

- Home empty state and filtered no-results recovery link exist (`apps/web/src/components/home-client.tsx:430`, `apps/web/src/components/home-client.tsx:439`).
- Load-more announces loading/results in an sr-only live region (`apps/web/src/components/load-more.tsx:49`, `apps/web/src/components/load-more.tsx:165`).
- Search surfaces invalid, rate-limited, maintenance, setup-required, no-results, and loading states (`apps/web/src/components/search.tsx:136`, `apps/web/src/components/search.tsx:507`).

I18n:

- English/Korean leaf-key parity is locked by test (`apps/web/src/__tests__/i18n-key-parity.test.ts:47`).

Perceived performance:

- Masonry reserves aspect ratio/intrinsic height (`apps/web/src/components/home-client.tsx:321`, `apps/web/src/components/home-client.tsx:324`).
- Photo viewer preloads exactly one responsive neighbor format (`apps/web/src/components/photo-viewer.tsx:256`, `apps/web/src/components/photo-viewer.tsx:302`).

## Manual-Validation Risks

### MV-UX-C91-01 - Seeded browser pass not run

Severity: LOW
Confidence: Medium

I did not run Playwright/browser screenshots in this bounded lane. The Playwright config starts a local server by default (`apps/web/playwright.config.ts:78`), and seeded public/admin flows rely on DB/env credentials (`apps/web/e2e/helpers.ts:89`, `apps/web/e2e/helpers.ts:105`). Run the E2E suite in the seeded environment to validate actual DOM layout, focus order, visual overlap, and responsive states.

## Validation Evidence

Passed:

- `npm test --workspace=apps/web -- a11y-us-p15.test.ts focus-visible-links-scan.test.ts touch-target-audit.test.ts i18n-key-parity.test.ts`
- 4 test files, 43 tests.

## Missed-Issue Sweep

Swept: public navigation, admin navigation, search dialog, photo viewer, lightbox, info bottom sheet, map/list fallback, home masonry, tag filters, load more, reduced motion CSS, locale tests, marketing copy, and Playwright config. No additional confirmed UI/UX defect found.
