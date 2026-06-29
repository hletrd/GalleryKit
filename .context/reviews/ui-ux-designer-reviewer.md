# UI/UX Designer Reviewer - Cycle 14

Role: `ui-ux-designer-reviewer` registered at `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`.

Profile note: the registered local prompt is written for another app. I used only its reviewer-style intent: deep professional UI/UX critique, accessibility review, interaction-quality review, and source-backed findings. I did not apply BurstPick-specific product requirements to GalleryKit.

Scope: independent review artifact only. No production code edits. Current HEAD reviewed: `d821a9ab`.

## Executive Summary

GalleryKit has a strong baseline for a photographer-first gallery: the main masonry grid, photo viewer, lightbox, search dialog, touch-target scanning, focus-visible scanning, dark/light/OLED tokens, and EN/KO key parity are already mature. The clearest remaining UI/UX problems are concentrated in secondary or admin surfaces: the public map is visually useful but weakly exposed to keyboard/screen-reader users, several admin data tables are not wrapped for narrow screens, and settings-style admin forms are brittle under Korean copy and mobile widths.

Browser validation was only partially feasible locally. The existing local dev server loaded the admin login page, but public routes rendered the app error boundary because the local database/schema state failed a topics query. I recorded that as a validation blocker, not as a confirmed product UI bug.

## Inventory Built Before Inspection

Primary UI/UX inventory:

- Public routes under `apps/web/src/app/[locale]/(public)/`: home, topic, smart collection, shared group, shared photo, photo detail/loading, timeline, year, map, privacy, uploads route, feed route, and locale layout.
- Admin routes under `apps/web/src/app/[locale]/admin/`: login, admin layout, dashboard, categories, tags, settings, SEO, DB, password, users, tokens, analytics, protected loading/error, and route metadata.
- Shared UI under `apps/web/src/components/`: home grid, photo viewer, lightbox, search, map, nav, admin nav/header, image manager, upload dropzone, tag filter/input, load-more, color details, histogram, bottom sheet, EXIF/color panels, footer, and UI primitives used by these surfaces.
- i18n and styling: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/app/[locale]/globals.css`, and Tailwind/Radix/shadcn component usage.
- Regression coverage checked: `touch-target-audit.test.ts`, `focus-visible-links-scan.test.ts`, i18n key parity tests, public source-contract tests, and related UI unit/e2e files.

Approximate source surface inventoried: 99 public/admin/component files. I deeply inspected the primary public gallery/photo/share/search/map paths and the main admin login/dashboard/settings/forms/table paths. I did not line-review non-rendering API/feed/upload route handler bodies beyond inventory because they do not render UI. Protected admin browser flows were not exercised because no credentials were used.

## Browser Evidence

Local server status:

- An existing Next dev server was already running at `http://localhost:3001`.
- `curl -I http://localhost:3001/en` returned HTTP 200, but the browser rendered the application error boundary.
- Browser title at `/en`: `Error | GalleryKit`.
- Visible error UI at `/en`: `Error / Something went wrong loading this page. / Try again / Return to Gallery`.
- Console/server evidence: the page failed while querying `topics` with `select slug, label, order, image_filename, map_visible, (SELECT MAX(updated_at) FROM images WHERE topic=slug AND processed=true) ...`.
- Screenshot evidence captured locally: `/tmp/gallerykit-home-error.png`.

Admin login browser check:

- URL: `http://localhost:3001/en/admin`.
- Mobile viewport: 390 x 844.
- Visible UI: `Admin / Sign in to manage your gallery / Username / Password / Sign in`.
- Basic keyboard path reached the submit button after username/password fields; labels and password toggle were visible in source at `apps/web/src/app/[locale]/admin/login-form.tsx:35-108`.
- Screenshot evidence captured locally: `/tmp/gallerykit-admin-login-mobile.png`.

## Confirmed Issues

### UIUX-C14-01 - Public map is pointer-first and has weak accessible structure

Severity: Medium

Confidence: Medium-high

Evidence:

- The map page renders the map before the accessible fallback list at `apps/web/src/app/[locale]/(public)/map/page.tsx:59-79`.
- The accessible fallback list is present, but it is after the map: links are rendered at `apps/web/src/app/[locale]/(public)/map/page.tsx:67-78`.
- The Leaflet `MapContainer` is rendered as a visual block with inline height/width styling and no surrounding accessible name or visible keyboard instructions at `apps/web/src/components/map/map-client.tsx:107-144`.
- Markers are wired primarily through pointer click handlers at `apps/web/src/components/map/map-client.tsx:119-126`, with photo navigation exposed inside the popup at `apps/web/src/components/map/map-client.tsx:127-141`.

Failure scenario:

A keyboard or screen-reader user opens `/map`. They encounter a large interactive map region before the useful list, but the map itself does not announce a clear name, purpose, keyboard model, or marker list. The fallback links are helpful, but their placement after the map makes the accessible path less discoverable. Sighted keyboard users can also get stuck understanding how to operate a third-party map before reaching the list.

Concrete fix:

Treat the map and list as a single accessible region. Add a visible heading or `aria-labelledby` around the map/list, add short keyboard-use text or a skip link to the photo list before the map, and either make markers reliably keyboard-labelled or explicitly present the map as visual exploration with the list as the primary accessible control. Consider disabling scroll-wheel zoom by default and adding an explicit zoom/use hint so the map does not unexpectedly capture page navigation.

### UIUX-C14-02 - Several admin tables lack a narrow-screen overflow or card fallback

Severity: Medium

Confidence: High

Evidence:

- Category management renders a multi-column table directly inside a bordered wrapper without `overflow-x-auto` at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:216-261`.
- Tag management renders its table without an overflow wrapper at `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:95-126`.
- Admin user management renders its table inside `className="border rounded-md"` with no horizontal overflow handling at `apps/web/src/components/admin-user-manager.tsx:137-177`.
- Dashboard image management shows the established safer pattern: the image manager is wrapped in `max-w-full ... overflow-auto` at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123-132`.
- Analytics tables also use `overflow-x-auto`, for example `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:95-96`, `141-142`, `172-173`, `206-207`, and `247-248`.

Failure scenario:

On a 320-390 px admin viewport, category rows include order, label, slug, aliases, map visibility, and actions. Without a local horizontal scroller or stacked small-screen layout, the right-side action controls can clip off-screen or force page-level horizontal scrolling. That makes edit/delete actions hard to discover and easy to miss, especially in Korean where labels and dates are longer.

Concrete fix:

Wrap each admin table in the same local overflow pattern already used by analytics and dashboard (`rounded-md border overflow-x-auto`) and give the table a stable `min-w-*` where needed. For the category table, consider a small-screen stacked card layout because it mixes editable text, aliases, visibility, and destructive actions. Keep row action buttons visible without requiring a whole-page horizontal pan.

### UIUX-C14-03 - Settings and SEO admin headers/rows are brittle with Korean copy on mobile

Severity: Medium

Confidence: Medium-high

Evidence:

- Settings uses a single-line `flex items-center justify-between` header with a `text-3xl` title and a right-aligned save button at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:226-240`.
- Settings has multiple long-label rows using side-by-side `flex items-center justify-between`, including metadata/display switches at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:407-443`, color/HDR settings at `553-671`, and semantic-search controls with a fixed-width `SelectTrigger className="w-[200px]"` at `658-665`.
- SEO uses the same non-wrapping header pattern at `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:72-87`.
- Korean messages include long explanatory settings strings, including color profile, Firefox display limitation, AVIF effort, semantic search, backfill, and analytics disclaimers in `apps/web/messages/ko.json`.

Failure scenario:

In Korean on a narrow phone or split-screen tablet, the title/help text and fixed-width controls compete in the same row. The save button or select can squeeze, wrap awkwardly, or push text into a hard-to-scan column. This is most likely in settings because it combines long localized explanations with switches, selects, and fixed-width controls.

Concrete fix:

Make settings/SEO headers responsive: `flex-wrap`, `gap-3`, `items-start`, `min-w-0` on text blocks, and `shrink-0` on the save button. For setting rows, prefer a two-row mobile layout: label/help text full width, control beneath or right-aligned on `sm:` and above. Replace fixed `w-[200px]` selects with `w-full sm:w-[200px]` inside a wrapping row.

### UIUX-C14-04 - Public home empty state is not actionable for a fresh gallery

Severity: Low

Confidence: High

Evidence:

- The home grid empty state renders only a generic title/body when there are no images at `apps/web/src/components/home-client.tsx:424-438`.
- The only action in that state is a clear-filter link, and it appears only when `currentTags.length > 0` at `apps/web/src/components/home-client.tsx:430-435`.
- The admin upload area has a more useful setup-oriented empty state for missing categories at `apps/web/src/components/upload-dropzone.tsx:344-363`, but the public home page has no comparable path or explanation.

Failure scenario:

A newly installed or private gallery with no processed public photos shows a dead-end public page: visitors see "No images" but do not know whether the gallery is empty, loading, private, still processing uploads, or filtered. A signed-in owner viewing the public page also gets no route back to upload/setup from the empty state.

Concrete fix:

Keep the public copy neutral, but make it more informative: "Photos will appear here once published" or similar. If the viewer is an authenticated admin, optionally include a localized link to the dashboard/upload flow. Preserve the existing clear-filter action for filtered empty states.

## Likely Issues

### UIUX-C14-05 - Photo-page swipe handling may intercept gestures outside the photo canvas

Severity: Low-medium

Confidence: Medium

Evidence:

- `PhotoNavigation` installs global `window` touch listeners at `apps/web/src/components/photo-navigation.tsx:47-60`.
- Once horizontal movement is detected, it calls `e.preventDefault()` from the global `touchmove` handler at `apps/web/src/components/photo-navigation.tsx:131-133`.
- The listener is attached while the photo viewer is active, not scoped to only the photo image/canvas area.

Failure scenario:

On mobile photo pages, a horizontal gesture over side panels, bottom sheets, controls, or browser-edge navigation may be interpreted as photo navigation instead of local scrolling or browser navigation. This is hard to prove without a populated local photo page, but the source shape is broad enough to warrant manual validation.

Concrete fix:

Scope swipe listeners to the photo media region rather than `window`, or ignore gestures that start inside controls, panels, dialogs, bottom sheets, or scrollable metadata regions. Add a mobile browser regression check that swipes over the image navigate photos while swipes over controls/metadata do not.

### UIUX-C14-06 - Search input has a 32 px visual field inside a touch-first dialog

Severity: Low

Confidence: Medium

Evidence:

- The search dialog input uses `className="h-8 ..."` at `apps/web/src/components/search.tsx:372-403`.
- The dialog itself, close button, semantic toggle, and result rows have stronger touch/focus treatment at `apps/web/src/components/search.tsx:351-364`, `429-496`.
- The touch-target audit focuses primarily on interactive controls and known button/link patterns, not every text input visual height.

Failure scenario:

On mobile, the primary search field is visually smaller than GalleryKit's 44 px touch-target policy. Even if the surrounding dialog padding makes it usable, the field reads as denser and less touch-first than the rest of the interface.

Concrete fix:

Use `h-11` or `min-h-11` for the mobile search combobox input, with a compact desktop override if necessary. Confirm the text baseline remains visually balanced in both English and Korean.

## Risks Needing Manual Validation

### UIUX-C14-R1 - Public gallery/photo/share/search/map pages could not be browser-validated against local data

Severity: Medium as a review blocker

Confidence: High

Evidence:

- Local `/en` rendered the error boundary instead of the home gallery.
- The app error text was visible in browser: `Something went wrong loading this page`.
- The failing query involved topic loading before `HomeClient` could render. The home page depends on topic/config/image data at `apps/web/src/app/[locale]/(public)/page.tsx:149-166`.

Failure scenario:

This review could not validate real runtime layout, image loading, share pages, photo navigation, map markers, or search result behavior locally with representative data. Source review found issues, but browser-only problems such as visual overlap, animation jank, route-specific hydration errors, and mobile map marker behavior may remain.

Concrete fix:

Before the next UI/UX review cycle, provide a migrated local database or a seed fixture that lets `/en`, `/en/p/[id]`, `/en/g/[key]`, `/en/s/[key]`, `/en/search`, `/en/timeline`, `/en/year/[year]`, and `/en/map` load with representative photos, topics, tags, shares, EXIF/color data, and geotags.

### UIUX-C14-R2 - Protected admin workflows need credential-backed browser validation

Severity: Medium as a review gap

Confidence: High

Evidence:

- `/en/admin` login loaded and was inspected.
- Protected pages such as dashboard/settings/forms could only be source-reviewed because no credentials were used.
- The protected admin layout constrains the app into `h-screen overflow-hidden` with a scrolling main region at `apps/web/src/app/[locale]/admin/layout.tsx:17-29`; this pattern needs real mobile browser validation with wrapped nav, tables, dialogs, toasts, and forms.

Failure scenario:

Source review can identify table and wrapping risks, but cannot prove how the protected admin shell behaves with real data, virtual keyboards, form validation errors, sticky headers, wrapped navigation, and dialogs on iOS/Android widths.

Concrete fix:

Run an authenticated browser pass at 390 x 844, 768 x 1024, and desktop widths covering dashboard image manager, upload, categories, tags, settings, SEO, password, users, tokens, and analytics. Include Korean locale and at least one validation-error state per form.

## Positive Evidence

- Reduced-motion handling is broad. Global CSS clamps animations/transitions under `prefers-reduced-motion: reduce` and suppresses hover scale at `apps/web/src/app/[locale]/globals.css:253-279`; the lightbox also uses a `matchMedia` state for slideshow/image motion at `apps/web/src/components/lightbox.tsx:81-109` and `529-537`.
- Touch targets are actively policed. The audit scans app/component roots at `apps/web/src/__tests__/touch-target-audit.test.ts:79-83` and records known exceptions rather than silently ignoring them.
- Focus-visible behavior is actively policed by `apps/web/src/__tests__/focus-visible-links-scan.test.ts`, and primary controls in search/photo/lightbox/admin forms include explicit focus-ring classes.
- Search has a solid keyboard model: Cmd/Ctrl+K open/close and Escape handling at `apps/web/src/components/search.tsx:283-300`, dialog semantics at `351-364`, combobox/listbox attributes at `372-444`, and live status text at `417-427`.
- The photo viewer exposes keyboard shortcuts and avoids editable-target conflicts at `apps/web/src/components/photo-viewer.tsx:388-419`.
- Lightbox keyboard behavior is comprehensive, including slideshow, color pip, histogram, fullscreen, arrows, and Escape handling at `apps/web/src/components/lightbox.tsx:306-357`.
- EN/KO message key parity was checked with a flat key comparison: both files currently expose 802 keys.

## Missed-Issues Sweep

Final sweep checked for:

- Primary UI routes and components across public gallery, photo, share, search, map, timeline/year, admin login, dashboard, categories/tags/users, settings/SEO, tokens/password/analytics.
- Known touch-target and focus-visible enforcement tests.
- Reduced-motion, forced-colors, dark/light/OLED CSS support.
- Korean/English key parity and long-copy pressure.
- Loading/error/empty states in home, map, tokens, admin login, upload, and analytics-style tables.

Skipped or not fully validated:

- Browser-backed public page validation was blocked by the local database/schema error described above.
- Browser-backed protected admin validation was blocked by authentication scope; source review covered the pages instead.
- Non-rendering route handlers, feed/upload internals, and backend data utilities were inventoried but not line-reviewed as UI surfaces.

No production code was modified for this review. Only this review artifact was written.
