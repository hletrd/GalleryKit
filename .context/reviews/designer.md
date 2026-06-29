# Designer Review - Cycle 12

Role: Cycle 12 designer reviewer using the local UI/UX-designer perspective, adapted to GalleryKit's Next.js web photo gallery. Scope covered information architecture, affordances, keyboard/focus navigation, WCAG 2.2/accessibility, contrast/ARIA/focus traps/reduced motion, responsive behavior, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL, and perceived performance. No production code was changed.

## Executive Summary

GalleryKit's current UI surface is generally disciplined: the public/admin IA is coherent, touch-target and focus-visible protections are backed by tests, the admin login shell is accessible in live browser checks, and the prior timeline/year/map responsive regressions appear fixed. I found one confirmed accessibility defect and one likely mobile semantics risk:

- Confirmed: the privacy route nests a second `<main>` landmark inside the public layout's existing `<main>`.
- Likely: the mobile photo info bottom sheet advertises modal dialog semantics and traps focus even in its peek state, while visually presenting as a partial sheet with no backdrop.

The largest review limitation is local data availability. The local dev server started successfully, but public gallery routes that query MySQL fell into the app error shell because `127.0.0.1:3306` refused connections. I therefore used live browser evidence for admin/login and static public pages, and source/test review for DB-backed photo/gallery interactions.

## Inventory Reviewed

I first built a review-relevant inventory, then read the UI files rather than sampling. The render-surface inventory contained 99 TypeScript/TSX/CSS files under:

- Public routes: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]`, `c/[slug]`, `g/[key]`, `s/[key]`, `p/[id]`, `map`, `timeline`, `year`, `privacy`, plus public layout/loading/error/not-found shells.
- Admin routes: login, protected layout, dashboard, upload/image management, categories, tags, SEO, settings, password, users, DB, tokens, analytics, loading/error shells.
- Components: `nav`, `footer`, `home-client`, `load-more`, `photo-viewer`, `photo-navigation`, `image-zoom`, `lightbox`, `info-bottom-sheet`, color/histogram widgets, search, tag/filter controls, upload/dropzone/image-manager admin components, map components, and shared UI primitives.
- Styling and contracts: `apps/web/src/app/[locale]/globals.css`, Tailwind/theme tokens, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, and UI-oriented tests/e2e specs including touch targets, focus-visible scans, i18n parity, lightbox controls, info-sheet IA, HDR badge contrast, admin flows, public flows, and navigation fixes.

Final sweep included searches for `main`, `role=`, `aria-`, `FocusTrap`, `prefers-reduced-motion`, `forced-colors`, `tabIndex`, `aria-keyshortcuts`, loading/empty/error labels, and route-level shells.

## Browser Evidence

Tooling: `agent-browser` CLI with local Chromium. Screenshots captured:

- `/tmp/gallery-desktop-home.png`
- `/tmp/gallery-admin-login-desktop.png`
- `/tmp/gallery-admin-login-mobile-dark.png`
- `/tmp/gallery-privacy-mobile.png`

Runtime checks:

- Local dev server: `http://127.0.0.1:3100`.
- `/en`: HTTP 200 but rendered the app error boundary because MySQL was unavailable. Accessibility snapshot exposed a `main` region with heading `Error`, text `Something went wrong loading this page.`, and buttons `Try again` / `Return to Gallery`.
- `/en/admin`: rendered the login shell. Snapshot exposed one `main`, heading `Admin`, labeled `Username` and `Password` fields, `Show password`, `Sign in`, and a notifications region. DOM state check returned `mainCount: 1`, `nestedMain: false`, active element `login-username`, and no horizontal overflow.
- `/en/privacy` at mobile viewport `390x844`: rendered without DB access. Accessibility snapshot exposed `navigation "Main navigation"`, then `main > main`, then footer `contentinfo`. DOM state check returned `mainCount: 2`, `nestedMain: true`, and `bodyOverflowX: 0`.

The agent-browser style/box commands returned success without a payload in this installed CLI build, so I did not include computed-style or box-metric claims beyond DOM state and accessibility snapshots.

## Findings

### DES-C12-01 - Privacy page nests a second main landmark inside the public main

Severity: Low
Confidence: High
Classification: confirmed

Source evidence:

- The public layout wraps every public child route in a skip-link target `<main id="main-content" tabIndex={-1}>` at `apps/web/src/app/[locale]/(public)/layout.tsx:12`.
- The privacy page returns another `<main className="container mx-auto max-w-3xl px-4 py-12">` at `apps/web/src/app/[locale]/(public)/privacy/page.tsx:18`.

Browser evidence:

- Route: `http://127.0.0.1:3100/en/privacy`.
- Selector/state evidence: `document.querySelectorAll('main').length === 2`; `document.querySelector('main main') !== null`.
- Accessibility snapshot exposed nested landmarks as `main` containing another `main`.
- Screenshot: `/tmp/gallery-privacy-mobile.png`.

Failure scenario:

A keyboard or screen-reader user activates the skip link and lands in the outer public `main`, then landmark navigation exposes another nested `main` for the same page content. This makes the privacy page's landmark model inconsistent with other public routes and weakens the WCAG 2.2 expectation that repeated landmarks describe distinct regions.

Suggested fix:

Change the privacy page wrapper from `<main>` to `<section>` or `<div>`, preferably with `aria-labelledby` pointing at the page `<h1>` if an explicit region name is useful. Keep the public layout's existing `main-content` skip target as the single page-level main landmark.

### DES-C12-02 - Mobile info sheet likely overstates modality in peek state

Severity: Medium
Confidence: Medium
Classification: likely

Source evidence:

- The bottom sheet shows a backdrop only when `sheetState === 'expanded'` at `apps/web/src/components/info-bottom-sheet.tsx:176-181`.
- The focus trap is active whenever `isOpen`, regardless of sheet state, at `apps/web/src/components/info-bottom-sheet.tsx:185-192`.
- The sheet container always uses `role="dialog"` and `aria-modal="true"` at `apps/web/src/components/info-bottom-sheet.tsx:194-199`.
- The peek state is implemented as a partial-height translated sheet with `minHeight: PEEK_HEIGHT`, `overflowY: hidden`, and transform-driven position at `apps/web/src/components/info-bottom-sheet.tsx:200-210`.

Browser evidence:

- Not directly reproduced in local browser because DB-backed photo pages could not render without MySQL.
- This is a source-confirmed semantics risk rather than a live-confirmed behavioral failure.

Failure scenario:

On mobile, a user opens photo information and receives a partial "peek" sheet. Visually, the page still reads as a photo view with a partial panel and no backdrop, but assistive technology is told a modal dialog is active and keyboard focus is trapped inside it. That mismatch can make the underlying photo context unreachable by keyboard/screen reader until close, while sighted users see a less-than-modal interaction model.

Suggested fix:

Pick one modal contract and make the implementation match it:

- If peek is meant to be a non-modal disclosure, set `aria-modal={false}` and disable `FocusTrap` until expanded, then use modal semantics only for the expanded state.
- If any open sheet state is meant to be modal, show the backdrop/inert treatment consistently while open and make the visual state communicate that the rest of the page is unavailable.

Add a mobile regression test that opens the info sheet, checks `aria-modal`/focus containment for peek versus expanded states, and verifies the visible backdrop/inert behavior matches the chosen contract.

## Verified Strengths and Non-Findings

- Admin login IA and accessibility held in live browser checks: one main landmark, explicit labels, initial focus on username, password visibility button, notifications region, and no horizontal overflow at desktop/mobile sampled widths.
- The local DB failure reached a usable error shell with a heading, explanatory copy, retry action, and return action instead of a blank page.
- Timeline/year image geometry regressions from earlier cycles appear addressed in source: archive thumbnails guard invalid dimensions and use eager/high-priority loading for initial visible items.
- Shared-group photo cards now compute safe aspect ratios and use `containIntrinsicSize`/above-fold loading hints in source review.
- Map loading has a visible fallback skeleton rather than a blank suspended map area.
- Reduced-motion and forced-colors handling are present in global CSS, and core animated surfaces include motion-reduction branches.
- Touch-target and focus-visible coverage is institutionalized through tests, including the 44 px audit and focus-visible link scanning.
- English/Korean message parity is enforced by tests. The app currently declares `dir="ltr"`, which is appropriate for the supported locales reviewed here; no RTL support is claimed by the code.

## Limitations

- Local MySQL was unavailable, so DB-backed public gallery/photo/map pages could not be fully exercised in the local browser. I used static/source/test review for those surfaces.
- I did not log into admin because no credentials were provided and the task did not require credentialed mutation.
- I did not run the full lint/typecheck/build/test suite because this pass is a review artifact only and no production code was edited.

## Completion Check

- Review inventory built before findings.
- All review-relevant render-surface UI files in the inventory were examined.
- Browser evidence collected where feasible with accessibility snapshots and DOM state checks.
- Findings include file/line evidence, failure scenarios, severity, confidence, and suggested fixes.
- Final sweep performed for commonly missed landmarks, focus traps, motion, contrast-related hooks, loading/empty/error states, and i18n/RTL assumptions.
