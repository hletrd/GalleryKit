# GalleryKit UI/UX Designer Reviewer — Cycle 8

Date: 2026-07-07
Scope: GalleryKit Next.js web app in `/Users/hletrd/flash-shared/gallery`.
Role: UI/UX designer reviewer lane. I used `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md` as professional-review methodology only and adapted it from the stale BurstPick wording to GalleryKit's public gallery, photo viewer, sharing surfaces, and protected admin workflows.
Constraints honored: no source fixes, no commit, no push, no deploy, no local dev server requirement, no credentials, and no mutation of the temporary MySQL container `gallerykit-e2e-mysql-cycle7-47691` on `127.0.0.1:33307`.

## Executive Summary

GalleryKit is much stronger than a typical self-hosted gallery on baseline accessibility: the public site has landmarks, skip-link targets, 44 px touch-target discipline, focus-restore tests, localized messages, and photo-viewing shortcuts. The biggest remaining design failure is not visual polish; it is distinguishability and workflow efficiency at scale. The public masonry grid turns many real photos into identical accessible links and repeated visible tag titles, while the admin interface still depends on wide spreadsheet-like tables for dense photo operations. Design quality score: 7/10 for public browsing, 7/10 for photo inspection, 6/10 for admin workflow efficiency.

## Inventory

Inspected UI implementation inventory:

- `apps/web/src/components`: 60 `.tsx` component files plus `use-modal-tree-isolation.ts`; high-risk components reviewed include `nav-client.tsx`, `home-client.tsx`, `masonry-card.tsx`, `search.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `lightbox.tsx`, `image-zoom.tsx`, `info-bottom-sheet.tsx`, `image-manager.tsx`, `upload-dropzone.tsx`, `bulk-edit-dialog.tsx`, `admin-nav.tsx`, `admin-header.tsx`, `admin-user-manager.tsx`, and UI primitives under `components/ui/`.
- Public route files: 19 files under `apps/web/src/app/[locale]/(public)`, including home, topic, photo, shared group/link, smart collection, map, timeline, year, privacy, and uploads route handlers.
- Admin route files: 28 files under `apps/web/src/app/[locale]/admin`, including login, dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics, protected layout/loading/error, and server actions.
- Messages: `apps/web/messages/en.json` and `apps/web/messages/ko.json`; both currently flatten to 868 leaf keys with no missing-key drift.
- Tests reviewed: 11 Playwright specs/helpers under `apps/web/e2e`; 340 unit/source tests under `apps/web/src/__tests__`, including touch-target, focus-visible, i18n parity, public route, focus-restore, and nav visual checks.
- Docs/context reviewed: `AGENTS.md` prompt supplied in the task, `CLAUDE.md`, `.context/plans`, `.context/reviews`, and existing local screenshots under `.context/`.

Live public evidence gathered with `agent-browser` against `https://gallery.atik.kr`:

- Desktop `/en` accessibility snapshot: main nav, tag filters, masonry photo links, load-more, footer.
- Desktop `/en/p/348` accessibility snapshot and computed layout: `nav` height 64, media container `1248 x 790`, black background, `borderRadius: 12px`, photo image `1230 x 772`, `object-fit: contain`.
- Mobile Korean `/ko` accessibility snapshot and DOM boxes at `390 x 844`: nav controls are 44 px targets; tag chips occupy vertical space from y=180 through y=380 before the first photo starts at y=412; repeated photo links share identical accessible names.

## Findings

### UXR-C8-01 — Repeated gallery cards have indistinguishable accessible names

Severity: High
Confidence: High
Status: Confirmed

Evidence:

- Live desktop `/en` accessibility snapshot exposed four adjacent links all named `View photo: #Color in Music Festival #DOHOON #JIHOON`, refs `e26` through `e29`.
- Live mobile Korean `/ko` snapshot exposed the same repeated labels as `사진 보기: #Color in Music Festival #DOHOON #JIHOON`, refs `e25` and `e26`, and DOM evaluation showed many more repeated offscreen links with the same `aria` string.
- Source builds the card label from tags/title only: `displayTitle = getPhotoDisplayTitleFromTagNames(...)` and `photoAriaLabel = t('aria.viewPhoto', { title: displayTitle })` in `apps/web/src/components/masonry-card.tsx:47-64`.
- The visible card title and alt text use the same tag-derived display identity at `apps/web/src/components/masonry-card.tsx:107-158`, so sighted users also see a wall of repeated tag titles when a batch has no distinct image title.
- Existing e2e validates one seeded unique name (`View photo: E2E Landscape`) in `apps/web/e2e/public.spec.ts:160-167`, but does not assert uniqueness or disambiguation in real tag-heavy datasets.

Failure scenario:

A keyboard or screen-reader visitor tabs through a concert gallery where many images share the same people/event tags. The focus order announces "View photo: #Color in Music Festival #DOHOON #JIHOON" repeatedly with no index, capture time, image id, filename fragment, or other differentiator. The user cannot choose "the second one" or return to the same image reliably.

Suggested fix:

Keep the aesthetic tag title if needed, but make the accessible name and visible secondary metadata uniquely scannable. Include one stable differentiator such as capture time, sequence position, image id, or original filename-derived short label: `View photo 3 of 30: #Color...; captured 2026-...` or `View photo: #Color...; image 348`. Add a browser test that samples visible `main a[href*="/p/"]` accessible names and fails when duplicates occur within the first page unless the names include a unique ordinal/id.

### UXR-C8-02 — Mobile public IA lets filters push the first photo below the primary viewport

Severity: Medium
Confidence: High
Status: Confirmed on live public UI

Evidence:

- Live mobile Korean `/ko` at `390 x 844`: tag chips start at y=180 and wrap through y=380; first photo link starts at y=412. The first visible viewport spends roughly half its height on heading/filter controls before photo content.
- Source renders all available tags as a wrapping group with no collapse, horizontal scroll, priority cap, or "more filters" sheet: `apps/web/src/components/tag-filter.tsx:62-123`.
- Home always renders `TagFilter` before the masonry grid at `apps/web/src/components/home-client.tsx:232-342` (grid region observed in source output around the rendered `TagFilter`, masonry cards, and `LoadMore`).
- Live DOM boxes confirm each chip meets the 44 px target floor, but the layout cost is cumulative: `Color in Music Festival` was 192 px wide, `Asia Top Artist Festival` 193 px wide, and rows wrapped to y=336 before the masonry list.

Failure scenario:

On a phone, a visitor opens the gallery to see photos but first has to pass a dense taxonomy block. As tags grow, the first viewport becomes navigation-heavy instead of photo-heavy. For a photographer's public portfolio, this weakens the first impression and makes "photo first" dependent on a small tag set.

Suggested fix:

Use a compact responsive filter model: show `All` plus the top 3-5 tags, move the full tag list into a filter sheet/dialog, or use a horizontally scrollable chip row with a visible overflow affordance. Preserve the 44 px hit targets and `aria-pressed` state, but keep the first photo in the first viewport on common mobile sizes.

### UXR-C8-03 — Admin photo management is a wide table, not an efficient photo workflow

Severity: High
Confidence: High for source evidence; Likely for real admin friction
Status: Source-confirmed workflow risk

Evidence:

- Dashboard constrains recent uploads into a scrollable panel: `max-h-[calc(100vh-16rem)] overflow-auto` around `ImageManager` in `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:140-144`.
- `ImageManager` renders a horizontally scrollable table at `apps/web/src/components/image-manager.tsx:424-600`.
- The table has nine columns: select, preview, title, filename, topic, tags, gamut, date, actions at `apps/web/src/components/image-manager.tsx:426-449`.
- Each row embeds a 128 px preview, inline tag editor, color badges, date, edit/delete actions, and truncation at `apps/web/src/components/image-manager.tsx:470-586`.
- Selection creates a sticky bulk action bar at `apps/web/src/components/image-manager.tsx:321-421`, which helps, but the row model still requires horizontal scanning and per-row tab stops.

Failure scenario:

An admin uploads or reviews dozens of photos on a laptop. To change tags, confirm topic, inspect title, and act on the row, they must work across a horizontally scrollable table with rich inline controls. The photo is treated as a table thumbnail rather than the primary object. On narrow screens or Korean UI, row context and action affordances can be separated by horizontal scrolling.

Suggested fix:

Introduce an admin photo workbench pattern: left/grid photo selection, right inspector panel for metadata/tags, sticky batch toolbar, and a detail drawer for edit/delete. Keep the current table as a dense "list view" for power users, but do not make it the only workflow. Add sticky first/action columns if the table remains.

### UXR-C8-04 — Admin navigation is flat and wraps instead of grouping workflows

Severity: Medium
Confidence: High
Status: Source-confirmed IA issue

Evidence:

- Admin nav defines ten peer links in one flat array: dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics at `apps/web/src/components/admin-nav.tsx:15-26`.
- It renders as a wrapping horizontal nav: `className="flex flex-wrap items-center gap-x-4 gap-y-2..."` at `apps/web/src/components/admin-nav.tsx:29`.
- Header nests the nav inside a flex-wrapping header next to the Admin link and logout form at `apps/web/src/components/admin-header.tsx:13-27`.
- There is no grouping between content management, publishing/SEO, security/users/tokens, operations/DB/settings, and analytics.

Failure scenario:

As the admin surface grows, every destination competes at the same visual level. A photographer/admin trying to perform a task like "publish new set", "change delivery settings", or "review traffic" must parse a flat list of labels, and wrapped rows change spatial positions across viewport widths and Korean/English strings.

Suggested fix:

Group admin IA into stable sections: Content (`Dashboard`, `Categories`, `Tags`), Publishing (`SEO`, public preview), Operations (`Settings`, `DB`), Access (`Users`, `Tokens`, `Password`), Insights (`Analytics`). On desktop use a left sidebar or grouped top nav; on small widths use a menu button with section headings. Preserve `aria-current` and focus rings.

### UXR-C8-05 — Photo viewer shortcut discoverability is split between visible prose and partial ARIA

Severity: Medium
Confidence: Medium-High
Status: Confirmed source pattern; impact depends on user modality

Evidence:

- Photo viewer installs global key handling for ArrowLeft, ArrowRight, and `I` at `apps/web/src/components/photo-viewer.tsx:400-418`.
- Lightbox handles Space, `C`, `H`, `F`, arrows, and Escape at `apps/web/src/components/lightbox.tsx:316-368`.
- The visible desktop shortcut hint is a prose paragraph only: `apps/web/src/components/photo-viewer.tsx:580-584`, with text from `apps/web/messages/en.json:363-365` and Korean from `apps/web/messages/ko.json:363-365`.
- Some buttons expose `aria-keyshortcuts`, such as fullscreen (`F`) in `apps/web/src/components/lightbox.tsx:55-59` and info (`I`) in `apps/web/src/components/photo-viewer.tsx:606-663`, but arrow navigation buttons in `apps/web/src/components/photo-navigation.tsx:306-329` do not expose `aria-keyshortcuts`.
- Live desktop photo snapshot shows the prose hint as ordinary paragraph text and controls named `Open fullscreen view`, `Info`, `Next photo`.

Failure scenario:

Keyboard users can use the shortcuts if they read the paragraph, but assistive tech and command-discovery tooling cannot consistently associate shortcut metadata with the relevant controls. Mobile hides the hint by design, and desktop-only prose is not a command palette or help surface.

Suggested fix:

Add `aria-keyshortcuts` consistently to shortcut-backed controls: previous/next arrows, fullscreen, info, color details, histogram, and slideshow where a control exists. Consider a small keyboard-help dialog reachable from the photo viewer (`?`) and a structured `<kbd>` list rather than one prose sentence. Keep the prose hint short and avoid hiding all shortcut discovery on tablet layouts with hardware keyboards.

### UXR-C8-06 — Primary photo inspection is still framed by rounded chrome in normal viewer mode

Severity: Low-Medium
Confidence: High for live computed evidence; Medium for product impact
Status: Confirmed visual/fidelity tradeoff

Evidence:

- Live `/en/p/348` computed style: `[data-testid="photo-media-container"]` is `1248 x 790`, `background: rgb(0, 0, 0)`, `borderRadius: 12px`, `overflow: hidden`; the image is `1230 x 772`, `objectFit: contain`.
- Source sets the media surface to `rounded-xl border dark:border-transparent p-2 overflow-hidden min-h-[40vh] md:min-h-[500px]` at `apps/web/src/components/photo-viewer.tsx:697`.
- The actual image carries `max-h-[calc(100vh-8rem)]` at `apps/web/src/components/photo-viewer.tsx:483-542`.
- The lightbox likely provides the more immersive inspection mode, but the default photo page remains a framed panel rather than an edge-to-edge viewing surface.

Failure scenario:

For casual browsing, the rounded panel is polished. For color/focus inspection, the visible frame, padding, and rounded corners make the photograph feel embedded in UI chrome. A user comparing edge detail or composition sees an artificial black margin and rounded crop boundary as part of the viewing context.

Suggested fix:

Keep the current card-like treatment for public editorial browsing if desired, but offer a "critical view" or make the primary desktop viewer less framed: remove radius/padding in dark/OLED mode, let the photo area occupy more vertical space, and reserve rounded chrome for metadata panels. Confirm that the lightbox is the recommended fidelity mode and make that affordance obvious.

### UXR-C8-07 — Long Korean operational copy risks overwhelming settings surfaces

Severity: Medium
Confidence: Medium
Status: Likely layout/content-design risk

Evidence:

- Message parity is good: both locales have 868 leaf keys and no missing keys.
- Several Korean operational strings are very long. Examples from `apps/web/messages/ko.json`: `settings.semanticSearchDesc` is 243 characters, `settings.firefoxDisplayGapNoteDetail` is 194, `settings.backfillTriggerHint` is 181, `settings.backfillRequiredHint` is 163, and `settings.backfillConfirmDesc` is 145.
- Corresponding English settings copy is already dense at `apps/web/messages/en.json:765-815`; Korean strings around `apps/web/messages/ko.json:790-815` are longer and include technical tokens such as `--force-reencode`.
- Settings renders many cards/forms and validation alerts from `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`; the source includes several long hint/error render points around `settings-client.tsx:327-455` and field errors through `settings-client.tsx:481-755` from grep output.

Failure scenario:

An admin in Korean settings sees long paragraphs mixed with operational warnings, backfill caveats, and technical flags. The content is accurate, but dense operational prose can bury the decision point: what changes, what is risky, and what action is required.

Suggested fix:

Split long settings copy into structured microcopy: one-sentence summary, bullet list of consequences, and a "requires sidecar backfill" warning row when relevant. Preserve exact technical tokens, but avoid placing all caveats in one paragraph. Add screenshot or DOM tests for Korean settings at common admin widths to catch overflow and excessive vertical compression.

### UXR-C8-08 — Documented touch-target exemptions keep admin mobile quality ambiguous

Severity: Low-Medium
Confidence: Medium
Status: Risk, not a confirmed live failure

Evidence:

- The touch-target audit intentionally scans components, admin routes, public routes, and app-level files at `apps/web/src/__tests__/touch-target-audit.test.ts:42-88`.
- The same audit documents known admin exemptions and explicitly says admin is keyboard-primary / mobile out of scope in `apps/web/src/__tests__/touch-target-audit.test.ts:156-194` and `apps/web/src/__tests__/touch-target-audit.test.ts:218-243`.
- Current source still contains compact admin triggers such as the batch add button at `apps/web/src/components/image-manager.tsx:338-341`, add-admin trigger at `apps/web/src/components/admin-user-manager.tsx:93-99`, and admin logout button at `apps/web/src/components/admin-header.tsx:21-25`.
- The underlying `Button` primitive now floors size variants to at least 44 px according to `apps/web/src/__tests__/touch-target-audit.test.ts:164-170`, so this is primarily a governance/design-scope risk rather than a measured sub-44 live target.

Failure scenario:

If the admin interface becomes expected to work well on phones or tablets, historical "admin is desktop/keyboard-primary" assumptions could hide rough edges. Future primitive changes could also make old compact size usage regress despite the current floor.

Suggested fix:

Decide explicitly whether mobile admin is supported. If yes, retire the admin exemptions, replace compact triggers with explicit `h-11`/`min-h-11` classes at call sites, and add a mobile admin Playwright smoke for dashboard, image manager, users, settings, and tokens. If no, document desktop-only admin support in product/admin docs and keep the audit comments current.

## Strengths Not Reopened

- Public landmarks and skip-link targets are intentionally wired: public main target in `apps/web/src/app/[locale]/(public)/layout.tsx:8-16`; admin main target in `apps/web/src/app/[locale]/admin/layout.tsx:24-33`.
- Public search has a strong modal pattern: focus trap, autofocus, Escape close, focus restore, live result count, combobox/listbox roles, IME guards, and source/browser tests (`apps/web/src/components/search.tsx:369-563`, `apps/web/e2e/public.spec.ts:21-40`).
- Focus restore is actively tested for lightbox, mobile info sheet, and search dialog in `apps/web/e2e/focus-restore.spec.ts:10-76`.
- Nav visual tests assert visible nav target size and non-overlap on mobile collapsed, mobile expanded, and desktop in `apps/web/e2e/nav-visual-check.spec.ts:40-87`.
- The 44 px touch target policy is unusually well documented and enforced by `apps/web/src/__tests__/touch-target-audit.test.ts:5-40`.
- i18n key parity is protected by `apps/web/src/__tests__/i18n-key-parity.test.ts:135-168`; my local JSON flatten check also reported `en keys 868`, `ko keys 868`, no missing keys.
- Error/loading/empty states exist across public/admin surfaces: home empty state in `apps/web/src/components/home-client.tsx:344-360`, load-more live region in `apps/web/src/components/load-more.tsx:161-173`, admin loading state in `apps/web/src/app/[locale]/admin/(protected)/loading.tsx:6-13`, token loading/error/empty states in `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:148-171`.
- Trust-critical token UX includes one-time plaintext display, copy affordance, required acknowledgment, and revoke confirmation at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:250-325`.

## Final Sweep

Reviewed public IA, nav, masonry cards, tag filters, search, photo viewer, zoom/lightbox, mobile bottom sheet, map/timeline/shared routes by source; reviewed admin IA, dashboard, image manager, upload, bulk edit, settings, tokens, users, analytics by source and tests; reviewed i18n messages and parity; used live public browser evidence for desktop, photo detail, and Korean mobile. I did not run local dev, did not require credentials, and did not mutate app source, services, git state, deployment state, or the temporary MySQL container.

Stop condition met for this lane: one review artifact written with inventory, confirmed/likely/risk findings, source/browser/test evidence, final sweep, and suggested fixes.
