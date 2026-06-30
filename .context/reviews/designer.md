# Cycle 23 Designer / UI-UX Deep Review

Date: 2026-06-30
Role: designer / UI-UX reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Scope constraint: review artifact only; source changes were limited to this file.

## Method

Read first: `AGENTS.md`, full `CLAUDE.md`, and the local agent-browser skill docs for core navigation, query/snapshot, interaction, wait, debug, config, visual, and network/storage.

Inventory covered:

- Public routes/components: `apps/web/src/app/[locale]/(public)/**`, `components/nav-client.tsx`, `home-client.tsx`, `search.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `photo-navigation.tsx`, `color-details-section.tsx`, `map/**`.
- Admin routes/components: `apps/web/src/app/[locale]/admin/**`, `admin-header.tsx`, `admin-nav.tsx`, `upload-dropzone.tsx`, `image-manager.tsx`, `admin-user-manager.tsx`, `bulk-edit-dialog.tsx`.
- Design system/styling: `globals.css`, `components/ui/**`, theme provider, Tailwind-style class usage in TSX.
- i18n/assets/tests/docs: `apps/web/messages/{en,ko}.json`, `public/fonts`, `public/icons`, `public/resources`, `public/uploads`, `apps/web/e2e/**`, `apps/web/src/__tests__/**`, `.context/reviews/**`, `.context/plans/**`.

Browser-backed review:

- Existing `:3000` was another app, so I started GalleryKit on `http://localhost:3001` with `npm --workspace=apps/web run dev -- -p 3001`.
- DB-backed routes were blocked by local MySQL/schema state. `/en` and `/en/map` rendered route errors with console query failures. I used browser evidence for static/auth/error surfaces and source/e2e evidence for DB-backed gallery/photo/admin screens.
- Confirmed `/en/privacy` public shell and `/en/admin` login with agent-browser accessibility snapshots, DOM boxes, styles, validation state, and page errors/console.
- Confirmed i18n key parity with a JSON key-count script: `en=826`, `ko=826`, no missing keys.

## Findings

### 1. Error pages can keep the failed route title instead of announcing an error

Severity: Medium
Confidence: High
Status: Confirmed
Area: error state UX, screen-reader/browser-tab orientation

Evidence:

- Browser: `http://localhost:3001/en/map` showed heading `Error`, text `Something went wrong loading this page.`, actions `Try again` and `Return to Gallery`, but `document.title` stayed `Map | GalleryKit`.
- Source: `apps/web/src/app/[locale]/error.tsx:16-20` sets the title only when `document.title.trim()` is empty.
- Source: `apps/web/src/app/[locale]/(public)/map/page.tsx:12-24` sets normal map metadata, so the error boundary inherits a non-error title.

Failure scenario:

A visitor lands on a broken DB-backed page. The visual content says "Error", but browser history, tabs, and assistive tech title context still identify the failed page as "Map" or another route. That makes recovery and support reporting more confusing.

Concrete fix:

Set the localized error title unconditionally in the route error boundary, e.g. `${t('error.title')} | ${siteTitle}`, or use Next metadata if available for error boundaries. Add a regression test that forces a route error and asserts both visible heading and `document.title`.

### 2. The public error boundary drops the normal public shell

Severity: Medium
Confidence: High
Status: Confirmed
Area: information architecture, error recovery, responsive navigation

Evidence:

- Browser: `/en/map` error snapshot exposed only `nav "Site navigation"` with a single `Gallery` link, then the error region. No main public nav, search, theme, locale switch, footer, privacy link, GitHub link, or admin link.
- Source: `apps/web/src/app/[locale]/error.tsx:22-61` renders a standalone `<main>` and local one-link `<nav>`.
- Contrast: `apps/web/src/app/[locale]/not-found.tsx:7-11` documents that a stripped dead-end page was a previous UX problem, then renders `Nav` at `:20` and `Footer` at `:47`.

Failure scenario:

During a DB outage or route-level exception, users lose the same recovery tools that still work on static routes: search, language switching, theme control, footer/admin/privacy links, and topic navigation when available. On a failing home-like route, `Return to Gallery` can also loop back into another failing DB route.

Concrete fix:

Mirror the not-found shell for recoverable localized route errors: render the normal `Nav`, keep the `main-content` target, and include `Footer`. If avoiding `Nav` because it could be part of the failure, add a stable fallback shell with locale/theme/admin/privacy links and a clear "current page failed" title.

### 3. Lightbox controls can remain invisible but pointer-active after auto-hide

Severity: Medium
Confidence: Medium
Status: Likely source risk; needs manual/browser validation with seeded photos
Area: affordances, focus/keyboard parity, pointer interaction

Evidence:

- Source: `apps/web/src/components/lightbox.tsx:369-371` makes hidden controls `tabIndex=-1` and `aria-hidden=true`, but does not disable pointer events.
- Source: `apps/web/src/components/lightbox.tsx:543-550` hides the controls overlay by setting opacity to `0`.
- Source: individual hidden controls keep `pointer-events-auto`, e.g. close/fullscreen/slideshow at `apps/web/src/components/lightbox.tsx:552-600` and prev/next at `:620-643`.

Failure scenario:

After the auto-hide timer fires, the controls become transparent and unavailable to keyboard/AT, but the top-right and edge hit zones can still intercept clicks. A user trying to click the image/backdrop may accidentally close the lightbox, toggle fullscreen, or navigate photos through invisible controls.

Concrete fix:

When `controlsVisible` is false, also apply `pointer-events-none` to each control or to a stateful wrapper that children cannot override. Add a seeded e2e check: open lightbox, wait for auto-hide, click top-right/edge coordinates, assert no hidden control action fires until mouse/focus reveals controls again.

### 4. Mobile nav shows an expand button even when there are no hidden topics

Severity: Low
Confidence: High
Status: Confirmed on DB-fallback static page
Area: mobile affordance, empty state

Evidence:

- Browser: `/en/privacy` at `390x844` exposed `button "Expand menu"` with `aria-expanded=false`, while the topics container had no topic links because topic loading fell back to `[]`.
- Source: `apps/web/src/components/nav-client.tsx:99-107` renders the expand/collapse button unconditionally.
- Source: `apps/web/src/components/nav-client.tsx:117-153` maps `topics`, but there is no empty-topic guard.
- Source: `apps/web/src/components/nav-client.tsx:155-179` keeps search/theme/locale visible in the collapsed mobile bar, so the expander may reveal no new actionable content.

Failure scenario:

Fresh installs, DB outages, or galleries with zero public topics show a menu affordance that appears to promise hidden navigation but only changes layout or reveals already-visible controls. This is minor, but it erodes trust in the mobile nav.

Concrete fix:

Render the expand button only when `topics.length > 0` or when the collapsed state truly hides controls at the active breakpoint. If it remains, change the label and controlled region so it accurately describes what will appear.

### 5. Login required-field validation is not localized or persistent

Severity: Low
Confidence: High
Status: Confirmed
Area: form validation UX, i18n, WCAG error identification

Evidence:

- Browser: submitting empty `/ko/admin` focused `username`, exposed invalid controls, and browser validation messages were English: `Please fill out this field.` No visible `role=alert` or inline Korean error appeared.
- Source: `apps/web/src/app/[locale]/admin/login-form.tsx:43-52` and `:63-72` rely on native `required` inputs with no `aria-invalid`, `aria-describedby`, or localized inline required-field message.
- Source: server-action errors do have an alert at `apps/web/src/app/[locale]/admin/login-form.tsx:89-93`, so this gap is limited to client-side required-field validation.

Failure scenario:

Korean admins or assistive-tech users who submit an empty login form get ephemeral browser chrome in the browser language instead of persistent in-page Korean feedback tied to the fields. The message disappears after focus changes and is harder to review.

Concrete fix:

Intercept submit, validate empty username/password in component state, set `aria-invalid`, attach `aria-describedby` to persistent localized messages, and move focus to the first invalid field. Keep native constraints as a fallback.

## Verified Strengths / Non-Findings

- Public static shell: `/en/privacy` snapshot exposed `Main navigation`, `Search photos`, theme, locale switch, semantic `main`, footer links, and no page errors.
- Touch targets: browser boxes for public nav controls and admin login controls were 44px or larger.
- Search dialog: source includes focus return, body scroll lock, dialog role, combobox/listbox pattern, and polite live status (`apps/web/src/components/search.tsx:313-324`, `:370-449`). Browser confirmed dialog focus entered `#search-input` and body overflow locked.
- Photo viewer/lightbox: source includes single H1 strategy, shortcut descriptions, focus traps, reduced-motion handling, status regions, and 44px controls (`photo-viewer.tsx:525-704`, `lightbox.tsx:431-687`).
- Color/HDR surfaces: source gates admin-only HDR/color metadata and includes forced-colors CSS (`globals.css:145-181`, `color-details-section.tsx:194-204`, `:532-560`).
- i18n/RTL: messages are key-parity clean; `layout.tsx:93-111` sets `lang` and `dir`. Runtime RTL was not exercised because only `en` and `ko` are supported (`lib/constants.ts:1-4`; `lib/locale-path.ts:37-40`).
- Reduced motion: global CSS suppresses animations/transitions and hover scale (`globals.css:253-279`), and lightbox/photo-viewer use reduced-motion hooks.

## Coverage Notes

Confirmed in browser:

- `/en/privacy`, `/en/admin`, `/ko/admin`, `/en/map` error state.
- Accessibility snapshots, DOM boxes/styles, validation state, console/page error checks, mobile viewport `390x844`, desktop viewport `1440x1000`.

Blocked from browser by DB/auth/seed state:

- DB-backed home gallery, topics, smart collections, timeline/year, map results, photo detail, shared photo/group, protected admin dashboard/settings/tokens/upload flows.
- These were source-reviewed and cross-checked against e2e/source-contract tests where relevant.

Skipped:

- Generated `.next`, `node_modules`, uploaded media binaries, static image pixel review, and non-UI backend scripts unless they affected UI state.
- Full Playwright suite was not run because the local DB/admin seed was unavailable; e2e files were read for coverage expectations.

Final missed-issues sweep:

- Re-ran targeted `rg` sweeps for `error`, `lightbox`, `search`, `login`, `nav`, `theme`, `reduced`, `motion`, `touch`, `rtl`, `i18n`, `aria`, and `focus` across source tests and e2e.
- Rechecked working tree before writing: existing unrelated review files were already modified; this review only changed `.context/reviews/designer.md`.
