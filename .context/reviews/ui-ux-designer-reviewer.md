# UI/UX Designer Review - Cycle 17

- Reviewer lane: `ui-ux-designer-reviewer`
- Repo: `/Users/hletrd/flash-shared/gallery`
- HEAD: `5e054f80`
- Date: 2026-06-30
- Scope: GalleryKit Next.js web photo gallery current HEAD.
- Write scope: review artifact only. No source code changes.
- Prompt note: read `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`; used only generally applicable senior UI/UX review principles and ignored Swift/BurstPick-specific requirements.

## Method

1. Read `AGENTS.md`, `CLAUDE.md`, the code-review skill, the Playwright skill, and the local custom reviewer prompt.
2. Inventoried public/admin routes, route states, shared components, `ui/` primitives, Tailwind/global CSS, `en`/`ko` messages, Radix/shadcn primitives, accessibility tests, and touch-target policy.
3. Source-reviewed public photo workflows: masonry browsing, photo viewer, swipe navigation, lightbox, bottom sheet, color/HDR disclosures, search, map, topics/tags/share/year/timeline, loading/empty/error states.
4. Source-reviewed admin workflows: login, dashboard upload, image manager, settings, SEO, categories, tags, users, tokens, DB, analytics.
5. Ran Playwright against local dev server on `127.0.0.1:3100`:
   - `/en` and `/en/map` returned the localized route error UI because MySQL on `127.0.0.1:3306` was unavailable.
   - `/en/admin` rendered the English admin login page; password and submit controls measured 44 px high.
   - `/ko/admin` rendered the Korean admin login page; password and submit controls measured 44 px high.
6. Ran targeted validation:
   - `npm test --workspace=apps/web -- touch-target-audit.test.ts focus-visible-rings-cycle20.test.ts info-bottom-sheet-ia.test.ts a11y-us-p15.test.ts`
   - Result: 4 files passed, 35 tests passed.
   - Message leaf count: `apps/web/messages/en.json` 810, `apps/web/messages/ko.json` 810.

## Inventory Summary

Public routes reviewed:
- `/`, `/p/[id]`, `/[topic]`, `/c/[slug]`, `/year/[year]`, `/timeline`, `/map`, `/privacy`, `/s/[key]`, `/g/[key]`, upload/resource/API-adjacent public surfaces under `apps/web/src/app/[locale]/(public)/**`.

Admin routes reviewed:
- `/admin`, `/admin/login`, `/admin/dashboard`, `/admin/settings`, `/admin/seo`, `/admin/categories`, `/admin/tags`, `/admin/users`, `/admin/tokens`, `/admin/db`, `/admin/analytics`, plus admin API/upload/database actions.

Design-system surfaces reviewed:
- Global tokens and motion/color policy: `apps/web/src/app/[locale]/globals.css`.
- shadcn/Radix primitives: `apps/web/src/components/ui/**`, including Button/Dialog/AlertDialog/Select/Switch/Dropdown/Tooltip.
- Public components: `home-client`, `photo-viewer`, `photo-navigation`, `lightbox`, `image-zoom`, `info-bottom-sheet`, `search`, `nav-client`, `tag-filter`, map components, color/HDR components.
- Admin components: `upload-dropzone`, `image-manager`, `tag-input`, `bulk-edit-dialog`, admin header/nav/settings/user/database components.

## Findings

### UIUX-C17-01 - Photo-page swipe navigation is attached to `window`, so mobile horizontal gestures outside the image can navigate photos

- Severity: Medium
- Confidence: High
- Route/selector: `/[locale]/p/[id]`, global `window` touch handlers in the mounted `PhotoNavigation`.
- Evidence:
  - `apps/web/src/components/photo-navigation.tsx:47-60` records every `window` touch start/move and calls `preventDefault()` once horizontal movement exceeds 10 px.
  - `apps/web/src/components/photo-navigation.tsx:96-133` completes navigation from the same global gesture and registers the listeners on `window`.
  - `apps/web/src/components/photo-viewer.tsx:687-694` visually mounts `PhotoNavigation` inside the media box, but the listeners are not scoped to that box.
- User impact: Mobile photo browsing can change photos from gestures that did not begin on the photo surface. That is especially disruptive when a viewer is trying to read metadata, use browser edge gestures, or interact with page chrome.
- Concrete failure scenario: A phone user opens a photo, starts a horizontal pan in a non-image area while repositioning the page, and the gallery moves to the next/previous photo. If the user was comparing color/HDR metadata or reading a caption, they lose context.
- Suggested fix: Attach swipe listeners to a media-container ref, or record the touch-start target and ignore gestures that begin outside the image/navigation surface, controls, scrollable metadata, and browser-edge zones. Add a mobile e2e/touch regression that swipes metadata and verifies no navigation.

### UIUX-C17-02 - The primary photo surface is exposed as a generic zoom button instead of preserving the photo's accessible name

- Severity: Medium
- Confidence: High
- Route/selector: `/[locale]/p/[id]`, `.photo-viewer-image` inside `ImageZoom`.
- Evidence:
  - `apps/web/src/components/image-zoom.tsx:343-362` wraps the image slot in a focusable `div role="button"` with `aria-label={Zoom in|Zoom out}`.
  - The underlying photo image has meaningful alt text at `apps/web/src/components/photo-viewer.tsx:467-483` and `apps/web/src/components/photo-viewer.tsx:508-531`, but the focused interactive wrapper is named only by the zoom action.
  - The wrapper is used around the main photo at `apps/web/src/components/photo-viewer.tsx:720-723`.
- User impact: Screen-reader and keyboard users can reach the central object of the page and hear only "Zoom in" or "Zoom out", not the image title/alt. That makes it harder to verify which photograph is open without detouring to the hidden heading or info panel.
- Concrete failure scenario: A client opens a shared photo link with a screen reader, tabs into the main photo, and hears "Zoom in button". They cannot confirm the subject/title from the primary surface before activating controls or searching surrounding metadata.
- Suggested fix: Keep the image semantic name discoverable. Options: make zoom a separate adjacent button; make the photo a `figure`/`img` with a separately labeled zoom control; or include the photo title/alt in the zoom control name and use `aria-describedby` for the shortcut/action details. Avoid a generic button role replacing the main photograph's accessible identity.

### UIUX-C17-03 - First-time desktop photo pages hide metadata, color/HDR explanation, similar photos, and download behind a non-default info panel

- Severity: Medium
- Confidence: Medium
- Route/selector: `/[locale]/p/[id]`, desktop info sidebar toggle.
- Evidence:
  - `apps/web/src/components/photo-viewer.tsx:103-108` initializes `isPinned` from `sessionStorage`, defaulting to `false`.
  - `apps/web/src/components/photo-viewer.tsx:174-175` derives `showInfo` directly from `isPinned`.
  - `apps/web/src/components/photo-viewer.tsx:736-747` hides the desktop sidebar unless `showInfo` is true.
  - The hidden-by-default sidebar contains color details, gamut hint, similar photos, EXIF, histogram, capture date, and download actions at `apps/web/src/components/photo-viewer.tsx:787-999`.
  - The desktop affordance is a toolbar toggle at `apps/web/src/components/photo-viewer.tsx:642-657`.
- User impact: The initial desktop experience is immersive, but professional gallery visitors often need confirmation details: title, caption, download, capture metadata, color-space disclosure, and related-image navigation. Those are all behind one "Info" action that first-time users may miss.
- Concrete failure scenario: A client receives a direct `/p/[id]` link, visually inspects the image, then leaves without seeing the download button or the Display P3/sRGB honesty note because the sidebar was collapsed and there was no persistent metadata/download summary.
- Suggested fix: Default the info sidebar open on desktop direct photo routes, or add a compact persistent metadata/download strip near the photo. If keeping the default closed, make the toolbar affordance more explicit for first-time visits and consider surfacing color/download status outside the panel.

### UIUX-C17-04 - Admin image management remains a wide table inside a scroll container, so mobile/event-day management is not first-class

- Severity: Medium
- Confidence: High
- Route/selector: `/[locale]/admin/dashboard`, recent uploads image manager.
- Evidence:
  - `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123-132` lays upload and recent uploads into a responsive grid and wraps `ImageManager` in `overflow-auto`.
  - `apps/web/src/components/image-manager.tsx:421-445` renders a 9-column table: select, preview, title, filename, topic, tags, gamut, date, actions.
  - `apps/web/src/components/image-manager.tsx:463-479` reserves a 128 px thumbnail column, and `apps/web/src/components/image-manager.tsx:491-524` adds a `min-w-[200px]` tag editor column.
  - Row actions are at the far right at `apps/web/src/components/image-manager.tsx:544-579`.
- User impact: Upload is touch-capable, but managing the just-uploaded photos on a phone or small tablet requires horizontal scrolling through a dense table. Selection state, preview, tags, and actions are spatially separated.
- Concrete failure scenario: A photographer uploads event images from a phone, then needs to fix a title/tag or create a share group. They must pan a wide table back and forth, increasing the chance of editing the wrong row or missing the action column.
- Suggested fix: Add a card/list layout below `lg`: thumbnail, title/filename, topic/gamut/date, tags, and edit/delete/share actions in one row stack. Keep the existing table for desktop. Move bulk actions into a sticky bottom bar on narrow screens so selected-row context stays visible.

### UIUX-C17-05 - Touch-target governance still depends on documented admin exemptions rather than eliminating compact-control patterns

- Severity: Low
- Confidence: High
- Route/selector: admin protected routes and `components/image-manager.tsx`.
- Evidence:
  - `apps/web/src/components/ui/button.tsx:23-30` currently floors all Button sizes to at least 44 px, so runtime Button hits are safe.
  - `apps/web/src/__tests__/touch-target-audit.test.ts:151-183` still documents an `image-manager` compact-pattern budget, including one remaining `size="sm"` button without an explicit height override.
  - `apps/web/src/__tests__/touch-target-audit.test.ts:213-238` keeps admin route-group budgets for compact patterns and states mobile admin is out of scope.
  - The current remaining example appears at `apps/web/src/components/image-manager.tsx:335-338` as a batch-add `Button variant="secondary" size="sm"` without explicit `h-11`, relying on the primitive floor.
- User impact: This is not a current measured sub-44 px failure. The risk is governance: future design-system changes can make admin controls regress while the source pattern still looks acceptable because historical budgets normalize compact usage.
- Concrete failure scenario: A future Button variant or custom admin control drops the implicit size floor. The page still has compact patterns scattered across admin surfaces, and reviewers must reason from exception counts rather than a simple "all interactive admin controls declare/measure 44 px" contract.
- Suggested fix: Retire admin compact-pattern budgets over time. Add explicit `h-11`/`min-h-11` to remaining `size="sm"` and icon usages or replace the audit with a layout-aware measured touch-target check. Keep admin desktop density, but make the mobile/touch contract unconditional.

### UIUX-C17-06 - Local browser validation of public gallery flows is blocked by an unavailable MySQL dependency

- Severity: Medium as review risk
- Confidence: High
- Route/selector: local `/en`, `/en/map`; public browsing/photo/search/map flows.
- Evidence:
  - Playwright on `http://127.0.0.1:3100/en` returned `Error | GalleryKit` with body text "Something went wrong loading this page. Try again Return to Gallery".
  - Dev server logs showed `ECONNREFUSED 127.0.0.1:3306` for topics/latest-image queries.
  - Playwright on `http://127.0.0.1:3100/en/map` hit the same route error boundary from `getMapImages`.
  - The route error UI itself is accessible and actionable: `apps/web/src/app/[locale]/error.tsx:22-53` renders a main landmark, visible heading, 44 px retry button, and return link.
- User impact: The review could validate admin login live and review public gallery code statically, but could not interact with real masonry browsing, photo viewer, search results, map markers, share pages, or public photo navigation in-browser. That leaves runtime-only layout/focus/perceived-performance risk.
- Concrete failure scenario: A UI regression that only appears with real image dimensions or hydrated public data would not be caught by this cycle's local browser pass because public pages fail before the gallery surface renders.
- Suggested fix: Maintain a small seeded local/e2e dataset aligned with current migrations, or provide a deterministic fixture mode for UI review. Keep the existing route error UI, but make the review/dev path able to render at least one public topic, one photo, one map marker, and one search result without production credentials.

## Positive Observations

- Map accessibility has improved since the prior artifact: `apps/web/src/app/[locale]/(public)/map/page.tsx:59-78` now includes a skip link, named map section, instructions, and a labeled photo list.
- Settings switch rows now use the safer responsive pattern: examples at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:407-456` and `647-676` stack copy/control on mobile and preserve `aria-describedby`.
- Touch targets are broadly disciplined. `apps/web/src/components/ui/button.tsx:23-30` enforces 44 px Button variants, nav controls meet 44 px at `apps/web/src/components/nav-client.tsx:91-178`, and the targeted audit passed 35 tests.
- Color/HDR honesty is a real strength. P3/HDR badge visibility is capability-gated in CSS at `apps/web/src/app/[locale]/globals.css:145-162`; wide-gamut explanatory copy is display-aware at `apps/web/src/components/wide-gamut-hint.tsx:150-205`; mobile photo metadata includes color details and histogram at `apps/web/src/components/info-bottom-sheet.tsx:311-330`.
- Photo rendering is tuned for photographer intent: full photo surfaces opt into high-quality downscaling at `apps/web/src/app/[locale]/globals.css:184-202`, and reduced-motion users are protected from hover scale at `apps/web/src/app/[locale]/globals.css:253-279`.
- Loading/error states are intentionally accessible: `apps/web/src/components/photo-viewer-loading.tsx:9-24` uses `role="status"`/`aria-live`, and the route error boundary provides clear recovery actions.
- Search has solid interaction semantics: dialog/combobox/listbox wiring, IME-safe keyboard handling, live status, and semantic-search honesty are visible in `apps/web/src/components/search.tsx:367-504`.
- Korean i18n parity is healthy in reviewed strings: EN/KO leaf counts match at 810, and Playwright confirmed localized `/ko/admin` login labels and buttons.

## Final Missed-UX Sweep

- Rechecked prior-cycle findings: map accessibility and settings mobile wrapping are fixed in current HEAD; they are not re-reported.
- Reviewed keyboard/focus hotspots: nav, search dialog, lightbox, info bottom sheet, tag input, admin login, image manager, and settings. No additional high-confidence focus trap or lost-focus defect found in source.
- Reviewed loading/empty/error states: global route loading, photo loading, home empty/filter empty, search empty/error, upload no-topic state, route error, and not-found patterns. No additional high-confidence issue beyond the local public-data validation blocker.
- Reviewed photo-specific quality: color/HDR disclosures, gamut badges, histogram placement, image alt/title derivation, blur placeholders, reduced motion, and responsive photo viewer. Findings above cover the remaining photo-gallery UX risks found in this pass.
- Reviewed hard-coded UI text and locale parity in the surfaces inspected. No new actionable English-only public/admin UI issue found beyond third-party attribution and technical values.

## Finding Count

6 findings:
- 4 medium user-facing/product or workflow issues
- 1 medium validation-risk issue
- 1 low governance issue
