# GalleryKit Designer UI/UX Review - Cycle 16

Date: 2026-07-08
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `78778dd8`
Reviewer lane: `designer`
Mode: source-first UI/UX review with limited local browser validation

## Scope And Inventory

I built the UI inventory first, then reviewed every relevant public/admin UI file and interaction surface rather than sampling a subset.

Inventory covered:

- 51 localized app files under `apps/web/src/app/[locale]/**`, including public routes, admin routes, loading/error/not-found states, admin protected pages, and route-specific UI clients.
- 61 component files under `apps/web/src/components/**`, including navigation, search, lightbox, photo viewer, admin upload/table workflows, map, dialogs, forms, theme, i18n, and primitive UI controls.
- `apps/web/src/app/[locale]/globals.css` for theme, contrast, forced-colors, focus, and reduced-motion behavior.
- `apps/web/messages/en.json` and `apps/web/messages/ko.json` for i18n parity and validation copy.
- Relevant tests under `apps/web/src/__tests__/**` and `apps/web/e2e/**`.

Interaction surfaces reviewed: public gallery home, topic/category/year/timeline/map/photo/share routes, nav/search/theme/locale controls, lightbox and bottom sheet, load-more, empty/maintenance/error states, admin login, dashboard, upload/dropzone, image table, bulk edit, category/tag managers, SEO/settings/password/users/tokens/database/analytics pages, dialogs, alerts, forms, and destructive confirms.

## Browser And Validation Evidence

Local browser automation was attempted through the requested agent-browser path.

- `agent-browser --version` succeeded with `agent-browser 0.22.2`.
- `npm run dev --workspace=apps/web -- --hostname 127.0.0.1 --port 3100` could not start because Next reported an existing dev lock for PID `7042` on port `3000`. No matching process/listener was present, so this looked like a stale lock. I did not delete the lock because deleting files is destructive.
- `npm run start --workspace=apps/web -- --hostname 127.0.0.1 --port 3100` started, but DB-backed pages rendered the global error shell because MySQL was unavailable: `connect ECONNREFUSED 127.0.0.1:3306`.
- Browser snapshots of `/en`, `/en/admin`, and an unknown `/en/...` route confirmed the shell exposed a skip link, banner navigation, a single main error region, a heading, retry button, return link, and toast region. Full public/admin workflows could not be interactively validated without the DB.

Fresh tests run:

```text
npm test --workspace=apps/web -- --run \
  src/__tests__/touch-target-audit.test.ts \
  src/__tests__/i18n-key-parity.test.ts \
  src/__tests__/theme-token-contract.test.ts \
  src/__tests__/password-form-a11y.test.ts
```

Result: 4 test files passed, 20 tests passed.

Positive implementation notes from current source:

- `apps/web/src/app/[locale]/layout.tsx:101-107` sets locale `lang` and `dir`.
- `apps/web/src/app/[locale]/layout.tsx:126-145` provides the global skip link and theme provider.
- `apps/web/src/app/[locale]/(public)/layout.tsx:13-18` makes the skip target programmatically focusable.
- `apps/web/src/app/[locale]/globals.css:253-279` suppresses motion for `prefers-reduced-motion`.
- `apps/web/src/app/[locale]/globals.css:281-300` handles forced-colors photo overlays.
- Dialog/lightbox/search code uses focus traps, modal isolation, i18n close labels, and live status regions in the main modal paths.

## Confirmed Findings

### DES-C16-01 - Mobile Home Still Places A Full Tag Wall Before The First Photo

Severity: Medium
Confidence: High
Status: Confirmed from current source

Evidence:

- `apps/web/src/components/home-client.tsx:287-305` renders the page heading and full `TagFilter` before the photo grid.
- `apps/web/src/components/home-client.tsx:318-330` starts the masonry grid after the filter block.
- `apps/web/src/components/tag-filter.tsx:62-122` renders every tag as a wrapping chip group with no collapse, overflow rail, prioritization, or more control.

Why this is a problem:

The home page's primary value is photo browsing, but mobile users and keyboard users meet a large taxonomy control before the first image. This weakens information architecture and makes first meaningful content slower to reach.

Concrete failure scenario:

A phone visitor opens the gallery from a profile link and must scroll past or tab through many filter chips before seeing the first photo. A switch-control user pays the cost for every chip before reaching image content.

Suggested fix:

Keep `All` plus a few active/recent chips above the grid, and move the full taxonomy into a filter sheet, collapsible panel, or horizontal rail with an explicit expand affordance. Preserve `aria-pressed` and 44 px targets.

### DES-C16-02 - Admin Create/Edit Server Validation Is Still Mostly Toast-Only

Severity: Medium
Confidence: High
Status: Confirmed from current source

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:91-107` handles create failures with `toast.error(...)`.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:109-126` handles update failures with `toast.error(...)`.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:205-223` renders create fields without persistent field errors, `aria-invalid`, or `aria-describedby`.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:363-383` renders edit fields with the same gap.
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:53-68` handles update failure with `toast.error(...)`.
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:176-181` renders tag edit controls without field-linked server errors.
- `apps/web/src/components/admin-user-manager.tsx:51-60` handles server create-user failure with toast only, while `apps/web/src/components/admin-user-manager.tsx:107-125` only field-links the confirm-password mismatch.
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-72` saves SEO settings with toast-only failure, while `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:98-184` provides help text but not persistent server-error states.

Why this is a problem:

Toast-only validation is transient and not tied to the control that needs correction. It is weak for screen-reader users, keyboard users, long forms, duplicate slugs, invalid aliases, SEO sanitization, or server-side username errors. Native `required`/`pattern` bubbles are also browser-language, not consistently localized through the app.

Concrete failure scenario:

An admin tries to rename a category to an already-used slug. A toast appears briefly while focus remains on the submit button. If the user misses the toast or returns after it disappears, there is no persistent indication of which field failed.

Suggested fix:

Use the login/settings pattern consistently: keep server errors in component state, render a form-level `role="alert"` summary plus per-field text, set `aria-invalid` and `aria-describedby`, and focus the first invalid field after failure. Keep toast as secondary feedback only.

### DES-C16-03 - Admin Recent Uploads Uses A Dense Metadata Table As The Primary Photo Workbench

Severity: Medium
Confidence: Medium-High
Status: Confirmed from current source; authenticated hands-on validation still needed

Evidence:

- `apps/web/src/components/image-manager.tsx:427-452` renders the recent uploads workbench as a horizontally scrollable multi-column table.
- `apps/web/src/components/image-manager.tsx:473-499` places preview, title, description, and filename into compact cells.
- `apps/web/src/components/image-manager.tsx:501-534` embeds tag editing inside each row.

Why this is a problem:

For a photographer-facing admin workflow, batch review and metadata cleanup are visual tasks. A dense table makes photo identity, comparison, and repeated metadata edits harder than a photo-first grid/list with an inspector or drawer.

Concrete failure scenario:

After uploading a shoot, an admin needs to identify similar frames, assign categories, and fix tags. They have to scan small thumbnails and cramped row controls, losing the visual context needed to make quick decisions.

Suggested fix:

Make the default upload management view photo-first: larger thumbnails, key metadata, selection, and a side drawer or inline detail panel for category/tags. Keep the dense table as an optional power-user mode if needed.

### DES-C16-04 - Truncated Technical Values Rely On Mouse-Only Native `title`

Severity: Low-Medium
Confidence: High
Status: Confirmed from current source

Evidence:

- `apps/web/src/components/info-bottom-sheet.tsx:413-423` truncates camera/lens values and exposes the full value only through `title`.
- `apps/web/src/components/photo-viewer.tsx:803-812` repeats the same EXIF pattern.
- `apps/web/src/components/upload-dropzone.tsx:535-538` truncates filenames with `title`.
- `apps/web/src/components/image-manager.tsx:497-499` truncates uploaded filenames with `title`.

Why this is a problem:

Native `title` is unreliable on touch, keyboard, and assistive technology. Camera model, lens model, and original filenames are exact verification data for photographers and admins.

Concrete failure scenario:

An admin on a tablet sees two uploaded filenames with identical prefixes. The visible text truncates and the full filename is only available via mouse hover, so the admin cannot confidently choose the right file.

Suggested fix:

Use expandable text, a copyable metadata row, a details disclosure, or an accessible tooltip/popover triggered by focus, hover, and touch. For filenames in tables, allow wrapping in a detail drawer or provide a copy button with a clear label.

### DES-C16-05 - Upload Progress Changes Are Not Fully Announced

Severity: Low-Medium
Confidence: Medium
Status: Confirmed source gap; needs screen-reader runtime validation

Evidence:

- `apps/web/src/components/upload-dropzone.tsx:469-483` renders visible progress text and a `progressbar`.
- `apps/web/src/components/upload-dropzone.tsx:484-488` adds `aria-live="polite"` only to the current filename, not the combined progress count/percent.

Why this is a problem:

Screen readers do not consistently announce changing `aria-valuenow` on an unfocused progressbar. The filename live region alone does not communicate "10 of 100, 10%" progress.

Concrete failure scenario:

A screen-reader admin starts a large upload and focus remains on the disabled upload controls. They may hear a changing filename, but not whether progress is moving or how many files remain.

Suggested fix:

Add a dedicated `role="status" aria-live="polite" aria-atomic="true"` text node containing the localized count, total, percent, and current filename. Keep the `progressbar` for semantic value.

## Likely Issues

### DES-C16-06 - Tag Autocomplete Can Be Clipped Inside The Admin Table Scrollport

Severity: Medium
Confidence: Medium
Status: Likely from current DOM/CSS structure; needs authenticated visual confirmation

Evidence:

- `apps/web/src/components/image-manager.tsx:427-452` wraps the image table in `overflow-x-auto`.
- `apps/web/src/components/image-manager.tsx:501-534` embeds `TagInput` in each row.
- `apps/web/src/components/tag-input.tsx:184` positions the input container as `relative`.
- `apps/web/src/components/tag-input.tsx:231-233` renders suggestions as an absolutely positioned child inside that subtree.

Why this is a problem:

An absolutely positioned dropdown cannot escape an overflow-clipping ancestor just by using `z-50`. On narrower admin widths, suggestions can be clipped or require horizontal scrolling while the user is trying to choose a tag.

Concrete failure scenario:

An admin edits tags in the recent uploads table on a tablet. The suggestion list opens near the right edge of the scrollport and is partially hidden, so the admin assumes no matching tags exist or cannot reach an option.

Suggested fix:

Render suggestions through a portal/popover that positions relative to the input but escapes the table scroll container, or move row metadata editing into a drawer/inspector outside the scroll table. Verify keyboard arrows, Escape, outside click, and touch selection.

### DES-C16-07 - Lightroom Token Page Uses One Pending State For Independent Async Jobs

Severity: Low-Medium
Confidence: Medium
Status: Likely source issue; needs authenticated workflow timing validation

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:28` defines one `isPending` transition state.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:40-42` attaches focus restoration for retry, create, and revoke controls to that same pending state.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:56-61` uses it for list refresh.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-104` uses it for create.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:106-117` uses it for revoke.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:187-194`, `242-245`, and `303-321` disable unrelated revoke/create/confirm controls from the shared state.

Why this is a problem:

Loading the list, creating a token, and revoking a token are different jobs with different user context. A shared pending state can disable unrelated controls, block closing a confirm dialog, or restore focus to the wrong action after an unrelated transition settles.

Concrete failure scenario:

A list refresh is slow after token creation. The admin opens the create dialog again and the create button is disabled by the list refresh, without a clear dialog-local reason. Focus restoration can also target a button unrelated to the action the user just took.

Suggested fix:

Split state into `isLoadingList`, `isCreating`, and `isRevoking`, with separate focus restoration and dialog close gating. Show dialog-local status text for create/revoke and keep list refresh status inside the list region.

### DES-C16-08 - Archive Photo Grids Re-enable Viewport Prefetch That Other Grids Intentionally Disable

Severity: Low
Confidence: High
Status: Likely performance issue from source

Evidence:

- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:250-253` links each archive photo without `prefetch={false}`.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:210-213` does the same.
- `apps/web/src/components/masonry-card.tsx:78-81` disables prefetch for the main masonry cards.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:199-209` disables prefetch for shared grids with an explicit resource-cost comment.

Why this is a problem:

Long masonry-like archive pages can schedule many photo-detail RSC prefetches as links enter the viewport. That competes with thumbnail loading and server/database work, especially on mobile or low-bandwidth connections. The main and shared grids already avoid this.

Concrete failure scenario:

A mobile visitor scrolls a year archive with many photos. The browser begins prefetching detail pages for visible tiles, making image loading and scrolling feel slower before the user clicks anything.

Suggested fix:

Add `prefetch={false}` to timeline/year photo links and rely on normal click navigation plus existing detail-page neighbor preloads.

## Manual-Validation Risks

### DES-C16-09 - Leaflet Map Accessibility Needs Real DOM And Keyboard Validation

Severity: Low-Medium
Confidence: Medium
Status: Manual-validation risk

Evidence:

- `apps/web/src/app/[locale]/(public)/map/page.tsx:80-89` provides a skip link and labelled/described section around the map.
- `apps/web/src/components/map/map-client.tsx:109-140` renders `MapContainer` without explicit ARIA props, focus handling, or localized keyboard instructions on the Leaflet container itself.
- Marker popup buttons are labelled at `apps/web/src/components/map/map-client.tsx:126-131`, but marker reachability depends on Leaflet's generated DOM.

Why this is a problem:

Leaflet injects its own focusable map viewport and controls. The wrapper section is labelled, but the generated interactive map may still be announced generically, lack localized keyboard instructions, or make marker access unclear.

Concrete failure scenario:

A keyboard/screen-reader visitor tabs into the map and hears a generic interactive region. They do not know how to pan, zoom, reach markers, or leave the map except by tabbing until the list.

Suggested fix:

When the map instance is ready, apply a localized accessible name/description to the Leaflet container and verify generated controls have useful labels. Keep the photo list fallback, and add visible-on-focus skip links before and after the map.

### DES-C16-10 - Admin Navigation Is A Flat Ten-Link Wrap

Severity: Low-Medium
Confidence: High
Status: Confirmed source structure; needs authenticated responsive validation

Evidence:

- `apps/web/src/components/admin-nav.tsx:15-26` defines ten top-level links in one array.
- `apps/web/src/components/admin-nav.tsx:28-49` renders one wrapping nav list.
- `apps/web/src/components/admin-header.tsx:13-27` places brand, nav, and logout into a wrapping header row.

Why this is a problem:

The admin IA mixes content, discovery, account, system, database, analytics, and token workflows in one flat cluster. On narrow screens and Korean labels, wrapping changes spatial grouping, increasing visual rescanning cost.

Concrete failure scenario:

An admin moves between Uploads, Tags, SEO, Settings, DB, and Analytics. On a narrow viewport the link positions wrap differently, so repeated task navigation requires scanning the whole cluster each time.

Suggested fix:

Group admin navigation into stable sections such as Content, Discovery, System, and Account. Use a desktop sidebar or grouped top nav, and a mobile drawer/segmented menu with clear current-page state and 44 px targets.

## Final Sweep

Commonly missed areas checked:

- Focus traps and modal isolation: present in search, lightbox, and info sheet.
- Touch targets: targeted audit passed; button primitives and many custom links/chips use 44 px minimums.
- Contrast/dark/forced colors: theme token tests passed; current source contains forced-colors and reduced-motion overrides.
- Loading/empty/error states: public restore maintenance, token loading/error/empty, upload skipped-file warnings, image-processing placeholders, and global error shell are present. DB outage prevented end-to-end visual confirmation of data-loaded states.
- i18n: key parity test passed for English/Korean. RTL is future-proofed via `dir`, but no RTL locale is shipped, so RTL layout remains unvalidated.
- Perceived performance: photo grids generally use sized images, AVIF/WebP/JPEG sources, above-fold priority logic, and prefetch suppression in main/shared grids; timeline/year are the outliers.

Skipped runtime validation:

- Authenticated admin workflows, map marker navigation, upload progress, token lifecycle timing, and table autocomplete clipping could not be validated in a data-loaded local browser because the local MySQL dependency was unavailable and the dev server lock could not be cleared without deleting a file.
