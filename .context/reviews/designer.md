# Cycle 24 Designer / UI-UX Review

Date: 2026-06-30
Role: designer / UI-UX reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `a6efd6fd docs(security): record cycle 24 security posture`
Scope constraint: review artifact only. No source files were modified.

## Method And Inventory

I read the workspace rules in `AGENTS.md` and `CLAUDE.md`, then used the local agent-browser CLI skill docs for navigation, config, wait, query, visual capture, interaction, network, debug, and state before loading the app.

UI/UX inventory covered:

- Pages and layouts: `apps/web/src/app/[locale]/**`, including public gallery/photo/share/map/timeline/privacy routes and protected admin routes.
- Components: `apps/web/src/components/**`, including nav, search, photo viewer, lightbox, bottom sheet, map, admin header/nav, upload, image manager, bulk edit, user manager, and UI primitives.
- Styles and tokens: `apps/web/src/app/[locale]/globals.css`, `tailwind.config.ts`, `components.json`, `theme-provider.tsx`, and token usage in TSX.
- Messages/i18n: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, locale helpers, and `dir` handling.
- Public assets: `apps/web/public/fonts`, `icons`, `resources`, `uploads`, `sw.js`, and `histogram-worker.js`.
- Browser/e2e/visual coverage: `apps/web/e2e/**`, touch-target, focus-visible, HDR/contrast, i18n parity, and related UI test files in `apps/web/src/__tests__/**`.
- UI notes/docs: `CLAUDE.md`, `apps/web/README.md`, `.context/reviews/**`, and `.context/plans/**`.

Runtime setup:

- An existing process on `localhost:3000` was auth-gated and not usable for this review.
- I started the app on `http://localhost:3001` with `PORT=3001 npm run dev --workspace=apps/web`.
- Local MySQL at `127.0.0.1:3306` was unavailable. The dev server logged: `Could not connect to database to bootstrap queue (ECONNREFUSED). Retrying image queue bootstrap in 30s.`
- DB-backed pages were therefore source-reviewed and partially browser-checked in their failure state. Static/privacy and login surfaces were browser-reviewed directly.

Browser artifacts saved only under `/tmp`:

- `/tmp/gallery-c24-privacy-desktop.png`
- `/tmp/gallery-c24-privacy-mobile.png`
- `/tmp/gallery-c24-admin-login.png`
- `/tmp/gallery-c24-home-db-offline.png`

Browser evidence used beyond screenshots:

- Accessibility snapshots for `/en/privacy`, `/en/admin`, and DB-offline `/en`.
- DOM/box/style checks for desktop and mobile nav controls, footer links, headings, form fields, and buttons.
- Form validity checks on admin login.
- Console/page-error review showing DB query failures under the offline environment.

## Confirmed Findings

### 1. DB-backed home can strand users in an indefinite loading state

Severity: High
Confidence: High
Area: loading/error states, recovery IA, assistive technology feedback

Evidence:

- Browser: `http://localhost:3001/en` with the DB offline exposed only the skip link, `role="status"` text `Loading...`, and the live notifications region after waiting. `document.title` was empty, no `main` content was present, and the DOM contained a failed-query RSC template. Artifact: `/tmp/gallery-c24-home-db-offline.png`.
- Runtime blocker: the dev server repeatedly reported MySQL `ECONNREFUSED`.
- Source: `apps/web/src/app/[locale]/(public)/page.tsx:151-157` awaits SEO/config/tag/topic DB reads together, and `:166` awaits `getImagesLitePage(...)` without a page-level recovery path.
- Source: `apps/web/src/app/[locale]/loading.tsx:7-11` renders only a generic loading status.
- Source: `apps/web/src/app/[locale]/error.tsx:22-57` has a localized retry/back shell, but the observed DB-offline home never reached that shell in the browser.

Failure scenario:

During a DB outage or first-run misconfiguration, a visitor can land on the homepage and see only a spinner indefinitely. Screen reader users get a status update but no failure, retry, fallback navigation, or page title context.

Concrete fix:

Wrap the homepage data-loading path so DB failures render a localized maintenance/error state inside the public shell, or make the thrown RSC failure reliably surface through the localized error boundary. The state should include a real `main`, an error heading, retry/back actions, and a title. Add a regression that simulates `getImagesLitePage` or the initial DB reads failing and asserts the visible error shell replaces the loading status.

### 2. Category admin server validation is toast-only and not tied to fields

Severity: Medium
Confidence: High for source behavior; browser validation of protected category flows blocked by DB/auth seed
Area: form validation UX, WCAG error identification, keyboard recovery

Evidence:

- Source: create/update/alias handlers show `toast.error(res.error)` only at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:81-97`, `:99-115`, and `:135-153`.
- Source: create fields at `topic-manager.tsx:195-212`, edit fields at `:320-340`, and alias input/button at `:361-380` have no persistent field error state, `aria-invalid`, or `aria-describedby` linkage for server/action errors.
- Browser baseline: `/en/admin` login required-field validation focused the first invalid field and exposed valid 44 px controls, so the issue is specific to these source-reviewed admin category server errors rather than all forms.

Failure scenario:

An admin creates or edits a topic with a duplicate slug, invalid slug, invalid order, or image-processing warning. The only actionable feedback is a transient toast disconnected from the field that needs repair. Keyboard and screen reader users may remain in the dialog without knowing which field failed after the toast disappears.

Concrete fix:

Store structured field errors for `label`, `slug`, `order`, `image`, and `alias`. Render persistent inline messages with `role="alert"` or an error summary, set `aria-invalid`, attach `aria-describedby`, and focus the first invalid field after the action returns. Keep toast as a secondary summary, not the only error surface. Add a focused component/action test for an invalid or duplicate slug path.

### 3. Some new-tab links lack an accessible "opens in new window" cue

Severity: Low
Confidence: High
Area: link affordance, context-change warning

Evidence:

- Browser: the `/en/privacy` footer accessibility tree exposed the external link as just `GitHub`; no accessible cue indicated a new tab/window.
- Source: `apps/web/src/components/footer.tsx:45-53` uses `target="_blank"` for GitHub with visible text `GitHub`, but no hidden text or `aria-label` cue. It also uses `rel="noreferrer"` rather than the explicit `noopener noreferrer` used elsewhere.
- Source: admin GPS map links in `apps/web/src/components/photo-viewer.tsx:875-883` and `apps/web/src/components/info-bottom-sheet.tsx:453-461` open Google Maps in a new tab with coordinate text only.
- Contrast: analytics links already include the intended pattern with `aria-label={`${label} ${t.opensInNewWindow}`}` at `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:117-122` and `:225-230`.

Failure scenario:

A keyboard or screen reader user activates GitHub or a map coordinate link and unexpectedly moves to a new tab/window. This is a mild but avoidable context-change surprise, and the codebase already has a better pattern.

Concrete fix:

Promote the `opensInNewWindow` message to a shared/common namespace or duplicate it where appropriate, then add either an `aria-label` suffix or visually hidden text to each new-tab link. Use explicit `rel="noopener noreferrer"` consistently.

## Likely Issues And Manual-Validation Risks

- Search, theme, and locale interactions on `/en/privacy` were visible in the accessibility tree and had 44 px boxes, but direct click automation did not reliably trigger React-controlled nav actions in the DB-offline dev session. Existing e2e/source coverage still shows search dialog focus management, focus restoration, and body scroll lock; this remains a manual seeded-browser validation item, not a product finding.
- Protected admin dashboard, settings, token, upload, image-manager, and category workflows could not be fully browser-tested because the local DB/admin seed was unavailable. I source-reviewed their UI contracts and cited the category gap above.
- Photo viewer, lightbox, color/HDR panels, timeline/year pages, map results, and shared photo/group pages could not be visually exercised with real data because DB reads failed. Existing source and e2e coverage were inspected for focus traps, keyboard paths, touch target sizing, loading/empty states, and color/HDR privacy conventions.
- Dark-mode browser emulation did not flip `matchMedia` in agent-browser during this run. Dark/light mode review is therefore source-backed through tokens and tests, not visually confirmed in-browser for every route.
- RTL behavior is a future-locale risk only. Current shipped locales are `en` and `ko`, and `getLocaleDirection` returns `ltr` for supported locales.
- LCP/CLS/INP risk for real masonry/photo pages was not measured because seeded DB content was unavailable. The offline home spinner issue above is the main perceived-performance finding from this run.

## Verified Strengths / Non-Findings

- Static public shell: `/en/privacy` exposed skip link, `Main navigation`, search, theme, locale switch, semantic main content, footer links, and live notifications in the accessibility snapshot.
- Touch target sizing: browser box checks showed public nav controls, footer links, admin login inputs, password reveal, and submit controls at 44 px or larger on desktop and `390x844` mobile.
- Login form baseline: `/en/admin` labels, required controls, password reveal, autocomplete attributes, autofocus, and native required-field focus behavior were present.
- Reduced motion: `apps/web/src/app/[locale]/globals.css:253-279` globally suppresses animation/transition behavior and hover scale under `prefers-reduced-motion`.
- Contrast/design tokens: foreground and muted token comments in `globals.css` document WCAG-aware contrast choices, and HDR/contrast unit tests are present.
- Focus and keyboard coverage: e2e/source tests cover search dialog focus trap/restoration, heading hierarchy, visible nav target size, touch target audits, and focus-visible link scanning.
- i18n: English/Korean message files and key-parity tests are present; `layout.tsx` sets `lang` and `dir`.

## Missed-UX Sweep And Skipped-File Confirmation

Final sweep terms included `aria`, `focus`, `keyboard`, `dialog`, `loading`, `empty`, `error`, `toast`, `invalid`, `reduced-motion`, `target="_blank"`, `rtl`, `dir=`, `theme`, `contrast`, `touch`, `skeleton`, and `placeholder`.

No UI source category was intentionally skipped: pages, components, styles/tokens, messages/i18n, public assets, e2e visual/browser tests, and UI notes were inventoried. The skipped browser coverage was caused by the local DB blocker above, not by stale prior-cycle assumptions.

Not reviewed line-by-line: generated `.next`, `node_modules`, binary media pixels, and non-UI backend scripts except where they directly affected UI state. Full Playwright/lint/build/test gates were not run because this was a review-only artifact and local MySQL was unavailable; source-backed UI tests were inspected instead.
