# UI/UX Designer Review - Cycle 19

- Reviewer lane: `ui-ux-designer-reviewer`
- Repo: `/Users/hletrd/flash-shared/gallery`
- HEAD: `d4aea50f`
- Date: 2026-06-30
- Scope: GalleryKit Next.js web UI/UX/design-system surface at current HEAD.
- Write scope: review artifact only. No source code changes, no commit, no push.
- Prompt note: read `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`; applied its senior UI/UX review method to this web gallery/admin product and ignored Swift/BurstPick-specific file requirements that do not exist here.

## Executive Summary

GalleryKit is visually coherent and materially better than a default shadcn/Tailwind gallery, but its biggest remaining interaction failure is that the primary photo object is still not a trustworthy accessible object: on the live photo page the focused photo surface is named "Click to zoom in" while the image alt is only "Photo", despite the page title containing meaningful tag-derived context. Design quality score: 7/10. The public gallery is strong on touch target sizing, dark/OLED support, loading/error states, and photographer-oriented color/HDR honesty; the weaker areas are primary-photo semantics, global mobile swipe scoping, hidden metadata/download affordances, and admin management ergonomics on narrow screens.

## Method And Evidence

1. Read repo guidance: AGENTS instructions supplied in prompt, `CLAUDE.md`, local custom reviewer prompt, and Playwright skill instructions.
2. Required `.context/project/*.md` files listed by the custom prompt were not present, so `CLAUDE.md` and source were treated as project authority.
3. Source-reviewed 100 TSX/CSS UI files under `apps/web/src/components` and `apps/web/src/app/[locale]`, focusing on public navigation, masonry, photo viewer, lightbox, search, map, admin shell, admin upload, image manager, analytics, forms, and primitives.
4. Ran live browser/DOM audit against `https://gallery.atik.kr/en` because local port `127.0.0.1:3100` was not running. Captured:
   - `/tmp/uiux-home-desktop.png`
   - `/tmp/uiux-home-mobile.png`
   - `/tmp/uiux-photo-desktop.png`
   - `/tmp/uiux-photo-mobile.png`
   - `/tmp/uiux-admin-login-mobile.png`
5. Live DOM measurements:
   - Home desktop 1440x900: no horizontal overflow, 30 images, nav 64 px high, visible buttons >= 44 px.
   - Home mobile 390x844: no horizontal overflow, visible buttons >= 44 px, one-column masonry cards 358 px wide.
   - Photo desktop `/en/p/348`: `.photo-viewer-image` measured 1230x772, image alt `"Photo"`, closest focused zoom surface `role="button"` with aria-label `"Click to zoom in"`.
   - Photo mobile `/en/p/348`: `.photo-viewer-image` measured 340x638, same generic alt/zoom label.
   - Admin login mobile: password reveal and submit controls measured 44 px high.
6. Ran targeted validation:
   - `npm test --workspace=apps/web -- touch-target-audit.test.ts focus-visible-rings-cycle20.test.ts info-bottom-sheet-ia.test.ts a11y-us-p15.test.ts`
   - Result: 4 files passed, 35 tests passed.
7. i18n parity check: `apps/web/messages/en.json` and `apps/web/messages/ko.json` both contain 816 leaf strings.

## Information Architecture Assessment

The public information architecture is sound for a self-hosted portfolio/gallery: sticky global nav, topic links, tag filters, masonry browsing, photo pages, map/timeline/year routes, public shares, and admin-only operational routes. The public layout also has a real skip link and focused `<main>` target in `apps/web/src/app/[locale]/layout.tsx:119-128` and `apps/web/src/app/[locale]/(public)/layout.tsx:7-16`.

State visibility is mixed. Filter state is visible in the H1 and active tag chips in `apps/web/src/components/home-client.tsx:257-273`; photo position is visible and live-announced in `apps/web/src/components/photo-viewer.tsx:727-732`; route errors and not-found states are recoverable in `apps/web/src/app/[locale]/error.tsx:22-53` and `apps/web/src/app/[locale]/not-found.tsx:18-48`. However, desktop photo metadata, download, histogram, similar photos, and color details remain behind an info toggle by default in `apps/web/src/components/photo-viewer.tsx:103-108`, `174-175`, and `736-999`.

The admin IA is complete but not yet optimized for frequent on-location workflows. The nav exposes every admin section in one horizontal wrapping cluster in `apps/web/src/components/admin-nav.tsx:15-49`, which is discoverable, but the image management task is still a desktop table rather than a responsive photo-management surface.

## Visual Design Audit

The design system has concrete tokens and enforcement. Theme variables for light, dark, and OLED are defined in `apps/web/src/app/[locale]/globals.css:13-101`; reduced motion is respected globally in `apps/web/src/app/[locale]/globals.css:253-279`; high-contrast forced-colors rules exist for photo overlays and color chips in `apps/web/src/app/[locale]/globals.css:164-182` and `281-300`. The Button primitive enforces 44 px minimum controls across default, small, and icon variants in `apps/web/src/components/ui/button.tsx:23-30`.

Public visual hierarchy is generally good: photo content dominates, nav is restrained, masonry cards preserve aspect ratios and avoid horizontal overflow in live desktop/mobile checks. Color/HDR visual language is functional rather than decorative, with P3/HDR chip gating in `apps/web/src/app/[locale]/globals.css:145-162`, photo card P3 badges in `apps/web/src/components/home-client.tsx:382-391`, and detailed color disclosure in `apps/web/src/components/color-details-section.tsx:299-520`.

The main visual weakness is hidden density rather than chaotic styling. On photo pages the default desktop composition is immersive, but important client-facing tasks are behind the info panel. On admin pages, table density is efficient on desktop but breaks the visual/task hierarchy on small screens because preview, tags, date, gamut, and actions are spatially separated across columns.

## Interaction Design Critique

Keyboard support is better than average for a web gallery. Photo pages support ArrowLeft/ArrowRight, F, I, C, and H in `apps/web/src/components/photo-viewer.tsx:387-418`; lightbox supports Escape, arrows, F, C, H, and Space in `apps/web/src/components/lightbox.tsx:306-357`; search supports Cmd/Ctrl+K, Escape, combobox arrows, and IME-aware Enter handling in `apps/web/src/components/search.tsx:294-311` and `391-421`.

Touch support is also deliberate: nav, tag chips, photo controls, bottom sheet, upload controls, and admin buttons mostly meet the 44 px floor. The targeted touch/focus tests passed. The remaining interaction concerns are scoped but important: the photo swipe recognizer listens on `window`, the main photo semantic role is generic zoom, and admin management still forces horizontal table cognition on narrow screens.

Feedback latency appears acceptable. Photo blur placeholders and transitions are implemented in `apps/web/src/components/photo-viewer.tsx:123-132` and `696-725`, with reduced-motion handling. Masonry cards use `content-visibility: auto` in `apps/web/src/app/[locale]/globals.css:231-235`, eager loading for above-fold cards in `apps/web/src/components/home-client.tsx:296-360`, and live demo first render reached network idle in about 1.1 to 1.2 seconds for tested public pages.

## Workflow Design Evaluation

For public gallery consumers, the workflow is clear: browse topic/tag masonry, open photo, navigate adjacent photos, enter lightbox, inspect info, download, and share where authorized. The map and analytics surfaces also include explicit empty/approximate states.

For the photographer/admin workflow, upload is comparatively strong: dropzone disabling is honest, upload progress is announced, per-file previews exist, and topic/tag assignment is integrated in `apps/web/src/components/upload-dropzone.tsx:344-520`. Post-upload management is the bottleneck. `ImageManager` gives powerful batch edit/share/delete/tag actions, but the only layout is a 9-column table in `apps/web/src/components/image-manager.tsx:421-591`, which is not a first-class phone/tablet workflow.

This is not Lightroom or Photo Mechanic, and it should not pretend to be a 10,000-image culling instrument. As a portfolio and delivery gallery it is close; as an event-day management surface it still needs a responsive card/list mode and stronger primary-photo semantics.

## Accessibility Report

Positive:

- Skip-to-content is implemented with a programmatically focusable target: `apps/web/src/app/[locale]/layout.tsx:119-128` and `apps/web/src/app/[locale]/(public)/layout.tsx:7-16`.
- Touch target and focus tests passed: 35 targeted tests.
- Buttons and controls generally include focus-visible rings and 44 px sizing.
- Search dialog uses dialog/combobox/listbox roles and live status in `apps/web/src/components/search.tsx:378-449`.
- Error, not-found, and loading states have landmarks/status semantics in `apps/web/src/app/[locale]/error.tsx:22-53`, `not-found.tsx:18-48`, and `loading.tsx:6-12`.
- Locale message parity is intact at 816 EN and 816 KO leaves.

Failures and risks:

- The primary photo surface has a generic interactive name. Live DOM: `.photo-viewer-image` alt was `"Photo"` and the focused wrapper was `[role="button"][aria-label="Click to zoom in"]`. Source: `apps/web/src/components/image-zoom.tsx:343-362` wraps the image slot with the zoom role/name, and `apps/web/src/components/photo-viewer.tsx:467-483` / `508-548` provide the image alt from `getConcisePhotoAltText`.
- Swipe navigation is global to `window`, which can hijack horizontal gestures that begin outside the image surface. Source: `apps/web/src/components/photo-navigation.tsx:47-60` and `131-133`.
- Color badges use color plus text, which is acceptable. P3/HDR are not color-only.
- RTL is structurally future-proofed via `dir={getLocaleDirection(locale)}` in `apps/web/src/app/[locale]/layout.tsx:94-100`, but only EN/KO are shipped, so RTL behavior was not validated.

## Platform Fidelity Check

Web platform conventions are mostly respected. Links remain links, buttons are buttons, dialogs trap focus, Escape closes overlays, and responsive breakpoints avoid page-level horizontal overflow in live checks. The theme system supports system/light/dark/OLED via `apps/web/src/app/[locale]/layout.tsx:130-137`. The mobile bottom sheet uses dynamic viewport/safe-area handling in `apps/web/src/components/info-bottom-sheet.tsx:194-210` and `282-287`.

The main platform mismatch is gesture scope. Mobile browsers already reserve horizontal gestures for browser navigation, carousel-like content, and nested panning. A `window`-level touch recognizer for photo navigation is too broad for a page that also contains nav, toolbar, metadata, and footer.

## Competitive UX Comparison

| Feature | Lightroom Classic | Capture One | Photo Mechanic | DaVinci Resolve | GalleryKit Verdict |
| --- | --- | --- | --- | --- | --- |
| Primary asset semantics | Photo identity is always visible in filmstrip/metadata | Strong metadata panels | Filename/IPTC always central | Clip identity visible in media bins | Worse for assistive tech: focused photo says zoom, not identity |
| Keyboard next/prev | Single-key/arrows | Strong | Very strong | Strong | Same for basic next/prev |
| Rapid culling/rating | First-class flags/ratings/color labels | First-class | Best-in-class speed | Not photo-culling focused | Missing by product scope |
| Compare/survey | First-class | Strong | Contact sheet/preview workflow | Multi-view layouts | Missing by product scope |
| Metadata visibility | Panels are persistent and configurable | Persistent panels | Dense always-visible data | Inspector panels | Partially hidden by default on photo pages |
| Mobile delivery viewing | Not primary | Not primary | Not primary | Not primary | Better: responsive public gallery/lightbox |
| Admin/event-day mobile management | Not primary | Desktop tool | Desktop tool | Desktop tool | Needs mobile card/list mode |
| Color/HDR disclosure | Strong in develop context | Strong | Limited | Strong | Strong for web gallery, with honest P3/HDR notes |

## Design System Assessment

The design system is real, not just incidental Tailwind classes. It has:

- Central theme tokens: `apps/web/src/app/[locale]/globals.css:13-101`.
- Button size and focus policy: `apps/web/src/components/ui/button.tsx:7-30`.
- shadcn/Radix primitives under `apps/web/src/components/ui/**`.
- Cross-cutting motion, contrast, photo-rendering, and forced-colors rules in `globals.css`.
- Tests for touch targets and focus-visible rings.

Remaining system gap: responsive data-management patterns are not yet encoded. Tables recur in admin and analytics surfaces, but there is no shared "dense table on desktop, card/list on mobile" primitive. That leaves every admin surface to solve narrow screens ad hoc.

## Findings

### UIUX-C19-01 - Primary photo accessibility collapses to "Click to zoom in" and generic "Photo"

- Severity: High
- Confidence: High
- Surface/selector: `/[locale]/p/[id]`, `.photo-viewer-image` inside `ImageZoom`, closest `[role="button"]`.
- Evidence:
  - Live demo `/en/p/348` at 1440x900: `.photo-viewer-image` alt was `"Photo"` while the page title/H1 was `#JIHOON #DOHOON #Color in Music Festival`.
  - Live demo same page: closest focusable photo wrapper was `role="button"` with `aria-label="Click to zoom in"`, size 1230x772.
  - `apps/web/src/components/image-zoom.tsx:343-362` wraps the photo slot in a focusable `div role="button"` and names it only by zoom state.
  - `apps/web/src/components/photo-viewer.tsx:467-483` and `508-548` render the image alt via `getConcisePhotoAltText(...)`.
  - `apps/web/src/lib/photo-title.ts:85-122` can produce meaningful title/tag-derived alt text, but current live data path still fell back to the generic string.
- Failure scenario: A screen-reader or keyboard user opens a direct client delivery link, tabs to the main object, and hears only "Click to zoom in button" or "Photo". They cannot confirm which image is open from the primary surface, despite visible users seeing the meaningful document title and tags.
- Fix: Preserve the photo identity as the accessible object. Prefer a semantic `figure`/`img` with descriptive alt and a separate zoom button, or pass a composed label such as `"Photo: {displayTitle}. Click to zoom in"` plus `aria-describedby` for shortcut details. Add a regression using real tag-only rows so `/p/[id]` cannot fall back to generic `"Photo"` when tags/title exist.

### UIUX-C19-02 - Mobile photo swipe navigation is registered on `window`, not the photo surface

- Severity: Medium
- Confidence: High
- Surface/selector: `/[locale]/p/[id]`, `PhotoNavigation` touch handlers.
- Evidence:
  - `apps/web/src/components/photo-navigation.tsx:47-60` records every `window` touch start/move and calls `preventDefault()` when horizontal movement exceeds 10 px.
  - `apps/web/src/components/photo-navigation.tsx:96-133` completes navigation from the same global gesture and registers `touchstart`, `touchmove`, and `touchend` on `window`.
  - `apps/web/src/components/photo-viewer.tsx:687-694` visually places `PhotoNavigation` inside the media box, but the event listeners are not scoped to that media box.
- Failure scenario: A mobile user begins a horizontal gesture over page chrome, footer, or metadata while trying to scroll/reposition. The gallery can treat that gesture as next/previous photo navigation, causing unexpected context loss.
- Fix: Scope swipe listeners to a media-container ref, or store the touch-start target and ignore gestures that begin outside the photo/navigation region. Add an e2e touch regression that swipes over toolbar/metadata/footer and verifies the photo id does not change.

### UIUX-C19-03 - Desktop photo pages hide download, metadata, color details, histogram, and similar photos by default

- Severity: Medium
- Confidence: High
- Surface/selector: `/[locale]/p/[id]`, desktop info sidebar.
- Evidence:
  - `apps/web/src/components/photo-viewer.tsx:103-108` initializes `isPinned` from `sessionStorage`, defaulting to `false`.
  - `apps/web/src/components/photo-viewer.tsx:174-175` derives `showInfo` directly from `isPinned`.
  - `apps/web/src/components/photo-viewer.tsx:736-747` hides the desktop sidebar unless `showInfo` is true.
  - The hidden panel contains color details, wide-gamut hint, similar photos, EXIF, histogram, capture date, and download controls at `apps/web/src/components/photo-viewer.tsx:787-999`.
  - Live desktop `/en/p/348` text sample exposed "Back to TWS", fullscreen, and "Info", but no download/color/metadata content until the info control is used.
- Failure scenario: A client or photographer opens a direct photo link, reviews the image, and misses the download button or P3/sRGB delivery disclosure because the panel is collapsed and the only persistent affordance is an "Info" button.
- Fix: Default the info sidebar open on desktop direct photo pages, or add a compact always-visible metadata/download strip below the photo. If keeping the immersive default, make the first-run affordance explicit and persistent enough that download/color disclosure is not hidden behind a generic toggle.

### UIUX-C19-04 - Admin image management is still a 9-column desktop table on narrow screens

- Severity: Medium
- Confidence: High
- Surface/selector: `/[locale]/admin/dashboard`, `ImageManager`.
- Evidence:
  - `apps/web/src/components/image-manager.tsx:421-591` renders one table for every viewport.
  - The table has nine columns: select, preview, title, filename, topic, tags, gamut, date, actions at `apps/web/src/components/image-manager.tsx:421-445`.
  - The preview column reserves a 128 px square at `apps/web/src/components/image-manager.tsx:463-479`.
  - The tags column reserves `min-w-[200px]` at `apps/web/src/components/image-manager.tsx:491-524`.
  - Row actions live at the far right in `apps/web/src/components/image-manager.tsx:544-579`.
- Failure scenario: A photographer uploads images from a phone or small tablet, then needs to tag, edit, share, or delete recent images. They must horizontally pan a dense table where selection, preview, tags, gamut, date, and actions are separated, increasing wrong-row edits and slowing event-day work.
- Fix: Keep the table for desktop, but add a below-`lg` card/list layout with thumbnail, title/filename, topic/date/gamut, tags, and edit/share/delete actions in one vertical unit. Move bulk actions into a sticky bottom bar on narrow screens so selected count and actions stay spatially connected.

### UIUX-C19-05 - The admin design system lacks a reusable responsive data-surface primitive

- Severity: Low
- Confidence: Medium
- Surface/selector: admin tables and analytics tables.
- Evidence:
  - `ImageManager` hand-builds the complex table in `apps/web/src/components/image-manager.tsx:421-591`.
  - Analytics independently hand-builds multiple horizontally scrollable tables in `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:91-275`.
  - Admin nav and buttons have consistent target/focus rules, but there is no shared table-to-card/list contract comparable to the Button primitive's size contract in `apps/web/src/components/ui/button.tsx:23-30`.
- Failure scenario: Future admin pages continue to add `overflow-x-auto` tables with inconsistent mobile behavior, and reviewers must rediscover touch/focus/layout issues per page rather than relying on a system primitive.
- Fix: Add a shared `ResponsiveDataSurface` pattern or documented component contract: table on desktop, cards or definition-list rows below `lg`, sticky bulk-action region when selectable, and standard empty/loading/error slots. Then migrate ImageManager first because it has the highest task frequency.

## Positive Observations

- Touch target governance is effective. Button variants floor to 44 px in `apps/web/src/components/ui/button.tsx:23-30`, and targeted tests passed 35 checks.
- Live public pages had no horizontal overflow at 390 px or 1440 px.
- The public masonry uses aspect-ratio reservations, column-count syncing, above-fold priority, and `content-visibility`, visible in `apps/web/src/components/home-client.tsx:195-237`, `296-360`, and `apps/web/src/app/[locale]/globals.css:231-235`.
- Search is one of the strongest interaction surfaces: Cmd/Ctrl+K, IME safety, live status, combobox/listbox semantics, and focus restoration in `apps/web/src/components/search.tsx:294-324` and `378-524`.
- Lightbox controls are appropriately large, keyboard-accessible, and reduced-motion aware in `apps/web/src/components/lightbox.tsx:420-685`.
- Mobile info bottom sheet handles drag, focus trap, dynamic viewport height, safe area, and expanded/peek states in `apps/web/src/components/info-bottom-sheet.tsx:42-210`.
- Color/HDR honesty is a differentiator: display-gated P3/HDR chips, wide-gamut hints, delivered bit-depth disclosures, and copyable color metadata are implemented in `globals.css`, `color-details-section.tsx`, and `wide-gamut-hint.tsx`.
- Error and not-found states are intentionally navigable and accessible rather than blank failures.
- EN/KO message parity is currently healthy.

## Prioritized Design Recommendations

### Tier 0 - Blocking

No Tier 0 blocker found for the public gallery's basic browse/open/view workflow. The product is usable today for public gallery delivery.

### Tier 1 - High Impact

1. Fix primary photo semantics so the focused photo surface exposes the actual photo identity, not only the zoom action.
2. Scope mobile swipe navigation to the photo surface.
3. Make desktop photo metadata/download/color disclosure visible by default or persistently discoverable.
4. Add mobile card/list management for admin image rows.

### Tier 2 - Polish

1. Create a reusable responsive data-surface pattern for admin tables.
2. Audit live data rows where image alt falls back to `"Photo"` despite tags/title being available.
3. Consider a richer first-run cue for the Info panel on direct photo links.
4. Keep reducing ad hoc table markup in analytics/admin pages.

### Tier 3 - Refinement

1. Validate RTL behavior before adding an RTL locale. The `dir` hook exists, but layouts have not been tested.
2. Add browser-level accessibility snapshots for photo pages with tag-only images.
3. Add gesture tests for photo pages on mobile viewports.
4. Add visual regression coverage for dark, OLED, and forced-colors critical surfaces.

## Final Verdict

GalleryKit's UI helps public visitors browse and inspect photos, and it is unusually strong for a self-hosted gallery on color/HDR transparency, touch sizing, reduced motion, and localized recovery states. It still gets in the way for assistive-tech users on the most important object in the app - the photo itself - and for admins trying to manage recent uploads on narrow screens.

Design-readiness: good for public portfolio/gallery use, acceptable for desktop admin use, not yet strong for mobile admin/event-day management. Before calling the UI "well-designed" for professional photo delivery, fix the primary photo accessible name, scope gestures, and make metadata/download affordances visible enough that clients do not have to discover them by chance.
