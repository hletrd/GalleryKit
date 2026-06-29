# Designer Review - Review-Plan-Fix Cycle 4

Role: designer / UI-UX reviewer. Scope: information architecture, affordances, focus/keyboard navigation, WCAG 2.2 accessibility, contrast, ARIA, focus traps, reduced motion, responsive breakpoints, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL, and perceived performance. No application code was edited.

## Inventory Coverage

Read `AGENTS.md` and `CLAUDE.md` first. Consulted current/recent `.context` history including `.context/reviews/designer.md` from cycle 3, `.context/reviews/ui-ux-designer-reviewer.md`, and recent run-9 designer reports to avoid stale duplicates.

Built a UI inventory of 104 relevant files under:
- `apps/web/src/app/[locale]`
- `apps/web/src/components`
- `apps/web/messages`
- `apps/web/src/i18n`

Examined the UI inventory with source reads plus structural scans for interactive elements, labels, ARIA, focus traps, dialogs/sheets, loading states, reduced-motion hooks/classes, metadata, directional CSS, localized date formatting, and touch-target classes. Also checked adjacent tests and plans for stale findings.

Browser evidence:
- Used `agent-browser`; Chromium was already installed.
- Reused existing Next dev server at `http://127.0.0.1:3014`.
- Local MySQL was unavailable (`ECONNREFUSED 127.0.0.1:3306`), so DB-backed public pages rendered error boundaries or could not reach the intended 404 shell. This is recorded as a validation limitation.
- Live-checked `/en/admin` and `/ko/admin` at desktop/mobile sizes with accessibility snapshots and DOM state. Both rendered one `main`, one skip link, localized titles (`Admin | GalleryKit`, `관리 | GalleryKit`), labelled username/password fields, 44 px password-toggle and submit controls, and working password reveal.
- Live-checked `/en` under DB failure. It rendered a localized route error shell with one `main`, h1, 44 px action controls, and no browser page errors beyond the expected server query failure.

## Findings

### DES-C4-01 - 404 pages render a duplicate skip link before navigation

Severity: Low  
Confidence: High  
Status: confirmed by source; manual browser validation blocked because local DB failure crashes `Nav` before the intended not-found shell renders.

Evidence:
- `apps/web/src/app/[locale]/layout.tsx:123-128` always renders a root skip link targeting `#main-content`.
- `apps/web/src/app/[locale]/not-found.tsx:20-23` renders another identical skip link before its local `Nav`.
- `apps/web/src/app/[locale]/not-found.tsx:24-51` intentionally reproduces the public shell (`Nav`, `main#main-content`, `Footer`) because the route-level 404 does not inherit the `(public)` layout. That makes the local `main` necessary, but the second skip link is now redundant because the root locale layout already provides one.

Why this is a problem: keyboard users landing on a 404 encounter two identical "Skip to content" controls in sequence before the page navigation. The second control does not add a new bypass target or function; it lengthens the first-tab path on an error recovery page.

Failure scenario: a keyboard user opens a dead URL, presses Tab expecting to move from the global skip link into the navigation or page action, and instead lands on a second visually identical skip link. Screen-reader link lists also contain duplicate same-name same-target links.

Concrete fix: remove the local `<a href="#main-content">` from `not-found.tsx` and keep the local `main#main-content`, `Nav`, and `Footer`. Add a source or rendered test asserting that the not-found shell has exactly one `a[href="#main-content"]` and one `main#main-content`.

### DES-C4-02 - Lightroom token dates ignore the selected app locale

Severity: Low  
Confidence: High  
Status: confirmed by source; protected route was not browser-authenticated locally.

Evidence:
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:22` destructures only `t` from `useTranslation()`, dropping the current `locale`.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:123`, `:125`, and `:128` format created/last-used/expiry dates with bare `toLocaleDateString()`.
- Nearby admin surfaces already pass the app locale explicitly, e.g. `apps/web/src/components/admin-user-manager.tsx:153` and `apps/web/src/components/image-manager.tsx:536`.

Why this is a problem: the admin UI supports explicit English/Korean locale switching, but token dates fall back to the browser or OS locale. That can make a Korean admin page show English/US date formatting, or vice versa.

Failure scenario: an admin switches GalleryKit to Korean on an English-configured browser and opens the Lightroom token page. Labels are Korean, but token dates can still appear as `6/29/2026`, making the row feel partially untranslated and harder to scan consistently.

Concrete fix: destructure `locale` from `useTranslation()` and call `toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })` or a shared date formatter for all three token dates. Add a small source/test guard rejecting bare `toLocaleDateString()` in UI files except where explicitly justified.

### DES-C4-03 - Lightroom token list loading state is a silent spinner

Severity: Low  
Confidence: High  
Status: confirmed by source; protected route was not browser-authenticated locally.

Evidence:
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:107-110` renders the initial token-list loading state as a centered `Loader2` icon only.
- The wrapper has no `role="status"`, no `aria-live`, and no text alternative; the SVG also is not explicitly `aria-hidden`.
- Other loading surfaces in this repo expose status semantics, e.g. `apps/web/src/app/[locale]/loading.tsx:8`, `apps/web/src/components/photo-viewer-loading.tsx:11-13`, and `apps/web/src/components/optimistic-image.tsx:71`.

Why this is a problem: visual users see an activity indicator while `listLrTokens()` runs, but screen-reader users receive no loading announcement and no textual state for the panel.

Failure scenario: an admin opens the token page over a slow DB connection. The list area appears empty to assistive tech until either the token rows or empty state arrive, making the page feel stalled.

Concrete fix: wrap the loading state in `role="status" aria-live="polite"` with localized loading text, and mark the spinner `aria-hidden="true"`. Example shape: `<div role="status" aria-live="polite"> <Loader2 aria-hidden="true" ... /> <span className="sr-only">{t('common.loading')}</span> </div>`.

## Non-Findings Rechecked

- Cycle-3 duplicate document-title finding is fixed for timeline/map/year. Current source lets the layout title template append the site name while OpenGraph/Twitter titles remain explicit.
- Cycle-3 theme-toggle finding is fixed. `nav-client.tsx` now computes `aria.cycleTheme` with current and next theme labels, and `en.json` / `ko.json` contain the key.
- Cycle-3 map loading fallback is fixed. `MapLoader` now wraps the client-only map in `Suspense` with a fixed-size `role="status"` fallback.
- Admin login form has visible labels, required attributes, proper autocomplete, localized password-toggle labels, 44 px controls, and working reveal behavior in both English and Korean.
- Public route error shell under DB failure has one `main`, one h1, 44 px action controls, and task-specific title `Error | GalleryKit`.
- Reduced-motion coverage is present globally in `globals.css:291-297`, with component-specific handling in lightbox/photo-viewer/home surfaces. No new unbounded motion defect was found.
- Dialog, alert-dialog, sheet, search overlay, lightbox, and bottom-sheet patterns expose focus traps or Radix-managed modal behavior where applicable.
- Touch-target source patterns remain broadly enforced through component primitives and `touch-target-audit.test.ts`.
- RTL is not a shipped locale (`html dir="ltr"`), and no new RTL-specific regression was filed. Directional utility use remains an LTR-only support constraint rather than a current defect.

## Missed-Issues Sweep

Final sweep covered public/admin metadata, skip-link targets, not-found/error/loading states, dialog/sheet focus patterns, search and tag comboboxes, admin forms, Lightroom token UI, upload controls, map shell, photo/lightbox/color surfaces, dark/light/OLED token usage, reduced-motion hooks/global CSS, i18n key parity risks, localized date formatting, and prior cycle findings.

Coverage limitation: without a local MySQL service or authenticated admin session, loaded gallery grids, photo records, map markers, authenticated token rows, dashboard tables, and real search results could not be fully browser-validated. For those surfaces, this pass used source, tests, DOM/error-shell evidence, and prior review history.
