# GalleryKit Designer Review - Cycle 20

Repo: `/Users/hletrd/flash-shared/gallery`
Lane: `designer`
Date: 2026-07-08

This is a review-only artifact. I did not modify application source. Existing concurrent edits in other `.context/reviews/*.md` files were left untouched.

## Scope And Method

Target result: comprehensive UI/UX review of the Next.js web UI, with source and browser evidence for information architecture, affordances, keyboard/focus, WCAG 2.2 accessibility, contrast, ARIA, focus traps, reduced motion, responsive behavior, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL readiness, and perceived performance.

Local runtime:

- `npm run dev --workspace=apps/web` and `npm run dev --workspace=apps/web -- --port 3010` both failed because Next reported an existing dev-server lock for PID `7042`.
- `ps -p 7042` and `lsof -nP -iTCP:3000 -sTCP:LISTEN` returned no running/listening process. I did not kill processes or remove the stale lock in the shared workspace.
- `npm run start --workspace=apps/web -- --port 3010` rendered usable pages. It emitted the expected warning: `next start` is not the preferred mode for `output: standalone`; use `.next/standalone/server.js` instead.

Browser/tooling used:

- `agent-browser` core/navigation: opened `/en`, `/en/p/7`, `/en/map`, `/en/admin`.
- `agent-browser` config: tested `1440x1000`, `390x844`, and dark media.
- `agent-browser` query: accessibility snapshots, URL/title, element boxes, computed styles, DOM metrics.
- `agent-browser` interact/wait: opened search, filled query, opened lightbox, stepped Tab order, waited for load/network/DOM conditions.
- `agent-browser` debug/network: checked console/errors and request tracking.
- `agent-browser` visual/state: saved screenshots to `/tmp/gallery-*.png`; saved state to `/tmp/gallery-browser-state.json`.

## Inventory

Routes inventoried:

- Public: home, topic, photo, shared group, shared link, smart collection read route, map, timeline, year, privacy, about, uploads proxy, locale error/not-found/loading.
- Admin: login plus protected dashboard, analytics, categories, tags, SEO, settings, tokens, password, users, DB, protected loading/error.
- API/UI-adjacent routes: OG image routes, search routes, uploads routes, feed/sitemap/robots/manifest/icon surfaces.

Components inventoried:

- Public shell: `nav`, `nav-client`, `footer`, `theme-provider`, `register-service-worker`.
- Gallery: `home-client`, `masonry-card`, `grid-picture`, `grid-picture-fallback-boundary`, `load-more`, `tag-filter`, `search`, `on-this-day-widget`, `topic-empty-state`.
- Photo: `photo-viewer`, `photo-navigation`, `image-zoom`, `lightbox`, `lightbox-color-pip`, `info-bottom-sheet`, `color-details-section`, `histogram`, `wide-gamut-hint`, `similar-photos`.
- Map: `map-client`, `map-loader`.
- Admin: `admin-header`, `admin-nav`, `image-manager`, `upload-dropzone`, `bulk-edit-dialog`, `tag-input`, `admin-user-manager`, protected route clients.
- Primitives: shadcn/Radix `button`, `dialog`, `alert-dialog`, `dropdown-menu`, `select`, `sheet`, `switch`, `input`, `textarea`, `table`, `tooltip`, etc.

Design/docs/test assets reviewed:

- `CLAUDE.md`, `AGENTS.md`, `.context/plans/`, `.context/reviews/`, `apps/web/e2e/*.spec.ts`.
- `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- `apps/web/src/app/[locale]/globals.css`.
- Final sweep counted 142 UI-relevant files under `apps/web/src/app` and `apps/web/src/components`.

## Browser Evidence Summary

Home desktop `/en`:

- Snapshot exposed skip link, `navigation "Main navigation"`, `main`, `heading "Latest"`, tag filter group, photo links with image alt text, footer links, and notification region.
- Search opened as `dialog "Search photos"`; empty state exposed the combobox and close button.
- Search query `E2E` changed combobox to `expanded=true`, exposed `2 results`, listbox, and result options `E2E Portrait #7` and `E2E Landscape #6`.

Home mobile `390x844`:

- Snapshot exposed collapsed `DisclosureTriangle "Filter by tag"` and mobile nav controls.
- Element metrics showed 44 px or larger nav controls and footer links.
- Confirmed finding DES-C20-01 below: tag chips were visually laid out while the disclosure remained closed.

Photo `/en/p/7`:

- Snapshot exposed H1 `E2E Portrait`, back link, fullscreen button, pinned info button with `aria-pressed=true`, next-photo button, image zoom button, EXIF, histogram controls, and download link.
- Element metrics confirmed toolbar controls and histogram/download controls at or above 44 px.
- Lightbox opened as `dialog "Photo lightbox"`, focused Close, locked body scroll, and Tab cycled among lightbox controls. Background siblings were both `aria-hidden=true` and `inert=true`.

Map `/en/map`:

- Snapshot exposed H1 `Map`, skip link to photo list, region `Photo map`, help text, Leaflet controls, one marker as `button "Marker"`, and an accessible list `Geotagged photo list`.
- Confirmed finding DES-C20-02 below: Leaflet marker accessible name was generic.

Admin login `/en/admin`:

- Snapshot exposed H1 `Admin`, username/password labels, password show button, and submit button.
- Metrics: username/password fields 334x44, show password 44x44, submit 334x44.
- Global skip link resolved to `#main-content` and moved focus to `<main id="main-content">`.

Dark mode:

- `agent-browser set media dark` produced `htmlClass:"dark"`, body background `rgb(9, 9, 11)`, foreground `rgb(250, 250, 250)`, and `colorScheme:"dark"`.

## Confirmed Findings

### DES-C20-01 - Closed Mobile Tag Filter Still Paints Its Chip Controls

Severity: Medium
Confidence: High

File and region:

- `apps/web/src/components/tag-filter.tsx:145-156`

Source evidence:

- The mobile disclosure renders `<details className="group sm:hidden">`.
- Its direct non-summary child is `<div className="mt-2 flex flex-wrap gap-2" role="group" ...>`.
- Because that direct child has author `display:flex`, it overrides the browser's closed-`details` hiding rule.

Browser evidence:

- At `390x844`, the accessibility snapshot showed `DisclosureTriangle "Filter by tag" [expanded=false]` and did not expose the chip group.
- DOM metrics at the same state:
  - `detailsOpen:false`
  - chip buttons `All`, `e2e(2)`, `landscape(1)`, `portrait(1)`
  - `display:"flex"`, `visibility:"visible"`, `tabIndex:0`, rectangles at `y:232`, each 44 px tall.
- Tab order skipped the chips while the disclosure was closed, moving from the summary directly to the first photo link. That means the controls are visible/layout-affecting but not programmatically exposed.

Failure scenario:

A mobile keyboard or screen-reader user hears the tag filter as collapsed while sighted users can still see chip controls occupying layout space below it. Pointer users may interact with controls that the disclosure state says are hidden, while keyboard users cannot reach them until the disclosure is opened.

Concrete fix:

Replace the direct child `flex` with a closed-safe display pattern, for example:

```tsx
<div className="mt-2 hidden flex-wrap gap-2 group-open:flex" role="group" aria-label={t('home.tagFilter')}>
  {chips}
</div>
```

Alternatively, avoid native `<details>` for this control and manage `open` state explicitly with `hidden`, `aria-expanded`, and a controlled region.

### DES-C20-02 - Map Markers Have Generic Accessible Names

Severity: Low-Medium
Confidence: High

File and region:

- `apps/web/src/components/map/map-client.tsx:120-137`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:80-110`

Source evidence:

- `MapClient` renders each `<Marker position={[marker.latitude, marker.longitude]}>` without marker-level `title`, `alt`, or keyboard label options.
- The popup button is labelled with `${openPhotoLabel}: ${marker.displayTitle}`, and the page provides an accessible fallback list, but the marker itself is not distinguishable before opening the popup.

Browser evidence:

- `/en/map` accessibility snapshot exposed the map marker only as `button "Marker"`.
- DOM metrics for `.leaflet-marker-icon`: `tag:"IMG"`, `role:"button"`, `tabIndex:"0"`, `text:"Marker"`, 44x44 box.
- The page did include a `Skip map to photo list` link and a `Geotagged photo list`, so this is not a total navigation blocker.

Failure scenario:

When a map contains several geotagged photos, screen-reader and keyboard users navigating inside the map encounter repeated indistinguishable `Marker` controls. They must open each popup or skip to the list to know which photo a marker represents.

Concrete fix:

Pass accessible marker options through React Leaflet:

```tsx
<Marker
  key={marker.id}
  position={[marker.latitude, marker.longitude]}
  title={marker.displayTitle}
  alt={`${openPhotoLabel}: ${marker.displayTitle}`}
>
```

Keep the fallback list. If Leaflet does not propagate the desired name consistently across browsers, add a post-render marker icon attribute sync or use a custom accessible marker element.

## Likely Issues

### DES-C20-03 - Tag Filter Hydrates Duplicate Chip Trees

Severity: Low
Confidence: Medium

File and region:

- `apps/web/src/components/tag-filter.tsx:11-19`, `70-139`, `143-160`

Evidence:

- The source memoizes one `chips` fragment and mounts it twice: mobile disclosure and desktop `sm:flex`.
- On mobile, the hidden desktop copy is not painted, but both copies exist in the hydrated tree.

Failure scenario:

Large galleries with many tags pay avoidable hydration and DOM cost on public gallery pages. This can add input latency around a first-screen filter control, especially on phones.

Concrete fix:

Render one chip list and adapt the wrapper across breakpoints, or branch after hydration with a single mounted tree. Fixing DES-C20-01 with a single disclosure/content structure can also reduce this duplication.

## Manual-Validation Risks

- Protected admin workflows beyond login were source-reviewed but not browser-tested with an authenticated session. Highest manual priority: image manager bulk edit, upload dropzone, settings save/backfill, DB backup/restore dialogs, token creation/revoke.
- Physical P3/HDR display behavior cannot be proven from this browser session. Source has display-gamut and forced-colors handling, but real device validation is still required.
- RTL is future-facing. The root layout sets `dir={getLocaleDirection(locale)}`, but current locales are English and Korean, both LTR. A new RTL locale would need a full mirrored-layout pass across nav, photo viewer, admin tables, map, and bottom sheet.
- Browser screenshots were captured, but findings above rely on text-extractable DOM/accessibility/box evidence rather than screenshot interpretation.

## Positive Findings

- Skip links work on public and admin layouts; admin login moved focus to `<main id="main-content">`.
- Modal isolation is solid in tested search and lightbox flows: background is removed from the accessibility tree, body scroll locks, and lightbox background siblings are inert.
- Touch target policy is broadly enforced. Runtime metrics and the targeted tests found controls at or above 44 px in nav, search, photo viewer, histogram, admin login, map controls, and footer.
- Search has strong keyboard and screen-reader semantics after results load: combobox, listbox, active option model, live result count, and keyboard instructions.
- Reduced motion is handled in global CSS and in major photo interactions (`photo-viewer`, `lightbox`, `image-zoom`, `photo-navigation`, smooth scroll).
- Dark/light/OLED theme tokens are centralized, and dark-mode runtime styling rendered correct background/foreground/color-scheme values.
- Korean and English message files have parity tests, and route-level `lang`/`dir` are wired through locale helpers.
- Map information architecture includes a skip link and accessible list fallback, limiting the impact of marker naming.
- Loading/empty/error surfaces exist across public restore maintenance, route errors, photo loading, map loader, upload progress, search statuses, and admin protected loading/error.

## Tests Run

Passed:

```sh
npm test --workspace=apps/web -- src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/a11y-us-p15.test.ts src/__tests__/privacy-page-landmark.test.ts src/__tests__/map-thumb-wiring.test.ts src/__tests__/focus-visible-rings-cycle20.test.ts
```

Result: 6 files passed, 53 tests passed.

## Final Sweep

Final UI sweep counted 142 files under `apps/web/src/app` and `apps/web/src/components`. I reviewed route inventory, key UI source, global styles, messages, e2e specs, and source-contract tests. No additional skipped UI file class was identified after the final sweep.
