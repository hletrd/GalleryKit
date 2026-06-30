# Cycle 29 Designer UI/UX Review

Date: 2026-06-30
Role: designer
Repo: `/Users/hletrd/flash-shared/gallery`
Scope: Prompt 1 review only. No product-code changes implemented.

## Process And Runtime Evidence

Read first: `AGENTS.md` and `CLAUDE.md`.

Confirmed UI presence by scanning Next.js App Router pages, JSX/TSX components, Tailwind/global CSS, locale messages, UI primitives, public assets, and route config. The app has localized public gallery routes, photo viewer/lightbox, search, map/timeline/privacy pages, and protected admin surfaces for upload, image management, categories, tags, users, analytics, settings, tokens, and DB backup/restore.

Used the `agent-browser` skill family and CLI:

- `agent-browser install` reported Chrome already installed.
- Port `3000` was already occupied by a different Next server redirecting to `/auth/device-login`, so I started this repo on `http://localhost:3001` with `npm run dev --workspace=apps/web -- -p 3001`.
- `/en` rendered the app shell plus route error boundary because the local MySQL dependency was unavailable. Exact blocker from server logs: `connect ECONNREFUSED 127.0.0.1:3306` while reading `topics`, `admin_settings`, and latest image metadata.
- `/en/privacy` loaded successfully. Accessibility snapshot exposed skip link, `Main navigation`, search/theme/locale controls, `main`, privacy sections, footer, Admin/GitHub links, and Sonner notifications region.
- Search dialog runtime check: trigger opened `role="dialog"`, focus landed on `#search-input` with `role="combobox"`, `body.style.overflow` became `hidden`, and background body children were `aria-hidden=true` plus `inert=true`.
- Mobile viewport `390x844` kept the privacy/error shell accessibility tree coherent.
- DOM metrics on the reachable error shell showed visible controls at 44 px high: nav home link `63.25x44`, Try Again button `91.05x44`, Return link `142.67x44`.

Focused validation passed:

```text
npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/a11y-us-p15.test.ts src/__tests__/lightbox-controls-contract.test.ts
Test Files 4 passed; Tests 47 passed.
```

Runtime gap: populated public gallery/photo/map pages and protected admin pages could not be fully exercised end-to-end without a running local MySQL instance and admin session. Findings below are backed by source, live shell evidence, and existing tests rather than screenshots alone.

## Findings

### C29-DES-01 - Theme control hydrates with different server/client labels and icons

- Severity: Medium
- Confidence: High
- Source: `apps/web/src/components/nav-client.tsx:35-45`, `nav-client.tsx:160-176`; `apps/web/src/components/theme-provider.tsx`; runtime browser/server output while loading `/en/privacy`
- Runtime evidence: after the browser had `gallery_theme=dark`, the server-rendered nav theme button had `aria-label="Theme: System. Switch to Light."` and a Monitor icon, while the hydrated client rendered `aria-label="Theme: Dark. Switch to OLED."` and a Moon icon. React logged a hydration mismatch and regenerated the subtree, pointing at `NavClient` around the theme icon branch.
- Problem: The theme button depends on `useTheme()` before client mount, so server HTML and client storage-derived state can disagree. This causes noisy runtime errors, extra client work, and a brief mismatch in accessible name/icon for keyboard and screen-reader users.
- Failure scenario: A returning visitor who previously selected dark or OLED loads any public page. The first interactive nav control can be announced with the wrong current theme/next action until hydration repairs it, and React reports a hydration error in development.
- Suggested fix: Gate the theme-specific label/icon behind a mounted state or render a stable server/client placeholder until `useTheme()` resolves on the client. Keep the button dimensions stable at 44 px so the mount swap does not shift the nav, and add a source or component test that simulates stored dark/OLED theme without a hydration mismatch.

### C29-DES-02 - Public GPS map publishing is a one-click switch without a consequence confirmation

- Severity: Medium
- Confidence: High
- Source: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:64-78`, `topic-manager.tsx:259-265`; `apps/web/src/lib/data.ts:1660-1685`; `apps/web/src/app/[locale]/(public)/map/page.tsx:44-56`; `apps/web/messages/en.json:107-109`
- Selector/source evidence: the category table renders a `Switch` with `aria-label={t('categories.mapVisibleToggle', { label })}` and immediately calls `setTopicMapVisible(slug, !currentValue)` in `handleMapVisibleToggle`. The public map query is explicitly the only public latitude/longitude surface and returns processed photos where `topics.map_visible = true`. The current copy is consequence-forward, `"Publish GPS on public map"`, but the interaction still has no first-enable confirmation, no count of affected geotagged photos, and no preview of what will become public.
- Problem: This is a privacy-impacting publication action but behaves like a reversible display preference. A single accidental toggle can expose every geotagged processed photo in that category on `/map`.
- Failure scenario: An admin scans the category table on a trackpad, toggles the switch for a client/private category, sees only `"Map visibility updated"`, and GPS coordinates for that topic become publicly browsable before the admin realizes the scope.
- Suggested fix: Gate the false-to-true transition with an `AlertDialog` that says the category's GPS-bearing photos will become public, shows the count if cheaply available, and confirms with explicit copy like `Publish GPS`. Keep off transitions fast. While the request is in flight, use optimistic switch state or a row-level `aria-live` status so the disabled switch does not appear stuck on the old value.

### C29-DES-03 - Public map can hydrate and render 10,000 markers plus 10,000 fallback list links

- Severity: Medium
- Confidence: High
- Source: `apps/web/src/lib/data.ts:1649-1658`; `apps/web/src/app/[locale]/(public)/map/page.tsx:37-56`, `map/page.tsx:83-95`; `apps/web/src/components/map/map-client.tsx:76-93`, `map-client.tsx:118-140`
- Selector/source evidence: `MAP_MAX_MARKERS = 10000`; the server maps every row into `markers`, renders every marker into both Leaflet `<Marker>` components and an accessible `<ul id="map-photo-list">`, and `FitBounds` computes arrays over the whole marker set. The page is `revalidate = 0`, so this work is request-fresh.
- Problem: The accessible fallback is good IA, but at the current cap the public page can become a very large client payload and an enormous keyboard/screen-reader list. That harms perceived performance and makes the map hard to use exactly when the gallery has enough GPS photos to need better navigation.
- Failure scenario: A travel/wedding archive enables several GPS-rich categories. A mobile visitor opens `/map`, downloads thousands of markers, Leaflet mounts thousands of DOM-backed points/popups, and the fallback list creates thousands of focusable links below the map. The page feels frozen or overwhelming.
- Suggested fix: Move the map to clustered or viewport-bounded loading, and page or virtualize the accessible list. If a full-map cap remains, show a localized truncation notice with a filter affordance so visitors know they are seeing only the most recent subset.

### C29-DES-04 - DB-backed public route failures still collapse to a generic route error shell

- Severity: Medium
- Confidence: High
- Source: `apps/web/src/app/[locale]/error.tsx:22-57`; `apps/web/src/app/[locale]/(public)/layout.tsx:1-17`; `apps/web/src/app/[locale]/(public)/page.tsx:151-168`
- Runtime evidence: loading `http://localhost:3001/en` with local MySQL unavailable logged `connect ECONNREFUSED 127.0.0.1:3306` and rendered an accessibility tree of `banner > navigation "Site navigation" > link "Gallery"`, then `main > region "Error"`, heading `"Error"`, button `"Try again"`, and link `"Return to Gallery"`. The normal public shell on `/en/privacy` included search, theme, locale, footer, privacy link, GitHub link, and Admin link.
- Problem: The error boundary is accessible, but a backend data failure strips normal public IA and gives visitors a generic message instead of a gallery-specific unavailable/maintenance state. This weakens recovery during restore, first-run DB setup, transient MySQL failure, or migration drift.
- Failure scenario: A public visitor hits the home gallery during a DB restart. They lose search/theme/locale/footer affordances and cannot tell whether the gallery is empty, broken, or temporarily unavailable.
- Suggested fix: For expected DB-unavailable reads on public listing/detail/map pages, catch and render a localized `PublicDataUnavailable` or restore-maintenance shell inside the normal public layout where possible. Preserve nav/footer controls and add a test that mocks a `getImagesLitePage()` or `getTopicsCached()` failure and asserts the product-specific recovery state.

## Coverage Summary

Reviewed source regions:

- App/public shell: `layout.tsx`, `error.tsx`, `loading.tsx`, `not-found.tsx`, public route pages under `apps/web/src/app/[locale]/(public)/`
- Public components: `nav-client.tsx`, `search.tsx`, `home-client.tsx`, `load-more.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `map/*`, timeline/year/map/privacy paths
- Admin components/routes: dashboard, upload dropzone, image manager, bulk edit, settings, DB backup/restore, categories, tags, users, analytics
- UI primitives and styling: shadcn/Radix primitives under `components/ui`, `globals.css`, theme/reduced-motion/forced-colors styles
- i18n: `apps/web/messages/en.json`, `apps/web/messages/ko.json`
- Test coverage map: touch target audit, focus-visible scan, a11y tests, lightbox control contract, related source-lock tests

Positive observations:

- Skip link and focusable `main` target exist.
- Search dialog focus trap, inerting, scroll lock, Escape close, and combobox semantics were verified live.
- Existing 44 px touch-target policy is enforced by tests and visible reachable controls met the 44 px floor.
- Reduced-motion and forced-colors CSS exists for photo card hover motion, skeletons, color chips, and overlays.
- Locale `lang`/`dir`, bilingual messages, empty states, alert roles, and field-level errors are broadly present.
- The previous cycle's slideshow interval field-level validation gap is fixed in current source.

## Missed-Issue Sweep

Final sweep covered `aria-*`, `role`, `tabIndex`, `aria-live`, `focus-visible`, `sr-only`, dialog/sheet/focus-trap code, table overflow patterns, touch-target tests, reduced-motion CSS, forced-colors CSS, dark/light/OLED theme tokens, loading/empty/error states, form validation, privacy/map copy, and public/admin route IA.

No additional designer-severity issue rose above the reporting threshold after accounting for existing tests and already-fixed cycle 28 findings. The only material validation gap is the unavailable local MySQL service, which blocked full runtime traversal of populated gallery/admin flows.
