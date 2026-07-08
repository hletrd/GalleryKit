# Cycle 23 Designer Review

Role: `designer`
Repo: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `66a2ec6f0797d4c7a3a12bab6d610a2dbae21013`
Scope: review-only. No source behavior, commits, pushes, or deploys.

## Inventory

Rules read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, and the Playwright skill instructions.

UI/UX files inventoried: Next.js app routes under `apps/web/src/app/[locale]`, shared UI components under `apps/web/src/components`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/playwright.config.ts`, `apps/web/e2e/*.spec.ts`, and UI/a11y tests including touch target, focus-visible, i18n parity, search status, and source-contract tests.

Local runtime: started `npm run start --workspace=apps/web -- --hostname 127.0.0.1 --port 3100`. Public pages loaded at `http://127.0.0.1:3100/en`. Protected admin login with the E2E plaintext password returned `Authentication failed. Please try again.`, so protected-admin runtime beyond login is source-confirmed/manual-validation in this lane.

Browser evidence collected with Playwright: DOM text, role/name/state, active element, `inert`/`aria-hidden`, computed styles, selector attributes, and bounding boxes at 390x844 mobile and 1440x900 desktop/dark.

## Findings

### DES-C23-01 - Search dialog opens while the focused combobox reports `aria-expanded="false"`

Severity: Medium
Confidence: High
Status: confirmed live accessibility defect
Validation: browser-confirmed at `http://127.0.0.1:3100/en`

Evidence:

- `apps/web/src/components/search.tsx:434-439` renders the open search surface as `role="dialog"` with `aria-modal="true"` and label `Search photos`.
- `apps/web/src/components/search.tsx:447-456` renders the focused input as `role="combobox"` and sets `aria-expanded={hasDisplayedResults}`, not the visible dialog/listbox state.
- Live desktop probe after clicking `Search photos`: active element was `INPUT role="combobox"` with placeholder `Search photos, tags, cameras...`; the dialog had `role="dialog"`, `aria-modal="true"`, `aria-label="Search photos"`, and box `1440x310`; outside body children were `inert=true` and `aria-hidden="true"`.
- The same live input exposed `aria-expanded="false"` and no `aria-controls` while the modal search UI was open and focused.
- This matches the older deferred item `.context/plans/cycle-13-plan.md:94`, but it is absent from the current Cycle 22 deferred register and carry-forward register checked in this lane.

Failure scenario:

A screen-reader user opens search and lands in a combobox that says it is collapsed while a modal search popup is visibly active. The dialog exists, but the active control's state contradicts the visible interaction model until results appear.

Suggested fix:

Use separate state for the combobox popup/listbox. If the input's popup is the dialog, bind `aria-expanded` to `isOpen`; if the combobox popup is only the result list, keep `aria-expanded` tied to listbox visibility but avoid presenting the modal dialog itself as the combobox popup. Add an accessibility test for the open-empty state.

### DES-C23-02 - Admin image management remains table-first on narrow screens

Severity: Medium
Confidence: High
Status: source-confirmed carry-forward
Validation: source-confirmed; protected-admin runtime manual-validation because login failed in this lane

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144` places Recent Uploads in a constrained scroll area: `max-h-[calc(100vh-16rem)] overflow-auto`.
- `apps/web/src/components/image-manager.tsx:427-450` renders a 9-column table inside `overflow-x-auto`.
- `apps/web/src/components/image-manager.tsx:472-488` uses a fixed `h-32 w-32` preview cell, `image-manager.tsx:500-552` gives tags a `min-w-[200px]` cell, and `image-manager.tsx:571-607` puts edit/delete actions at the far right.
- The same issue is recorded as Cycle 22 deferred `AGG-C22-22` in `.context/plans/cycle-22-2026-07-08-deferred.md`.

Failure scenario:

On tablet or narrow laptop, an admin reviewing similar photos must connect thumbnail, title, filename, tags, gamut, date, and actions across horizontal and nested vertical scrolling. Row context is easy to lose before reaching the destructive action cell.

Suggested fix:

Keep the table for wide desktop density, but add a responsive card/list workbench below large desktop widths. Group thumbnail, status, title/filename/topic, tags, and actions in one visual cluster per image.

### DES-C23-03 - Admin navigation is still one flat strip of unrelated workflows

Severity: Low-Medium
Confidence: High
Status: source-confirmed carry-forward
Validation: source-confirmed; protected-admin runtime manual-validation

Evidence:

- `apps/web/src/components/admin-nav.tsx:15-26` defines ten peer links: Dashboard, Categories, Tags, SEO, Settings, Tokens, Password, Users, Database, and Analytics.
- `apps/web/src/components/admin-nav.tsx:28-49` renders them as one wrapping flex nav.
- `apps/web/src/components/admin-header.tsx:13-26` places the brand, all nav links, and logout in one wrapping header row.
- Touch target and `aria-current` treatment are good; the issue is IA and affordance hierarchy. This is also deferred as Cycle 22 `AGG-C22-23`.

Failure scenario:

Routine publishing tasks and high-risk operational pages such as tokens, users, password, and database restore are visually equal peers. On narrow widths, wrapping can mix daily content management with sensitive operations.

Suggested fix:

Group admin IA into stable sections such as Publish, Organize, Site, Access, Operations, and Insights. On mobile/tablet, use a sectioned drawer or menu while preserving current focus rings, `aria-current`, and 44 px targets.

### DES-C23-04 - Mobile masonry cards still permanently overlay metadata on finished photos

Severity: Low
Confidence: High
Status: confirmed live presentation issue
Validation: browser-confirmed at 390x844; already deferred as Cycle 22 `AGG-C22-24`

Evidence:

- `apps/web/src/components/masonry-card.tsx:149-154` always renders the mobile title/topic overlay as `absolute inset-x-0 top-0 sm:hidden bg-gradient-to-b from-black/75 to-transparent p-3`.
- Live mobile probe on `/en`: first card box was `358x556.875`; overlay was `358x60`, `display: block`, `position: absolute`, and `backgroundImage: linear-gradient(rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0))`.
- Second card repeated the same `358x60` permanent top overlay over a `358x201.375` landscape card.

Failure scenario:

For a finished-photo gallery, important crop detail near the top of a phone image can be covered before the visitor chooses to open the photo. The permanent chrome competes with the photographer's framing.

Suggested fix:

Move mobile metadata below the image, reserve a compact caption band, or add a clean-grid option where metadata appears on focus/open instead of over the bitmap.

## Current Non-Issues Checked

- Mobile public nav controls met 44 px boxes in the live probe: search, theme, locale, and expand menu were all `44x44`.
- Search dialog focus and modal isolation worked: focus moved to the combobox, the dialog was named, and outside body children were inert/`aria-hidden`.
- Login required-field feedback worked live: empty submit focused `#login-username`; username and password fields were `44` px high, `aria-invalid="true"`, and pointed to visible `role="alert"` messages.
- Dark mode privacy page rendered with `html.dark`, body background `rgb(9, 9, 11)`, foreground `rgb(250, 250, 250)`, and muted text `rgb(161, 161, 170)`.
- Cycle 23 source fixes for the empty mobile nav expander, hidden lightbox pointer-events, upload single-column mobile staging, skipped-file reasons, and reduced-motion swipe/transition behavior are present in source.

## Coverage Notes

Covered IA, affordances, focus/keyboard, WCAG 2.2 name/role/value, contrast tokens, ARIA, focus/modal isolation, loading/empty/error states, forms, dark/light, English/Korean i18n posture, RTL posture, responsive layout, and perceived-performance source patterns.

Manual-validation gaps: protected admin runtime beyond the login page, destructive admin actions, true RTL because no RTL locale is shipped, real screen-reader output, production CDN/service-worker/offline behavior, physical P3/HDR display behavior, and high-volume performance traces.

## Final Missed-Issue Sweep

Swept current UI source/messages/tests/reviews for `aria-`, `role`, `tabIndex`, focus, loading, empty, error, validation, reduced motion, dark mode, RTL/dir, touch targets, admin nav, image manager, search, lightbox, upload, masonry, map, semantic search, and public route recovery. No additional confirmed designer findings were found.
