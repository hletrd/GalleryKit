# UI/UX Designer Reviewer - Cycle 29

Date: 2026-06-30
Repo: `/Users/hletrd/flash-shared/gallery`
Mode: Prompt 1 review only. No product-code changes implemented.
Reviewer note: adapted only the UI/UX critique style; no BurstPick-specific paths or assumptions were used.

## Process And Evidence

Read first:

- `AGENTS.md`
- `CLAUDE.md`

Inventory and review covered:

- Public routes under `apps/web/src/app/[locale]/(public)/`: home, topic, photo, shared link/group, smart collection, map, timeline/year, privacy, loading/error.
- Admin routes under `apps/web/src/app/[locale]/admin/`: login, protected shell, dashboard/upload/image management, categories, tags, settings, SEO, password, users, DB, tokens, analytics.
- Shared UI: `nav-client.tsx`, `search.tsx`, `home-client.tsx`, `load-more.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `map/*`, `upload-dropzone.tsx`, `image-manager.tsx`, `admin-*`, `tag-*`, `ui/*`.
- Styling/themes: `apps/web/src/app/[locale]/globals.css`, `tailwind.config.ts`, theme provider and theme helpers.
- i18n: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.
- Tests/docs: touch target audit, focus-visible scan, US-P15 a11y contracts, i18n parity, theme token/resolve tests, E2E public/admin/nav specs, current `.context/reviews/designer.md`, prior `ui-ux-designer-reviewer.md`, and existing screenshot/browser artifact inventories.

Browser evidence reused from the main cycle 29 designer pass:

- Local app was run at `http://localhost:3001`; `localhost:3000` was occupied by another app.
- `/en/privacy` loaded and exposed coherent `lang`, `dir`, nav, main, footer, search/theme/locale controls.
- Search dialog focus/inert/scroll-lock behavior was verified live.
- `/en` hit the app error boundary because local MySQL was unavailable: `connect ECONNREFUSED 127.0.0.1:3306`.
- Populated gallery/admin DB-backed runtime traversal was blocked by the unavailable DB.

Focused validation I ran:

```text
npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/a11y-us-p15.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/theme-token-contract.test.ts src/__tests__/theme-resolve.test.ts
Test Files 6 passed; Tests 53 passed.
```

## Confirmed Issues

### C29-UXR-01 - Theme control hydrates with a different label/icon than the server rendered

Severity: Medium
Confidence: High
Type: Confirmed issue

Sources:

- `apps/web/src/components/nav-client.tsx:39-47` reads `useTheme()`, falls back to `system`, and builds the accessible label.
- `apps/web/src/components/nav-client.tsx:166-176` renders theme-specific icon branches and button label/title.
- `apps/web/src/app/[locale]/layout.tsx:130-138` configures `next-themes` with `storageKey="gallery_theme"`.
- `apps/web/src/lib/theme.ts:39-46` defines the system -> light -> dark -> oled cycle.
- Runtime evidence in `.context/reviews/designer.md`: stored `gallery_theme=dark` produced server label/icon for System/Monitor and hydrated client label/icon for Dark/Moon with a React hydration mismatch.

Failure scenario:

A returning visitor with `gallery_theme=dark` or `oled` opens any public page. The server HTML exposes the theme button as "Theme: System. Switch to Light." with a Monitor icon; hydration then swaps to the stored theme label/icon. In development this logs a hydration mismatch and regenerates the subtree. For keyboard and screen-reader users, the first nav pass can announce the wrong current theme and next action.

Fix:

Render a stable theme button until the client has mounted and `useTheme()` has resolved from storage. Keep the 44 px dimensions stable during the swap. Add a component/source test or Playwright check that seeds `gallery_theme=dark`/`oled` before navigation and asserts there is no hydration error and no accessible-name mismatch.

### C29-UXR-02 - Public GPS map publishing is exposed as a one-click table switch

Severity: Medium
Confidence: High
Type: Confirmed issue

Sources:

- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:64-78` immediately calls `setTopicMapVisible(slug, !currentValue)`.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:259-265` renders the switch with only an aria-label and disabled in-flight state.
- `apps/web/src/app/actions/topics.ts:600-625` persists `topics.map_visible` and revalidates app data.
- `apps/web/src/lib/data.ts:1660-1685` documents `getMapImages()` as the only public latitude/longitude surface and filters by `topics.map_visible = true`.
- `apps/web/messages/en.json:107-109`, `apps/web/messages/ko.json:107-109` label the column/toggle as public GPS map visibility.

Failure scenario:

An admin scanning the Categories table accidentally toggles a private or client category on a trackpad. The app shows only a success toast, while every processed GPS-bearing photo in that category becomes available on `/map` after revalidation. The data flow is intentional, but the affordance treats a privacy-impacting publication action like a harmless display preference.

Fix:

Gate only the false -> true transition with an `AlertDialog` using explicit copy such as "Publish GPS". Include the category label, explain that geotagged photos in the category become public on `/map`, and show an affected-photo count if cheap to query. Keep true -> false fast. During the request, either apply an optimistic switch state or expose a row-level `aria-live` status so the disabled switch does not look stuck.

### C29-UXR-03 - Public map can render 10,000 markers and 10,000 accessible list links in one page

Severity: Medium
Confidence: High
Type: Confirmed issue

Sources:

- `apps/web/src/lib/data.ts:1649-1658` sets `MAP_MAX_MARKERS = 10000` and notes clustering/viewport loading would be needed beyond the cap.
- `apps/web/src/lib/data.ts:1667-1685` returns up to 10,000 public GPS rows, request-fresh.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:37-56` maps every row into client markers.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:83-95` renders every marker again as a fallback `<Link>` in `#map-photo-list`.
- `apps/web/src/components/map/map-client.tsx:76-93` computes full-array bounds.
- `apps/web/src/components/map/map-client.tsx:118-140` renders every marker as a Leaflet `<Marker>`/`<Popup>`.

Failure scenario:

A travel or event archive enables public GPS for several dense categories. A mobile visitor opens `/map` and receives thousands of markers plus thousands of fallback links. Leaflet mounts a large marker set, `FitBounds` scans all points, and assistive-tech users are presented with a very long link list. The page can feel frozen and the accessible fallback becomes hard to navigate at the same moment the map needs more structure.

Fix:

Use clustering or viewport-bounded marker loading, and page or virtualize the accessible list. If a server cap remains, expose a localized truncation notice and filtering affordance so visitors know whether they are seeing all public GPS photos or only the most recent subset.

### C29-UXR-04 - Public DB failures collapse to a generic localized route error shell

Severity: Medium
Confidence: High
Type: Confirmed issue

Sources:

- `apps/web/src/app/[locale]/error.tsx:22-57` renders a standalone generic error shell with a minimal nav, Try again, and Return to Gallery.
- `apps/web/src/app/[locale]/(public)/layout.tsx:1-17` normally provides full public nav/main/footer.
- `apps/web/src/app/[locale]/(public)/page.tsx:151-173` checks restore maintenance, then awaits DB-backed SEO/config/tag/topic/gallery reads without a route-local unavailable state.
- `apps/web/messages/en.json:706-710`, `apps/web/messages/ko.json:706-710` use generic "Something went wrong loading this page" copy.
- Runtime evidence in `.context/reviews/designer.md`: `/en` with local DB down rendered the generic error boundary and lost the normal public shell controls.

Failure scenario:

A visitor hits the gallery during a MySQL restart, migration problem, or first-run DB setup issue. Instead of a gallery-specific unavailable/maintenance state inside the normal public IA, they see a generic "Error" page with minimal navigation. They cannot tell whether the gallery is empty, temporarily unavailable, or broken.

Fix:

For expected public DB-read failures on home/topic/photo/map routes, catch and render a localized `PublicDataUnavailable` or maintenance-like shell inside the normal public layout where possible. Preserve public nav/footer/search/theme/locale affordances when they can be resolved safely. Add a test that mocks a `getTopicsCached()` or `getImagesLitePage()` failure and asserts product-specific recovery copy.

## Risks Needing Manual Validation

### C29-UXR-R1 - Opt-in admin E2E selectors are stale after the admin main-content rename

Severity: Low
Confidence: High
Type: Validation risk, not a product UI defect

Sources:

- `apps/web/src/app/[locale]/admin/layout.tsx:19-27` states the old `#admin-content` target was replaced by the global `#main-content` target.
- `apps/web/e2e/helpers.ts:195` still waits for `#admin-content`.
- `apps/web/e2e/admin.spec.ts:24-34` still expects `#admin-content table`.
- `apps/web/e2e/admin.spec.ts:138-140` still scopes upload file input lookup to `#admin-content`.

Failure scenario:

When `E2E_ADMIN_ENABLED=true`, admin browser coverage can fail on stale selectors before it exercises category, tag, user, password, DB, and upload flows. That weakens future UI regression evidence for the exact protected admin surfaces that were blocked in this local runtime pass by missing MySQL.

Fix:

Update the E2E helpers/specs to use `#main-content`, role-based landmarks, or more specific page-level selectors. Then run the admin E2E lane against a seeded local DB/admin session.

### C29-UXR-R2 - Populated gallery/admin runtime review remains DB-blocked

Severity: Low
Confidence: High
Type: Manual validation gap

Sources:

- `.context/reviews/designer.md` records the local runtime blocker: `connect ECONNREFUSED 127.0.0.1:3306`.
- DB-backed public home data begins at `apps/web/src/app/[locale]/(public)/page.tsx:157-173`.
- Protected dashboard data begins at `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`.

Failure scenario:

Static review and focused tests can miss visual density, scrolling, responsive table/card behavior, and real upload/image-management states that only appear with seeded photos, tags, topics, GPS data, and admin auth.

Fix:

Run a seeded local DB or known-safe review environment and capture desktop/mobile passes through populated home, photo, map, admin dashboard/upload, categories, settings, and DB pages. Include dark/light/OLED and Korean locale snapshots.

## Rechecked Previous Findings

- Prior image-manager horizontal overflow issue is fixed in current source: `apps/web/src/components/image-manager.tsx:424-425` now uses `min-w-0 overflow-x-auto rounded-md border`; wide columns remain contained.
- Prior slideshow interval field-level validation issue is fixed: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:154-174` validates the field; `settings-client.tsx:698-714` marks `aria-invalid`, associates help/error text, and renders `role="alert"`.
- Public/admin skip-link targets are covered: `apps/web/src/app/[locale]/layout.tsx:123-128`, public layout `apps/web/src/app/[locale]/(public)/layout.tsx:8-16`, admin layout `apps/web/src/app/[locale]/admin/layout.tsx:19-27`, and error boundary `apps/web/src/app/[locale]/error.tsx:34-56`.
- Touch target and focus-visible policies have broad source gates: `apps/web/src/__tests__/touch-target-audit.test.ts:42-83` and `apps/web/src/__tests__/focus-visible-links-scan.test.ts:52-88`.
- Korean/English key parity and theme-token contracts passed in the focused validation run.

## Covered Area Summary

Information architecture:

- Reviewed localized public shell, topic/tag filters, public map/timeline/year/privacy pages, shared routes, smart collections, admin grouping, and admin nav. Main IA issue is the generic public DB-error fallback; main privacy-affordance issue is the one-click GPS map switch.

Interaction design:

- Reviewed search dialog, nav expansion, theme cycling, locale switching, lightbox/photo viewer controls, upload dropzone, tags, category map toggle, settings validation, DB restore confirmation, and admin tables. Confirmed issues are theme hydration and GPS-publication confirmation.

Accessibility:

- Reviewed landmarks, skip links, labels, aria-live regions, combobox/listbox patterns, dialog/focus-trap behavior, touch targets, focus-visible rings, field validation, and map fallback list. Focused a11y/touch/focus tests passed. Map scale remains an accessibility risk because the fallback can become thousands of links.

Responsive behavior:

- Reviewed nav wrapping, public masonry, photo viewer, map loader, admin layout, image manager overflow, and table/card patterns. No new source-backed responsive defect was found besides map scale.

Loading/empty/error states:

- Reviewed global/public/admin loading and error files, topic empty state, search states, upload states, map empty/loading, and restore-maintenance copy. Confirmed issue is generic DB failure UX.

Themes/color:

- Reviewed light/dark/OLED tokens, forced-colors CSS, reduced-motion CSS, HDR/P3 badge display rules, and tests. No contrast regression found; theme hydration remains an interaction/accessibility mismatch.

i18n:

- Reviewed `en.json`/`ko.json`, plural convention from `CLAUDE.md`, map/category/error/theme/search keys, and parity tests. No new translation-key gap found.

## Final Missed-Issues Sweep

Final sweep covered `aria-*`, `role`, `tabIndex`, `aria-live`, `focus-visible`, `sr-only`, dialog/focus-trap code, search/listbox semantics, map/list fallback, admin table overflow, touch-target tests, reduced-motion CSS, forced-colors CSS, dark/light/OLED tokens, loading/empty/error states, validation flows, privacy/GPS copy, Korean/English messages, and E2E selectors.

Reported findings:

- Confirmed product UI/UX issues: 4
- Validation risks needing manual follow-up: 2

No product code was modified.
