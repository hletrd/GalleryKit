# Cycle 28 Designer UI/UX Review

Date: 2026-06-30
Role: designer
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `9d7f7f74`
Scope: Prompt 1 review only. No fixes implemented.

## Inventory

Read first: `AGENTS.md` instructions supplied for this workspace and `CLAUDE.md`.

Review-relevant files and docs examined:

- App shell and routing: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/layout.tsx`, `apps/web/src/app/[locale]/error.tsx`, public home/photo/share/topic/category/year/timeline/map/privacy/loading/not-found routes under `apps/web/src/app/[locale]/(public)`.
- Public UI components: `nav-client.tsx`, `nav.tsx`, `footer.tsx`, `home-client.tsx`, `search.tsx`, `photo-viewer.tsx`, `image-zoom.tsx`, `lightbox.tsx`, `photo-navigation.tsx`, `info-bottom-sheet.tsx`, `photo-card.tsx`, `optimistic-image.tsx`, `tag-filter.tsx`, `map-view.tsx`.
- Admin UI components/routes: admin login/protected layouts, settings, analytics, categories, tags, dashboard, users, uploads, database, tokens, image manager, `upload-dropzone.tsx`, `image-manager.tsx`, `tag-input.tsx`, `admin-user-manager.tsx`.
- UI primitives and modal infrastructure: `button.tsx`, `input.tsx`, `label.tsx`, `dialog.tsx`, `sheet.tsx`, `table.tsx`, `switch.tsx`, `lazy-focus-trap.tsx`, `use-modal-tree-isolation.ts`.
- Styling/accessibility/i18n: `globals.css`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, locale path helpers, gallery config shared validators.
- Tests used as coverage map: touch target audit, a11y scans, focus-visible scans, HDR badge contrast, theme token contract, i18n key parity, admin e2e specs.
- Existing review context: previous `.context/reviews/designer.md`, plus cycle context in `.context/reviews/`.

No relevant UI file identified by this inventory was intentionally skipped. DB-authenticated and DB-backed flows that could not be reached at runtime were reviewed from source with the blocker noted below.

## Runtime Evidence

- Port 3000 was already occupied by an existing `node` listener, so I left it alone and started this repo with `npm run dev --workspace=apps/web -- --port 3001`.
- Used the `agent-browser` skill family to install/drive Chromium, inspect accessibility snapshots, query active elements, capture computed styles/rects, exercise keyboard focus, and inspect console output.
- Loaded `http://localhost:3001/en/privacy` at desktop and mobile widths. The page exposed skip link, `Main navigation`, `GalleryKit`, search, theme, locale, main headings, and footer links. Mobile visible controls measured at least 44 px in height/width.
- Opened the search overlay from privacy. Runtime evidence: `input#search-input` was the active element, role `combobox`, label `Search photos, tags, cameras...`; the dialog applied `body.style.overflow = hidden`; background siblings were `aria-hidden=true` and `inert=true`; Tab moved focus to the 44x44 close button; Escape closed the dialog.
- Loaded `http://localhost:3001/en/admin` and submitted dummy credentials. The login page stayed in-form and rendered `role=alert` text `Authentication failed. Please try again.`
- Loaded `http://localhost:3001/en`. The local DB-backed home failed because MySQL data reads were unavailable; console output included failed `topics` query logs and the page rendered the route-level error shell.
- Dark mode was exercised through the theme button on privacy; runtime state reached `html.dark`, localStorage `theme=dark`, body background `rgb(9, 9, 11)`, body text `rgb(250, 250, 250)`.
- Targeted validation passed: `npm test --workspace=apps/web -- touch-target-audit.test.ts a11y-us-p15.test.ts focus-visible-links-scan.test.ts i18n-key-parity.test.ts theme-token-contract.test.ts hdr-badge-contrast.test.ts` passed 6 files / 56 tests.

Runtime blocker: full public gallery/photo/map and protected-admin data flows could not be end-to-end exercised because the local dev environment had MySQL read failures. I used source-backed evidence for those paths instead of treating screenshots as sufficient.

## Findings

### C28-DES-01 - Public data failures collapse into a stripped generic error shell

- Severity: Medium
- Confidence: High
- Files and lines: `apps/web/src/app/[locale]/error.tsx:22-57`; `apps/web/src/app/[locale]/(public)/layout.tsx:7-17`; `apps/web/src/app/[locale]/(public)/page.tsx:151-167`; `apps/web/src/components/nav-client.tsx:160-184`
- Evidence: The normal public layout renders `Nav`, focusable `main`, and `Footer`, while the route error component renders its own minimal header with only one localized home link. The public home awaits DB-backed `getTagsCached()`, `getTopicsCached()`, and `getImagesLitePage()` before rendering. In browser, `/en` exposed `banner > navigation "Site navigation" > link "Gallery"`, `main > region "Error"`, `button "Try again"`, and `link "Return to Gallery"`; search, theme, locale, topic navigation, footer, and admin/footer links were absent.
- Problem: A recoverable public data outage removes the main information architecture and recovery affordances. The shell is accessible in isolation, but it is not product-specific enough for a gallery visitor and it bypasses controls that remain useful during a backend outage.
- Failure scenario: During first-run setup, a DB restart, migration drift, or a transient MySQL outage, a public visitor lands on the home page and sees a generic app error with no search, no language/theme controls, no footer/admin link, and no explanation that gallery data is temporarily unavailable.
- Suggested fix: Preserve the normal public shell for public route failures or catch expected DB-unavailable reads in public listing pages and render a localized `PublicDataUnavailable` state inside `PublicLayout`. Keep search/theme/locale/footer visible when possible, and add a regression that simulates `getTopicsCached()` or `getImagesLitePage()` failure and asserts the recovery IA remains present.

### C28-DES-02 - Slideshow interval has server-only validation and no inline field error

- Severity: Medium
- Confidence: High
- Files and lines: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:154-173`, `settings-client.tsx:229-270`, `settings-client.tsx:696-707`; `apps/web/src/lib/gallery-config-shared.ts:88-90`, `gallery-config-shared.ts:147-153`; `apps/web/src/app/actions/settings.ts:60-65`; `apps/web/messages/en.json:720`
- Evidence: `validateSettings()` adds range errors for WebP/AVIF/JPEG quality and `wide_gamut_max_source_pixels`, but omits `slideshow_interval_seconds`. The slideshow input has `type="number"`, `min={SLIDESHOW_INTERVAL_MIN}`, `max={SLIDESHOW_INTERVAL_MAX}`, and `aria-describedby="slideshow-interval-help"`, but no `aria-invalid`, no error element, and no `fieldErrors.slideshow_interval_seconds` rendering. The shared validator rejects values outside 2-30 and the server action returns a generic `invalidSettingValue` toast.
- Problem: Native `min`/`max` does not protect this save path because settings save is handled by a button `onClick` and a server action, not by browser form submission/reportValidity. Other numeric settings already get localized inline errors, so this one field behaves inconsistently.
- Failure scenario: An admin types `1`, `0`, or `999` seconds and clicks Save. They get a generic toast such as an invalid setting value for `slideshow_interval_seconds`, with no field highlight, no linked screen-reader error, and no immediate instruction beyond the passive hint text.
- Suggested fix: Add `addRangeError('slideshow_interval_seconds', settings.slideshow_interval_seconds, SLIDESHOW_INTERVAL_MIN, SLIDESHOW_INTERVAL_MAX)` to `validateSettings()`, include it in the hook dependencies, render a localized `role="alert"` error paragraph, set `aria-invalid`, and include the error id in `aria-describedby`. Add a focused test covering client validation for out-of-range slideshow intervals.

### C28-DES-03 - Image manager table lacks a stable responsive width contract

- Severity: Low
- Confidence: Medium
- Files and lines: `apps/web/src/components/image-manager.tsx:424-548`; `apps/web/src/components/ui/table.tsx:7-18`; comparison patterns in `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:218-219`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:96-97`, and `apps/web/src/components/admin-user-manager.tsx:135-136`
- Evidence: The shared `Table` primitive provides `overflow-x-auto`, but `ImageManager` renders a 9-column media-management table as `<Table>` without a `min-w-*` contract. The row includes a 128x128 preview, title/description, truncated filename, topic, a tag editor with `min-w-[200px]`, gamut badges, date, and two 44x44 action buttons. Other narrower admin tables explicitly set widths such as `min-w-[760px]` or `min-w-[520px]`.
- Problem: On narrow admin viewports, the table depends on browser auto table layout and cell min-content behavior rather than an intentional breakpoint or scroller width. That makes the most complex admin table more likely to wrap, compress, and produce unstable horizontal scrolling compared with the rest of the admin IA.
- Failure scenario: An admin reviewing uploads on a tablet or narrow laptop gets row heights that jump as titles/descriptions wrap, the tag editor competes with action/date columns, and horizontal scan order becomes harder than in the tag/category/user tables.
- Suggested fix: Match the established admin pattern by giving the image manager table an explicit minimum width sized for its real columns, for example `<Table className="min-w-[1120px]">`, or introduce a card/list layout below the chosen admin breakpoint. Keep the existing 44 px controls and table overflow container.

## Positive Coverage

- Skip-link and main focus targets are present in the app/public layout.
- Search dialog focus, Escape behavior, background inerting, and reduced body scroll were verified in-browser.
- Theme controls and dark tokens produced high-contrast computed colors on the privacy path.
- Locale messages passed key parity, and `layout.tsx` sets locale-specific `lang` and `dir`.
- Global styles include forced-colors accommodations, reduced-motion overrides, stable focus-visible rings, and touch-target enforcement tests.
- Public privacy, map, timeline, year, upload, and empty-state source paths include visible headings or explicit empty/error copy.

## Missed-Issue Sweep

Searched and inspected `aria-*`, `role=`, `tabIndex`, `focus-visible`, `sr-only`, `aria-live`, `loading`, `error`, `empty`, `not-found`, modal/dialog/sheet portals, reduced-motion CSS, forced-colors CSS, theme tokens, responsive overflow patterns, table patterns, form validation, locale messages, admin route surfaces, public routes, and existing UI/a11y/e2e tests. After the final sweep, no additional designer-severity issue rose above the reporting threshold.
