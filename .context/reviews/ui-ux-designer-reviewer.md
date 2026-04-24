# UI/UX Designer Reviewer — PROMPT 1 Cycle 4/100

**Repo:** `/Users/hletrd/flash-shared/gallery`  
**App reviewed:** GalleryKit Next.js web app (`apps/web`)  
**Lane:** custom `ui-ux-designer-reviewer`, adapted to public/admin photo-gallery UX  
**Review date:** 2026-04-25 KST  
**Status:** REVIEW_COMPLETE (source-led; live public pages DB-blocked)

## Inventory first

Reviewed these UI surfaces before making findings:

- **Public routes/layouts:** `apps/web/src/app/[locale]/(public)/layout.tsx`, `page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`
- **Global app states:** `apps/web/src/app/[locale]/layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `globals.css`
- **Public components:** `nav.tsx`, `nav-client.tsx`, `footer.tsx`, `home-client.tsx`, `search.tsx`, `tag-filter.tsx`, `load-more.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `image-zoom.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `histogram.tsx`, `optimistic-image.tsx`
- **Admin routes/components:** `admin/layout.tsx`, `admin/page.tsx`, `admin/login-form.tsx`, protected dashboard/categories/tags/users/password/settings/seo/db pages, `admin-header.tsx`, `admin-nav.tsx`, `image-manager.tsx`, `upload-dropzone.tsx`, `tag-input.tsx`, `admin-user-manager.tsx`
- **Design primitives:** `components/ui/button.tsx`, `input.tsx`, `table.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `switch.tsx`, `sonner.tsx`, `skeleton.tsx`
- **i18n:** `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `i18n/request.ts`, `lib/constants.ts`, `lib/locale-path.ts`
- **UX tests/artifacts:** `apps/web/e2e/public.spec.ts`, `admin.spec.ts`, `nav-visual-check.spec.ts`, `apps/web/test-results/nav-*.png`, existing `.context` screenshots.

## Browser evidence / blockers

Used `agent-browser` against `npm run dev --workspace=apps/web`.

- `http://localhost:3000/en` rendered the localized app error boundary instead of the gallery because local MySQL was unavailable: server logs showed `ECONNREFUSED` and the DOM snapshot exposed `heading "Error"`, `button "Try again"`, and `link "Return to Gallery"`. Screenshot: `/tmp/gallerykit-en-db-blocked.png`.
- `http://localhost:3000/en/admin` rendered the admin login screen successfully, with skip link, username/password fields, and sign-in button. Screenshot: `/tmp/gallerykit-admin-db-blocked.png`.
- Protected admin pages and public gallery interactions were therefore reviewed by source inspection plus existing Playwright screenshots/tests.

## Findings

### UX-C4-01 — Public data outages fall through to a generic page error

- **Severity:** Medium
- **Confidence:** High
- **Status:** Open
- **Evidence:** `apps/web/src/components/nav.tsx:7` awaits `getTopicsCached()`, `getSeoSettings()`, and `getGalleryConfig()` in one `Promise.all`; `apps/web/src/app/[locale]/(public)/page.tsx:115-129` similarly couples tags/topics/images before rendering `HomeClient`; the route error shell is generic at `apps/web/src/app/[locale]/error.tsx:16-33`. Live browser hit this path when MySQL returned `ECONNREFUSED`.
- **Failure scenario:** A visitor arrives during a database restart or cold-start. Instead of a branded gallery unavailable/maintenance state that preserves context, the public experience becomes a generic “Something went wrong” page.
- **Fix:** Add a public `GalleryUnavailable`/maintenance state that catches optional nav/topic/image query failures separately. Keep the site brand, retry action, and localized explanation visible; let nav render with an empty topic list when topic fetch fails.

### UX-C4-02 — Mobile info sheet opens visually without moving focus or announcing the new dialog

- **Severity:** Medium
- **Confidence:** High
- **Status:** Open
- **Evidence:** The mobile info button only calls `setShowBottomSheet(true)` at `apps/web/src/components/photo-viewer.tsx:261-268`. `InfoBottomSheet` opens in `peek` state, but focus is only moved when `sheetState === 'expanded'` at `apps/web/src/components/info-bottom-sheet.tsx:120-124`, and the focus trap is also active only when expanded at `apps/web/src/components/info-bottom-sheet.tsx:148-153`.
- **Failure scenario:** A keyboard or screen-reader user activates “Info” on mobile. The sheet appears visually, but focus remains behind the sheet and the newly exposed title/EXIF content is not announced.
- **Fix:** On open, focus the drag handle/title or close button even in peek state, connect the trigger with `aria-controls`, and announce the state change. Alternatively open fully for keyboard/SR activation and reserve peek-only behavior for touch drag.

### UX-C4-03 — Shared dialog primitives hardcode English close text

- **Severity:** Low
- **Confidence:** High
- **Status:** Open
- **Evidence:** `apps/web/src/components/ui/dialog.tsx:69-76` renders `<span className="sr-only">Close</span>`; `apps/web/src/components/ui/sheet.tsx:75-78` does the same. The app already has localized `aria.close` messages.
- **Failure scenario:** Korean users navigating admin dialogs hear an English “Close” control inside otherwise localized UI.
- **Fix:** Add `closeLabel` props to `DialogContent`/`SheetContent`, or wrap these primitives with localized app-level components that pass `t('aria.close')`.

### UX-C4-04 — Photo detail loading fallback is not localized

- **Severity:** Low
- **Confidence:** High
- **Status:** Open
- **Evidence:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:16-18` uses a dynamic import loading fallback with `aria-label="Loading photo"` hardcoded in English.
- **Failure scenario:** On a slow connection in `/ko/p/:id`, assistive tech announces English loading text during the photo viewer chunk load.
- **Fix:** Move the loading fallback to a small localized client component, or pass a translated label from the server page using `getTranslations('common')`/`getTranslations('photo')`.

### UX-C4-05 — Footer leaves user-facing labels untranslated

- **Severity:** Low
- **Confidence:** High
- **Status:** Open
- **Evidence:** `apps/web/src/components/footer.tsx:43-48` renders visible `GitHub` and `Admin` literals. `nav.admin` is already translated in `apps/web/messages/*.json`.
- **Failure scenario:** Korean public pages still show “Admin” in English in the footer, producing a mixed-language navigation surface.
- **Fix:** Load footer translations with `getTranslations`, reuse `t('nav.admin')`, and add an `opens in new tab` localized hint for the external GitHub link if desired.

### UX-C4-06 — Dialog content has no mobile max-height/scroll guard

- **Severity:** Medium
- **Confidence:** High
- **Status:** Open
- **Evidence:** `apps/web/src/components/ui/dialog.tsx:60-64` centers content with no `max-h` or `overflow-y-auto`; `apps/web/src/components/ui/alert-dialog.tsx:54-58` has the same pattern. Long admin dialogs exist, e.g. category edit form plus alias manager at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:252-318`.
- **Failure scenario:** On a short mobile viewport or with the virtual keyboard open, lower dialog controls can be pushed off-screen and become hard to reach.
- **Fix:** Add `max-h-[calc(100dvh-2rem)] overflow-y-auto` to dialog/alert-dialog content, preserve footer visibility, and regression-test category edit on 320×568 and 390×844 viewports.

### UX-C4-07 — Switch primitive is below comfortable/mobile target size

- **Severity:** Medium
- **Confidence:** Medium-high
- **Status:** Open
- **Evidence:** `apps/web/src/components/ui/switch.tsx:13-24` renders the switch root as `h-[1.15rem] w-8`; the GPS privacy switch uses it at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:170-175`.
- **Failure scenario:** On touch devices, the privacy toggle’s actual control is roughly 18px high, making it easy to miss and below the 24px WCAG 2.2 target-size baseline unless the associated label activation is relied on.
- **Fix:** Make the switch root at least `min-h-6 min-w-10`, preferably a 44px touch target via padding or wrapper, and keep the visible thumb proportions unchanged.

### UX-C4-08 — Admin tag comboboxes lack contextual accessible names

- **Severity:** Medium
- **Confidence:** High
- **Status:** Open
- **Evidence:** `apps/web/src/components/tag-input.tsx:168-185` renders the combobox input without `aria-label`, `aria-labelledby`, or an ID accepted from callers. Dense admin uses include per-image tag editors at `apps/web/src/components/image-manager.tsx:399-429` and per-upload file tag editors at `apps/web/src/components/upload-dropzone.tsx:368-380`.
- **Failure scenario:** A screen-reader user tabs through a table of image rows and hears repeated generic tag inputs with weak/no row context, making it unclear which photo will be edited.
- **Fix:** Add `ariaLabel`/`ariaLabelledBy` props to `TagInput`; pass labels such as “Tags for {filename/title}” in `ImageManager` and “Additional tags for {file.name}” in `UploadDropzone`.

### UX-C4-09 — Batch upload failures are only toast-level and lose per-file diagnosis

- **Severity:** Medium
- **Confidence:** High
- **Status:** Open
- **Evidence:** Failed uploads are accumulated in `failedFiles` at `apps/web/src/components/upload-dropzone.tsx:133-169`; partial success only shows a toast and keeps failed file cards at `apps/web/src/components/upload-dropzone.tsx:209-216`. The card UI at `apps/web/src/components/upload-dropzone.tsx:319-384` has no per-file status/error slot.
- **Failure scenario:** An admin uploads 50 mixed RAW/HEIC/JPEG files, several fail due size/type/processing issues, and the remaining cards show no reason or retry guidance after the toast disappears.
- **Fix:** Track upload status per pending item (`queued/uploading/succeeded/failed`) with an error message. Render inline failure badges, retry/remove actions, and keep a persistent summary region with `role="status"`/`aria-live`.

### UX-C4-10 — Batch action toolbar scrolls away inside the admin image manager

- **Severity:** Medium
- **Confidence:** Medium-high
- **Status:** Open
- **Evidence:** The selected-items toolbar is rendered above the table at `apps/web/src/components/image-manager.tsx:255-332`. On the dashboard, the whole manager is inside a constrained scroll container at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:35-39`.
- **Failure scenario:** An admin selects rows after scrolling through recent uploads; the batch share/tag/delete controls are above the scroll position and must be hunted down before acting.
- **Fix:** Make the selected toolbar sticky within the image-manager scroll container (`sticky top-0 z-...`) or move batch actions to a fixed bottom action bar on narrow screens.

### UX-C4-11 — Admin table checkboxes are visually tiny touch targets

- **Severity:** Low-medium
- **Confidence:** High
- **Status:** Open
- **Evidence:** Select-all and row checkboxes in `apps/web/src/components/image-manager.tsx:339-347` and `apps/web/src/components/image-manager.tsx:361-368` use `h-4 w-4` controls with no larger label/wrapper target.
- **Failure scenario:** Touch or motor-impaired users trying to select multiple photos in admin hit adjacent table content or miss the 16px checkbox.
- **Fix:** Wrap checkboxes in a 32–44px inline-flex label/button target, or support row-click selection with clear focus/selected states while preserving checkbox semantics.

### UX-C4-12 — Thumbnail alt text can become verbose captions or low-value tag lists

- **Severity:** Low
- **Confidence:** Medium-high
- **Status:** Open
- **Evidence:** Public grid alt text is derived from `description`, then `title`, then comma-joined tags at `apps/web/src/components/home-client.tsx:150-156`; photo viewer uses a similar fallback at `apps/web/src/components/photo-viewer.tsx:184-189`.
- **Failure scenario:** A caption-like description or long tag list is read for every thumbnail in a masonry grid, slowing screen-reader browsing and failing to provide concise visual identification.
- **Fix:** Add a distinct `alt_text`/accessibility description field or generate concise alt from title/topic/camera context. Keep longer captions in visible/details text, not `alt`.


### UX-C4-13 — Locale-prefixed icon requests can hit the public topic route

- **Severity:** Low-medium
- **Confidence:** Medium
- **Status:** Open
- **Evidence:** Live dev logs from `agent-browser` showed `/en/apple-icon` and `/en/icon?...` invoking the topic lookup path. Root icon routes exist at `apps/web/src/app/icon.tsx:12-45` and `apps/web/src/app/apple-icon.tsx:10-40`, while arbitrary locale children are resolved as topics by `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:100-107`.
- **Failure scenario:** Browser favicon/PWA requests under a locale prefix produce unnecessary topic DB lookups and, when DB is unavailable, visible server errors instead of lightweight static icon responses.
- **Fix:** Verify production icon link generation and either add localized icon route aliases or exclude `/icon`, `/apple-icon`, and favicon/PWA metadata requests from the localized topic route/middleware.

## Strengths observed

- Public and admin layouts include localized skip links: `apps/web/src/app/[locale]/(public)/layout.tsx:10-15`, `apps/web/src/app/[locale]/admin/layout.tsx:20-24`.
- Main navigation is named and responsive: `apps/web/src/components/nav-client.tsx:70-162`; existing `nav-visual-check.spec.ts` covers collapsed/expanded/desktop states.
- Public masonry breakpoints are coherent (`columns-1 sm:columns-2 md:columns-3 xl:columns-4`) at `apps/web/src/components/home-client.tsx:148`.
- Route loading states are accessible status indicators: `apps/web/src/app/[locale]/loading.tsx:7-9`, `apps/web/src/app/[locale]/admin/(protected)/loading.tsx:7-9`.
- Photo viewer has keyboard navigation and reduced-motion handling: `apps/web/src/components/photo-viewer.tsx:165-180`, `apps/web/src/app/[locale]/globals.css:156-165`.
- Search dialog now includes combobox/listbox semantics and focus restore: `apps/web/src/components/search.tsx:161-271`.
- Translation bundles are structurally complete: `en.json` and `ko.json` have matching flattened keys.

## Verification notes

- Ran source inventory via `omx explore` and direct file inspection with line numbers.
- Started local Next dev server successfully; public gallery was blocked by unavailable MySQL, admin login page rendered.
- Used `agent-browser` snapshots/screenshots for `/en` and `/en/admin`.
- No production DB-backed public/admin protected journey was verified in this lane because local DB was not reachable.
