# Cycle 26 UI/UX Designer Reviewer

Date: 2026-06-30
Role: ui-ux-designer-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `5eb711e7305d`

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`.

Inventory covered before review:

- Public localized routes: home, topic, smart collection, share, shared group, photo, map, timeline, year, privacy, loading, error, not-found, uploads, feeds, metadata.
- Admin routes: login, protected layout, dashboard, settings, SEO, password, users, DB, analytics, categories, tags, tokens.
- Components: nav/search, home masonry, photo viewer, lightbox, info bottom sheet, color details, histogram, upload dropzone, image manager, admin nav/header, map, UI primitives.
- Styles and i18n: `globals.css`, Tailwind usage, `en.json`, `ko.json`.
- Tests and QA references: touch target, focus-visible, a11y, i18n parity, lightbox, search, privacy, admin settings, upload, and Playwright specs.

## Runtime Evidence

- Used `agent-browser` CLI after reading the browser skills.
- Port 3000 was occupied by another process; started this repo on port 3001.
- `http://localhost:3001/en/privacy` loaded and exposed expected nav, main, footer, and notification landmarks.
- Opened Search from the privacy page. The dialog had `aria-modal="true"`, but the accessibility snapshot still exposed the underlying page.
- `http://localhost:3001/en` rendered the public error shell because local MySQL was unavailable.
- Saved screenshots in `/tmp/gallery-c26-privacy-desktop.png`, `/tmp/gallery-c26-search-open.png`, `/tmp/gallery-c26-home-mobile-error.png`.
- Targeted UI/a11y tests passed: 4 test files, 43 tests.

Runtime blocker: seeded DB-dependent states, real photo lightbox, shared-gallery photo navigation, map markers, search results, and authenticated admin workflows were not fully runnable because local MySQL was unavailable. Source-backed evidence was used for those surfaces.

## Findings

### C26-UX-01 - Custom modal dialogs leave background content exposed to assistive technology

- Severity: High
- Confidence: High
- File and lines:
  - `apps/web/src/components/search.tsx:365-383`, `apps/web/src/components/search.tsx:533`
  - `apps/web/src/components/lightbox.tsx:451-459`
  - `apps/web/src/components/info-bottom-sheet.tsx:185-199`
- Runtime selector/evidence: With Search open on `/en/privacy`, `agent-browser snapshot -C` exposed background `link "Skip to content"`, `navigation "Main navigation"`, `main` privacy content, `contentinfo`, `region "Notifications alt+T"`, and the Next dev tools button alongside `dialog "Search photos"`. `agent-browser get attr '#search-dialog' aria-modal` returned `true`.
- Failure scenario: A screen-reader user opens Search, Lightbox, or the mobile info bottom sheet. Keyboard focus is trapped visually, but virtual cursor navigation can still move through and potentially activate background nav, footer, page content, and other controls. The UI declares a modal while the accessibility tree remains non-modal.
- Fix: Prefer Radix `Dialog`/`Sheet` for these surfaces, or add a shared modal manager that sets `inert` plus an `aria-hidden` fallback on app-root siblings while any custom portal modal is open. Keep the active portal outside the hidden subtree. Add a Playwright/a11y regression that opens Search and asserts the accessibility snapshot contains the active dialog without background landmarks or controls.

### C26-UX-02 - Public home DB failure loses normal recovery affordances

- Severity: Medium
- Confidence: High
- File and lines: `apps/web/src/app/[locale]/error.tsx:22-57`; `apps/web/src/app/[locale]/(public)/page.tsx:151-167`
- Runtime selector/evidence: On `http://localhost:3001/en`, the accessibility snapshot exposed only a small header link, heading `Error`, text `Something went wrong loading this page.`, `Try again`, and `Return to Gallery`; normal search/theme/locale/footer affordances were absent.
- Failure scenario: During a backend outage, a public visitor or evaluator lands on a generic error page that removes the product's normal wayfinding and localization affordances. On mobile this reads like a dead-end application crash rather than a temporary gallery data problem.
- Fix: Render expected public data-read failures as a localized degraded gallery state inside the public layout, or align the client error boundary with the not-found IA by preserving brand, locale, theme, footer, and clear maintenance/retry copy. Cover with a route-level failure test.

## Non-Findings / Fixed Since Prior Review

- Search result keyboard discoverability has improved: `apps/web/src/components/search.tsx:394-450` now wires `aria-describedby` to `search-keyboard-instructions`, and the desktop footer shows the instruction when results exist.
- Auto-lightbox loading status is now named in `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx`.
- Photo-viewer global shortcuts now ignore common interactive controls through `isEditableTarget`.
- The touch-target audit, i18n key parity, skip/focus accessibility, and focus-visible link scans passed.

## Missed-Issue Sweep

Final sweep checked modal semantics, focus restoration, keyboard shortcut guards, status/live regions, loading/empty/error shells, responsive nav, mobile search, locale/theme controls, admin form copy, touch-target tests, focus-visible tests, and product-facing locale strings. No additional UI/UX issue rose above this cycle's reporting threshold.
