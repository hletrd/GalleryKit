# Cycle 25 Designer / UI-UX Review

Date: 2026-06-30
Role: cycle-25 designer / UI-UX reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Branch reviewed: `master`
Scope constraint: review artifact only. No source files were modified beyond this report. No commit or push was made.

## File Inventory

I first read `AGENTS.md` and `CLAUDE.md`, then used the installed `agent-browser` CLI skill docs for navigation, viewport config, wait, query/snapshot, visual capture, interaction, and debug/console inspection.

Inventory covered:

- Public routes: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `s/[key]/page.tsx`, `g/[key]/page.tsx`, `c/[slug]/page.tsx`, `map/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `privacy/page.tsx`, upload serving routes, and public metadata/feed routes.
- Public components: `nav`, `search`, `home-client`, `photo-viewer`, `lightbox`, `info-bottom-sheet`, `lightbox-color-pip`, `color-details-section`, `wide-gamut-hint`, `histogram`, `load-more`, `tag-filter`, `map/*`, `footer`, loading/error shells, and UI primitives.
- Admin routes/components: login, protected layout/loading/error, dashboard, categories, tags, settings, SEO, password, tokens, DB, analytics, admin nav/header, upload, image manager, user manager, and bulk edit.
- Styles/tokens: `apps/web/src/app/[locale]/globals.css`, Tailwind usage in TSX, theme provider/tokens, touch-target classes, forced-colors and reduced-motion rules.
- i18n: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, locale path helpers, `lang`/`dir` handling.
- Tests/evidence files: `apps/web/e2e/**` and relevant `apps/web/src/__tests__/**` for touch targets, focus-visible, i18n parity, a11y, color/HDR, search, lightbox, map, privacy, and source contracts.

## Runtime Evidence

Local app server:

- Port `3000` was already occupied by a `next-server` process that redirected to `/auth/device-login`, so I did not use or stop it.
- Started this repo on `http://localhost:3001` with `npm run dev --workspace=apps/web -- --port 3001`.
- `agent-browser install` confirmed Chromium was already installed.

Browser checks performed:

- `/en`: loaded public home failure state. Console/dev server showed DB bootstrap and query failures caused by `ECONNREFUSED 127.0.0.1:3306`.
- `/en/privacy`: loaded successfully at desktop and `390x844` mobile. Captured accessibility snapshot, DOM metrics, and screenshots.
- `/en/admin`: loaded login shell successfully. Captured accessibility snapshot, form control boxes, and focus order.
- Search interaction from privacy route: opened search dialog, filled `sun`, and confirmed the action degraded to localized search failure because DB was unavailable.

Artifacts saved under `/tmp`:

- `/tmp/gallery-desktop-home.png`
- `/tmp/gallery-privacy-desktop.png`
- `/tmp/gallery-privacy-mobile.png`
- `/tmp/gallery-admin-login-mobile.png`

Runtime blockers:

- DB-backed gallery, search results, map marker data, photo viewer, lightbox with real image data, timeline/year galleries, shared routes, and protected admin workflows could not be fully exercised because local MySQL was unavailable. I did not initialize or mutate the database because that would be a DB/schema-changing action outside this review request.

Targeted validation:

- `npm test --workspace=apps/web -- touch-target-audit.test.ts i18n-key-parity.test.ts a11y-us-p15.test.ts focus-visible-links-scan.test.ts`
- Result: 4 test files passed, 43 tests passed.

## Findings

### 1. Public route error shell drops the normal public wayfinding

Severity: Medium
Confidence: High
Area: IA, error state, keyboard recovery, i18n affordances

Evidence:

- Runtime: `/en` with DB unavailable rendered `Error | GalleryKit`, a stripped header with only a `Gallery` link, main region `Error`, `Something went wrong loading this page.`, `Try again`, and `Return to Gallery`.
- Runtime server evidence: DB bootstrap/query failures were `ECONNREFUSED 127.0.0.1:3306`; failing home queries included `getTopicsCached()` and `getLatestImageForOgCached()`.
- Source: `apps/web/src/app/[locale]/error.tsx:22-55` renders a custom standalone shell with only one nav link and no footer, search, theme, or locale controls.
- Contrast: `apps/web/src/app/[locale]/not-found.tsx:18-48` intentionally preserves the public `Nav`, `main`, and `Footer`, with comments explaining why dead-end routes need wayfinding.

Failure scenario:

A public visitor hits the gallery during DB outage, migration drift, or first-run misconfiguration. The page has a retry and home link, but loses normal public navigation, locale switching, theme switching, search access, footer/admin link, and the product’s usual IA context. This is especially costly on localized routes because the user cannot switch locale from the error state.

Suggested fix:

Align the route error shell with the not-found IA. If importing the server `Nav`/`Footer` is not viable in a client error boundary, create a lightweight client-safe public error shell that preserves brand/home, locale switch, theme toggle, footer links, and a localized maintenance/retry explanation. Add a regression that forces a public page data read to throw and asserts those recovery affordances remain present.

### 2. Auto-lightbox loading state has an unnamed status region

Severity: Low
Confidence: High
Area: WCAG 4.1.3 status messages, loading state, screen reader feedback

Evidence:

- Source: `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx:20-25` renders the auto-lightbox transition as `role="status"` and `aria-live="polite"` with only an `aria-hidden` spinner.
- Source: normal photo loading does this correctly in `apps/web/src/components/photo-viewer-loading.tsx:9-20`, with `aria-label={t('photo.loading')}` and visible loading text.

Failure scenario:

When a route sets `sessionStorage.gallery_auto_lightbox=true` and navigates to `/p/[id]`, sighted users see a black fullscreen spinner, but assistive tech gets an unnamed status region. A screen reader user may not hear that the photo is loading or that the interface is intentionally in transition.

Suggested fix:

Give the lightbox loading container an accessible name and/or text, matching the normal photo skeleton. For example, add `aria-label={t('photo.loading')}` and a visually hidden `{t('photo.loading')}` span, while keeping the spinner decorative. Add a small source/component test for the lightbox branch.

### 3. Search results are keyboard-operated but not discoverable to sighted keyboard users

Severity: Low
Confidence: Medium
Area: keyboard affordance, search dialog, WCAG 2.1.1/2.4.6 usability

Evidence:

- Source: search result rows are links forced into listbox options with `role="option"` and `tabIndex={-1}` at `apps/web/src/components/search.tsx:72-80`.
- Source: the only result navigation path is `ArrowDown`/`ArrowUp` plus `Enter` on the input at `apps/web/src/components/search.tsx:402-418`.
- Source: the dialog has a live result count at `apps/web/src/components/search.tsx:436-445`, and the result listbox at `:447-449`, but no visible or screen-reader instruction that results are reached with arrow keys. The visible footer hint only explains the global `Cmd/Ctrl+K` toggle.
- Runtime: search dialog opened on `/en/privacy`; result validation was blocked by DB outage, but the keyboard model is clear from source.

Failure scenario:

A keyboard-only visitor opens search, types a query, then presses `Tab`. Because results are not in the tab order, focus moves toward dialog controls rather than the first result. Users familiar with ARIA comboboxes may use arrow keys, but sighted keyboard users receive no local cue that arrow navigation is required.

Suggested fix:

Add an instruction tied to the input via `aria-describedby`, such as "Use up and down arrows to choose a result, Enter to open." Consider showing it subtly in the dialog footer when results exist. If the product wants ordinary link behavior instead, keep anchors tabbable and use roving focus less aggressively. Re-run search keyboard e2e coverage after choosing one model.

## Coverage Notes

- IA: Public shell, privacy page, admin login, error/not-found surfaces, nav/footer, search entry, archive/map/share/photo source paths.
- Affordances: Search, theme, locale, footer links, admin login fields, retry/back links, gallery cards, map accessible list, upload/admin controls by source.
- Keyboard/focus: Runtime login focus order; source focus traps/restoration in search, lightbox, bottom sheet; tests for skip link/focus-visible links passed.
- WCAG 2.2: Touch target audit passed; findings above cover status messaging, keyboard discoverability, and error recovery context.
- Responsive states: Runtime `390x844` privacy snapshot and DOM metrics; static review of mobile nav, bottom sheet, photo viewer, map, archive, and admin tables.
- Loading/empty/error: Route loading, photo loading, search/load-more statuses, map fallback, empty gallery/topic/share/admin states, and public/admin error shells reviewed.
- i18n: English/Korean messages, key parity test, locale switch, `lang`/`dir`, and Korean plural convention reviewed.
- Reduced motion: Global `prefers-reduced-motion` block in `globals.css:253-260` and component-level checks in photo navigation/lightbox/image zoom reviewed.
- Perceived performance: Runtime DB-offline behavior, masonry image sizing/fetch priority, map dynamic import, service-worker notes, and search debounce/static failure handling reviewed. Real LCP/CLS/INP on photo grids could not be measured without seeded DB content.

## Positive Evidence / Non-Findings

- `/en/privacy` accessibility snapshot exposed skip link, `Main navigation`, search/theme/locale buttons, semantic main content, footer links, and notifications region.
- Mobile DOM metrics on `/en/privacy` showed visible nav/footer controls at 44 px or larger.
- `/en/admin` login snapshot exposed labeled username/password fields, password reveal button, and submit. Tab order moved from password to password reveal as expected after autofocus.
- Footer new-window affordance is currently present: runtime snapshot exposed `GitHub opens in a new window`, and `footer.tsx` includes both `aria-label` and sr-only text.
- Targeted tests passed for touch targets, i18n key parity, skip/focus accessibility, and focus-visible link scanning.

## Missed-Issue Sweep

Final sweep terms and files included `aria-*`, `role=`, `tabIndex`, `focus-visible`, `sr-only`, `alt=`, `aria-live`, `loading`, `empty`, `error`, `notFound`, `rateLimited`, `maintenance`, `prefers-reduced-motion`, `animate-*`, `transition-*`, `scrollTo`, `target="_blank"`, `truncate`, `overflow-*`, `whitespace-nowrap`, locale/message usage, public pages, admin pages, shared/map/photo/search/lightbox components, and UI primitives.

No UI category was intentionally skipped. Browser validation gaps are specifically due to the unavailable local MySQL database, not due to omitting those flows from review. Generated `.next`, `node_modules`, binary media pixels, and non-UI backend internals were not line-reviewed except where they affected user-visible UI state.
