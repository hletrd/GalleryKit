# Cycle 31 Designer UI/UX Review

Reviewer lane: designer plus custom UI/UX coverage. Product code was not edited.

## Evidence

- Project context: `AGENTS.md` and `CLAUDE.md` reviewed. Relevant product constraints: photographer intent, no edit/culling/scoring features, color/HDR honesty, English/Korean UI, 44 px touch target policy.
- Custom reviewer prompts: `/Users/hletrd/.codex/agents/product-marketer-reviewer.md` and `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md` were readable; their review lenses were incorporated into the separate artifacts.
- Local runtime: `npm run dev --workspace=apps/web -- --port 3021` reached Next.js, but the app rendered the error shell because MySQL was unavailable: `ECONNREFUSED`, then a failing topics query. Local screenshot: `/tmp/gallery-local-home-desktop.png`.
- Live runtime: `https://gallery.atik.kr/en` tested with agent-browser at desktop `1440x1000` and mobile `390x844`.
- Live screenshots: `/tmp/gallery-live-home-desktop.png`, `/tmp/gallery-live-home-mobile.png`, `/tmp/gallery-live-home-mobile-menu.png`, `/tmp/gallery-live-photo-mobile.png`, `/tmp/gallery-live-lightbox-mobile.png`.

## UI Inventory

- Public routes: `apps/web/src/app/[locale]/(public)/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `c/[slug]/page.tsx`, `map/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `privacy/page.tsx`.
- Admin routes: `apps/web/src/app/[locale]/admin/**`, `apps/web/src/app/api/**`.
- Public UI: `home-client.tsx`, `nav-client.tsx`, `search.tsx`, `tag-filter.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `image-zoom.tsx`, `color-details-section.tsx`, `wide-gamut-hint.tsx`, `lightbox-color-pip.tsx`, `footer.tsx`, `load-more.tsx`.
- Admin UI: `login-form.tsx`, `upload-dropzone.tsx`, `tag-input.tsx`, `image-manager.tsx`, `settings-client.tsx`, `admin-nav.tsx`.
- Global UX systems: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`.

## Findings

### D31-UX-01: Mobile home delays the photo-first experience behind a large tag wall

- Severity: Medium
- Confidence: High
- Evidence: live mobile `390x844`; tag chips occupy approximately `y=180..380`, and the first photo card begins around `y=412`. Source order places the filter before the gallery in `apps/web/src/components/home-client.tsx:255` and `apps/web/src/components/home-client.tsx:273`; the filter renders every tag as wrapping 44 px controls in `apps/web/src/components/tag-filter.tsx:63` and `apps/web/src/components/tag-filter.tsx:120`.
- Selector/metric: `[role="group"][aria-label*="Filter"] button` heights were 44 px, but the wrapped group consumed roughly 200 px of first-screen height.
- Failure scenario: a first-time mobile visitor lands on a photographer portfolio and sees taxonomy controls before enough photography, weakening IA and perceived content quality.
- Fix: on small screens, make the tag filter horizontally scrollable, collapsed behind a "Filters" control, or cap visible chips with a "More filters" disclosure after the first row. Keep the active filter visible.

### D31-UX-02: Idle lightbox can expose a dialog with no actionable controls in the accessibility tree

- Severity: Medium
- Confidence: Medium
- Evidence: live mobile lightbox snapshot after controls auto-hid showed only `dialog "Photo lightbox"` and the image. Source hides every overlay control with `aria-hidden` and `tabIndex=-1` when `controlsVisible` is false in `apps/web/src/components/lightbox.tsx:371`; the overlay opacity also becomes 0 in `apps/web/src/components/lightbox.tsx:546` and `apps/web/src/components/lightbox.tsx:550`. Close, fullscreen, slideshow, previous, and next controls are inside that hidden overlay at `apps/web/src/components/lightbox.tsx:555`, `apps/web/src/components/lightbox.tsx:576`, `apps/web/src/components/lightbox.tsx:600`, `apps/web/src/components/lightbox.tsx:623`, and `apps/web/src/components/lightbox.tsx:644`.
- Selector/metric: `role=dialog[aria-label="Photo lightbox"]` accessibility snapshot contained image content only after the 3 second hide timer from `apps/web/src/components/lightbox.tsx:201`.
- Failure scenario: a screen reader, switch, or voice-control user idles in the modal and loses discoverable close/navigation actions until another interaction re-reveals controls.
- Fix: keep at least close and next/previous controls in the accessibility tree while visually hidden, or provide a persistent visually hidden command group. Avoid setting `aria-hidden` on essential modal controls solely because the visual overlay is faded.

### D31-UX-03: Search error messaging is duplicated for assistive technology

- Severity: Low
- Confidence: High
- Evidence: live search for `jihoon` returned "Search is temporarily unavailable. Please try again later." twice in the accessibility snapshot. Source writes the same status into an `sr-only` live region in `apps/web/src/components/search.tsx:440` and a visible message in `apps/web/src/components/search.tsx:473`.
- Selector/metric: search dialog `#search-input` plus live region; duplicate text appeared after the query failed.
- Failure scenario: screen reader users hear or encounter the same failure twice, making the command dialog feel broken rather than merely unavailable.
- Fix: choose one announcement path. Either make the visible status the live region, or keep the `sr-only` live region and mark the duplicate visible copy `aria-hidden="true"` for repeated status text.

### D31-UX-04: Photo card links can read repetitively in the accessibility tree

- Severity: Low
- Confidence: Medium
- Evidence: live desktop link text for initial `a[href*="/p/"]` cards repeated title/topic text. Source sets an authoritative `aria-label` on the link in `apps/web/src/components/home-client.tsx:323`, then also exposes image alt text in `apps/web/src/components/home-client.tsx:353` and overlay headings/copy in `apps/web/src/components/home-client.tsx:395` and `apps/web/src/components/home-client.tsx:401`.
- Selector/metric: first desktop card `a[href="/en/p/348"]` exposed repeated `#Color in Music Festival` and `TWS` text in the browser accessibility tree.
- Failure scenario: screen reader browse mode on the masonry grid becomes verbose, especially across dozens of visually similar cards.
- Fix: treat overlay text as decorative for AT when the link `aria-label` is authoritative, or reduce image alt duplication inside linked cards while preserving descriptive alt text on the detail page.

### D31-UX-05: Live production search failed for a known visible term

- Severity: Medium
- Confidence: High
- Evidence: on `https://gallery.atik.kr/en`, visible chips included `JIHOON`, but entering `jihoon` in the search dialog produced the generic unavailable state. Source maps failures into `error` in `apps/web/src/components/search.tsx:160` through `apps/web/src/components/search.tsx:270`, then displays the generic status at `apps/web/src/components/search.tsx:473`.
- Selector/metric: `#search-input` query `jihoon`; no result list, error status shown.
- Failure scenario: users try the most obvious discovery mechanism for a known performer and lose trust in the gallery's findability.
- Fix: fix the backend failure path, then add a graceful fallback that links visible tag matches or recent cached results when full search is unavailable.

### D31-UX-06: RTL support is scaffolded but not ready to activate safely

- Severity: Low
- Confidence: High
- Evidence: layout sets `dir={getLocaleDirection(locale)}` in `apps/web/src/app/[locale]/layout.tsx:94`, but shipped locale switching is English/Korean in `apps/web/src/components/nav-client.tsx:19`. Several UI controls still use physical directions: `right-4`, `left-0`, and `right-0` in `apps/web/src/components/lightbox.tsx:555`, `apps/web/src/components/lightbox.tsx:621`, and `apps/web/src/components/lightbox.tsx:642`; mobile nav spacing uses physical margin classes in `apps/web/src/components/nav-client.tsx:100` and `apps/web/src/components/nav-client.tsx:170`.
- Selector/metric: no RTL locale is currently exposed; this is a future-activation risk, not a current English/Korean defect.
- Failure scenario: adding Arabic/Hebrew later would flip text direction but leave navigation, lightbox, and carousel affordances physically oriented.
- Fix: before adding RTL locales, convert directional layout to logical start/end utilities and add RTL visual snapshots for nav, search, home, photo viewer, and lightbox.

## Coverage Notes

- IA: public IA is simple and understandable: top nav, topic links, search, tags, masonry, photo detail. The mobile filter placement is the main IA concern.
- Affordances: nav, search, theme, language, photo viewer controls, and admin controls generally use icon buttons with accessible names. Live mobile touch target metrics showed nav/buttons/chips at or above 44 px.
- Keyboard/focus: skip link exists in `apps/web/src/app/[locale]/layout.tsx:119`; search supports `Ctrl/Cmd+K` and Escape in `apps/web/src/components/search.tsx:297`; photo viewer supports arrow/F/I/C/H shortcuts in `apps/web/src/components/photo-viewer.tsx:370`; lightbox focus management starts at `apps/web/src/components/lightbox.tsx:434`. Lightbox auto-hide is the remaining keyboard/AT risk.
- WCAG 2.2 and contrast: `apps/web/src/app/globals.css:14` through `apps/web/src/app/globals.css:101` defines light/dark/OLED tokens with contrast comments; forced-colors adjustments exist at `apps/web/src/app/globals.css:164` and `apps/web/src/app/globals.css:281`; reduced motion support exists at `apps/web/src/app/globals.css:253`.
- ARIA: search combobox attributes are explicit in `apps/web/src/components/search.tsx:394`; tag filter uses `aria-pressed` in `apps/web/src/components/tag-filter.tsx:81`; photo viewer has a hidden H1 and description in `apps/web/src/components/photo-viewer.tsx:540`. Main ARIA defects are duplicated search status and lightbox hidden controls.
- Responsive: masonry breakpoints are explicit in `apps/web/src/components/home-client.tsx:35`; mobile nav menu worked at `390x844`; photo viewer controls met target sizes at mobile. The filter wall is the main responsive layout issue.
- Loading/empty/error: loading uses `role="status"` in `apps/web/src/app/[locale]/loading.tsx:8`; public error shell rendered locally and provided retry/home actions in `apps/web/src/app/[locale]/error.tsx:22`; empty gallery copy exists in `apps/web/src/components/home-client.tsx:426`.
- Form validation UX: login labels, invalid state, descriptions, and alert are in `apps/web/src/components/login-form.tsx:58` through `apps/web/src/components/login-form.tsx:129`; upload disabled/no-topic/progress states are in `apps/web/src/components/upload-dropzone.tsx:373` through `apps/web/src/components/upload-dropzone.tsx:488`.
- Dark/light: theme provider supports system/light/dark/OLED in `apps/web/src/app/[locale]/layout.tsx:130`; theme button worked in the live nav; CSS includes dark and OLED tokens.
- i18n: English/Korean messages exist; `dir` is wired for future locales, but RTL needs a dedicated pass before activation.
- Perceived performance: images use sized AVIF/WebP/JPEG sources and lazy/eager behavior in `apps/web/src/components/home-client.tsx:333`; reduced motion suppresses major transforms in `apps/web/src/app/globals.css:253`. Hover/card transitions around `500ms` in `apps/web/src/components/home-client.tsx:357` and sidebar transitions around `500ms` in `apps/web/src/components/photo-viewer.tsx:718` may feel slow for repeated professional browsing.

## Verdict

The UI is generally mature: touch targets, focus rings, color modes, reduced motion, form validation, and error shells are well-covered. The current cycle should prioritize mobile information architecture, live search reliability, and lightbox accessibility discoverability before adding new surface area.
