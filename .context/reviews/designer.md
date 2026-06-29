# Designer UI/UX Review — Cycle 1/100 Prompt 1

Scope: repository-wide GalleryKit UI/UX review for public, shared, photo-viewer, admin, UI primitive, styles, i18n, and UI/a11y tests. This is source-backed; live browser validation was attempted with the local app.

## Inventory Reviewed

- Project docs: `AGENTS.md`, `CLAUDE.md`.
- Public routes: `apps/web/src/app/[locale]/(public)/**`, root localized `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `global-error.tsx`.
- Admin routes: `apps/web/src/app/[locale]/admin/**`.
- Components: all files under `apps/web/src/components/**`, including shadcn/Radix wrappers, photo viewer, lightbox, search, map, upload, image manager, bottom sheet, color/HDR surfaces, nav/footer.
- Styles/config: `apps/web/src/app/[locale]/globals.css`, `apps/web/tailwind.config.ts`.
- Messages: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- UI/a11y tests and e2e specs: `touch-target-audit`, `a11y-us-p15`, `focus-visible-*`, `info-bottom-sheet-ia`, `search-disclaimer`, `switch-geometry-contract`, `hdr-badge-contrast`, Playwright public/admin/nav specs.

## Validation Evidence

- `npm run dev --workspace=apps/web -- --hostname 127.0.0.1 --port 3010`
  - Server started, but logged `Could not connect to database to bootstrap queue (ECONNREFUSED)`.
- `agent-browser` runtime checks:
  - `/en/admin` rendered the login surface; DOM had `mainContentCount: 1`.
  - `/en` and `/en/this-route-does-not-exist-xyz` fell into the localized error boundary because DB-backed page data was unavailable; accessibility tree exposed “Skip to content”, but DOM had `mainContentCount: 0`.
- Targeted tests:
  - `npm test --workspace=apps/web -- touch-target-audit a11y-us-p15 focus-visible-links-scan info-bottom-sheet-ia search-disclaimer switch-geometry-contract hdr-badge-contrast`
  - Result: 7 files passed, 58 tests passed.

## Findings

### D1 — Localized Error Boundary Has a Broken Skip Link Target

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Files/regions:
  - `apps/web/src/app/[locale]/layout.tsx:123-128` renders a global skip link to `#main-content`.
  - `apps/web/src/app/[locale]/error.tsx:16-46` renders `<main role="main">` without `id="main-content"` or `tabIndex={-1}`.
  - `apps/web/src/__tests__/a11y-us-p15.test.ts:29-37` only asserts the public sub-layout target, not the localized error boundary.
- Evidence:
  - Browser DOM on `/en` error state: `mainCount: 1`, `mainContentCount: 0`.
  - Accessibility tree exposed `link "Skip to content"` followed by a main region, but the link target did not exist.
- Failure scenario:
  - During DB outage or route render failure, keyboard users tab to “Skip to content”, activate it, and focus does not move into the error page’s main content. This weakens WCAG 2.4.1 bypass behavior exactly when the user needs recovery controls.
- Concrete fix:
  - Change `error.tsx` to `<main id="main-content" tabIndex={-1} className="... focus:outline-none">`.
  - Add a source test beside `a11y-us-p15.test.ts` asserting `[locale]/error.tsx` carries the target because it is rendered under the global localized layout.

### D2 — Search Results Are Tab-Focusable but the Focus Scanner Exempts Them

- Severity: Medium
- Confidence: High
- Status: Confirmed from source; runtime search could not be loaded without DB.
- Files/regions:
  - `apps/web/src/components/search.tsx:71-79` renders each result as a real `<Link role="option" href=...>` with no `tabIndex={-1}` and no `focus-visible:*` style.
  - `apps/web/src/components/search.tsx:345-376` uses input `role="combobox"` with `aria-activedescendant`.
  - `apps/web/src/__tests__/focus-visible-links-scan.test.ts:41-42` and `:69-75` exempt `role="option"` because the test assumes result rows are “not Tab focus”.
  - `apps/web/e2e/public.spec.ts:21-40` tests one Tab remains inside the dialog but does not create results or assert visible focus on a result row.
- Evidence:
  - Source contract mismatch: anchors with `href` are Tab-focusable unless removed from the tab order. The scanner’s documented premise does not match the component.
- Failure scenario:
  - A keyboard user opens search, types a query, presses Tab into a result row, and receives no visible focus indicator unless the row also happens to be the active descendant. This is a WCAG 2.4.7 / 2.4.11 regression hidden by the test exemption.
- Concrete fix:
  - Pick one pattern and make it consistent:
    - Preferred combobox pattern: keep focus on the input, set result links `tabIndex={-1}`, navigate with arrow keys/Enter, and keep `aria-activedescendant`.
    - Or link-list pattern: remove `role="option"`/`aria-activedescendant` coupling and add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` plus `onFocus={() => setActiveIndex(idx)}` to result rows.
  - Update `focus-visible-links-scan.test.ts` so `role="option"` is exempt only when the element is not Tab-focusable.

### D3 — Error States Can Render With an Empty Document Title

- Severity: Medium
- Confidence: Medium
- Status: Confirmed runtime under DB-down dev environment; root cause likely spans metadata/error rendering.
- Files/regions:
  - `apps/web/src/app/[locale]/layout.tsx:17-58` owns localized metadata.
  - `apps/web/src/app/[locale]/error.tsx:7-47` renders the visible error UI but cannot export static metadata as a client error boundary.
  - `apps/web/src/lib/data.ts:1704-1725` catches SEO DB failures and falls back to `site-config`, so the empty title needs investigation at the boundary/metadata integration level rather than a simple missing fallback in `getSeoSettings`.
- Evidence:
  - `agent-browser eval` on `/en` after the DB-triggered error returned `"title": ""`, while the body showed the localized error UI.
- Failure scenario:
  - Screen-reader users and browser-tab users land on an error page with no meaningful document title, violating the intent of WCAG 2.4.2 Page Titled and making recovery tabs hard to distinguish.
- Concrete fix:
  - Add a regression test for DB/error-boundary rendering that asserts `document.title` is non-empty on the localized error page.
  - Investigate why root metadata is not surviving this error path despite `getSeoSettings()` fallback; if Next cannot guarantee it, set a client-side fallback title in `error.tsx` via a guarded `useEffect` using the localized error title plus the stamped `data-gallery-title`.

### D4 — SEO Settings Hints Are Visual Only

- Severity: Low
- Confidence: High
- Status: Confirmed from source.
- Files/regions:
  - `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:95-174` renders hint paragraphs for site title, nav title, description, author, locale, and OG image URL, but the related inputs/textareas do not use `aria-describedby`.
  - Contrast: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:347-400` correctly associates many setting hints via `aria-describedby`.
- Evidence:
  - Source has visible hints at `seo-client.tsx:104`, `:116`, `:129`, `:141`, `:153`, `:174`; corresponding fields at `:97-103`, `:109-115`, `:121-128`, `:134-140`, `:146-152`, `:166-173` lack descriptions.
- Failure scenario:
  - A screen-reader admin hears the field label but not important instructions like “leave empty for default”, expected locale format, or URL purpose. That weakens WCAG 1.3.1 / 3.3.2 instruction relationships and increases avoidable validation errors.
- Concrete fix:
  - Give each hint an id, for example `seo-title-help`, and add matching `aria-describedby` to its input/textarea.
  - Add a source contract test similar to the settings-client hint coverage.

## Final Sweep

- Information architecture: public nav, admin nav, topic/year/map/share routes have landmarks and current-page states; localized error boundary is the main IA exception because its skip target is missing.
- Affordances and touch targets: targeted touch audit passed; shadcn button/select/switch primitives enforce 44px floors. Remaining documented admin touch exceptions are intentional desktop-priority areas in the audit map.
- Focus and keyboard: modal/search/lightbox/bottom-sheet traps and restoration have tests; search result focus is the notable unguarded mismatch.
- WCAG contrast: core tokens include documented light/dark/OLED contrast adjustments; targeted HDR/destructive text tests passed.
- ARIA: major dialogs and live regions are present; SEO hints need programmatic relationships.
- Reduced motion: global `prefers-reduced-motion` rule suppresses transitions/animations and hover scale; photo viewer/lightbox/image zoom also have source-level reduced-motion handling.
- Responsive breakpoints: public masonry, nav, photo viewer, bottom sheet, timeline/year grids were inspected; no new source-backed breakpoint defect found.
- Loading/empty/error states: loading components use `role="status"`; empty states exist for public/admin surfaces. Error boundary has the skip-target/title gaps above.
- Dark/light/OLED: theme tokens and global-error theme preservation were inspected; no new source-backed issue found.
- i18n/RTL: English/Korean messages are present and `dir="ltr"` is explicit. RTL is not currently product-relevant because supported locales are LTR, but adding RTL locales will require making `dir` locale-derived.
- Perceived performance: source shows LCP/eager logic, intrinsic-size/aspect-ratio reservations, sized derivatives, and reduced neighbor preloads. Live performance profiling was skipped because the local DB was unavailable and the gallery routes rendered error states.
- Skipped/irrelevant live areas: DB-backed homepage/search/photo/map/share/admin protected flows could not be fully browser-tested locally due `ECONNREFUSED`; review falls back to source/test evidence for those areas. No raw-screenshot-only findings are included.
