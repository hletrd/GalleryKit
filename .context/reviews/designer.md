# Designer Review - Review-Plan-Fix Cycle 5

Role: designer / UI-UX reviewer. Scope: information architecture, affordances, keyboard/focus navigation, WCAG 2.2 accessibility, responsive breakpoints, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL, and perceived performance. No application source was edited.

## Inventory Coverage

Read the supplied `AGENTS.md` contract and `CLAUDE.md` first. Loaded the `agent-browser` core, query, visual, interaction, and config skills before browser checks.

Current UI inventory rebuilt before reviewing:

- 96 product-facing UI files under `apps/web/src/app/[locale]/(public)`, `apps/web/src/app/[locale]/admin`, and `apps/web/src/components`.
- 2 locale files: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Relevant UI/a11y tests: touch target audit, focus-visible scans, route error shell tests, i18n key parity, theme resolution, bottom-sheet IA, lightbox control contracts, search disclaimer, HDR badge contrast.
- Structural scan covered 314 interactive/control markers (`button`, `Button`, `Link`, anchors, inputs, selects, textareas, dialog/status/live-region roles, ARIA attributes, `tabIndex`, and autofocus).

Browser evidence:

- Started local dev server: `npm run dev --workspace=apps/web -- --hostname 127.0.0.1 --port 3014`.
- `agent-browser install` confirmed Chromium 150.0.7871.24 already installed.
- The app loaded from `http://127.0.0.1:3014`, but local MySQL was unavailable: Next logged `Could not connect to database to bootstrap queue (ECONNREFUSED)`. DB-backed public pages and protected admin data views could not be fully browser-validated.
- `/en/admin` initially rendered the admin login shell with title `Admin | GalleryKit`, one skip link, one `main`, visible username/password labels, required fields, password reveal button, and submit control in the accessibility tree.
- `/ko/admin` rendered the localized login shell with title `관리 | GalleryKit`, Korean labels, and localized password reveal text.
- Later `/en`, `/en/not-real-route`, and `/en/admin` fell through the localized route error shell because DB-backed route work failed. The error shell still exposed one skip link, one `main`, h1 `Error`, a retry button, and a return link at desktop/mobile and light/dark viewports.
- Verified middleware redirect behavior with `agent-browser open http://127.0.0.1:3014/p/1`: final URL became `http://127.0.0.1:3014/en/p/1`, matching `localePrefix: 'always'` and default-locale fallback.

## Findings

### DES-C5-01 - Admin analytics public links force default-locale pages and English accessible labels

Severity: Low  
Confidence: High  
Status: confirmed by source and browser redirect behavior.  
Selector / region: analytics top-photo links `a[href="/p/${row.imageId}"]`; analytics shared-album links `a[href="/g/${row.shareKey}"]`.

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:112-117` renders top-photo links with `href={`/p/${row.imageId}`}` and an `aria-label` suffix hard-coded as `(opens in new window)`.
- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:194-200` comments that shared-album hrefs are intentionally locale-agnostic.
- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:222-227` renders shared-album links with `href={`/g/${row.shareKey}`}` and the same hard-coded English `aria-label` suffix.
- `apps/web/src/proxy.ts:7-12` configures `next-intl` with `localePrefix: 'always'` and `localeDetection: false`.
- Browser confirmation: opening `/p/1` redirected to `/en/p/1`.

Why this is a problem:

The admin analytics page is localized, but these public-preview links do not preserve the admin's selected locale. A Korean admin reviewing analytics and opening a top photo or shared album gets the English public route by default. Screen-reader users on the Korean admin page also hear English text inside the link accessible name.

Failure scenario:

A Korean-speaking photographer opens `/ko/admin/analytics`, reviews the top shared albums table, and opens a shared album in a new tab to check what a client saw. The link points to `/g/{key}`, which middleware resolves to `/en/g/{key}` rather than `/ko/g/{key}`; assistive tech also announces `{key} (opens in new window)` in English.

Concrete fix:

Pass `locale` into `AnalyticsClient` from `analytics/page.tsx` (or read it with the existing i18n client provider), import `localizePath`, and use:

- `href={localizePath(locale, `/p/${row.imageId}`)}`
- `href={localizePath(locale, `/g/${row.shareKey}`)}`

Add a localized message such as `common.opensInNewWindow` or `analytics.opensInNewWindow`, and build the aria-label from that key instead of inline English. While touching this component, consider formatting `viewCount.toLocaleString(locale)` because the same client currently lacks locale-aware number formatting.

## Rechecked Non-Findings

- Cycle 4 duplicate 404 skip link is fixed: `not-found.tsx` now relies on the root locale-layout skip link and keeps only the local `main#main-content`.
- Cycle 4 Lightroom token date/loading findings are fixed: `tokens-client.tsx` uses `locale` in `formatTokenDate()` and the initial spinner has `role="status"` plus localized hidden text.
- Admin login has visible labels, required/autocomplete attributes, password reveal `aria-pressed`, localized reveal labels, and a `role="alert"` error path.
- Search overlay has a dialog role, focus trap, `aria-activedescendant`, live result/status announcements, keyboard navigation, IME guards, and 44 px close/trigger controls.
- Photo viewer/lightbox/bottom sheet expose reduced-motion branches, focus management, modal semantics, live-region counters, keyboard shortcuts, 44 px controls, and mobile/desktop info-panel transfer logic.
- Upload flow has no-topic recovery, disabled dropzone semantics, progressbar values, per-file `role="alert"` errors, object URL cleanup, and 44 px destructive file-remove targets.
- Admin dashboard failed-image retry now announces success via toast and keeps retry failures visible.
- Analytics table headers use `scope="col"` on the raw tables.
- Touch-target policy remains broadly enforced by primitives plus `touch-target-audit.test.ts`.
- RTL is not a shipped locale; `layout.tsx` sets `dir="ltr"`. This remains an explicit support constraint rather than a current defect for the English/Korean locale set.

## Validation

Passed:

- `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/a11y-us-p15.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/focus-visible-rings-cycle20.test.ts src/__tests__/error-shell.test.ts src/__tests__/error-shell-heading.test.ts`
  - 6 files passed, 60 tests passed.
- `npm test --workspace=apps/web -- --run src/__tests__/i18n-key-parity.test.ts src/__tests__/info-bottom-sheet-ia.test.ts src/__tests__/lightbox-controls-contract.test.ts src/__tests__/search-disclaimer.test.ts src/__tests__/theme-resolve.test.ts src/__tests__/hdr-badge-contrast.test.ts`
  - 6 files passed, 33 tests passed.

Browser artifacts captured in `/tmp/`:

- `/tmp/gallery-admin-desktop-light.png`
- `/tmp/gallery-admin-mobile-320.png`
- `/tmp/gallery-home-error-dark.png`

Validation limitation:

The local DB was not reachable, so real gallery grids, real photo records, map markers, authenticated admin tables, dashboard uploads, search results, and protected analytics rows were validated by source/tests rather than live data interaction.

## Final Missed-Issues Sweep

Final sweep covered localized route construction, hard-coded visible/accessibility strings, table headings, image alt text, decorative SVG/image hiding, focus-visible coverage, touch target classes, loading/status/live regions, dialog/sheet focus patterns, form validation feedback, dark/light/OLED tokens, reduced-motion handling, responsive admin headers, public error/not-found/loading shells, and prior designer/UI findings. No additional current-cycle actionable UI/UX defects were found beyond `DES-C5-01`.
