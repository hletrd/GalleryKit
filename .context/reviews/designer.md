# Designer Review - Cycle 10

Role: cycle 10 designer / UI-UX reviewer. Scope: Next.js public and admin UI, information architecture, affordances, focus and keyboard navigation, WCAG 2.2 accessibility, contrast, ARIA, focus traps, reduced motion, responsive breakpoints, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL, and perceived performance.

This is PROMPT 1 only. No application source was edited for this report.

## Inventory

Read before review:

- `AGENTS.md`
- `CLAUDE.md`
- agent-browser skills for core navigation, config, query, visual, interact, wait, network, debug, and state.

UI-relevant inventory built before judging findings:

- Public routes under `apps/web/src/app/[locale]/(public)/`: home, topic, smart collection, shared link/group, photo detail/loading, map, timeline, year, upload route, and public layout.
- Admin routes under `apps/web/src/app/[locale]/admin/`: login, protected layout, dashboard/upload manager, categories, tags, SEO, settings, password, users, DB, tokens, analytics, loading, and error shells.
- Shared components under `apps/web/src/components/`: nav/search/footer, home masonry, tag filter, load more, grid picture fallback, photo viewer, image zoom, lightbox, info bottom sheet, color details, lightbox color pip, histogram, upload dropzone, tag input, image manager, bulk edit, admin nav/header, user manager, map loader/client, and shadcn/Radix UI primitives.
- Styling/i18n/test surface: `apps/web/src/app/[locale]/globals.css`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, touch-target, focus-visible, i18n parity, error-shell, lightbox, info-bottom-sheet, and HDR contrast tests.

Primary source files reviewed with exact regions:

- Layout, language, skip link: `apps/web/src/app/[locale]/layout.tsx:93-132`
- Public home IA, masonry, empty state, back-to-top: `apps/web/src/components/home-client.tsx:255-456`
- Mobile/desktop navigation controls: `apps/web/src/components/nav-client.tsx:83-181`
- Search dialog/combobox shell: `apps/web/src/components/search.tsx:320-345`
- Photo viewer/lightbox entry points: `apps/web/src/components/photo-viewer.tsx:79-230`
- Lightbox modal focus and controls: `apps/web/src/components/lightbox.tsx:96-98`, `apps/web/src/components/lightbox.tsx:430-447`, `apps/web/src/components/lightbox.tsx:547-565`
- Info bottom sheet modal focus and controls: `apps/web/src/components/info-bottom-sheet.tsx:185-199`, `apps/web/src/components/info-bottom-sheet.tsx:213-247`
- Admin login form: `apps/web/src/app/[locale]/admin/login-form.tsx:47-108`
- Admin dashboard/upload/image manager/settings: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`

## Browser Evidence

Local/dev flow:

- Port 3000 was already occupied, so I did not interrupt it.
- Started `npm run dev --workspace=apps/web -- --port 3010`; Next.js 16.2.9 reported ready.
- Local `http://localhost:3010/en` returned 200 but rendered the app error shell because the local DB/query path failed on `topics`. I used this as error-state evidence only, then used production for representative public UI behavior.

Agent-browser production pass:

- Mobile Korean home, `https://gallery.atik.kr/ko`, 390x844: accessibility snapshot exposed skip link, `navigation "메인 내비게이션"`, H1 `최근 사진`, tag-filter group, photo links, load-more, footer, and notifications region. DOM metrics showed `scrollWidth === 390`, `lang="ko"`, `dir="ltr"`, and sampled visible controls/photo links at 44 px or larger.
- Expanded mobile nav: search/theme/language controls measured 44x44 and had localized accessible names.
- Desktop English home, `https://gallery.atik.kr/en`, 1440x1000: accessibility snapshot exposed persistent search/theme/language controls, H1 `Latest`, tag-filter group, photo links, load-more, footer, and no page errors.
- Search dialog: opening search focused `#search-input`; query `jihoon` produced 20 results. Browser evidence: input `role="combobox"`, `aria-expanded="true"`, `aria-controls="search-results"`, live text `20 results`, input 466x44, close button 44x44, result options 558x64.
- Photo page `/en/p/348` at mobile width: toolbar/back/fullscreen/info/next/zoom controls were exposed with sampled targets at 44 px or larger and no horizontal overflow.
- Info bottom sheet: opened as `dialog "Photo Info"`, Close was focused, drag handle was 390x44, and Close was 44x44.
- Lightbox: opened as `dialog "Photo lightbox"` with body scroll locked and 44 px controls, but `document.activeElement` stayed on `<body>` after a 500 ms wait. Pressing Tab moved focus to Close inside the dialog.
- Admin login `https://gallery.atik.kr/ko/admin`, 390x844: snapshot exposed H1 `관리자 로그인`, visible labels, required username/password fields, password reveal, and submit. DOM metrics: username 308x44 with `autocomplete="username"` and autofocus, password 308x44 with `autocomplete="current-password"`, reveal 44x44, submit 308x44, no horizontal overflow.
- `agent-browser state list` showed no saved auth state, so protected admin pages were source-reviewed rather than live-DOM tested.

Contrast note: token/source review and sampled screenshots were used for contrast. A computed-style contrast sweep over photo overlays was not treated as authoritative because transparent/gradient overlays sit over image pixels, which the DOM style API cannot evaluate reliably.

## Confirmed Findings

### DES-C10-01 - Lightbox opens with focus left on `<body>` instead of moving into the modal

Severity: Medium

Confidence: High

Classification: confirmed

Source evidence:

- `Lightbox` stores `closeButtonRef`, `previouslyFocusedRef`, and `dialogRef` at `apps/web/src/components/lightbox.tsx:96-98`.
- The mount effect tries to focus `closeButtonRef.current` immediately after body scroll lock at `apps/web/src/components/lightbox.tsx:430-444`.
- The `FocusTrap` wrapper at `apps/web/src/components/lightbox.tsx:447` sets `allowOutsideClick` and `fallbackFocus`, but does not provide `initialFocus`.
- The close button is focusable and labelled at `apps/web/src/components/lightbox.tsx:547-565`.

Browser evidence:

- On `https://gallery.atik.kr/en/p/348`, clicking `Open fullscreen view` opened `dialog "Photo lightbox"`.
- After a 500 ms wait, `document.activeElement` was still `<body class="antialiased min-h-screen bg-background font-sans flex flex-col" style="overflow: hidden;">`.
- Pressing Tab moved focus to the Close button inside the dialog, proving focusable modal controls exist but initial focus was not placed there.

Failure scenario:

A keyboard or screen-reader user opens the lightbox. The visual modal appears and body scroll locks, but assistive technology focus remains outside the dialog until the user presses Tab. The dialog may not be announced immediately, and the next key command starts from an ambiguous page-level focus position.

Concrete fix:

Move initial focus ownership into the focus-trap activation path instead of relying on a separate mount effect. For example, pass `initialFocus: () => closeButtonRef.current ?? false` in the `FocusTrap` options at `apps/web/src/components/lightbox.tsx:447`, with a dialog-container fallback if needed. Keep the existing restore-on-unmount behavior. Add a browser or component test that opens the lightbox and asserts `document.activeElement` is the Close button or another intended in-dialog control after activation.

## Risks / Likely Issues

### DES-C10-RISK-01 - Custom modal surfaces still need manual AT validation for background virtual-cursor isolation

Severity: Medium

Confidence: Medium

Classification: risk; not confirmed as an assistive-technology failure

Source evidence:

- Search uses a custom `FocusTrap` plus manual `role="dialog"` / `aria-modal="true"` at `apps/web/src/components/search.tsx:327-340`.
- Lightbox uses a custom `FocusTrap` plus manual modal shell at `apps/web/src/components/lightbox.tsx:447-453`.
- Info bottom sheet uses a custom `FocusTrap` plus manual modal shell at `apps/web/src/components/info-bottom-sheet.tsx:185-199`.

Browser evidence:

- Chromium accessibility snapshots for open search, info sheet, and lightbox still included page landmarks/background content alongside the dialog.
- Keyboard Tab behavior worked or moved into modal controls in the sampled paths, so this is not a keyboard-tab failure by itself.

Failure scenario:

A VoiceOver, NVDA, or JAWS user opens search, the info sheet, or the lightbox and navigates with a virtual cursor/rotor rather than Tab. If background content remains reachable despite `aria-modal`, the user can move out of the active modal context and trigger unrelated page navigation.

Concrete fix:

Validate the three custom modal shells with VoiceOver Safari and NVDA/Chrome or NVDA/Firefox. If background content remains reachable, migrate these shells to the existing Radix Dialog primitive or add an `inert`/`aria-hidden` sibling strategy while each modal is open. DES-C10-01 should be fixed separately for lightbox initial focus.

### DES-C10-RISK-02 - Authenticated admin workflows remain source-reviewed only in this pass

Severity: Low

Confidence: High

Classification: coverage risk

Source evidence:

- Protected admin routes redirect unauthenticated users in `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`.
- Admin login has labels, required fields, autocomplete, password reveal, and alert/server-error handling at `apps/web/src/app/[locale]/admin/login-form.tsx:47-108`.
- Admin controls generally route through 44 px button/link primitives or explicit floors in `apps/web/src/components/admin-nav.tsx`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`, and `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`.

Browser evidence:

- Production admin login was tested without credentials and passed the sampled checks.
- `agent-browser state list` reported no saved auth state.

Failure scenario:

An authenticated-only admin table, dialog, upload flow, bulk-edit flow, or settings state could have focus order, overflow, error-state, or live-region defects that are not visible from the login page or source review alone.

Concrete fix:

For the next cycle, provide a seeded local DB plus admin credentials, or save a reusable `agent-browser` auth state for a non-production reviewer account. Add a browser smoke pass covering upload, bulk edit, settings, SEO, tags, categories, analytics, and user management at desktop and mobile breakpoints.

## Category Review Notes

- Information architecture: public navigation exposes brand/home, topics, search, theme, locale, main content, photo cards, load-more, and footer in a coherent order. The mobile nav expand button controls only `primary-nav-controls` at `apps/web/src/components/nav-client.tsx:99-108`; topics remain visible and scrollable at `apps/web/src/components/nav-client.tsx:116-159`.
- Affordances: icon-only controls have accessible labels or titles where appropriate. Search, theme, locale, fullscreen, info, lightbox, and password reveal controls were understandable in source and browser snapshots.
- Focus and keyboard: skip link exists at `apps/web/src/app/[locale]/layout.tsx:119-128`; search keyboard navigation and focus trap worked in browser; info bottom sheet uses `initialFocus` at `apps/web/src/components/info-bottom-sheet.tsx:185-192`; lightbox initial focus is the confirmed exception.
- WCAG 2.2 / contrast / ARIA: sampled controls satisfy the 44 px target-size policy; current components use visible labels, `aria-pressed`, `aria-current`, `aria-modal`, live regions, progress roles, and focus rings. Manual AT validation remains recommended for custom modal shells.
- Reduced motion: global reduced-motion CSS suppresses transitions/animations and hover photo scale in `apps/web/src/app/[locale]/globals.css`; lightbox also observes `prefers-reduced-motion` at `apps/web/src/components/lightbox.tsx:92-109`.
- Responsive behavior: desktop and 390 px mobile public pages, mobile nav expansion, mobile search, mobile photo detail, info sheet, and lightbox had no horizontal overflow in sampled DOM measurements.
- Loading/empty/error states: home empty state and clear-filter affordance are present at `apps/web/src/components/home-client.tsx:424-438`; search loading/no-result/results live text is in `apps/web/src/components/search.tsx`; local app error shell was reachable when DB was down.
- Form validation UX: login uses visible labels, native required validation, autocomplete, password reveal, pending submit text, and role-alert server errors at `apps/web/src/app/[locale]/admin/login-form.tsx:47-108`.
- Dark/light mode: production home and reviewed token styles did not expose a confirmed contrast issue. OLED was source-reviewed but not separately browser-measured in this pass.
- i18n/RTL: English and Korean public routes produced localized labels and `lang` values; `dir="ltr"` is explicit at `apps/web/src/app/[locale]/layout.tsx:94-100`. No RTL locale ships today, so RTL remains future-work rather than a current defect.
- Perceived performance: production home loaded representative image/RSC assets without observed broken public DOM. Search results updated live after input. Local dev performance could not be judged because local DB state was unavailable.

## Verification

Targeted tests run:

```sh
npm test --workspace=apps/web -- src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/error-shell.test.ts src/__tests__/lightbox-controls-contract.test.ts src/__tests__/info-bottom-sheet-ia.test.ts src/__tests__/hdr-badge-contrast.test.ts
```

Result: 7 test files passed, 62 tests passed.

Not run: full lint, typecheck, build, or full test suite. This lane changed only a review artifact and did not edit application source.

## Files Reviewed / Inventory Summary

- Full route/component inventory was built with `rg --files` across `apps/web/src/app`, `apps/web/src/components`, `apps/web/messages`, `apps/web/src/lib`, and `apps/web/src/__tests__`.
- Source-reviewed public UI: layout, navigation, home masonry, search, photo viewer, lightbox, info bottom sheet, error shell, and responsive token CSS.
- Source-reviewed admin UI: login, protected layout/nav, dashboard/upload manager, image manager, settings, and related form/control primitives.
- Browser-reviewed live UI: public desktop home, public mobile Korean home, expanded mobile nav, search dialog, photo detail, info bottom sheet, lightbox, and unauthenticated admin login.

## Final Missed-Issue Sweep

- Rechecked hidden controls: back-to-top is not keyboard reachable while hidden (`aria-hidden` and `tabIndex` track visibility at `apps/web/src/components/home-client.tsx:440-451`).
- Rechecked modal basics: search and info bottom sheet initial focus worked in Chromium; lightbox initial focus failed and is filed as DES-C10-01.
- Rechecked touch targets: source/test/runtime samples support the 44 px policy.
- Rechecked public responsive samples: no horizontal overflow at desktop or mobile.
- Rechecked admin coverage boundary: login is validated in browser; protected admin remains source-only pending auth state.
