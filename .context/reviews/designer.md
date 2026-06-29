# Designer Review - Cycle 10

Role: cycle 10 designer / UI-UX reviewer. Scope: Next.js public and admin UI, information architecture, affordances, focus and keyboard navigation, WCAG 2.2 accessibility, contrast, ARIA, focus traps, reduced motion, responsive behavior, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL, and perceived performance.

This is PROMPT 1 only. No application source was edited; this report is the only intended source artifact.

## Inventory

Read before reviewing:

- `AGENTS.md`
- `CLAUDE.md`
- agent-browser skills for core navigation, config, query, visual, interact, wait, network, debug, and state.

UI-relevant files inventoried:

- Public routes under `apps/web/src/app/[locale]/(public)/`: home, topic, smart collection, shared link/group, photo detail/loading, map, timeline, year, upload route, and public layout.
- Admin routes under `apps/web/src/app/[locale]/admin/`: login, protected layout, dashboard/upload manager, categories, tags, SEO, settings, password, users, DB, tokens, analytics, loading, and error shells.
- Shared components under `apps/web/src/components/`: nav/search/footer, home masonry, tag filter, load more, grid picture fallback, photo viewer, image zoom, lightbox, info bottom sheet, color details, lightbox color pip, histogram, upload dropzone, tag input, image manager, bulk edit, admin nav/header, user manager, map loader/client, and shadcn/Radix UI primitives.
- Styling/i18n/test surface: `apps/web/src/app/[locale]/globals.css`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, touch-target, focus-visible, i18n parity, error-shell, lightbox, info-bottom-sheet, and HDR contrast tests.

Inventory examples with source review:

- Layout/skip link/theme/i18n: `apps/web/src/app/[locale]/layout.tsx:93-160`
- Home IA/masonry/empty/back-to-top: `apps/web/src/components/home-client.tsx:255-456`
- Nav/mobile controls: `apps/web/src/components/nav-client.tsx:83-181`
- Search dialog/combobox: `apps/web/src/components/search.tsx:320-479`
- Photo viewer/lightbox entry: `apps/web/src/components/photo-viewer.tsx:79-230`
- Lightbox modal: `apps/web/src/components/lightbox.tsx:430-680`
- Info bottom sheet: `apps/web/src/components/info-bottom-sheet.tsx:185-247`
- Admin login: `apps/web/src/app/[locale]/admin/login-form.tsx:34-108`
- Admin dashboard/upload/image manager/settings: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:65-170`, `apps/web/src/components/upload-dropzone.tsx:191-360`, `apps/web/src/components/image-manager.tsx:316-420`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:226-360`
- Global tokens/reduced motion/forced colors: `apps/web/src/app/[locale]/globals.css:13-338`

## Browser Evidence

Local/dev flow:

- Existing `localhost:3000` was occupied and redirected to `/auth/device-login`, so I did not interrupt it.
- Started the documented dev flow on `http://localhost:3010` with `npm run dev --workspace=apps/web -- --port 3010`; Next.js 16.2.9 reported ready.
- Local `/en` returned 200 but rendered the route error shell because the local DB/schema could not satisfy the topics query. Browser console showed the failed `topics` query. I used this only as error-state evidence, then used production for functional public UI evidence.

Production browser pass with `agent-browser`:

- Mobile Korean home, `https://gallery.atik.kr/ko`, 390x844: accessibility snapshot exposed skip link, `navigation "메인 내비게이션"`, H1 `최근 사진`, tag-filter group, photo links, load-more, footer, and notifications region. DOM metrics showed `scrollWidth === 390`, `lang="ko"`, `dir="ltr"`, and sampled visible controls/photo links at 44 px or larger.
- Expanded mobile nav: search/theme/language controls measured 44x44 and had localized accessible names.
- Desktop English home, `https://gallery.atik.kr/en`, 1440x1000 after resetting the browser session: accessibility snapshot exposed the persistent search/theme/language controls, H1 `Latest`, tag-filter group, photo links, load-more, footer, and no page errors.
- Search dialog: opening search focused `#search-input`; query `jihoon` produced 20 results. Browser evidence: input `role="combobox"`, `aria-expanded="true"`, `aria-controls="search-results"`, live text `20 results`, input 466x44, close button 44x44, result options 558x64.
- Photo page `/en/p/348` at mobile width: toolbar/back/fullscreen/info/next/zoom controls were exposed with 44 px or larger sampled targets and no horizontal overflow.
- Info bottom sheet: opened as `dialog "Photo Info"`, Close was focused, drag handle was 390x44, Close was 44x44.
- Lightbox: opened as `dialog "Photo lightbox"` with body scroll locked and 44 px controls, but `document.activeElement` stayed on `<body>` after a 500 ms wait. Pressing Tab moved focus to Close inside the dialog.
- Admin login `https://gallery.atik.kr/ko/admin`, 390x844: snapshot exposed H1 `관리자 로그인`, visible labels, required username/password fields, password reveal, and submit. DOM metrics: username 308x44 with `autocomplete="username"` and autofocus, password 308x44 with `autocomplete="current-password"`, reveal 44x44, submit 308x44, no horizontal overflow.
- `agent-browser state list` showed no saved auth state, so protected admin pages were source-reviewed rather than live-DOM tested.

Contrast note: token/source review and screenshots were used for contrast. A computed-style contrast sweep over photo overlays produced false positives because transparent/gradient overlays sit over image pixels, which the DOM style API cannot evaluate reliably.

## Confirmed Findings

### DES-C10-01 - Lightbox opens with focus left on `<body>` instead of moving into the modal

Severity: Medium

Confidence: High

Classification: confirmed

Source evidence:

- `Lightbox` stores `closeButtonRef` at `apps/web/src/components/lightbox.tsx:96`.
- The mount effect tries to focus `closeButtonRef.current` at `apps/web/src/components/lightbox.tsx:430-444`.
- The `FocusTrap` wrapper at `apps/web/src/components/lightbox.tsx:447` only sets `allowOutsideClick` and `fallbackFocus`; it does not provide `initialFocus`.
- The close button itself is focusable and labelled at `apps/web/src/components/lightbox.tsx:547-565`.

Browser evidence:

- On `https://gallery.atik.kr/en/p/348`, clicking `Open fullscreen view` opened `dialog "Photo lightbox"`.
- After a 500 ms wait, `document.activeElement` was still `<body class="antialiased min-h-screen bg-background font-sans flex flex-col" style="overflow: hidden;">`.
- The first Tab moved to the Close button inside the dialog, proving focusable modal controls exist but initial focus was not placed there.

Failure scenario:

A keyboard or screen-reader user opens the lightbox. The visual modal appears and body scroll locks, but assistive technology focus remains outside the dialog until the user presses Tab. The dialog may not be announced immediately, and the next key command starts from an ambiguous page-level focus position.

Concrete fix:

Move initial focus ownership into the focus-trap activation path instead of relying on a separate mount effect. For example, pass `initialFocus: () => closeButtonRef.current ?? false` (or focus the dialog container with `tabIndex={-1}` as a fallback) in the `FocusTrap` options at `apps/web/src/components/lightbox.tsx:447`, then keep the existing restore-on-unmount logic. Add a browser or component test that opens the lightbox and asserts `document.activeElement` is the Close button or another intended in-dialog control after activation.

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
- Keyboard Tab was trapped or moved into modal controls in the sampled paths, so this is not a keyboard-tab failure by itself.

Failure scenario:

A VoiceOver, NVDA, or JAWS user opens search, the info sheet, or the lightbox and navigates with a virtual cursor/rotor rather than Tab. If background content remains reachable despite `aria-modal`, the user can move out of the active modal context and trigger unrelated page navigation.

Concrete fix:

Validate the three custom modal shells with VoiceOver Safari and NVDA/Chrome or NVDA/Firefox. If background content remains reachable, migrate these shells to the existing Radix Dialog primitive or add an `inert`/`aria-hidden` sibling strategy while each modal is open. DES-C10-01 should be fixed separately for lightbox initial focus.

### DES-C10-RISK-02 - Authenticated admin workflows remain source-reviewed only in this pass

Severity: Low

Confidence: High

Classification: coverage risk

Source evidence:

- Protected admin routes redirect unauthenticated users at `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:12-17`.
- Admin login has labels, required fields, autocomplete, password reveal, and alert/server-error handling at `apps/web/src/app/[locale]/admin/login-form.tsx:47-104`.
- Admin controls generally route through 44 px button/link primitives or explicit floors, e.g. `apps/web/src/components/admin-nav.tsx:29-49`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:121-166`, and `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:226-360`.

Browser evidence:

- Production admin login was tested without credentials and passed the sampled checks.
- `agent-browser state list` reported no saved auth state.
- Local dev could not render functional DB-backed pages because the local database query failed, so protected admin pages could not be exercised as live DOM.

Failure scenario:

Authenticated-only admin dialogs, tables, upload progress, bulk edit, settings validation, analytics, or DB pages may contain focus order, overflow, live-region, or responsive-state defects that source review and the login page cannot prove.

Concrete fix:

For the next browser-heavy review, provide a seeded local DB plus admin credentials or a saved non-production `agent-browser` auth state. Cover dashboard upload, image manager/bulk edit, categories, tags, SEO, settings/backfill, tokens, password, users, DB, and analytics at mobile and desktop breakpoints.

## Category Review Notes

- Information architecture: public navigation, topics, search/theme/locale controls, main content, tag filtering, photo cards, load-more, footer, and admin entry are coherent in snapshots. Admin IA is broad but organized through `AdminNav`.
- Affordances: icon-only controls generally have labels/titles/keyshortcuts. Sampled search/theme/locale/fullscreen/info/close/next/password controls had meaningful names.
- Focus/keyboard: skip link is first focusable content; search focuses the combobox on open; info sheet focuses Close. Lightbox initial focus is the confirmed defect.
- WCAG 2.2 / ARIA: touch-target audit and runtime samples support the 44 px policy. Search combobox uses `aria-expanded`, `aria-controls`, `aria-activedescendant` wiring, live result count, and listbox/options. Custom modal background isolation remains a manual-AT risk.
- Responsive behavior: mobile home, expanded nav, admin login, photo page, info sheet, and lightbox had no horizontal overflow in sampled DOM metrics. Desktop home was verified after resetting the browser session.
- Loading/empty/error states: local DB failure reached the route error shell; home empty state and clear-filter affordance exist in `home-client.tsx:424-438`; search loading/no-result/results live text exists in `search.tsx:393-407`; admin upload progress/error/toast paths are source-visible.
- Form validation UX: admin login uses native required fields, visible labels, autocomplete, password reveal, pending submit text, and role-alert server error text.
- Dark/light/OLED/reduced motion: source tokens cover light, dark, and OLED; global reduced-motion CSS suppresses transitions/animations and photo-card hover scale at `globals.css:291-317`. Lightbox also observes `prefers-reduced-motion` at `lightbox.tsx:92-109`.
- i18n/RTL: English and Korean routes produced localized labels and `lang` values. `dir="ltr"` is explicit at `layout.tsx:94-100`; no RTL locale ships today, so RTL is future-proofing rather than a current defect.
- Perceived performance: home uses CSS masonry, responsive thumbnail sources, eager fetch priority above fold, content-visibility, image prefetch gating, and no observed public console/page errors after clearing the local-dev error buffer.

## Verification

Targeted tests run:

```sh
npm test --workspace=apps/web -- src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/error-shell.test.ts src/__tests__/lightbox-controls-contract.test.ts src/__tests__/info-bottom-sheet-ia.test.ts src/__tests__/hdr-badge-contrast.test.ts
```

Result: 7 test files passed, 62 tests passed.

Not run: full lint, full typecheck, full build, full Vitest suite, or authenticated admin browser smoke. This lane changed only a review artifact.

## Files Reviewed / Inventory Summary

Primary source files reviewed with line-numbered reads:

- `CLAUDE.md`
- `package.json`
- `apps/web/package.json`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/error.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/lazy-focus-trap.tsx`
- `apps/web/src/app/[locale]/globals.css`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- Related tests listed in the verification command.

Broader file inventory was built with `rg --files apps/web/src/app apps/web/src/components apps/web/messages apps/web/src/lib apps/web/src/__tests__` plus targeted `find` for route pages/layouts/loading/error files.
