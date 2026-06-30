# UI/UX Designer Reviewer - Cycle 28

Date: 2026-06-30
Repo: `/Users/hletrd/flash-shared/gallery`
Mode: Prompt 1 review only. No fixes implemented.
Reviewer surface: local `ui-ux-designer-reviewer` prompt applied under `AGENTS.md` and `CLAUDE.md` authority.

## Inventory First

### Instructions and Project Context Examined

- `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`
- `AGENTS.md` instructions supplied in the prompt
- `CLAUDE.md` architecture, UI, i18n, privacy, color/HDR, and operational guidance
- `.context/reviews/ui-ux-designer-reviewer.md` existing cycle 27 report
- `.context/reviews/photographer-r27/` and `.context/reviews/photographer-r28/` review history inventory
- `.context/plans/README.md` and current `.context/plans/photographer-*` plan inventory

### Current UI Source Examined

I inventoried and reviewed the current route/component/style/message/test surfaces that affect UI behavior: 16,713 lines across public pages, admin pages, shared components, UI primitives, translations, styles, and UI-focused tests.

Public app route files examined:

- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/globals.css`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/privacy/page.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`

Admin route files examined:

- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/images/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx`

Shared UI and interaction components examined:

- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/bulk-edit-dialog.tsx`
- `apps/web/src/components/color-details-section.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/grid-picture.tsx`
- `apps/web/src/components/grid-picture-fallback.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/lazy-focus-trap.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/lightbox-color-pip.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/photo-viewer-color-pip.tsx`
- `apps/web/src/components/photo-viewer-shell.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/similar-photos.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/theme-provider.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/wide-gamut-hint.tsx`
- `apps/web/src/components/map/*`
- `apps/web/src/components/ui/*`

Localization and UI test surfaces examined:

- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/__tests__/touch-target-audit.test.ts`
- `apps/web/src/__tests__/focus-visible-links-scan.test.ts`
- `apps/web/src/__tests__/a11y-us-p15.test.ts`
- `apps/web/src/__tests__/privacy-page-landmark.test.ts`
- `apps/web/src/__tests__/lightbox-controls-contract.test.ts`
- `apps/web/src/__tests__/i18n-key-parity.test.ts`
- `apps/web/src/__tests__/theme-token-contract.test.ts`
- `apps/web/src/__tests__/hdr-badge-contrast.test.ts`

## Runtime and Validation Evidence

Browser/runtime inspection was feasible against an already-running local dev server on `http://localhost:3001`.

Validated in browser:

- `/en/privacy` loaded successfully with title `Privacy | GalleryKit`.
- Privacy page exposed `html lang="en" dir="ltr"`, a `main` landmark with `id="main-content"`, a `Main navigation` landmark, and a footer landmark.
- `/en/admin` loaded the login UI with labeled username and password fields.
- Search dialog on `/en/privacy` moved focus to the combobox after open and restored focus to the Search trigger after Escape.

Runtime blocker:

- `/en` rendered the app error boundary because the local DB was unavailable. Console/server evidence showed failed queries against `admin_settings` and `topics`. This blocked populated home/gallery/admin-protected runtime evaluation, so those flows were reviewed through source, DOM-capable static evidence, and focused tests.

Focused validation run:

- `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/a11y-us-p15.test.ts src/__tests__/privacy-page-landmark.test.ts src/__tests__/lightbox-controls-contract.test.ts`
  - 5 files passed, 48 tests passed.
- `npm test --workspace=apps/web -- --run src/__tests__/i18n-key-parity.test.ts src/__tests__/theme-token-contract.test.ts src/__tests__/hdr-badge-contrast.test.ts`
  - 3 files passed, 15 tests passed.

Total focused validation: 8 UI/a11y/i18n/theme test files passed, 63 tests passed.

## Confirmed Findings

### C28-UX-01 - Admin image table lacks a contained horizontal overflow strategy

Severity: Medium
Confidence: High

File and region:

- `apps/web/src/components/image-manager.tsx:424-595`
- Comparison pattern: `apps/web/src/components/admin-user-manager.tsx:135-136`

Problem:

The admin image manager renders a dense 9-column table inside `<div className="min-w-0 rounded-md border">` with a plain `<Table>`, but the table has no horizontal scroll container, no explicit minimum width, and no responsive card fallback. The columns include checkbox, preview, title, filename, topic, tags, gamut, date, and actions. Several cells have fixed or minimum width pressure, including preview media, a `min-w-[200px]` tags area, and edit/delete action buttons.

Concrete failure scenario:

On a phone, tablet, split-screen laptop, or narrow admin sidebar viewport, the table either compresses controls into unreadable cells or creates page-level horizontal overflow. Keyboard users tabbing through the row actions can land on controls outside the visible viewport without a contained scroll context. Touch users may not reliably reach the date/actions side of the table, and screen magnifier users lose row context while panning.

Why this is a repo-consistency issue:

`admin-user-manager.tsx` already uses the safer project pattern at `135-136`: `overflow-x-auto rounded-md border` plus `Table className="min-w-[520px]"`. The image manager is wider and riskier, but does not apply that pattern.

Suggested fix:

Wrap the image table in a contained horizontal scroller, for example `overflow-x-auto rounded-md border`, and give the table an explicit minimum width sized for its actual columns. For smaller admin breakpoints, consider a responsive card/list layout that preserves preview, title, status, topic/tags, and primary actions without horizontal panning. Add a regression test or source contract so dense admin tables keep a contained overflow strategy.

### C28-UX-02 - Slideshow interval validation is not surfaced at field level

Severity: Medium
Confidence: High

File and region:

- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:154-173`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:695-707`
- `apps/web/src/app/actions/settings.ts:60-65`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:263-265`

Problem:

The settings page defines a numeric slideshow interval input with `min={SLIDESHOW_INTERVAL_MIN}` and `max={SLIDESHOW_INTERVAL_MAX}`, but the custom client-side `validateSettings` function does not validate `slideshow_interval_seconds`. The Save action is driven by a custom button handler, not native form submission, so browser constraint validation is not enough to reliably block invalid values or announce the problem. If the server rejects the value, the client shows only a generic toast from `result.error`, with no `aria-invalid`, no field-specific error message, and no error text associated through `aria-describedby`.

Concrete failure scenario:

An admin enters `0`, `999`, or another out-of-range slideshow interval and presses Save. The page attempts to save, receives a generic invalid-value failure, and leaves the field visually and programmatically unchanged. A screen reader user hears the toast but is not told which field needs correction. A sighted keyboard user must infer the offending field by scanning the settings page.

WCAG impact:

This weakens WCAG 2.2 error identification and correction support, especially 3.3.1 Error Identification and 3.3.3 Error Suggestion, because the invalid control is not marked or described when the app already knows the accepted range.

Suggested fix:

Add `slideshow_interval_seconds` to the same client-side range validation path used for image quality and wide-gamut pixel settings. When invalid, render a field-level message with an `id`, set `aria-invalid="true"` on the input, and include both the help text and error id in `aria-describedby`. Consider moving the settings save interaction into a real `<form onSubmit>` so native number validation and custom validation reinforce each other.

## Coverage Notes by Review Area

Information architecture:

- Public navigation, topic navigation, map/timeline/year/detail routes, privacy, and admin route grouping were reviewed. The current structure is understandable and avoids exposing admin-only data in public components. The main source-backed IA issue found is the responsive handling of dense admin image management.

Affordances:

- Public cards, search, lightbox controls, bottom sheet, zoom controls, upload dropzone, admin buttons, and table actions were reviewed. Button labels and icon-only controls generally have accessible names. The image manager table density issue remains the main affordance risk at narrow widths.

Focus and keyboard navigation:

- Skip link, privacy landmarks, search modal open/close focus behavior, lightbox keyboard shortcuts, bottom sheet focus trap, upload controls, and admin login were reviewed. Existing focused tests passed for touch targets, focus-visible links, and lightbox control contracts. No new focus trap defect was confirmed in the feasible runtime paths.

WCAG 2.2 accessibility:

- Landmarks, focus visibility, touch target tests, dialog semantics, input labels, live regions, and validation flows were reviewed. The confirmed WCAG concern is field-level validation for slideshow interval settings.

Contrast and color:

- Theme tokens, HDR badge contrast tests, forced-colors CSS, dark/light/OLED theme support, and color-gamut labels were reviewed. Focused contrast/token tests passed. No new source-backed contrast failure was found.

ARIA:

- Search combobox/dialog, bottom sheet dialog, upload progress, tag combobox/listbox, lightbox controls, navigation labels, and settings inputs were reviewed. The confirmed ARIA gap is missing invalid/error association for the slideshow interval field.

Reduced motion:

- Global reduced-motion CSS, home image hover suppression, photo viewer transition duration handling, photo navigation animation handling, and lightbox motion behavior were reviewed. No new reduced-motion failure was confirmed.

Responsive breakpoints:

- Public masonry/grid behavior, nav wrapping, photo viewer responsive layout, bottom sheet mobile behavior, admin shell, user table, and image manager table were reviewed. The confirmed responsive defect is the image manager table overflow strategy.

Loading, empty, and error states:

- Public loading for photo detail, protected admin loading/error, topic empty state, search empty/results, upload selected/progress/error states, and DB-triggered error boundary were reviewed. The DB blocker prevented populated gallery runtime validation, but source coverage did not reveal a new loading/empty/error-state defect beyond the settings validation UX issue.

Form validation UX:

- Admin login, upload form, tag input, user manager, password/settings forms, and settings save flow were reviewed. The confirmed defect is the missing field-level slideshow interval validation.

Dark/light mode:

- Theme provider, token contract tests, forced colors, dark/OLED selectors, and representative component classes were reviewed. No new dark/light mode issue was confirmed.

i18n and RTL:

- `en` and `ko` message parity tests passed. Root layout sets `lang` and `dir` from locale direction. No RTL locale is currently shipped, so RTL-specific visual behavior remains a future manual validation area rather than a confirmed current bug.

Perceived performance:

- Public masonry uses lazy loading and `content-visibility` support, search uses debouncing, image detail uses blur/priority handling, and reduced-motion paths are present. No new perceived-performance defect was confirmed in source. DB-backed runtime performance could not be assessed due to local DB unavailability.

## Previously Reported Issues Rechecked

- Cycle 27 desktop nav clipping issue was rechecked and is no longer present in current source. `apps/web/src/components/nav-client.tsx:84-91` now includes desktop auto height, min height, visible overflow, wrapping, and padding for expanded topic links.
- Cycle 27 create-user password hint association was rechecked and is no longer present in current source. `apps/web/src/components/admin-user-manager.tsx:113-119` now associates the create password and confirmation inputs with `create-password-help`.

## Final Missed-Issues Sweep

No current review-relevant UI source category was intentionally skipped in the source pass: public routes, admin routes, shared interaction components, UI primitives, global styles, messages, and UI-focused tests were inventoried and reviewed. Runtime inspection of populated DB-backed gallery flows was blocked by the unavailable local database, and that is the only material validation gap. The final sweep did not identify additional source-backed findings with enough confidence to report.

Finding count: 2
