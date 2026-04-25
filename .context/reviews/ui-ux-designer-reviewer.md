# UI/UX Designer Reviewer — PROMPT 1 / Cycle 5

**Repo:** `/Users/hletrd/flash-shared/gallery`
**Scope:** GalleryKit web UI (`apps/web`) — public gallery, photo viewer/lightbox, admin dashboard/settings/content management, shared routes, i18n/messages, styles, and UI tests.
**Mode:** Review only. No implementation. No commit.
**Date:** 2026-04-25 KST
**Status:** REVIEW_COMPLETE — source-led with limited browser confirmation.

## Inventory and runtime check

### Relevant surfaces inventoried

- **Public routes/layouts:** `apps/web/src/app/[locale]/(public)/layout.tsx`, `page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`.
- **Global states/styles:** `apps/web/src/app/[locale]/layout.tsx`, `globals.css`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `global-error.tsx`.
- **Public UI components:** `nav.tsx`, `nav-client.tsx`, `footer.tsx`, `home-client.tsx`, `search.tsx`, `tag-filter.tsx`, `load-more.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `image-zoom.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `histogram.tsx`, `optimistic-image.tsx`, `photo-viewer-loading.tsx`.
- **Admin UI:** admin layouts/pages plus `admin-header.tsx`, `admin-nav.tsx`, `dashboard-client.tsx`, `image-manager.tsx`, `upload-dropzone.tsx`, `tag-input.tsx`, `admin-user-manager.tsx`, topic/tag/password/seo/settings/db clients.
- **Design primitives:** `components/ui/*` used by dialogs, tables, controls, inputs, progress, switch, toasts.
- **i18n/RTL:** `messages/en.json`, `messages/ko.json`, `lib/constants.ts`, `lib/locale-path.ts`, `i18n/request.ts`.
- **Tests/artifacts:** `apps/web/e2e/public.spec.ts`, `admin.spec.ts`, `nav-visual-check.spec.ts`, `test-fixes.spec.ts`, `e2e/helpers.ts`, and UI-related unit tests (`lightbox`, `tag-input`, `upload-dropzone`, `photo-title`, `shared-page-title`, `settings-image-sizes-lock`, `error-shell`).

### Browser/CLI check

Used `agent-browser` against `npm run dev` at `http://localhost:3000/en`. The app server started, but DB-backed pages rendered only the localized error boundary because no local MySQL credentials/database were configured. DOM snapshot exposed `button "Try again"`, `link "Return to Gallery"`, and the Next dev server logged `ER_ACCESS_DENIED_ERROR` from `Home` at `apps/web/src/app/[locale]/(public)/page.tsx:115`. Therefore protected admin/public interactions were reviewed through DOM/source/test evidence rather than live DB-backed journeys.

## Findings

### UX-C5-01 — Keyboard focus on the zoomable photo has no visible indicator

- **Severity:** High
- **Confidence:** High
- **Classification:** confirmed
- **Selector/surface:** photo page zoom container, `role="button"` from `ImageZoom`.
- **Evidence:** `apps/web/src/components/image-zoom.tsx:117-132` makes the image container keyboard-focusable (`role="button"`, `tabIndex={0}`) and handles Enter/Space, but its class list only sets `overflow-hidden` and cursor state; there is no `focus-visible:*` ring/outline. It is rendered around the primary image at `apps/web/src/components/photo-viewer.tsx:342-345`.
- **Failure scenario:** A keyboard user tabs from the toolbar into the zoom control and cannot see where focus landed before pressing Space/Enter, violating focus visibility expectations on the main photo interaction.
- **Fix:** Add a visible focus treatment to the zoom container, e.g. `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`, and verify it remains visible over dark/light photo backgrounds.

### UX-C5-02 — Upload progress is visual-only rather than a real progressbar

- **Severity:** Medium
- **Confidence:** High
- **Classification:** confirmed
- **Selector/surface:** admin dashboard upload progress (`#admin-content` upload form).
- **Evidence:** `apps/web/src/components/upload-dropzone.tsx:361-369` renders progress text plus `<Progress value={progress} />`, but `apps/web/src/components/ui/progress.tsx:10-21` outputs plain `<div>` elements with no `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, or accessible label.
- **Failure scenario:** During a long multi-file upload, sighted users see a percentage bar, while screen-reader users only encounter a generic div and may not receive meaningful progress updates.
- **Fix:** Give `Progress` progressbar semantics by default or pass them at call sites: `role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t('upload.uploadingProgress', ...)}`. Keep the existing textual status in a polite live region.

### UX-C5-03 — Database page uses one pending state for backup, restore, and CSV export

- **Severity:** Medium
- **Confidence:** High
- **Classification:** confirmed
- **Selector/surface:** `/admin/db` action cards.
- **Evidence:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:28` creates one shared `isPending` via `useTransition()`. Backup uses it at `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:143-149`, restore uses the same flag at `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:195-202`, and CSV export uses it at `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:233-240`.
- **Failure scenario:** If an admin clicks “Download Backup”, the restore and export buttons are also disabled and can display “Restoring...” / “Exporting...” even though no restore/export is running. This is especially alarming because restore is destructive.
- **Fix:** Track an explicit pending action (`'backup' | 'restore' | 'export' | null`) or separate transitions/states so each card announces and disables only its own operation; keep destructive restore feedback isolated.

### UX-C5-04 — Category alias input is unlabeled

- **Severity:** Medium
- **Confidence:** High
- **Classification:** confirmed
- **Selector/surface:** category edit dialog alias field (`input[placeholder="Add new alias"]`).
- **Evidence:** The edit dialog’s alias section has a heading at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:282-284`, but the actual alias input at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:300-312` has only `placeholder={t('categories.aliasPlaceholder')}` and no `<label>`, `aria-label`, or `aria-labelledby`.
- **Failure scenario:** Screen-reader users tabbing through the category edit dialog land on an edit field whose purpose is only placeholder-derived/unclear, and placeholder text can disappear once typed.
- **Fix:** Add a real label or `aria-label={t('categories.aliasPlaceholder')}`; better, connect it with a visible label like “New alias” and include validation/help text for allowed alias formats.

### UX-C5-05 — Collapsed mobile info sheet can leave off-screen controls in tab order

- **Severity:** Medium
- **Confidence:** Medium-high
- **Classification:** likely
- **Selector/surface:** mobile photo info bottom sheet (`role="dialog"`, label `viewer.bottomSheet`).
- **Evidence:** The sheet has a `collapsed` transform of `calc(100% - 28px)` at `apps/web/src/components/info-bottom-sheet.tsx:45-50`. Focus trapping is active only when expanded at `apps/web/src/components/info-bottom-sheet.tsx:155`, but the close button is always rendered as a normal focusable button at `apps/web/src/components/info-bottom-sheet.tsx:199-207` even when the sheet is collapsed/peeked. The dialog itself remains mounted at `apps/web/src/components/info-bottom-sheet.tsx:156-172`.
- **Failure scenario:** After swiping the info sheet down to the collapsed 28px handle, a keyboard/switch user can tab into a close button/content that is visually off-screen or mostly hidden, creating a focus trap-like dead zone without the modal affordance.
- **Fix:** When `sheetState === 'collapsed'`, set non-handle controls to `tabIndex={-1}`/`aria-hidden`, or fully close the sheet. Keep only the visible drag handle focusable and expose state via `aria-expanded`/`aria-controls`.

### UX-C5-06 — Lightbox alt text falls back to raw filenames

- **Severity:** Medium
- **Confidence:** High
- **Classification:** confirmed
- **Selector/surface:** lightbox image (`dialog[aria-label="Photo lightbox"] img`).
- **Evidence:** `apps/web/src/components/lightbox.tsx:288-295` uses `alt={image.title ?? image.filename_jpeg ?? ''}`. The rest of the photo UI already avoids filename-like titles via `getConcisePhotoAltText` / `getPhotoDisplayTitle` (`apps/web/src/components/photo-viewer.tsx:184-196`, `apps/web/src/lib/photo-title.ts:67-72`).
- **Failure scenario:** Untitled uploads or camera filenames cause screen readers to hear UUID/technical filenames in fullscreen instead of the same concise title/tag fallback used by the page.
- **Fix:** Use the shared title/alt helpers in the lightbox as well, e.g. `getConcisePhotoAltText(image, t('common.photo'))`, with tag/title fallback parity across grid, detail, and lightbox.

### UX-C5-07 — Admin action columns have empty header text

- **Severity:** Low-medium
- **Confidence:** High
- **Classification:** confirmed
- **Selector/surface:** admin tables action columns.
- **Evidence:** Both locales define empty action labels: `apps/web/messages/en.json:54`, `apps/web/messages/en.json:165`, `apps/web/messages/ko.json:54`, and `apps/web/messages/ko.json:165`. These are rendered as table headers in user/image/tag/topic tables, e.g. `apps/web/src/components/admin-user-manager.tsx:127-130`, `apps/web/src/components/image-manager.tsx:352-359`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:98-101`, and `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:198-203`.
- **Failure scenario:** Screen-reader table navigation reaches edit/delete/share cells with a blank associated column header, reducing context even though individual buttons have labels.
- **Fix:** Provide localized visible or `sr-only` “Actions” text in the header. If visual minimalism is desired, keep the header visually hidden but programmatically present.

### UX-C5-08 — Public shortcut hint contradicts lightbox keyboard behavior

- **Severity:** Low-medium
- **Confidence:** High
- **Classification:** confirmed
- **Selector/surface:** photo page shortcut hint (`#photo-viewer-shortcuts`).
- **Evidence:** `apps/web/src/components/photo-viewer.tsx:243-245` displays `viewer.shortcutsHint`; English and Korean messages say F opens/closes the lightbox (`apps/web/messages/en.json:269`, `apps/web/messages/ko.json:269`). Outside the lightbox, F opens it (`apps/web/src/components/photo-viewer.tsx:174-176`), but inside the lightbox, F toggles browser fullscreen (`apps/web/src/components/lightbox.tsx:185-187`) and Escape closes (`apps/web/src/components/lightbox.tsx:192-195`).
- **Failure scenario:** A keyboard user opens the lightbox with F, follows the visible hint, presses F again expecting close, and is instead moved into fullscreen mode.
- **Fix:** Either change lightbox F behavior to close when already open, or update the hint to “F opens fullscreen view; inside fullscreen, F toggles browser fullscreen and Esc closes.” Also consider exposing `aria-keyshortcuts` on the visible hint/controls.

### UX-C5-09 — Admin navigation links are small text targets on touch screens

- **Severity:** Low-medium
- **Confidence:** Medium-high
- **Classification:** risk
- **Selector/surface:** admin header nav (`nav[aria-label="Admin navigation"] a`).
- **Evidence:** `apps/web/src/components/admin-nav.tsx:26-39` renders the links as bare text with `transition-colors` and no padding/min-height. The header wraps at small widths (`apps/web/src/components/admin-header.tsx:13-24`), but link hit areas remain the glyph box plus line height.
- **Failure scenario:** On mobile/tablet admin, route links like “DB 관리” or “SEO” can be hard to tap accurately, especially in a wrapped two-line header.
- **Fix:** Add touch target sizing (`inline-flex min-h-9/10 items-center rounded-md px-2`) and a focus-visible ring/background consistent with public nav pills.

### UX-C5-10 — Future RTL support is blocked by hard-coded `dir="ltr"`

- **Severity:** Low
- **Confidence:** High
- **Classification:** risk
- **Selector/surface:** root HTML element.
- **Evidence:** Supported locales are currently only English/Korean at `apps/web/src/lib/constants.ts:1-4`, but root layout hard-codes `dir="ltr"` at `apps/web/src/app/[locale]/layout.tsx:81-87` with a comment about future RTL locales.
- **Failure scenario:** If an RTL locale is added to `LOCALES`, the document direction remains LTR. Navigation order, text alignment defaults, sheets, and left/right navigation controls will be wrong until every component is revisited.
- **Fix:** Introduce a locale-direction map now (`{ en: 'ltr', ko: 'ltr' }`) and derive `<html dir={direction}>`; add an RTL smoke test before adding an RTL locale.

### UX-C5-11 — Photo swipe navigation is registered globally on `window`

- **Severity:** Medium
- **Confidence:** Medium
- **Classification:** likely
- **Selector/surface:** photo detail route touch gestures.
- **Evidence:** `apps/web/src/components/photo-navigation.tsx:130-132` attaches `touchstart`, `touchmove`, and `touchend` to `window`. The handler prevents default on horizontal movement at `apps/web/src/components/photo-navigation.tsx:53-59` and can navigate at `apps/web/src/components/photo-navigation.tsx:109-120`, regardless of whether the gesture started on the photo, toolbar, sheet, or another interactive region.
- **Failure scenario:** A mobile user horizontally swipes over non-photo content (e.g. bottom sheet, toolbar, or browser back-edge gesture area) and the app consumes the gesture or navigates photos unexpectedly.
- **Fix:** Scope touch listeners to the photo canvas/container via a ref, ignore events originating inside dialogs/sheets/controls, and use pointer events with `touch-action` to limit gesture capture to the intended surface.

## Strengths observed

- Public and admin skip links are present and localized: `apps/web/src/app/[locale]/(public)/layout.tsx:10-15`, `apps/web/src/app/[locale]/admin/layout.tsx:20-24`.
- Reduced-motion handling exists globally and in photo transitions: `apps/web/src/app/[locale]/globals.css:156-165`, `apps/web/src/components/photo-viewer.tsx:333-340`.
- Search dialog has focus trap/restore and live result status: `apps/web/src/components/search.tsx:166-179`, `apps/web/src/components/search.tsx:224-234`.
- Public nav has named navigation and mobile expand semantics: `apps/web/src/components/nav-client.tsx:70-92`.
- Public loading states use `role="status"` and localized labels: `apps/web/src/app/[locale]/loading.tsx:7-9`, `apps/web/src/app/[locale]/admin/(protected)/loading.tsx:7-9`.
- E2E coverage includes public navigation/search/lightbox/heading hierarchy and mobile nav visibility: `apps/web/e2e/public.spec.ts:5-119`, `apps/web/e2e/test-fixes.spec.ts:15-70`.

## Final sweep / files reviewed

Final sweep checked for accessibility, responsive behavior, interaction feedback, loading/error/empty states, i18n/RTL, keyboard/focus, motion, and perceived performance across:

- `apps/web/src/app/[locale]/(public)/**`
- `apps/web/src/app/[locale]/admin/**`
- `apps/web/src/app/[locale]/layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `globals.css`, `global-error.tsx`
- `apps/web/src/components/**` including all public/admin components and `components/ui/**`
- `apps/web/messages/en.json`, `apps/web/messages/ko.json`
- `apps/web/src/lib/constants.ts`, `locale-path.ts`, `photo-title.ts`, `image-types.ts`, `image-url.ts`, `clipboard.ts`, `error-shell.ts`, `gallery-config-shared.ts`
- `apps/web/e2e/*.ts`, with emphasis on `public.spec.ts`, `admin.spec.ts`, `nav-visual-check.spec.ts`, `test-fixes.spec.ts`, `helpers.ts`
- UI-adjacent unit tests under `apps/web/src/__tests__/` (`lightbox`, `upload-dropzone`, `tag-input`, `photo-title`, `shared-page-title`, `settings-image-sizes-lock`, `error-shell`, plus related action/route tests inventoried)
- `apps/web/tailwind.config.ts`, `apps/web/playwright.config.ts`, `apps/web/package.json`, `apps/web/README.md`

**Runtime limitation:** DB-backed UI could not be fully exercised with `agent-browser` because local MySQL credentials/database were absent; browser use confirmed the app error boundary and server-side DB failure path, while findings above are backed by source selectors/line references.
