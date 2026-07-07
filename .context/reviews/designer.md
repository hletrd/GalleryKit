# GalleryKit Designer UI/UX Review - Cycle 11

Date: 2026-07-07
Workspace: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `4b1d4862`
Lane: designer / UI-UX reviewer
Mode: review-only. No application source edits, plan edits, commits, pushes, deploys, service changes, Docker/MySQL starts or stops, file removals, or data mutations.

## Scope And Inventory

Instructions followed: `AGENTS.md`, `CLAUDE.md`, and the cycle-11 designer-review prompt. I only wrote this assigned review file.

Review-relevant frontend inventory:

- `apps/web/src/app/[locale]/**`: 46 localized route/layout/loading/error/not-found/admin TSX files. Covered public home, topic, photo, timeline, year archive, map, smart collection/shared routes, privacy, localized not-found/error shells, login, and protected admin dashboard/settings/categories/tags/SEO/tokens/users/image-management surfaces by source.
- `apps/web/src/components/**`: 60 UI component TSX files. Key reviewed components include `nav-client.tsx`, `search.tsx`, `home-client.tsx`, `masonry-card.tsx`, `grid-picture.tsx`, `optimistic-image.tsx`, `photo-viewer.tsx`, `photo-viewer-loading.tsx`, `photo-navigation.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `map/map-client.tsx`, `upload-dropzone.tsx`, `image-manager.tsx`, `tag-input.tsx`, `load-more.tsx`, `tag-filter.tsx`, `footer.tsx`, admin nav/header/user manager, and UI primitives.
- `apps/web/messages/en.json` and `apps/web/messages/ko.json`: current public/admin locale strings.
- `apps/web/src/__tests__/**`: 345 Vitest files. Review-relevant tests checked include touch target audit, focus-visible scans, focus restoration, a11y, i18n key parity, password/login form a11y, HDR/color contrast, admin source contracts, error shell, not-found recovery, select target, and tag input coverage.
- `apps/web/e2e/**`: 9 Playwright specs covering public flows, focus restore, nav visual checks, hydration, 404, and opt-in admin flows.

Agent-browser evidence against production:

- Used `agent-browser` CLI skills for viewport/media config, open/navigation, wait, accessibility snapshots, DOM/box/style evaluation, click/keyboard interaction, screenshots, network requests, console, and page-error checks.
- Mobile public home: `https://gallery.atik.kr/en` at `390x844`, light/reduced-motion. Snapshot showed skip link, main navigation, localized controls, `main`, H1, tag filter, photo links, load-more button, footer, and notification region. Screenshot saved to `/tmp/gallery-cycle11-mobile-home.png`.
- DOM metrics on the same URL found `lang="en"`, zero horizontal overflow, no visible unnamed controls, and no visible controls below 44 px. The search trigger was confirmed as a 44 x 44 button labelled `Search photos`.
- Search dialog opened from production with `button[aria-label="Search photos"]`, focused `#search-input`, exposed a dialog named `Search photos`, and closed with Escape.
- Korean admin login: `https://gallery.atik.kr/ko/admin` at `390x844`, dark/reduced-motion. Confirmed `lang="ko"`, no horizontal overflow, dark colors, labelled username/password fields, 44 px password reveal control, and 44 px submit button. Screenshot saved to `/tmp/gallery-cycle11-ko-admin-dark-mobile.png`.
- Browser `errors` and `console` checks reported no page errors in the checked production flows. Home `/api/` network filter captured no requests during the checked initial load.

## Findings

### DES-C11-01 - Admin category, tag, and SEO save failures remain toast-only

Severity: Medium
Confidence: High
Validation: Confirmed by source; authenticated production browser validation was not available in this review lane.

Evidence:

- Category create/update server-action errors only call `toast.error(...)` and do not set field or form error state: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90` and `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:108`.
- The category create form has labelled required inputs but no persistent alert, `aria-invalid`, error `aria-describedby`, invalid-field focus target, or pending submit state: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:204`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:207`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:211`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:215`, and `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:221`.
- The category edit form repeats the same pattern: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:362`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:365`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:369`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:373`, and `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:382`.
- Tag update failures are also toast-only: `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:52` and `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:57`. The edit form lacks inline error state and invalid-field focus wiring at `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:175`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:178`, and `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:180`.
- SEO save failures use `toast.error(...)` without assigning the server error to the relevant field or a persistent form alert: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:67`, and `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:70`. SEO fields only describe help text, for example `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:100`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:126`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:153`, and `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:174`.
- A better local pattern exists in the login form: it focuses the first invalid control and wires `aria-invalid`, `aria-describedby`, and `role="alert"` at `apps/web/src/app/[locale]/admin/login-form.tsx:44`, `apps/web/src/app/[locale]/admin/login-form.tsx:71`, `apps/web/src/app/[locale]/admin/login-form.tsx:78`, `apps/web/src/app/[locale]/admin/login-form.tsx:98`, `apps/web/src/app/[locale]/admin/login-form.tsx:120`, and `apps/web/src/app/[locale]/admin/login-form.tsx:126`.

Failure scenario:

An admin submits a duplicate topic slug, invalid topic alias, invalid tag name, or rejected SEO locale/URL. The save fails, a short-lived toast appears, the dialog/card remains open, and the failing input is not marked invalid or focused. Keyboard and screen-reader users have to rediscover the problem manually, and repeated Enter can resubmit without a clear pending state.

Concrete fix:

Reuse the login/settings form pattern. Keep per-form or per-field error state, render persistent `role="alert"` text inside the dialog/card, wire `aria-invalid` and `aria-describedby` to failing controls, focus the first invalid field or a form-level alert with `tabIndex={-1}`, and reflect pending state on submit buttons through disabled/spinner text.

### DES-C11-02 - Tag autocomplete popovers can be clipped inside the admin image table scroller

Severity: Medium
Confidence: Medium
Validation: Likely by source topology; manual validation requires authenticated admin image-management access.

Evidence:

- The admin image manager wraps the table in a clipping/scrolling overflow container: `apps/web/src/components/image-manager.tsx:427`.
- Each image row renders `TagInput` inside the table cell: `apps/web/src/components/image-manager.tsx:501` and `apps/web/src/components/image-manager.tsx:503`.
- `TagInput` creates a local positioned container at `apps/web/src/components/tag-input.tsx:184`.
- The suggestion list is an absolutely positioned child of that local container: `apps/web/src/components/tag-input.tsx:231` and `apps/web/src/components/tag-input.tsx:232`.
- The list uses `z-50`, but z-index cannot escape clipping from an overflow ancestor: `apps/web/src/components/tag-input.tsx:232`.

Failure scenario:

On a tablet-width admin screen, an admin edits tags in the horizontally scrollable image table. Typing into a row near the scrollport edge opens the suggestion list below the row, but the overflow ancestor can clip lower suggestions. Pointer and touch users then see a partial list or need awkward table scrolling before they can select an option.

Concrete fix:

Render tag suggestions through a portal/popover layer that escapes overflow containers, or convert `TagInput` to the same Radix Popover/Command-style surface used elsewhere. Add a regression that mounts `TagInput` inside an `overflow-x-auto` table wrapper and asserts the list remains visible and selectable.

## Verified Non-Findings

- Information architecture: public production pages expose skip link, nav, main, footer, topic/tag navigation, search/theme/locale controls, photo links, and recovery links. Source anchors include `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/layout.tsx`, `apps/web/src/components/nav-client.tsx`, and `apps/web/src/components/footer.tsx`.
- Affordances and keyboard navigation: search uses dialog semantics, focus management, Escape close, combobox/listbox semantics, and focus restoration in `apps/web/src/components/search.tsx`; live browser interaction confirmed open/focus/Escape behavior. Photo viewer and lightbox source expose keyboard handlers, modal structure, live status, and 44 px controls in `apps/web/src/components/photo-viewer.tsx` and `apps/web/src/components/lightbox.tsx`.
- WCAG 2.2 target size: production public/admin-login DOM checks found no visible sub-44 px controls, and source/tests continue to enforce the 44 px policy through `apps/web/src/__tests__/touch-target-audit.test.ts`.
- Responsive breakpoints: production mobile checks found zero horizontal overflow on public home and Korean admin login. Source shows reserved masonry/photo geometry in `apps/web/src/components/home-client.tsx`, `apps/web/src/components/masonry-card.tsx`, and `apps/web/src/components/grid-picture.tsx`.
- Loading, empty, and error states: source review covered photo loading, load-more, upload progress/skipped files, map loading/empty/list fallback, timeline empty years, public error, and not-found recovery in the relevant route/component files.
- Dark/light mode: production Korean admin login was checked in dark/reduced-motion mode; source centralizes light/dark/OLED, forced-colors, HDR/P3, and reduced-motion behavior in `apps/web/src/app/globals.css`.
- i18n: production Korean admin login rendered Korean labels and `lang="ko"`; source/tests cover locale routing and key parity in `apps/web/src/__tests__/i18n-key-parity.test.ts`.
- Perceived performance: source review confirmed image aspect-ratio reservation, responsive sources, eager/high-priority handling for above-fold media, content-visibility/intrinsic-size on masonry cards, and debounced/RAF resize work in the public gallery components.

## Prior Items Rechecked

- Cycle-9 `DES-C9-01` remains current as `DES-C11-01`.
- Cycle-9 `DES-C9-02` remains current as `DES-C11-02`.
- The compact accessibility snapshot still omitted the mobile search trigger, but direct DOM metrics confirmed a visible 44 x 44 button labelled `Search photos`; this is a tool snapshot limitation, not a product finding.
- Prior analytics table-header, public search target-size, year-page back-link accessible-name, and password confirmation summary concerns were rechecked as non-findings by source or current browser evidence.

## Final Sweep

Missed-issue sweep covered landmarks, heading order, skip links, target size, focus-visible coverage, modal focus traps, focus restoration, combobox/listbox active descendant behavior, keyboard/escape paths, mobile nav, horizontal overflow, forms, toasts versus inline errors, loading/empty/error states, dark/light mode, forced-colors/reduced-motion hooks, i18n key parity, image CLS reservation, admin tables, upload progress, tag controls, map/timeline fallbacks, and public console/page errors.

No new actionable UI/UX defects were found beyond the two current findings above. Authenticated protected admin pages were reviewed through source and tests rather than live browser interaction because no admin auth state was available and the task prohibited local long-lived DB/container setup.
