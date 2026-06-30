# Cycle 21 UI/UX Designer Review - GalleryKit

Reviewer: `ui-ux-designer-reviewer`
Scope: GalleryKit Next.js public gallery/photo/search/map/share UI and admin UI
Repo state reviewed: `1ed96484`
Date: 2026-06-30

## Method

I read the workspace instructions in `AGENTS.md`, the GalleryKit knowledge base in `CLAUDE.md`, and the custom reviewer prompt at `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`. The prompt is written for BurstPick/SwiftUI, so I adapted its professional UI review principles to GalleryKit's web surfaces: photographer workflow fit, accessibility, responsive layout, keyboard/focus, state handling, i18n, visual hierarchy, design-system consistency, and the 44 px touch-target policy.

I inventoried the UI with `omx explore`, inspected the relevant source files directly, used `agent-browser` against the live public site where feasible, and ran targeted UI tests.

Validation evidence:

- `agent-browser` mobile viewport `390x844` on `https://gallery.atik.kr/en`: no horizontal overflow on the home page or photo page; visible buttons/links were 44 px or larger; screenshots saved at `/tmp/gallery-uiux-c21-home-mobile.png` and `/tmp/gallery-uiux-c21-photo-mobile.png`.
- `agent-browser` desktop viewport `1440x900` on `/en/p/348`: no horizontal overflow; screenshot saved at `/tmp/gallery-uiux-c21-photo-desktop.png`.
- Live photo page `/en/p/348` exposed a meaningful page heading, but the primary photo image alt was `Photo` and the zoom button accessible name was `Photo. Click to zoom in`.
- Targeted tests passed: `npm test --workspace=apps/web -- touch-target-audit.test.ts focus-visible-rings-cycle20.test.ts i18n-key-parity.test.ts` -> 3 files, 23 tests.

## UI Inventory

Public gallery and navigation:

- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/grid-picture.tsx`
- `apps/web/src/components/load-more.tsx`

Photo, search, map, and sharing:

- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/photo-viewer-loading.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/similar-photos.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/components/map/map-loader.tsx`
- `apps/web/src/components/map/map-client.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/sharing.ts`

Admin UI:

- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/*`
- `apps/web/src/app/[locale]/admin/(protected)/settings/*`
- `apps/web/src/app/[locale]/admin/(protected)/seo/*`
- `apps/web/src/app/[locale]/admin/(protected)/analytics/*`
- `apps/web/src/app/[locale]/admin/(protected)/password/*`
- `apps/web/src/app/[locale]/admin/(protected)/db/*`
- `apps/web/src/components/ui/*`

## Findings

### 1. Primary photo and lightbox alt labels collapse to generic "Photo" on tag-only images

Severity: High
Confidence: High

Evidence:

- `apps/web/src/components/photo-viewer.tsx:520-522` computes `primaryPhotoAccessibleName` with `getConcisePhotoAltText(image, t('common.photo'))`.
- `apps/web/src/components/photo-viewer.tsx:690-692` passes that name into `ImageZoom`.
- `apps/web/src/components/image-zoom.tsx:343-365` uses the accessible name to label the zoom button.
- `apps/web/src/components/photo-viewer.tsx:408-410` computes the related-photo image alt text with the same helper, and `apps/web/src/components/photo-viewer.tsx:435-495` applies that value to related image `alt` text.
- `apps/web/src/components/lightbox.tsx:496-499` also uses `getConcisePhotoAltText(image, t('common.photo'))` for lightbox image alt text.
- `apps/web/src/lib/photo-title.ts:85-121` lets `getConcisePhotoAltText` use `title`, `tag_names`, or `alt_text_suggested`, but it does not use the `tags` array shape returned for a single public photo.
- `apps/web/src/lib/data.ts:1024-1035` selects the public image fields for `getImage`, then `apps/web/src/lib/data.ts:1116-1169` fetches and returns `tags: imageTagsResult`; it does not add `tag_names` to the image object.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:158-163` proves the page can build a meaningful display title and keywords from `image.tags`.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:267-283` passes both `image` and `tags` into `PhotoViewer`, but the viewer's alt helper only sees `image`.
- Live browser check on `/en/p/348`: the visible page heading was `#JIHOON #DOHOON #Color in Music Festival`, while the main image alt was only `Photo` and the zoom control announced `Photo. Click to zoom in`.

Failure scenario:

A screen-reader or keyboard user opens a direct photo/share link and tabs to the primary media. The page visually identifies the photo through tags, but the interactive photo object is announced only as "Photo", so the user cannot tell which image they are about to zoom, share, or navigate from.

Suggested fix:

Unify the photo accessible-name source with the page-title source. Either extend `getConcisePhotoAltText` to accept `tags?: TagInfo[]`, or normalize `tag_names` onto the image object returned by `getImage` and shared-photo queries. Then pass the same computed name into `PhotoViewer`, `ImageZoom`, related-photo thumbnails, and `Lightbox`. Add a regression test for a tag-only photo page asserting the main image/zoom accessible name is not the generic `common.photo` fallback.

### 2. Similar-photo recommendations can expose repeated indistinguishable "Photo" links

Severity: Medium
Confidence: Medium-High

Evidence:

- `apps/web/src/components/similar-photos.tsx:136-141` documents that the fallback label is the localized `common.photo` value when title and description are absent.
- `apps/web/src/components/similar-photos.tsx:186-194` uses that label for both the link `aria-label` and image `alt`.
- `apps/web/src/components/search.tsx:100-105` shows a better nearby pattern: search result labels fall back to `Photo {id}` and include contextual metadata when available.

Failure scenario:

When semantic search returns several similar photos without title or description, assistive-technology users hear a list of repeated links all named "Photo". The recommendations become difficult to compare and the user has no stable way to choose one result over another.

Suggested fix:

Make fallback recommendation labels unique and contextual. At minimum use `Photo {imageId}`. Prefer adding topic label, year/date, camera/lens, or tags from the similar-photo API payload when available. Add a component test that renders multiple title-less similar photos and asserts link names are unique.

### 3. Admin image management remains a desktop table with horizontal panning on narrow screens

Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123-132` embeds `ImageManager` inside a constrained `max-h... overflow-auto` panel.
- `apps/web/src/components/image-manager.tsx:424-448` renders a single table for all viewport sizes with selection, preview, title, filename, topic, tags, gamut, date, and actions columns.
- `apps/web/src/components/image-manager.tsx:467-479` gives the preview cell a fixed 128 px thumbnail.
- `apps/web/src/components/image-manager.tsx:494-528` gives the tags cell a full inline `TagInput` with `min-w-[200px]`.
- `apps/web/src/components/image-manager.tsx:547-582` places the row actions at the far right of the table.
- `apps/web/src/components/image-manager.tsx:586-590` has an empty state, but not a mobile-optimized data layout.

Failure scenario:

An admin using a phone or small tablet after an upload must horizontally pan through a dense table to review filename, tags, topic, gamut, and actions. That slows the event-day workflow and increases the chance of editing or deleting the wrong row because the preview, metadata, and actions do not stay visually grouped.

Suggested fix:

Add a responsive admin media-list presentation below the desktop breakpoint. Keep the desktop table, but render mobile rows as cards or compact list items with thumbnail, title/file, topic/date/gamut, tags, and row actions in one vertical unit. Keep selected-count and bulk actions in a sticky toolbar so selection state stays visible while scrolling.

### 4. Admin data tables repeat horizontal-scroll patterns instead of sharing a responsive data-surface primitive

Severity: Low-Medium
Confidence: Medium

Evidence:

- `apps/web/src/components/image-manager.tsx:424-595` implements a bespoke image table.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:218-279` wraps a `min-w-[760px]` table in `overflow-x-auto`.
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:96-129` wraps a `min-w-[520px]` table in `overflow-x-auto`.
- `apps/web/src/components/admin-user-manager.tsx:137-177` wraps a `min-w-[520px]` table in `overflow-x-auto`.
- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:91-274` repeats multiple bordered horizontal-scroll table sections.

Failure scenario:

Each admin area solves data display separately, so fixes for focus order, mobile reading order, empty/error slots, and touch ergonomics must be rediscovered page by page. The current pattern works technically, but it encourages horizontal panning as the default answer for administrative workflows.

Suggested fix:

Introduce a shared responsive admin data-surface component or convention: desktop table, mobile definition-list/card rows, standard loading/empty/error slots, consistent row actions, and optional sticky bulk selection. Migrate `ImageManager` first because it has the highest workflow pressure, then reuse the same contract for topics, tags, users, and analytics tables.

### 5. Admin Users nests one card inside another and duplicates hierarchy chrome

Severity: Low
Confidence: High

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx:16-24` renders an outer `Card` with its own `CardHeader`, title, and description, then renders `AdminUserManager`.
- `apps/web/src/components/admin-user-manager.tsx:88-136` returns another `Card` with a second `CardHeader`, title, description, and create-user form.

Failure scenario:

The Users page has duplicated card borders, duplicated header hierarchy, and extra padding before the actual table. It reads as less deliberate than the rest of the admin UI and costs vertical space in a workflow where admins need to scan user status and actions quickly.

Suggested fix:

Choose one owner for the card chrome. Either remove the outer card in `users/page.tsx`, or let `AdminUserManager` render a plain section/div when embedded. Keep one page title, one description, and one bordered data surface.

## Positive Observations

- Public layout includes a skip link and main target: `apps/web/src/app/[locale]/(public)/layout.tsx:7-16`, with the skip-link styling in `apps/web/src/app/globals.css:103-118`.
- The design token system covers light, dark, OLED, reduced-motion, and forced-colors cases in `apps/web/src/app/globals.css:13-101`, `apps/web/src/app/globals.css:164-182`, and `apps/web/src/app/globals.css:253-279`.
- The component library encodes the 44 px touch-target policy in core controls such as `apps/web/src/components/ui/button.tsx:23-30` and `apps/web/src/components/ui/switch.tsx:24-54`.
- Search has strong keyboard handling: `apps/web/src/components/search.tsx:294-311` handles Cmd/Ctrl+K, Escape, and IME composition; `apps/web/src/components/search.tsx:391-421` provides a combobox pattern; `apps/web/src/components/search.tsx:436-446` announces status.
- Map fallback/accessibility is better than a map-only experience: `apps/web/src/app/[locale]/(public)/map/page.tsx:55-89` includes an empty state, skip-map affordance, and accessible list links.
- Shared routes handle missing/invalid states rather than presenting blank pages: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:84-102` and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:233-237`.

## Missed-Issues Sweep

I rechecked the prior high-risk areas from the earlier review before closing this pass:

- The desktop photo-info default is no longer an unconditional hidden panel. `apps/web/src/components/photo-viewer.tsx:104-110` now opens on desktop when there is no stored session override.
- Photo swipe listeners are no longer global window listeners. `apps/web/src/components/photo-navigation.tsx:44-49` scopes swipe start to the provided target, `apps/web/src/components/photo-navigation.tsx:134-142` cleans that target up, and `apps/web/src/components/photo-viewer.tsx:656-664` passes the media container ref.
- Public browser smoke checks did not show horizontal overflow on the mobile home or photo page.
- The targeted touch-target, focus-ring, and i18n parity tests passed.

Final count: 5 findings.
