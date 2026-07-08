# Cycle 35 Designer UI/UX Review

Role: `cycle-35 designer / UI-UX reviewer`
Repo: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `7993fa467f8a71814f878aa59bcd80174daab1ed`
Date: 2026-07-08 KST

Scope: review-only. I did not edit product code. This report is the only file written.

## Inventory And Scope

Read before review: `AGENTS.md`, `CLAUDE.md`, and the relevant agent-browser skills (`agent-browser`, `agent-browser-query`, `agent-browser-interact`, `agent-browser-config`, `agent-browser-visual`).

Route inventory reviewed:

- Public localized routes: `/[locale]`, `/[locale]/[topic]`, `/[locale]/p/[id]`, `/[locale]/g/[key]`, `/[locale]/s/[key]`, `/[locale]/c/[slug]`, `/[locale]/map`, `/[locale]/timeline`, `/[locale]/year/[year]`, `/[locale]/privacy`, `/[locale]/about-gallerykit`, localized upload fallback route, not-found/error/loading surfaces.
- Admin routes: `/[locale]/admin`, protected dashboard, analytics, categories, tags, settings, SEO, DB, password, tokens, users.
- Component inventory: `apps/web/src/components/**`, including nav/search, masonry cards, photo viewer, lightbox, info bottom sheet, map, histogram, color details, forms, admin managers, and `components/ui/**`.
- i18n/theme/performance surfaces: `messages/en.json`, `messages/ko.json`, `app/[locale]/layout.tsx`, `globals.css`, image loading paths, focus-trap helpers, reduced-motion CSS/hooks.

Runtime browser review was feasible via the existing production build. `next dev` could not start because a stale Next dev marker reported another dev server on PID 7042 while no port 3000 listener existed; I avoided deleting lock files or killing processes. `npm run start --workspace=apps/web -- -p 3001` served the built app and warned that standalone output prefers `node .next/standalone/server.js`.

Browser/session evidence:

- `curl -I http://127.0.0.1:3001/en` returned HTTP 200 with CSP, HSTS, locale alternates, and `NEXT_LOCALE=en`.
- Agent-browser `0.22.2` snapshots covered `/en`, `/ko`, `/en/admin`, `/en/map`, `/en/timeline`, `/en/p/25`, search modal, lightbox, and mobile info sheet.
- Playwright DOM probe covered mobile `390x844` and desktop `1280x900` across `/en`, `/ko`, `/en/admin`, `/en/map`, `/en/timeline`, `/en/p/25`, `/en/privacy`, `/en/about-gallerykit`: no unnamed visible focusables, no horizontal overflow, `html lang/dir` correct for English/Korean, body contrast about `19.90:1`, and no page errors.
- Form validation check on `/en/admin`: empty submit produced inline `role="alert"` messages for username and password.
- Modal checks: search and lightbox snapshots hid the rest of the page from the accessibility tree; mobile info sheet exposed expand/close/title/date.

Skipped live runtime areas: protected admin internals beyond the unauthenticated login screen, because this review lane did not create or use an authenticated admin session. Those admin findings are source-backed.

## Findings

### DES-C35-01 - Search combobox controls the dialog when no result list exists

Severity: Medium
Confidence: High
Classification: Confirmed

Evidence:

- Source: `apps/web/src/components/search.tsx:443-452` renders `#search-input` as `role="combobox"` with `aria-expanded={isOpen}` and `aria-controls={hasDisplayedResults ? 'search-results' : 'search-dialog'}`.
- Source: `apps/web/src/components/search.tsx:430-435` makes `#search-dialog` the modal container with `role="dialog"`.
- Browser evidence on `/en`, after opening search with no query: `#search-input aria-controls="search-dialog"`, `#search-dialog role="dialog"`, and `#search-input aria-expanded="true"`.
- Browser evidence after typing `portrait`: `aria-controls` correctly changes to `search-results`, whose role is `listbox`.

User failure scenario:

A screen-reader user opens search before typing. The combobox announces as expanded but points its controlled popup relationship at the whole dialog rather than a listbox/results popup. This creates an invalid control relationship and can make the search field's state harder to understand before results exist.

Suggested fix:

Keep the combobox relationship stable. Either always render a `#search-results` element with `role="listbox"` and put empty/loading/status content inside it, or omit `aria-controls`/set `aria-expanded=false` until an actual listbox popup exists. Do not use the modal dialog itself as the combobox popup.

### DES-C35-02 - Mobile masonry cards permanently cover photos with metadata overlays

Severity: Low-Medium
Confidence: High
Classification: Confirmed

Evidence:

- Source: `apps/web/src/components/masonry-card.tsx:155-160` renders a mobile-only `absolute inset-x-0 top-0 sm:hidden bg-gradient-to-b from-black/75 to-transparent p-3` title/topic overlay inside the photo.
- Browser DOM evidence on mobile `/en`: first `.masonry-card` measured `358 x 556.875`; the overlay measured `358 x 60`, `position:absolute`, `display:block`, with `linear-gradient(rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0))`.
- Related source pattern: `apps/web/src/components/masonry-card.tsx:161-166` uses hover/focus reveal only at `sm` and above, so the mobile overlay is always present.

User failure scenario:

A phone visitor scans the public gallery and the top 60px of every image is covered by title/topic chrome. For photos with important subject matter near the top edge, the gallery masks part of the delivered edit before the user has chosen to open the photo.

Suggested fix:

Move mobile metadata into a reserved caption area below the image, or reveal the overlay only on focus/tap/long-press with a clear persistent alternative. Keep the current hover/focus reveal for larger pointer devices.

### DES-C35-03 - SEO settings mark every field invalid for one server-side field error

Severity: Medium
Confidence: High for source behavior; protected route not live-authenticated
Classification: Confirmed source issue

Evidence:

- Source: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:75-85` stores a single `formError`, toasts it, and focuses the summary.
- Source: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:121-128`, `135-142`, `149-157`, `164-171`, `178-185`, and `200-209` set `aria-invalid={!!formError}` on all SEO inputs/textareas.
- Source: `apps/web/src/app/actions/seo.ts:85-139` returns field-specific failure messages such as `seoTitleInvalid`, `seoLocaleInvalid`, and `seoOgImageUrlInvalid`, but not structured field identifiers.

User failure scenario:

An admin enters an invalid Open Graph image URL and presses Save. The UI sets every SEO field to invalid, so screen-reader users and sighted users must re-check unrelated title, description, author, locale, and URL fields even though only one field needs correction.

Suggested fix:

Return structured field errors from `updateSeoSettings`, for example `{ field: 'seo_og_image_url', error }`. In `SeoSettingsClient`, set `aria-invalid` only on affected controls, include field-specific error IDs in `aria-describedby`, render persistent inline errors, and focus the first invalid field after a failed save.

### DES-C35-04 - Public photo/search surfaces expose visible keyboard-shortcut tutorial text

Severity: Low
Confidence: High
Classification: Confirmed

Evidence:

- Source: `apps/web/src/components/photo-viewer.tsx:580-585` renders a visible desktop paragraph with `viewer.shortcutsHint` above the photo viewer.
- Browser evidence on desktop `/en/p/25`: accessibility snapshot included `Shortcuts: ←/→ to navigate, F to toggle lightbox, I to toggle info, C color details, H histogram. Space toggles slideshow in lightbox.`
- Source: `apps/web/src/components/search.tsx:524-530` renders visible search footer shortcut text, including `Ctrl/⌘ K`.
- Browser evidence in the open search dialog: snapshot included `Ctrl/⌘ K to toggle search`.

User failure scenario:

A public gallery visitor on desktop sees operational training text in the primary viewing surface, above or inside photo-focused UI. This competes with the photograph and page content, and it is read as ordinary page/dialog text rather than offered as contextual help.

Suggested fix:

Move shortcut discovery to tooltips on the relevant controls, a compact help/menu affordance, or screen-reader-only instructions tied to the specific widget. Keep visible copy focused on the photo/search task rather than listing global shortcuts.

## Covered Areas With No New Findings

- Information architecture: public home, topic, timeline, map, privacy/about, photo detail, footer, and localized nav were landmarked and had coherent headings in browser snapshots.
- Focus and keyboard: skip link targets resolved; login validation focused the first invalid field; search/lightbox/info sheet used focus traps and modal isolation.
- WCAG 2.2 basics: runtime probes found no unnamed visible focusables and no horizontal overflow at tested mobile/desktop viewports; repo touch-target policy is represented in source and tests.
- Contrast/dark/light: body foreground/background contrast passed strongly in light and dark probes; CSS includes forced-colors and reduced-motion handling.
- Loading/empty/error states: photo loading skeleton has `role="status"`; not-found/error routes include main landmarks and recovery links; gallery empty/filter state has a clear action.
- i18n/RTL: English and Korean routes set `lang` and `dir="ltr"` correctly. RTL is supported through `getLocaleDirection`, but no RTL locale is currently shipped, so RTL rendering was source-reviewed only.
- Perceived performance: source uses image dimensions/aspect-ratio reservations, above-fold priority, responsive derivatives, lazy loading, `content-visibility`, and bounded histogram/map chunks. No CLS was observed in the sampled routes.

## Final Sweep Notes

Commonly missed issues checked: duplicate/hidden headings, modal focus traps, `aria-modal`, focus restore, unlabeled icon buttons, small touch targets, hidden content still exposed to AT, reduced motion, forced colors, dark mode, loading/empty/error affordances, validation feedback, language direction, horizontal overflow, and LCP/CLS/INP risks.

Skipped live routes: authenticated protected admin pages (`dashboard`, `analytics`, `categories`, `tags`, `settings`, `seo`, `db`, `password`, `tokens`, `users`) and share-key/private collection states that require specific live data or credentials. Their source was included in the review, but runtime claims above are limited to the unauthenticated/admin-login and public seeded routes.
