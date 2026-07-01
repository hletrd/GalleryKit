# Cycle 91 Designer Review

Review lane: designer, with UI/UX and product-marketing lenses applied where relevant to the Next.js GalleryKit web repo.

HEAD reviewed: `c648634b666f59c29cfe40ea5bbd547bc98d1885`.

## Inventory

Relevant files/categories examined:

- Public gallery IA and states: `apps/web/src/components/home-client.tsx`, `tag-filter.tsx`, `load-more.tsx`, `nav-client.tsx`, `search.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `similar-photos.tsx`, `on-this-day-widget.tsx`, `footer.tsx`.
- Public routes: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `map/page.tsx`, `privacy/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `c/[slug]/page.tsx`.
- Admin IA and dense controls: `apps/web/src/components/admin-header.tsx`, `admin-nav.tsx`, `image-manager.tsx`, `upload-dropzone.tsx`, `admin-user-manager.tsx`, admin dashboard/settings/seo/categories/tags/tokens/analytics/db/password/users route files.
- Design-system and motion/accessibility primitives: `apps/web/src/components/ui/*`, `apps/web/src/app/[locale]/globals.css`, `apps/web/src/components/image-zoom.tsx`, `histogram.tsx`, `color-details-section.tsx`, `wide-gamut-hint.tsx`.
- i18n/copy/claims: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `apps/web/src/site-config.json`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Tests reviewed: `apps/web/src/__tests__/a11y-us-p15.test.ts`, `focus-visible-links-scan.test.ts`, `touch-target-audit.test.ts`, `i18n-key-parity.test.ts`, `image-zoom-source-contracts.test.ts`, relevant Playwright specs and config.

Browser execution: not run. This bounded lane had no seeded GalleryKit DB/browser fixture available in scope; Playwright defaults to a local web server (`apps/web/playwright.config.ts:78`) and seeded public/admin flows depend on local env and DB credentials (`apps/web/e2e/helpers.ts:89`, `apps/web/e2e/helpers.ts:105`). I used source and regression-test evidence instead.

Targeted validation run:

- `npm test --workspace=apps/web -- a11y-us-p15.test.ts focus-visible-links-scan.test.ts touch-target-audit.test.ts i18n-key-parity.test.ts`
- Result: 4 files passed, 43 tests passed.

## Confirmed Findings

### DES-C91-01 - LOW - Stale lightbox accessibility test no longer proves its stated contract

Severity: LOW
Confidence: High
Type: confirmed test-contract issue, not a confirmed rendered UI defect

Evidence:

- The regression test says it is asserting `lightbox image aria-label references currentIndex/totalCount` (`apps/web/src/__tests__/a11y-us-p15.test.ts:57`), then only regex-checks that `currentIndex` and `totalCount` appear somewhere in the source (`apps/web/src/__tests__/a11y-us-p15.test.ts:60`) and that a `currentIndex + 1` / `totalCount` formatting pattern appears somewhere (`apps/web/src/__tests__/a11y-us-p15.test.ts:62`).
- The component intentionally does not put this position on the image; its comment says the descriptive `alt` should win and the position is announced by the status counter (`apps/web/src/components/lightbox.tsx:528`, `apps/web/src/components/lightbox.tsx:531`).
- The actual accessible position state is on the live status element (`apps/web/src/components/lightbox.tsx:676`, `apps/web/src/components/lightbox.tsx:679`, `apps/web/src/components/lightbox.tsx:681`).

Failure scenario:

A future change could remove or break the `role="status"` / `aria-label={t('aria.photoPosition', ...)}` counter while leaving incidental `currentIndex` / `totalCount` text elsewhere in `lightbox.tsx`. The current test can still pass even though screen-reader users no longer get the slide position update. Conversely, the test name points reviewers toward an image-label contract that the component has explicitly rejected.

Concrete fix:

Rename and tighten the test to assert the current contract: a rendered/source status region exists with `role="status"`, `aria-live="polite"`, and an `aria-label` using `t('aria.photoPosition', { current: currentIndex + 1, total: totalCount })`. Remove the stale "lightbox image aria-label" wording and avoid broad `/currentIndex.*totalCount/s` matches that can be satisfied by unrelated code or comments.

## Likely / Manual-Validation Risks

### MV-C91-01 - Browser responsive states need a seeded visual pass

Severity: LOW
Confidence: Medium
Type: validation gap

Source evidence shows strong coverage for touch targets, focus rings, i18n parity, and reduced motion: the 44 px policy is encoded in `touch-target-audit.test.ts` (`apps/web/src/__tests__/touch-target-audit.test.ts:9`), focus-visible scanning walks components and app routes (`apps/web/src/__tests__/focus-visible-links-scan.test.ts:15`), and global reduced-motion overrides exist (`apps/web/src/app/[locale]/globals.css:253`). However, I did not run a live browser screenshot/keyboard pass for mobile nav, search, lightbox, map, and admin dashboards in this lane.

Concrete validation follow-up:

Run `npm run test:e2e --workspace=apps/web` in the seeded local E2E environment, plus manual screenshots for 375 px mobile, 768 px tablet, 1280 px desktop, dark/OLED themes, search dialog, photo viewer + lightbox, map fallback list, and admin nav wrapping.

## Non-Findings / Positive Evidence

- Public navigation uses labelled nav, current-page state, 44 px controls, locale/theme/search controls, and mobile expansion metadata (`apps/web/src/components/nav-client.tsx:92`, `apps/web/src/components/nav-client.tsx:116`, `apps/web/src/components/nav-client.tsx:145`, `apps/web/src/components/nav-client.tsx:172`).
- Search dialog has focus trap, labelled combobox/listbox, IME guards, live status, keyboard instructions, and semantic-search honesty copy (`apps/web/src/components/search.tsx:414`, `apps/web/src/components/search.tsx:440`, `apps/web/src/components/search.tsx:481`, `apps/web/src/components/search.tsx:546`).
- Lightbox has focus management, keyboard shortcuts, reduced-motion gating for Ken Burns/opacity, and 44 px controls (`apps/web/src/components/lightbox.tsx:93`, `apps/web/src/components/lightbox.tsx:433`, `apps/web/src/components/lightbox.tsx:557`, `apps/web/src/components/lightbox.tsx:607`).
- Map has a skip link and non-map list fallback for keyboard/screen-reader navigation (`apps/web/src/app/[locale]/(public)/map/page.tsx:75`, `apps/web/src/app/[locale]/(public)/map/page.tsx:93`).

## Missed-Issue Sweep

Final sweep covered ARIA/focus attributes, interactive controls, reduced motion CSS, public/admin route inventory, marketing claim text, locale parity tests, touch-target tests, and Playwright config. No confirmed rendered UI/UX, IA, i18n, responsive, empty/loading/error-state, perceived-performance, or marketing-claim mismatch was found from source evidence in this lane.
