# Designer Review - Cycle 11

Role: Cycle 11 designer / UI-UX reviewer. Scope: Next.js public and admin UI, information architecture, responsive behavior, accessibility, keyboard/focus behavior, i18n, dark/light/OLED theming, loading/empty/error states, and perceived performance. No production code was edited.

## Executive Summary

GalleryKit's public gallery has a mature visual system and much of the prior accessibility/touch-target work is holding, but the primary photo viewer still has two trust-breaking interaction defects: assistive technology receives generic "Photo" labels for specific photos, and the visible shortcut guide advertises a Space slideshow command on a page where Space only scrolls. Design quality score: 7/10 for the public surface, with the biggest gap in accessibility/shortcut contract accuracy rather than visual polish.

## Inventory

UI/UX inventory built before judging findings:

- Public routes: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]`, `c/[slug]`, `g/[key]`, `s/[key]`, `p/[id]`, `map`, `timeline`, `year`, `privacy`, public layout, global loading/error/not-found shells.
- Admin routes: login, protected dashboard/upload manager, categories, tags, SEO, settings, password, users, DB, tokens, analytics, admin layout/loading/error.
- Shared UI: nav/search/footer, masonry home, tag filter/input, load more, photo viewer, photo navigation, image zoom, lightbox, info bottom sheet, color details, lightbox color pip, histogram, map client, upload dropzone, image manager, admin nav/header, and shadcn/Radix primitives.
- Styling/i18n/docs/tests: `apps/web/src/app/[locale]/globals.css`, `apps/web/tailwind.config.ts`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `CLAUDE.md`, touch-target/focus/i18n/lightbox/info-sheet/error-shell tests.

Runtime inspection:

- Local dev server started on `http://localhost:3011`; `/en` returned 200 but the page fell into the app error shell because the local DB query for `topics` failed. I used local only as evidence that the error path is reachable.
- Production DOM/browser checks used `https://gallery.atik.kr/en/p/348` and mobile/desktop Chromium via Playwright. Findings below rely on DOM states, roles, labels, dimensions, URLs, and text extraction rather than screenshots.

Resolved since Cycle 10:

- The previous lightbox initial-focus defect appears fixed. Source now passes `initialFocus`/`fallbackFocus` to `FocusTrap` in `apps/web/src/components/lightbox.tsx:449-450`, and runtime focus moved to the 44x44 Close button after opening the lightbox.

## Findings

### DES-C11-01 - Primary photo surfaces expose generic alt text instead of the photo identity

Severity: High  
Confidence: High  
Classification: confirmed

Source evidence:

- `getConcisePhotoAltText()` only reads `title`, `tag_names`, and `alt_text_suggested` at `apps/web/src/lib/photo-title.ts:85-121`.
- `PhotoViewer` passes the full `ImageDetail` object into that helper at `apps/web/src/components/photo-viewer.tsx:443` and applies the result to the primary image at `apps/web/src/components/photo-viewer.tsx:521-528`.
- The same helper is used for the lightbox image at `apps/web/src/components/lightbox.tsx:496-505`.
- `PhotoViewer` separately computes a specific visible/document title from `image.tags` at `apps/web/src/components/photo-viewer.tsx:136-143`, proving the specific title data exists in the viewer but does not reach the image alt path.
- `ImageZoom` wraps the primary viewer image in a focusable `role="button"` with `aria-label={isZoomed ? t('aria.zoomOut') : t('aria.zoomIn')}` at `apps/web/src/components/image-zoom.tsx:343-362`, making the generic zoom control name the dominant keyboard affordance around the image.

Browser evidence:

- On `https://gallery.atik.kr/en/p/348`, `document.title` was `#JIHOON #DOHOON #Color in Music Festival — ATIK.KR Gallery`, but the primary image DOM had `alt="Photo"`.
- The same primary image had `ancestorButton: true` because it sits inside the zoom wrapper, whose DOM was `DIV role="button" aria-label="Click to zoom in"` with a 340x638 px rectangle.
- Opening the lightbox moved focus correctly to Close, but the lightbox image still had `alt="Photo"`.

Failure scenario:

A screen-reader user lands on a specific photo page or opens the lightbox. The page title and visual heading identify the work, but the actual image is announced as a generic photo, or the focused wrapper is announced as "Click to zoom in." In a gallery where many photos share the same topic, this prevents non-visual users from distinguishing the current image from the next one.

Suggested fix:

Make the alt-text helper accept the same `tags` shape that `getPhotoDisplayTitle()` already supports, or pass `normalizedDisplayTitle` into the image alt path when admin-authored alt text is absent. For the zoom wrapper, avoid masking the child image semantics: either make the zoom control name include the current photo identity, or separate the focusable zoom control from the semantic image so the `img` alt remains discoverable. Add a regression test that renders an `ImageDetail` with tags but no title/tag_names and asserts the viewer and lightbox image alt text includes the tag-derived title.

### DES-C11-02 - The photo page advertises Space for slideshow, but Space scrolls the page there

Severity: Medium  
Confidence: High  
Classification: confirmed

Source evidence:

- The visible shortcut hint says `Space to toggle slideshow` in English at `apps/web/messages/en.json:344` and Korean at `apps/web/messages/ko.json:344`.
- `PhotoViewer` renders that hint on the non-lightbox photo page at `apps/web/src/components/photo-viewer.tsx:575-576`.
- The non-lightbox `PhotoViewer` keyboard handler implements ArrowLeft, ArrowRight, F, I, C, and H, but not Space, at `apps/web/src/components/photo-viewer.tsx:388-419`.
- Space toggles slideshow only inside `Lightbox` at `apps/web/src/components/lightbox.tsx:307-319`, and the lightbox play/pause button advertises `aria-keyshortcuts="Space"` at `apps/web/src/components/lightbox.tsx:595-607`.

Browser evidence:

- On `https://gallery.atik.kr/en/p/348`, the extracted page text included `Shortcuts: ←/→ to navigate, F to toggle lightbox, I to toggle info, C color details, H histogram, Space to toggle slideshow.`
- Pressing Space on the photo page changed `scrollY` from `0` to `137`; no lightbox dialog opened and the only live/status text remained `Photo navigation available`.

Failure scenario:

A keyboard user follows the visible shortcut guide and presses Space expecting slideshow playback. The viewport scrolls instead, moving the photo and toolbar out of position. The user now has to recover scroll position and infer that slideshow only works after opening the lightbox, even though the page did not say that.

Suggested fix:

Either implement Space in `PhotoViewer` by opening/toggling the lightbox slideshow, or change the page hint to scope Space explicitly to lightbox mode, such as `Open fullscreen, then Space toggles slideshow`. Keep `aria-keyshortcuts="Space"` only on controls/modes where the key actually works. Add a Playwright regression that presses Space on the photo page and asserts the chosen contract: either no scroll plus slideshow behavior, or no visible page-level Space claim.

### DES-C11-03 - Window-level swipe navigation fires while the mobile info sheet is open

Severity: Medium  
Confidence: High  
Classification: confirmed

Source evidence:

- `PhotoNavigation` attaches `touchstart`, `touchmove`, and `touchend` listeners to `window` at `apps/web/src/components/photo-navigation.tsx:43-140`.
- The swipe handler navigates when horizontal movement crosses `SWIPE_THRESHOLD` at `apps/web/src/components/photo-navigation.tsx:96-128`.
- `PhotoViewer` disables `PhotoNavigation` only when `showLightbox` is true at `apps/web/src/components/photo-viewer.tsx:688-695`; it does not disable it when `showBottomSheet` is true.
- The mobile info sheet is rendered independently at `apps/web/src/components/photo-viewer.tsx:1029-1039`, and its default open state is a `role="dialog"` sheet at `apps/web/src/components/info-bottom-sheet.tsx:184-210`.

Browser evidence:

- On mobile Chromium at `https://gallery.atik.kr/en/p/348`, opening the Info sheet produced `role="dialog"` with `aria-label="Photo Info"`.
- A horizontal touch gesture inside the open sheet changed the URL from `/en/p/348` to `/en/p/347` and closed the sheet.

Failure scenario:

A mobile user opens photo info to inspect metadata, then performs a horizontal finger movement inside the sheet while reading or trying to interact with content. The page navigates to a different photo and dismisses the sheet, losing the user's current context. This is especially costly in shared galleries where recipients are comparing adjacent images and metadata.

Suggested fix:

Scope swipe listeners to the photo canvas element rather than `window`, or disable `PhotoNavigation` whenever `showBottomSheet` is true. As a defensive guard, ignore swipes whose event target is inside `[role="dialog"]`, buttons, links, form controls, or other overlay roots. Add a mobile Playwright test that opens the info sheet, dispatches a horizontal swipe inside it, and asserts the URL/current photo id does not change.

## Category Notes

- Information architecture: public navigation, topic filters, photo pages, and admin nav are coherent. The photo viewer is the main IA weak spot because its mode-specific shortcut contract is not explicit enough.
- Visual design: tokenized HSL/OKLCH themes, OLED mode, forced-colors handling, 44 px touch targets, and dark photo-viewing surfaces are generally strong. No new contrast failure was confirmed in this pass.
- Interaction design: lightbox focus is now correct, search has an explicit focus trap/combobox structure, and info sheet initial focus is deliberate. The remaining friction is mode leakage: Space belongs to lightbox but is advertised on the page, and swipe navigation belongs to the photo canvas but listens globally.
- Accessibility: skip link, landmarks, live regions, focus rings, and touch target work are visible in source/runtime. The alt-text regression is significant because it affects the primary object of the page.
- Responsive states: sampled mobile photo page had no horizontal overflow. The confirmed mobile sheet swipe bug is interaction-scoping, not layout overflow.
- Loading/empty/error states: local DB failure reached the app error shell; source includes home empty states, search no-result/loading states, admin upload progress, and table empty rows.
- i18n: English/Korean strings are present for the reviewed surfaces. The shortcut mismatch exists in both locales.
- Perceived performance: masonry uses responsive derivatives and content visibility; viewer/lightbox preloading and reduced-motion branches are present. No new performance defect was confirmed.

## Verification

- Source inventory completed with `find`/`rg` over `apps/web/src/app`, `apps/web/src/components`, `apps/web/messages`, `apps/web/src/lib`, and UI-related tests.
- Runtime evidence collected with Playwright against production photo page and lightbox; local dev server verified shell/error behavior but local gallery data was unavailable due DB query failure.
- No production code changed. Review artifact only.

Not run: full lint/typecheck/build/test suite, because this pass modified only `.context/reviews/designer.md`.
