# GalleryKit Designer Review - Cycle 7 Lane F

Date: 2026-07-07
Reviewed workspace: `/Users/hletrd/flash-shared/gallery`
Lane: designer
Mode: read-only UI/UX review, writing only this review artifact.

## Inventory

Review-relevant inventory was built before selecting findings. I enumerated 605 files across the UI/product surface:

- `apps/web/src/app/**`: 80 route/layout/action files covering public home, topic, photo, share/group, map, timeline, year, smart collection, privacy, not-found/error, admin login, and protected admin pages.
- `apps/web/src/components/**`: 60 UI components, including nav, search, home grid, cards, photo viewer, lightbox, info sheet, map, upload/admin controls, theme provider, and UI primitives.
- `apps/web/src/lib/**`: 111 supporting files for config, data shaping, i18n paths, image URLs, color/HDR metadata, search, privacy-sensitive selects, and settings.
- `apps/web/messages/**`: English and Korean message catalogs.
- `apps/web/e2e/**`: 10 Playwright browser-flow specs.
- `apps/web/src/__tests__/**`: 342 Vitest contract/unit/a11y files, including touch target, focus-visible, error shell, public/admin route, privacy, lightbox, and i18n tests.

I also read `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, the local designer/product reviewer instructions, and the project review context. This was not a sample-only pass.

## Browser And Code Evidence

Local app startup was not attempted because this lane was read-only and the deployed production instance was reachable with real data. I used `BASE_URL=https://gallery.atik.kr` via `agent-browser` and backed browser observations with source/test evidence.

Routes exercised:

- `/en` desktop and mobile: navigation, mobile menu, tag filters, masonry photo links, footer, search trigger, theme and locale controls.
- `/ko`: Korean localization and `html[lang="ko"]`.
- `/en/admin`: login form, empty-submit validation, required fields, password reveal, alert text.
- `/en/p/348`: photo detail, viewer toolbar, keyboard shortcut instructions, similar photos disclosure, histogram controls, download link.
- `/en/map`: empty geotagged-map state.
- `/en/nonexistent-topic-cycle7-lane-f`: 404 shell and document metadata.

Representative browser evidence:

- Main nav exposes `navigation "Main navigation"`, skip link, `Expand menu` / `Collapse menu`, `Search photos`, theme, locale, topic links, and footer links.
- Search dialog exposes `role="dialog"`, `combobox` label `Search photos, tags, cameras...`, Close button, semantic-search switch, live result count, and Escape focus restore.
- Admin login empty submit produced role alerts `Username is required` and `Password is required`; fields had `required`, `aria-invalid`, and described error regions.
- Touch-target spot checks on live DOM measured visible public controls at 44 px or larger, matching source contracts such as `nav-client.tsx:101-118`, `nav-client.tsx:140-190`, `home-client.tsx:332-378`, and `footer.tsx:38-57`.

Focused validation:

```bash
npm test --workspace=apps/web -- src/__tests__/error-shell-heading.test.ts src/__tests__/privacy-page-landmark.test.ts src/__tests__/focus-visible-rings-cycle20.test.ts src/__tests__/info-bottom-sheet-ia.test.ts
```

Result: 4 files passed, 16 tests passed.

## Findings

### DES-C7F-01 - 404 pages keep the generic gallery document title

Severity: Medium
Confidence: High
Status: confirmed

Evidence:

- Browser route: `https://gallery.atik.kr/en/nonexistent-topic-cycle7-lane-f`
- DOM/browser result: visible page correctly showed `404`, heading `Page not found.`, `Back to gallery`, nav, and footer, and emitted a single `noindex` robots tag. `document.title` remained `ATIK.KR Gallery`.
- Source: `apps/web/src/app/[locale]/not-found.tsx:12-49` renders the not-found shell but has no title override or client title effect.
- Source: `apps/web/src/app/[locale]/layout.tsx:22-27` supplies the default/template title, and `apps/web/src/app/[locale]/layout.tsx:54-66` documents that `not-found.tsx` cannot export its own metadata in the current route shape.
- Test gap: `apps/web/e2e/not-found-status.spec.ts:14-89` pins HTTP 404 and robots behavior but does not assert the 404 page title.

Failure scenario:

A keyboard or screen-reader user opens several tabs from search results or pasted links and cannot distinguish a dead-end 404 tab from a valid gallery tab by the browser title. Search engines and monitoring get the correct 404/noindex signals, but the human-facing error state misses WCAG 2.4.2 page-title specificity.

Suggested fix:

Add a tiny client component inside the not-found shell that sets the document title to localized copy such as `Page not found | {siteTitle}` after hydration, or adopt a supported route-level/global not-found metadata mechanism if the app moves to that structure. Add an e2e assertion beside `not-found-status.spec.ts` that verifies both the visible H1 and title on `/en/nonexistent-page-xyz-abc` and `/ko/...`.

## Coverage Sweep

Information architecture:

- Public IA is clear on live data: nav topics, search, language/theme controls, photo cards, footer, privacy, and admin entry are discoverable. Source confirms home structure and empty states in `apps/web/src/components/home-client.tsx:287-360`.
- Photo detail has a hidden H1, explicit shortcut instructions, viewer controls, metadata sections, and similar-photo disclosure in `apps/web/src/components/photo-viewer.tsx`.

Affordances:

- Buttons and links use labels, `aria-current`, visible hover/focus styling, and 44 px hit targets in nav/footer/tag/filter/photo-viewer code paths. Live DOM spot checks agreed.
- Search semantic mode is not a dead-looking toggle on production: enabling semantic search and searching `concert` returned live results and a live result count.

Keyboard and focus navigation:

- Search opens from the nav, focuses the input, closes on Escape, and restores focus to the trigger. Source backs this in `apps/web/src/components/search.tsx:319-336` and dialog markup around `search.tsx:417-482`.
- Photo viewer and lightbox include keyboard handling and focus restoration in `photo-viewer.tsx` and `lightbox.tsx`; targeted focus/error tests passed.

WCAG 2.2 accessibility:

- Confirmed strengths: landmarks, skip link, page H1s, focus-visible rings, role alerts on login validation, touch target contracts, `lang` and `dir` attributes.
- Confirmed issue: 404 title specificity, listed above.

Responsive breakpoints:

- Desktop 1440 and mobile 390 browser passes were usable. Mobile menu expansion exposed topic links and controls without hiding primary search/theme/language affordances.

Loading, empty, and error states:

- Search has unavailable/error status copy and a live status region.
- Map route has an explicit empty geotagged-photo state.
- Home and filtered-empty states are coded in `home-client.tsx:344-360`.
- 404 shell has usable wayfinding, but title needs the fix above.

Form validation UX:

- Admin login prevents empty submit with localized inline alerts, `aria-invalid`, and required fields. Evidence came from live DOM and `apps/web/src/app/[locale]/admin/login-form.tsx:31-45`, `65-128`.

Dark/light mode:

- Source declares `viewport.colorScheme` and light/dark theme colors in `layout.tsx:70-79`; nav exposes a theme toggle. Browser dark-mode pass remained navigable and accessible-tree equivalent.

i18n and RTL:

- English and Korean routes were both exercised. `layout.tsx:103-108` sets `lang` and `dir`, and `locale-path.ts` currently ships only LTR locales (`en`, `ko`). No current RTL bug is claimed; an RTL locale would need a separate visual/a11y pass before launch.

Perceived performance:

- Code uses responsive image sizing, above-fold priority selection, blur/placeholder paths, masonry column sizing, and explicit empty/error states. This lane did not run Lighthouse/Web Vitals, so no performance defect is claimed.

## Files And Categories Examined

Examined categories: public routes, admin login/protected routes, layouts/metadata, nav/search/footer, home grid/cards, photo viewer/lightbox, info sheet, map, upload/admin controls, theme/i18n helpers, site config, data privacy selects, message catalogs, a11y/unit tests, and Playwright specs.

No source files or plans were modified.
