# Designer Review - Cycle 14

Role: cycle-14 designer reviewer for GalleryKit. Scope is current HEAD only: `d821a9ab`.

I read `AGENTS.md` and `CLAUDE.md` first, then built a UI/UX inventory before inspecting implementation details. No production code was changed.

## Inventory

Inventory command used before inspection:

```sh
git ls-tree -r --name-only HEAD apps/web/src/app apps/web/src/components apps/web/messages apps/web/src/i18n apps/web/e2e | rg '\.(tsx|css|json|ts)$' | sort
```

The resulting inventory had 143 UI-adjacent files, covering:

- Public App Router pages and shells: home, topic pages, photo detail/loading, shared links/groups/collections, map, timeline, year archive, privacy, not-found, error, loading, root layout, metadata/icon/manifest routes.
- Admin App Router pages and client surfaces: login, protected layout, dashboard, upload/image manager, categories, tags, settings, SEO, password, users, tokens, DB, analytics, admin error/loading.
- Shared UI: nav, footer, search, home masonry, photo viewer, lightbox, image zoom, info bottom sheet, map client, color/histogram/details, upload dropzone, tag input, admin header/nav/user manager, Radix/shadcn primitives.
- Localization and tests: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, i18n request setup, and Playwright e2e specs.

I did not intentionally skip any files from that inventory. Source review used full-inventory sweeps for ARIA, focus, sizing, motion, tables, dialogs, loading/error states, and i18n, plus targeted reads of the affected regions.

## Browser Evidence

I used the agent-browser workflow against a local Next dev server.

- Dev server: `npm run dev --workspace=apps/web`, served on `http://localhost:3001` because `3000` was already occupied.
- Tested URLs: `http://localhost:3001/en`, `/en/privacy`, `/en/admin`.
- Viewports/media: desktop `1440x900`, mobile `390x844`, light mode.
- Screenshots captured: `/tmp/gallery-home-error-desktop.png`, `/tmp/gallery-home-error-mobile.png`.
- Accessibility snapshot on `/en`: skip link, `main`, region named `Error`, heading `Error`, paragraph `Something went wrong loading this page.`, button `Try again`, link `Return to Gallery`, and notifications region.
- Runtime blocker: all exercised routes entered the app error boundary because the local database was unavailable. Browser and server logs showed `connect ECONNREFUSED 127.0.0.1:3306` for DB-backed queries and image queue bootstrap.

Validation command:

```sh
npm test --workspace=apps/web -- touch-target-audit i18n
```

Result: 4 test files passed, 58 tests passed.

## Confirmed Issues

### DES-C14-01 - Search dialog input overrides the 44 px touch-target floor

Severity: Medium  
Confidence: High  
Classification: confirmed issue

Evidence:

- `apps/web/src/components/search.tsx:372-402` renders the search dialog combobox with the shared `Input` primitive, but passes `className="border-0 p-0 h-8 ..."` on line 402.
- `apps/web/src/components/ui/input.tsx:10-14` gives the primitive `min-h-11`, but the later `h-8` class wins in Tailwind merging and makes the primary text field 32 px tall.
- The same dialog is the primary search UI opened from mobile nav, with `role="dialog"` and `aria-modal="true"` at `apps/web/src/components/search.tsx:360-364`.

Failure scenario:

On mobile, the search UI is full-screen and the query input is the main control. A 32 px-tall text field is easier to miss for users with motor impairments and violates the repository's 44 px touch-target policy. It also weakens the visual affordance of the most important control in the dialog.

Concrete fix:

Remove the `h-8` override and keep the primitive's `min-h-11`, or set the row/input to an explicit `h-11 min-h-11` while preserving the compact borderless visual. Add this specific selector to the touch-target audit so raw class overrides on primitives are caught.

### DES-C14-02 - Mobile nav expander controls two regions but exposes only one

Severity: Low  
Confidence: High  
Classification: confirmed issue

Evidence:

- The mobile expand button at `apps/web/src/components/nav-client.tsx:99-107` exposes `aria-expanded={isExpanded}` and `aria-controls="primary-nav-controls"`.
- The same state also changes the topic link region at `apps/web/src/components/nav-client.tsx:117-123`, which has `id="primary-nav-topics"`.
- The controls region referenced by ARIA is `id="primary-nav-controls"` at `apps/web/src/components/nav-client.tsx:156-160`.

Failure scenario:

A screen-reader user toggles the mobile nav and is told only that `primary-nav-controls` changed. The topic links also visually change from horizontal scrolling/collapsed behavior into a wrapped expanded region, but that relationship is not programmatically exposed from the button.

Concrete fix:

Either set `aria-controls="primary-nav-topics primary-nav-controls"` on the button, or wrap both mobile-controlled areas in one container with a single stable id and point `aria-controls` to that container.

## Likely Issues

### DES-C14-03 - Root layout hard-codes LTR despite i18n comments promising RTL readiness

Severity: Low  
Confidence: High  
Classification: likely issue, currently latent

Evidence:

- `apps/web/src/app/[locale]/layout.tsx:94-100` renders `<html lang={locale} dir="ltr">`.
- The nearby comment at `apps/web/src/app/[locale]/layout.tsx:96-98` says the explicit direction future-proofs for RTL locales, while also noting only LTR locales are shipped today.
- Current message files are English and Korean, so the shipped locale set is LTR.

Failure scenario:

If an RTL locale such as Arabic or Hebrew is added, the page will still render and expose document direction as LTR. Reading order, punctuation flow, horizontal overflow assumptions, nav order, and directional icons can be wrong before any component-level translation work has a chance to correct them.

Concrete fix:

Derive `dir` from the locale, for example `rtlLocales.has(locale) ? "rtl" : "ltr"`, and add one layout/i18n test that asserts the document direction for any future RTL locale. If RTL is intentionally out of scope, update the comment so it does not imply readiness.

### DES-C14-04 - Some admin form dialogs provide no dialog description

Severity: Low  
Confidence: Medium  
Classification: likely issue

Evidence:

- Create category dialog: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:189-193` has `DialogContent`, `DialogHeader`, and `DialogTitle`, then starts the form with no `DialogDescription`.
- Edit category dialog: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:295-301` has the same title-only dialog pattern.
- Edit tag dialog: `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:165-171` also opens a form dialog with title only.
- Other dialog primitives in this repo support descriptions through `DialogDescription`, so this is a consistency gap rather than a missing primitive capability.

Failure scenario:

Screen-reader users entering these admin modals hear the title and then field labels, but no concise task context, consequence, or expected save behavior. This matters most in edit flows where the modal changes existing taxonomy visible on the public site.

Concrete fix:

Add localized `DialogDescription` text to these form dialogs, or explicitly set `aria-describedby={undefined}` on `DialogContent` if the team decides the title plus field labels are sufficient. Prefer descriptions for edit/create forms that mutate site structure.

## Validation Gap / Manual Follow-up

### DES-C14-R1 - Data-backed UI flows could not be browser-tested locally

Severity: Medium  
Confidence: High  
Classification: risk needing manual validation

Evidence:

- Browser-tested `/en`, `/en/privacy`, and `/en/admin` all reached the app error boundary instead of the intended page flows.
- Agent-browser accessibility snapshot for `/en` exposed only the error shell controls: skip link, error heading, retry button, return link, and notifications region.
- Browser/server logs showed failed MySQL connections: `connect ECONNREFUSED 127.0.0.1:3306`.
- Dev server also logged image queue bootstrap retries due the same database connection refusal.

Failure scenario:

Runtime-only UI defects in the real gallery, search results, lightbox/photo viewer, map, and authenticated admin forms could remain undetected by this cycle because the browser could not reach the data-backed states. Source review and unit tests reduce that risk but do not replace full interaction testing.

Concrete fix:

Run the same browser pass with a seeded local database, then cover at least:

- Public home with real masonry images at desktop and mobile.
- Search open, type, keyboard result navigation, empty state, and error state.
- Photo detail/lightbox next/previous, zoom, metadata sheet, and focus return.
- Admin login and at least one create/edit/delete form flow in categories/tags/images.
- Dark/light/OLED theme switch and reduced-motion media mode.
- `npm run test:e2e --workspace=apps/web` once the DB/browser fixture is available.

## Areas Reviewed With No New Confirmed Finding

- Information architecture: public routes, admin hierarchy, nav, footer, privacy/error/not-found/loading shells, and topic/photo/shared-link surfaces were inventoried and source-reviewed.
- Affordances and design-system consistency: shared `Button`, `Input`, `Select`, `Switch`, `Dialog`, `Sheet`, `AlertDialog`, `Table`, and admin/public component patterns were reviewed. The search input override above is the only confirmed target-size regression found in this pass.
- Focus and keyboard navigation: skip link, mobile nav controls, search dialog, lightbox, bottom sheet, upload/tag flows, and admin forms were reviewed from source; browser could only validate the error shell because of the DB blocker.
- WCAG 2.2 accessibility: reviewed target size, labels, landmarks, ARIA dialog/listbox/combobox patterns, focus traps, live regions, hidden text, and disabled states. Existing touch-target and i18n tests passed.
- Contrast and theme: token usage and dark/light/OLED-related sources were inspected. No new contrast finding was confirmed in this cycle because data-backed rendered pages were unavailable for computed-style sampling.
- Reduced motion: `apps/web/src/app/[locale]/globals.css:253-279`, `apps/web/src/components/lightbox.tsx:92-109`, `apps/web/src/components/image-zoom.tsx:45-52`, and `apps/web/src/components/photo-viewer.tsx:704-719` include reduced-motion handling.
- Responsive breakpoints: nav, masonry cards, public shells, admin cards/tables, dialogs, sheets, and photo viewer layouts were reviewed. `apps/web/src/components/ui/table.tsx:7-18` wraps tables in horizontal overflow, and analytics adds explicit overflow wrappers.
- Loading, empty, and error states: route loading spinners, home/topic empty states, search empty/error/loading status, upload progress, admin loading/error shells, and global/local error pages were reviewed.
- Form validation UX: labels, required fields, max lengths, server-action status messages, alerts, password reveal, upload file removal, and tag/category/user forms were reviewed. The description gap is captured above.
- i18n/RTL: English/Korean message files and locale-aware layouts/links were reviewed. Current locales are LTR; the latent hard-coded direction risk is captured above.
- Perceived performance: masonry aspect-ratio reservation, `containIntrinsicSize`, eager/high-priority above-fold images, blur placeholders, skeleton/loading shells, and table overflow were reviewed. Full LCP/CLS/INP measurement was blocked by the local DB failure.

## Final Missed-Issues Sweep

I ran a final source sweep across the inventory for `aria-controls`, hard-coded `h-8` controls, `dir="ltr"`, dialog content, reduced-motion handling, dialog modality, and table overflow. No additional confirmed UI/UX issues were found beyond the items above.

No relevant files from the built UI/UX inventory were intentionally skipped. The residual risk is runtime behavior hidden behind the unavailable local MySQL dependency.
