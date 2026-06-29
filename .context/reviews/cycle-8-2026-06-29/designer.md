# Cycle 8 Designer / UI-UX Review

Date: 2026-06-29
Reviewer: designer / UI-UX
Scope: Next.js web UI in `/Users/hletrd/flash-shared/gallery`

## Review Coverage

- Read first: `AGENTS.md`, `CLAUDE.md`, and agent-browser skill docs for core navigation, configuration, query, interaction, debugging, visual capture, and waits.
- Inventoried UI files under `apps/web/src/app`, `apps/web/src/components`, `apps/web/messages`, `apps/web/e2e`, and `apps/web/src/__tests__`.
- Started local dev server with `npm run dev` at `http://localhost:3000`.
- Browser evidence collected with `agent-browser`:
  - Local `/en`: public page falls into route error boundary because DB-backed nav query fails.
  - Local `/en/admin`: login page renders and is keyboard-focusable.
  - Production public `/en`, `/ko`, `/en/map`: used as supplemental runtime evidence because local public data pages are DB-blocked.
  - Desktop and mobile viewports, light/dark media, accessibility snapshots, DOM boxes/styles, console/page errors.
- Supporting screenshots:
  - `/tmp/gallery-cycle8-local-public-error.png`
  - `/tmp/gallery-cycle8-search-modal-mobile.png`

## Findings

### DES-C8-01 - Public layout collapses to the route error UI when navigation data fails

- Severity: High
- Confidence: High
- Status: Confirmed locally
- Area: Public information architecture, loading/error states, perceived reliability

Evidence:
- Runtime: `agent-browser open http://localhost:3000/en` produced title `Error | GalleryKit` and an accessibility tree containing only `main > region "Error" > heading "Error"`, `Try again`, and `Return to Gallery`.
- Runtime console: handled React error from `<Nav>`: failed query selecting `slug`, `label`, `order`, `image_filename`, `map_visible` from `topics`.
- Source: [nav.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/nav.tsx:6) awaits `Promise.all([getTopicsCached(), getSeoSettings(), getGalleryConfig()])` with no fallback or isolation.
- Source: [layout.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/app/[locale]/(public)/layout.tsx:7) renders `<Nav />` before `<main>`, so a nav data failure prevents otherwise useful public content/error recovery from rendering.

Failure scenario:
If `topics` or admin settings are temporarily unavailable, every public route loses the full gallery shell. Visitors get a generic route error instead of a degraded header, static brand link, language/theme controls, or the route's own empty/error content. This is especially costly for public photo/share links where the main photo content may not need topic navigation.

Concrete fix:
Wrap nav data loading in an isolated fallback. For example, split required vs optional data: use site-config defaults for title/image sizes/search mode, catch `getTopicsCached()` failures to render an empty topics list, and keep logging the failure server-side. Alternatively add an error boundary around `<Nav />` in the public layout that renders a minimal nav with home, theme, locale, and search disabled.

### DES-C8-02 - Search modal is visually modal but remains nested in the navigation landmark and exposes background content to the accessibility tree

- Severity: Medium
- Confidence: High
- Status: Confirmed on production snapshot; source-backed in current branch
- Area: ARIA modal semantics, landmarks, keyboard/screen-reader navigation

Evidence:
- Runtime: mobile `/ko` after opening search showed the accessibility tree as `navigation "메인 내비게이션" > generic > dialog "사진 검색"`, followed by the underlying `main`, tag-filter buttons, photo links, footer, and notifications region.
- Runtime DOM box: the search dialog was labelled `사진 검색`; focus moved to `#search-input`.
- Source: [nav-client.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/nav-client.tsx:156) renders `<Search />` inline inside `#primary-nav-controls`.
- Source: [search.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/search.tsx:321) creates a custom overlay and [search.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/search.tsx:334) renders `role="dialog" aria-modal="true"` inline, using `FocusTrap` but no portal/inert/aria-hidden handling for app siblings.

Failure scenario:
A screen-reader user opens search and still sees the dialog as part of the navigation landmark, while virtual cursor traversal can continue into the background gallery controls. The focus trap helps keyboard Tab order, but it does not make the rest of the document inert for assistive technology. This weakens modal affordance and can make the page feel like two active contexts at once.

Concrete fix:
Render the search modal through a portal at document/body level, or replace the custom modal with the existing Radix-backed `Dialog` primitive. Ensure opening the dialog makes the app root siblings inert or `aria-hidden`, and keep the accessible dialog name. If keeping the custom `FocusTrap`, add a small modal manager that toggles `inert`/`aria-hidden` on non-dialog siblings and restores them on close.

### DES-C8-03 - Photo map has no non-map browse fallback for keyboard and screen-reader users

- Severity: Medium
- Confidence: Medium
- Status: Risk; production currently has zero geotagged markers, so marker behavior could not be live-confirmed
- Area: Information architecture, keyboard navigation, WCAG 2.1.1 keyboard access

Evidence:
- Runtime: production `/en/map` currently renders the empty state `No geotagged photos are available on the map.`
- Source: [map/page.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/app/[locale]/(public)/map/page.tsx:51) renders either a paragraph empty state or only `<MapLoader />`.
- Source: [map-client.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/map/map-client.tsx:107) renders `MapContainer`, `TileLayer`, `Marker`, and `Popup`; there is no adjacent list/table of the same photos.
- Source: [map-client.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/map/map-client.tsx:128) puts the actual photo-opening button inside the Leaflet popup, which depends on first discovering/opening a map marker.

Failure scenario:
When geotagged photos exist, a keyboard-only or screen-reader user must operate a slippy map and discover marker popups to reach photo links. Even if Leaflet exposes marker icons as focusable, there is no structured list of geotagged photos, no count, and no non-spatial browsing path.

Concrete fix:
Render a companion list below the map using the same `markers` array: title/fallback id, topic, and a `View photo` link. Add an `aria-describedby` summary near the map with marker count and instructions. This preserves the visual map while giving assistive-tech and keyboard users a deterministic route to every mapped photo.

### DES-C8-04 - Image edit dialog validation is toast-only and not tied to invalid fields

- Severity: Low
- Confidence: Medium
- Status: Likely; protected admin runtime not accessible without credentials
- Area: Form validation UX, ARIA error association

Evidence:
- Source: [image-manager.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/image-manager.tsx:269) validates title/description length in `handleSaveEdit`.
- Source: [image-manager.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/image-manager.tsx:275) and [image-manager.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/image-manager.tsx:279) show validation failures only via `toast.error(...)`.
- Source: [image-manager.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/image-manager.tsx:604) and [image-manager.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/image-manager.tsx:608) render the title and description controls without `maxLength`, helper text/counters, `aria-invalid`, or `aria-describedby`.
- Contrast: [bulk-edit-dialog.tsx](/Users/hletrd/flash-shared/gallery/apps/web/src/components/bulk-edit-dialog.tsx:286) already has an inline `role="alert"` validation pattern for similar length errors.

Failure scenario:
An admin entering a long caption/title can press Save, hear or see a transient toast, and remain in a dialog where neither field is marked invalid. Screen-reader users do not get a field-associated error, and sighted users lose the message once the toast times out.

Concrete fix:
Mirror the bulk-edit pattern in the image edit dialog: maintain local validation error state, render persistent inline messages near the field, set `aria-invalid` and `aria-describedby`, and add visible character counters or `maxLength` where the client/server limits are hard. Move focus to the first invalid field or error summary on failed save.

## Positive Coverage Notes

- 44 px touch-target policy is broadly reflected in nav, tag chips, search controls, upload controls, admin nav, table checkboxes, and dialog controls.
- Global reduced-motion CSS exists in [globals.css](/Users/hletrd/flash-shared/gallery/apps/web/src/app/[locale]/globals.css:291), and key photo hover transforms are explicitly suppressed under reduced motion.
- Public gallery heading structure is deliberate: `h1`, visually hidden `h2` for photos, per-card `h3`.
- Login page has persistent labels, autocomplete attributes, autofocus, 44 px controls, and a password visibility toggle.
- Route-level error/not-found/loading surfaces have landmarks, visible headings, and focusable skip-link targets.

## Missed-Issue / Skipped-File Sweep

- Re-scanned 132 files under `apps/web/src/app` and `apps/web/src/components`.
- Searched for dialog/focus-trap/portal/inert patterns, animation/reduced-motion usage, validation/alert/error patterns, table overflow, touch-target-relevant sizing, roles/ARIA, loading/empty/error states, and i18n message surfaces.
- Protected admin pages beyond `/en/admin` were not browser-confirmed because no admin credentials were provided and local DB-backed auth/data access is unavailable. Those areas were source-reviewed.
- Local public runtime was DB-blocked; production public runtime was used only as supplemental UI evidence, not as a substitute for source citations.
