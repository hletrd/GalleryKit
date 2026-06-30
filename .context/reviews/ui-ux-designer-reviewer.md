# Cycle 22 UI/UX Designer Reviewer - GalleryKit

Reviewer: `ui-ux-designer-reviewer-style`
Scope: GalleryKit public gallery/photo/search/map/share surfaces plus admin information architecture and operational UI
Repo state reviewed: `85b0291f`
Date: 2026-06-30
Constraint: review artifact only; no source-code edits, no commit, no push.

## Inventory

Reviewed context and standing constraints:

- `AGENTS.md` from the user prompt: autonomous execution, no source edits for this lane, GalleryKit-specific workflow rules, no commit/push for this task.
- `CLAUDE.md:267-270`: product boundary is presentation/delivery of edited photographer intent; no culling/scoring/editing features.
- `CLAUDE.md:308-314`: current photographer-facing color audit surfaces.
- `CLAUDE.md:555-563`: prior photographer review history.
- `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`: adapted only the general professional UI/UX review lens; ignored BurstPick-specific SwiftUI paths.

Reviewed public surfaces:

- `apps/web/src/components/nav-client.tsx:83-181` - public navigation, mobile expansion, search/theme/locale controls.
- `apps/web/src/components/home-client.tsx:255-460` - public masonry information hierarchy, badges, loading/empty affordances, back-to-top.
- `apps/web/src/components/search.tsx:290-524` - search dialog, keyboard/focus behavior, semantic-search toggle.
- `apps/web/src/app/[locale]/error.tsx:22-53` and `apps/web/src/app/[locale]/not-found.tsx:7-49` - localized failure/dead-end IA.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:158-283` - photo detail metadata/JSON-LD handoff into the viewer.
- `apps/web/src/components/photo-viewer.tsx:355-704` - photo keyboard shortcuts, media stage, sidebar/bottom-sheet handoff.
- `apps/web/src/components/lightbox.tsx:81-687` - full-screen viewer, slideshow, controls auto-hide, keyboard handling.
- `apps/web/src/components/lightbox-color-pip.tsx:161-280` and `apps/web/src/components/info-bottom-sheet.tsx:237-539` - compact/mobile color and metadata surfaces.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:52-91` and `apps/web/src/components/map/map-client.tsx:97-141` - map/list accessibility fallback.

Reviewed admin surfaces:

- `apps/web/src/app/[locale]/admin/login-form.tsx` - login interaction evidence via existing browser artifact.
- `apps/web/src/components/admin-nav.tsx:15-49` - protected admin navigation IA.
- `apps/web/src/components/upload-dropzone.tsx:352-557` - upload staging, per-file tags, progress and first-run category affordance.
- `apps/web/src/components/image-manager.tsx:424-595` - image management table, selection, tags, gamut/HDR badges, row actions.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:172-328` - settings save/backfill action model.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:187-237` and `apps/web/src/components/ui/dialog.tsx:50-89` - token plaintext modal behavior.

Browser/artifact evidence used:

- Main designer lane artifact `.context/reviews/designer.md` reports agent-browser checks on `/en/privacy`, `/en/admin`, mobile nav at `390x844`, search focus/escape restore, and local DB-backed home failure.
- Existing screenshot `.context/browser-home-mobile-expanded.png`: mobile home at 390 px shows compact public IA and no obvious horizontal overflow.
- Existing screenshot `.context/admin-login.png`: admin login shows visible focus treatment and compact centered form.

## Findings

### 1. Route error state drops the public shell and can loop users back into the same failure

Severity: Medium
Confidence: High
Status: Open
Area: information architecture, error-state design, keyboard recovery

Evidence:

- `apps/web/src/app/[locale]/error.tsx:22-53` renders only a standalone `main` with an error card, `Try again`, and a localized home link.
- `apps/web/src/app/[locale]/not-found.tsx:7-11` explicitly notes that a stripped dead-end page was a prior wayfinding failure, and `apps/web/src/app/[locale]/not-found.tsx:20-47` now includes `Nav`, `main`, and `Footer`.
- Browser evidence from `.context/reviews/designer.md`: local `/en` with DB unavailable exposed only skip link, `main`, error region, `Try again`, and `Return to Gallery`; the console showed a failed `topics` query.

Failure scenario:

A visitor lands on the home page during a transient DB outage. The visible recovery link points to the same gallery entry route that just failed, while search, topics, locale switch, theme, footer links, and admin/privacy routes disappear. Keyboard users can activate two controls, but neither gives broader wayfinding.

Suggested fix:

Make the localized route error boundary use the same public shell pattern as `not-found`: render `Nav`, keep `main#main-content`, and render `Footer`. On the localized home route, de-emphasize or hide a "back to gallery" link that resolves to the current failed route; prefer `Try again` plus stable fallback links.

### 2. Site-wide re-encode is exposed as a one-click settings action

Severity: High
Confidence: High
Status: Open
Area: interaction safety, operational UX, photographer delivery trust

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:172-211` calls `triggerBackfill()` directly from `handleBackfill`.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:297-305` documents that the action is visible whenever the gallery has photos, including manual pipeline-version backfills.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:315-328` wires the visible CTA straight to `onClick={handleBackfill}` with no confirmation step.
- `CLAUDE.md:331-341` describes this as a real in-app color-pipeline backfill that re-encodes existing photos under shared DB/CPU constraints.

Failure scenario:

An admin reviewing settings after an event taps the re-encode CTA unintentionally. The UI can queue a broad background rewrite of existing photo derivatives, affect cache state, and consume constrained host resources before the admin has confirmed scope, count, or timing.

Suggested fix:

Insert a confirmation dialog before `triggerBackfill()`. Show affected-photo count, which derivative settings will be applied, that originals are untouched, expected resource impact, and whether cancellation is available. For large galleries, require a typed confirmation phrase and keep the action visually distinct from ordinary "save settings".

### 3. Token plaintext modal advertises dismiss controls that are intentionally blocked

Severity: Medium
Confidence: High
Status: Open
Area: modal affordance, focus trap behavior, screen-reader feedback

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:188-195` refuses to close the plaintext token dialog unless `plaintextAcknowledged` is true.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:197-237` renders the dialog content, acknowledgement checkbox, and disabled Done button, but does not suppress the default close button.
- `apps/web/src/components/ui/dialog.tsx:50-89` defaults `showCloseButton = true` and renders a top-right `DialogPrimitive.Close` button.

Failure scenario:

After creating a Lightroom token, an admin presses Escape or activates the visible X before checking the acknowledgement box. Nothing closes, but the UI does not explain why. The result is a modal that looks dismissible and behaves non-dismissibly, which is especially poor inside a focus trap.

Suggested fix:

While acknowledgement is false, render `DialogContent showCloseButton={false}` and block outside/Escape dismiss with explicit helper text. Alternatively, allow close attempts to move focus to the checkbox and announce a short inline message: "Acknowledge that the token was saved before closing."

### 4. Public masonry P3 badge is visually present but hidden from assistive tech

Severity: Medium
Confidence: High
Status: Open
Area: accessibility, color independence, photographer metadata visibility

Evidence:

- `apps/web/src/components/home-client.tsx:383-391` renders a visible `P3` badge for wide-gamut images.
- `apps/web/src/components/home-client.tsx:386-389` sets that badge to `aria-hidden="true"`.
- `CLAUDE.md:308-314` identifies color/HDR chips as a real photographer-facing audit surface, not decoration.

Failure scenario:

A screen-reader user scanning the gallery grid hears the photo link/title but does not get the same wide-gamut signal that sighted users see. For a gallery whose core promise is accurate color delivery, hiding the P3 cue makes the public grid less truthful for non-visual users.

Suggested fix:

Keep the visual badge but expose a concise accessible label, for example `role="img" aria-label="Display P3"` or a visually hidden sibling inside the photo link. If the badge remains display-gated by device capability, ensure the accessible cue appears under the same condition so screen-reader output matches visible state.

### 5. Admin image management still uses a desktop table as the only layout

Severity: Medium
Confidence: High
Status: Open
Area: responsive behavior, admin workflow, interaction density

Evidence:

- `apps/web/src/components/image-manager.tsx:424-448` renders a full table with selection, preview, title, filename, topic, tags, gamut, date, and actions columns.
- `apps/web/src/components/image-manager.tsx:467-475` reserves a fixed `h-32 w-32` preview in each row.
- `apps/web/src/components/image-manager.tsx:494-528` puts a `min-w-[200px]` tag editor inside a table cell.
- `apps/web/src/components/image-manager.tsx:547-582` places edit/delete actions at the far right of the row.

Failure scenario:

On a phone or narrow tablet, an admin checking uploads has to pan horizontally between the thumbnail, filename, tags, color status, and actions. That breaks the visual grouping between media and controls and raises the chance of editing or deleting the wrong image during a post-shoot upload pass.

Suggested fix:

Keep the table for desktop, but add a compact mobile media-list below the table breakpoint: thumbnail, title/file, topic/date, P3/HDR, tags, and actions in one vertical row/card. Keep bulk selection in a sticky toolbar so selected count and destructive actions stay visible while scrolling.

### 6. Upload staging becomes cramped on phones before the actual upload starts

Severity: Low-Medium
Confidence: Medium
Status: Open
Area: responsive behavior, batch-upload workflow

Evidence:

- `apps/web/src/components/upload-dropzone.tsx:459-466` renders selected files in `grid grid-cols-2 md:grid-cols-3`.
- `apps/web/src/components/upload-dropzone.tsx:501-531` puts filename, size, inherited tags, and a per-file `TagInput` into each preview card.
- Existing screenshot `.context/browser-home-mobile-expanded.png` confirms the 390 px review viewport used for mobile checks; two upload cards at that width would leave roughly half-width columns for tag editing and long camera filenames.

Failure scenario:

An admin uploads several photos from a phone and needs to add or verify per-file tags. Two columns leave little room for filenames and the tag combobox, increasing truncation and making per-file corrections feel fussy before the upload has even started.

Suggested fix:

Use one selected-file column below `sm`, then two columns at `sm` and three at `md`. Keep the thumbnail compact but give filename and per-file tags full row width. For larger batches, consider a sticky upload footer with file count and the primary upload button.

### 7. Admin navigation is a flat ten-link wrap with no task grouping

Severity: Low-Medium
Confidence: Medium
Status: Open
Area: information architecture, professional workflow fit

Evidence:

- `apps/web/src/components/admin-nav.tsx:15-26` defines ten peer links: Dashboard, Categories, Tags, SEO, Settings, Tokens, Password, Users, DB, Analytics.
- `apps/web/src/components/admin-nav.tsx:28-49` renders them as one wrapping horizontal nav group.

Failure scenario:

As GalleryKit grows, operationally different tasks sit at the same IA level: publishing/upload work, content taxonomy, site settings, account/token security, database maintenance, and analytics. On narrow screens this becomes a wrapped link cloud rather than a task model, so admins have to remember labels instead of navigating by workflow.

Suggested fix:

Group admin IA into stable clusters such as Content, Publishing, Site, Security, Operations, and Insights. On desktop this can remain a compact nav with separators or sections; on mobile it should become a menu or grouped list rather than an unstructured wrap.

## Positive Evidence

- Public search has solid focus management: `apps/web/src/components/search.tsx:313-324` restores trigger focus, `:370-383` creates a modal dialog, and `:391-421` implements combobox keyboard state with IME guards.
- The mobile public nav has explicit 44 px controls: `apps/web/src/components/nav-client.tsx:99-107` for expansion and `:160-178` for search/theme/locale controls.
- Photo viewer and lightbox shortcuts are discoverable through `aria-keyshortcuts`/titles on core controls: `apps/web/src/components/photo-viewer.tsx:559-626` and `apps/web/src/components/lightbox.tsx:551-657`.
- Map has a non-map fallback list and skip affordance: `apps/web/src/app/[locale]/(public)/map/page.tsx:59-89`.
- The lightbox color pip no longer has the older accessible-name gap: `apps/web/src/components/lightbox-color-pip.tsx:169-176` includes primaries/transfer/HDR in the button label.
- Similar-photo fallback labels are now unique: `apps/web/src/components/similar-photos.tsx:136-144` falls back to `Photo {imageId}`.
- The shared `getConcisePhotoAltText` now accepts both `tag_names` and `tags`: `apps/web/src/lib/photo-title.ts:85-125`.

## Final Sweep

I did not edit source code, run destructive commands, commit, or push. I checked the existing main designer review and did not copy its wording; overlapping issues are re-stated only where this lane independently confirmed the source evidence.

Previously open or likely issues that I am not re-raising:

- Generic tag-only photo alt text appears fixed by `apps/web/src/lib/photo-title.ts:85-125`.
- Repeated "Photo" similar-result links appear fixed by `apps/web/src/components/similar-photos.tsx:136-144`.
- Lightbox color pip screen-reader color metadata appears fixed by `apps/web/src/components/lightbox-color-pip.tsx:169-176`.
- Admin gamut/HDR visibility appears improved by `apps/web/src/components/image-manager.tsx:530-540`.
- Mobile public nav and admin login touch/focus behavior had browser evidence in `.context/reviews/designer.md` and `.context/admin-login.png`; I did not find a new blocker there.

Remaining validation gap: I did not run a fresh local browser session because DB-backed routes were already known unavailable in the main designer lane. Findings above are grounded in source references and existing browser artifacts.

---

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
