# Cycle 26 Designer Review

Date: 2026-06-30
Role: designer
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `5eb711e7305d`

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`.

Built inventory before review:

- App route files: 77 under `apps/web/src/app`.
- Components: 57 under `apps/web/src/components`.
- Tests: 275 under `apps/web/src/__tests__`, 8 under `apps/web/e2e`.
- Locales: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Product/docs surfaces: `README.md`, `apps/web/README.md`, env examples, nginx, Docker/deploy files, site config example.
- Public UI reviewed by source and browser: home, privacy, nav/footer, search, public error shell, loading shells, photo viewer/lightbox/bottom sheet paths, timeline/topic/share/map routes where source-backed.
- Admin UI reviewed by source: login, protected layout, settings, dashboard, tokens, users, analytics, DB, categories, tags, SEO, upload/image manager.

## Runtime Evidence

- Port 3000 was already occupied by another `node` listener, so I left it alone.
- Started this repo with `npm run dev --workspace=apps/web -- --port 3001`.
- `agent-browser install` confirmed Chromium was installed.
- Browser checks:
  - `http://localhost:3001/en/privacy` loaded successfully at desktop and mobile widths.
  - Search dialog was opened from the privacy page and inspected with accessibility snapshots.
  - `http://localhost:3001/en` rendered the public route error shell because local MySQL was unavailable.
- Screenshots saved:
  - `/tmp/gallery-c26-privacy-desktop.png`
  - `/tmp/gallery-c26-search-open.png`
  - `/tmp/gallery-c26-home-mobile-error.png`
- Validation: `npm test --workspace=apps/web -- touch-target-audit.test.ts i18n-key-parity.test.ts a11y-us-p15.test.ts focus-visible-links-scan.test.ts` passed 4 files / 43 tests.

Runtime blocker: DB-backed gallery/photo/shared/map/admin-auth flows could not be fully exercised because the local app logged MySQL connection failures. I used source-backed evidence for those paths.

## Findings

### C26-DES-01 - Public data failures collapse into a stripped generic error shell

- Severity: Medium
- Confidence: High
- File and lines: `apps/web/src/app/[locale]/error.tsx:22-57`; `apps/web/src/app/[locale]/(public)/page.tsx:93`, `apps/web/src/app/[locale]/(public)/page.tsx:151-167`
- Runtime selector/evidence: `http://localhost:3001/en` accessibility snapshot exposed `banner > navigation "Site navigation" > link "Gallery"`, `main > region "Error"`, `button "Try again"`, and `link "Return to Gallery"`, with no search, theme, locale, footer, or normal public nav controls.
- Failure scenario: During DB restart, migration drift, first-run misconfiguration, or a demo without MySQL, a public visitor sees a generic app error rather than a gallery-specific degraded state. They lose normal wayfinding, locale/theme controls, footer/admin links, and search context, making a temporary backend issue feel like a broken product.
- Fix: Add a client-safe public error shell that preserves the normal public IA affordances, or catch expected DB-unavailable reads in public listing pages and render a localized `PublicDataUnavailable` state inside the normal layout. Let metadata fall back to file/site settings when `getLatestImageForOgCached` fails. Add a regression that simulates a public data-read failure and asserts the recovery affordances remain visible.

## Prior-Issue Recheck

- Fixed since cycle 25: auto-lightbox loading now has `aria-label={t('photo.loading')}` plus sr-only text in `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx`.
- Fixed since cycle 25: photo-viewer shortcut suppression now treats links, buttons, selects, menu items, options, switches, and Radix popper content as interactive targets in `apps/web/src/components/photo-viewer.tsx`.
- Still current and covered by the UI/UX file: custom modal surfaces expose background content to assistive tech.

## Missed-Issue Sweep

Searched and inspected `aria-*`, `role=`, `tabIndex`, `focus-visible`, `sr-only`, `aria-live`, `loading`, `error`, `empty`, `not-found`, modal portals, public route metadata, admin settings copy, locale messages, README/operator claims, product feature claims, and existing UI/a11y tests. No additional designer-severity finding rose above the reporting threshold.
