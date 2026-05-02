# Cycle 1 Designer UI/UX Review

Date: 2026-05-02
Reviewer: designer cycle 1
Scope: Next.js UI in `apps/web`.

## Method and live-browser coverage

- Inventory first: used `omx explore` to collect UI-relevant files, then inspected the Next App Router surfaces under `apps/web/src/app`, shared components under `apps/web/src/components`, design primitives, locale messages, UI tests, and relevant config. No legacy `pages/` tree is present.
- Live interaction: started the local web app on `http://127.0.0.1:3100` and used `agent-browser` CLI for viewport/media, accessibility snapshots, DOM metrics, computed styles, focus, and native validation. The local DB/env was unavailable, so public gallery routes exercised the route error boundary; the admin login route rendered and was interactable.
- Live evidence from `agent-browser`:
  - `/en/admin`, 390×844, dark + reduced motion snapshot exposed: skip link, `main`, `h1 Admin`, username textbox, password visibility button, and sign-in button.
  - Empty admin submit focused `#login-username`; native validity message was `Please fill out this field.` for required username/password.
  - `/en` rendered the route error boundary with no `nav` and no `footer`; DOM metrics were `title: ""`, `nav: 0`, `footer: 0`, `CLS: 0`.
  - Computed contrast on admin login passed AA in both themes: light body 19.90:1, muted text 6.04:1, primary button 16.97:1; dark body 19.06:1, muted text 7.76:1, primary button 16.97:1.

## Positive findings

- Public layout normally has a skip link, `Nav`, focusable `main`, and `Footer` (`apps/web/src/app/[locale]/(public)/layout.tsx`; mirrored by `not-found.tsx` at lines 19-52).
- Theme tokens have strong default contrast, including documented muted foreground contrast fixes (`apps/web/src/app/[locale]/globals.css:14-64`).
- Reduced-motion users are broadly protected by a global clamp (`apps/web/src/app/[locale]/globals.css:160-168`) and local motion checks in the photo viewer/lightbox (`apps/web/src/components/photo-viewer.tsx:440-446`, `apps/web/src/components/lightbox.tsx:55-67,260-262`).
- Gallery performance basics are strong: self-hosted font with `font-display: swap` (`globals.css:5-10`), real image dimensions/aspect ratios and priority budgeting (`home-client.tsx:16-53,188-246`), `content-visibility: auto` on masonry cards (`globals.css:154-158`), and `containIntrinsicSize` per card (`home-client.tsx:192-201`).
- Critical focus-trap surfaces are present and tested: search dialog uses `FocusTrap` and `aria-modal` (`search.tsx:174-188`), lightbox traps/restores focus (`lightbox.tsx:264-285`), and e2e coverage asserts search focus trap/restore (`apps/web/e2e/public.spec.ts:21-40`).

## Findings

### D1 — Medium — confirmed — Route error boundary strands users outside the public IA

- Evidence:
  - `apps/web/src/app/[locale]/error.tsx:16-37` renders a standalone `main` with only Try again and Return to Gallery.
  - `apps/web/src/app/[locale]/not-found.tsx:19-52` shows the expected public recovery shell: skip link, `Nav`, `main`, and `Footer`.
  - Live `/en` with the unavailable DB rendered no `nav`, no `footer`, empty document title, and only two actions.
- User failure scenario: a visitor hits a transient gallery/metadata failure, keyboard-tabs to only Try again and Return to Gallery, and has no search, topic navigation, locale switch, theme switch, footer wayfinding, or useful tab title. Return to Gallery also targets the same route that may be failing.
- Suggested fix: make `error.tsx` reuse the public shell pattern from `not-found.tsx`; include skip link, `Nav`, localized `main`, `Footer`, a meaningful title update for client error boundaries, and a recovery action that is not only the failing home route.
- Confidence: High.

### D2 — Medium — likely/risk — Admin touch targets are explicitly below the 44 px floor on many primary actions

- Evidence:
  - The shared button primitive defaults to 32-40 px for `sm`, `icon`, `icon-sm`, and `icon-lg` (`apps/web/src/components/ui/button.tsx:23-29`).
  - Admin nav links are `min-h-10` (40 px), below the common 44 px touch target floor (`apps/web/src/components/admin-nav.tsx:26-44`).
  - Admin logout uses `size="sm"` (`apps/web/src/components/admin-header.tsx:20-25`).
  - Topic/tag/admin-user rows use `size="icon"` or `size="sm"` for back, edit, delete, and add controls (`apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:156-166,220-225`; `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:88-113`; `apps/web/src/components/admin-user-manager.tsx:91-96`).
  - The touch-target audit documents these as known admin exemptions, not compliant controls (`apps/web/src/__tests__/touch-target-audit.test.ts:120-190`).
- User failure scenario: an admin using a phone, tablet, or touch laptop attempts to edit/delete rows and misses a compact icon, potentially triggering an adjacent destructive action or abandoning the task.
- Suggested fix: adopt an admin hit-area policy: `min-h-11 min-w-11` for icon/destructive/table actions and at least 44 px tall nav/logout/add buttons. Retire the test exemptions when admin is mobile-supported.
- Confidence: High from source and tests; not live-authenticated because the DB was unavailable.

### D3 — Medium — likely — Comboboxes reference listboxes that often do not exist

- Evidence:
  - Search input always sets `aria-controls="search-results"` (`apps/web/src/components/search.tsx:195-203`), but the `#search-results` listbox is only rendered when `results.length > 0` (`search.tsx:246-288`). Empty, hint, no-result, and error states replace it with plain text blocks.
  - Tag input always sets `aria-controls={suggestionsId}` (`apps/web/src/components/tag-input.tsx:183-191`), but the listbox is rendered only while open and populated/creatable (`tag-input.tsx:204-244`).
- User failure scenario: a screen-reader user hears a combobox relationship and attempts arrow navigation, but the controlled element is absent during no-results or closed states. This can produce confusing or silent feedback even though visible text exists elsewhere.
- Suggested fix: either always render a stable `role="listbox"` with the controlled id for empty/no-results states, or remove `aria-controls`/`aria-activedescendant` whenever the listbox is absent. Tie no-result/error copy to the input with `aria-describedby`.
- Confidence: High for source; likely AT impact.

### D4 — Medium — likely — Admin validation is often toast-only or not field-associated

- Evidence:
  - Topic create/update/delete failures use `toast.error` while form fields have no `aria-invalid`, field error, or error summary (`apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:59-94,172-190,259-279`).
  - SEO save failures use only toast, while visible hints are not connected to inputs by `aria-describedby` (`apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:39-68,95-174`).
  - Settings save failures are toast-only; quality hints are visible but not described by the number fields, unlike the image sizes field (`apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:35-68,100-155`).
  - Upload rejected/limit errors are toast-only (`apps/web/src/components/upload-dropzone.tsx:145-176`).
- User failure scenario: a keyboard or screen-reader admin submits a dialog, a toast appears outside the current focus context, then disappears; the admin cannot tell which field failed or how to fix it without re-reading the form manually.
- Suggested fix: return structured field errors from server actions, focus a persistent error summary at submit failure, set `aria-invalid`, and connect every hint/error to the relevant control with `aria-describedby`. Keep toasts as secondary confirmation only.
- Confidence: High.

### D5 — Low — confirmed — Admin login required-field validation is native and not app-localized

- Evidence:
  - Login fields rely on native `required` validation (`apps/web/src/app/[locale]/admin/login-form.tsx:51-80`) and the form does not implement localized client validation.
  - Live empty submit focused `#login-username` with the browser message `Please fill out this field.`
- User failure scenario: in Korean UI or a non-English browser/OS combination, required-field messages may not match the app locale or translation tone, and the app has no inline summary after the bubble closes.
- Suggested fix: if localized admin UX is required, add `noValidate`, localized inline errors, `aria-invalid`, and focus management. If native validation is intentional, document it as an accepted browser-localized behavior.
- Confidence: Medium.

### D6 — Low — likely — Shared group gallery cards lack the public gallery focus affordance

- Evidence:
  - Home gallery cards add `focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2` (`apps/web/src/components/home-client.tsx:192-201`).
  - Shared group cards are image links without an equivalent focus-visible/focus-within ring (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:188-209`).
- User failure scenario: a keyboard user tabs through a shared album and cannot reliably see which photo link will open, especially because the cards are image-dominant.
- Suggested fix: mirror the home card focus treatment on shared group `Link` cards and expose the top mobile title overlay on focus as well as hover.
- Confidence: Medium.

### D7 — Low — risk — RTL is hard-coded out despite i18n architecture

- Evidence:
  - Root layout sets `lang={locale}` but hard-codes `dir="ltr"` (`apps/web/src/app/[locale]/layout.tsx:89-98`).
  - Locale alternates and messages support en/ko today, and current locales are LTR; the risk appears when adding Arabic/Hebrew or another RTL locale.
- User failure scenario: a future RTL locale would keep LTR reading order, left/right nav icons, horizontal masks, and photo navigation semantics, making the gallery feel backwards and confusing.
- Suggested fix: add a `localeToDir()` helper, set `dir` dynamically, and audit left/right affordances in nav, shared gallery, lightbox, and photo navigation with logical CSS properties.
- Confidence: High as future-risk.

### D8 — Low — likely — Loading states are announced, but completion/error states are less consistent

- Evidence:
  - `OptimisticImage` announces loading with `role="status"`, but image failure is visual text only without live semantics (`apps/web/src/components/optimistic-image.tsx:70-78`).
  - Load More uses an `IntersectionObserver` auto-loader and a live region that only says loading, not how many items loaded or whether loading ended (`apps/web/src/components/load-more.tsx:91-124`).
- User failure scenario: a screen-reader user hears “loading” while scrolling, then receives no clear completion count; if an image fails, the unavailable state may not be announced when it replaces the image.
- Suggested fix: add polite status text for image error and load-more completion, e.g. “12 more photos loaded” or “No more photos,” and keep it separate from transient toasts.
- Confidence: Medium.

### D9 — Low — likely — Mobile nav expansion is usable, but the relationship and horizontal overflow affordance are weak

- Evidence:
  - The mobile expand button exposes `aria-expanded` but no `aria-controls` for the topics/controls region (`apps/web/src/components/nav-client.tsx:86-109`).
  - Collapsed topics are horizontally scrollable with hidden scrollbars and a right mask (`nav-client.tsx:102-109`; `globals.css:148-151`). Secondary controls are hidden until expansion (`nav-client.tsx:141-161`).
- User failure scenario: a screen-reader user cannot associate the expand button with the controlled nav content, and a sighted touch user may not discover that the masked collapsed topics can scroll horizontally.
- Suggested fix: add a stable id to the expandable nav content and `aria-controls` on the toggle; consider a visible “more topics” affordance or snapping/gradient treatment that does not rely only on hidden scrollbars.
- Confidence: Medium.

### D10 — Low — confirmed/risk — Public LCP/error reliability depends on DB-backed layout and metadata reads

- Evidence:
  - Root metadata and root layout both await `getSeoSettings()` before rendering (`apps/web/src/app/[locale]/layout.tsx:16-18,82-85`).
  - Home metadata/page rendering also awaits SEO/config/tags/topics/images before the client gallery renders (`apps/web/src/app/[locale]/(public)/page.tsx:18-35,123-140`), and topic pages do the same for SEO/config/tags/topics/images (`apps/web/src/app/[locale]/(public)/[topic]/page.tsx:156-201`).
  - Live DB outage produced the stripped error boundary with empty title. CLS on that error surface was 0, but LCP/INP for the real gallery could not be measured without data.
- User failure scenario: slow or unavailable DB reads delay first content, cause blank/late metadata, or route users into the D1 error state instead of a resilient public shell.
- Suggested fix: provide cached/static SEO fallbacks in layout/metadata, isolate non-critical SEO from first paint where possible, and capture web-vitals for LCP/CLS/INP in seeded e2e or production telemetry. Keep aspect-ratio/priority work already present.
- Confidence: Medium.

## Category checklist

- Information architecture: generally strong public shell, but D1 is a confirmed IA failure on route errors.
- Affordances: primary public controls are clear; D6 and D9 note weaker focus/overflow affordances in shared group and mobile nav; D2 notes compact admin action affordances.
- Focus and keyboard: search/lightbox/bottom sheet have focus-trap implementations (`search.tsx:174-188`, `lightbox.tsx:264-285`, `info-bottom-sheet.tsx:155-167`); live admin tab/focus was sane. D3 and D6 remain AT/focus concerns.
- WCAG 2.2 accessibility: contrast passes on inspected admin route; reduced motion is broadly covered; D2 is the main touch-target gap; D3/D4 cover ARIA and error association.
- Responsive breakpoints: public nav, masonry, photo viewer, and landscape rules are present (`globals.css:117-146`, `home-client.tsx:188-315`, `photo-viewer.tsx:405-468`). Admin remains desktop-keyboard-primary per tests and should not be considered mobile-ready.
- Loading/empty/error: empty gallery copy exists (`home-client.tsx:285-299`); D1 and D8 cover error/loading announcement gaps.
- Form validation UX: login has labels and password reveal (`login-form.tsx:47-104`), but D4/D5 cover broader validation gaps.
- Dark/light mode: theme provider supports system/light/dark (`layout.tsx:103-115`); live computed contrast passed in both themes.
- i18n/RTL: en/ko message parity checked; D7 is future RTL risk.
- Perceived performance: good image sizing, `content-visibility`, font swap, and reduced CLS primitives; D10 is the remaining DB/LCP reliability risk.

## Final missed-issues sweep and skipped files

- Re-ran source sweeps for UI selectors (`aria-*`, focus traps, touch target classes, reduced motion, loading/error states, and form validation) and re-ran live `agent-browser` snapshots/DOM metrics before writing this report.
- Examined every file in the UI inventory: app layouts/pages/error/loading/not-found, admin clients, public components, UI primitives, messages, config, and UI/e2e tests.
- Skipped as non-inspectable UI code: binary e2e image fixtures (`apps/web/e2e/fixtures/*.jpg`), generated/build artifacts (`.next`, coverage, node_modules), and uploaded runtime assets. Server-only actions/API files were reviewed only where they surface UI states, validation, or navigation.

## Severity counts

- Critical: 0
- High: 0
- Medium: 4
- Low: 6
