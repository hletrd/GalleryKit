# UI/UX Designer Review - Cycle 15

- Reviewer lane: `ui-ux-designer-reviewer`
- Repo: `/Users/hletrd/flash-shared/gallery`
- HEAD: `3efa0c0e`
- Date: 2026-06-30
- Scope: GalleryKit web app current HEAD, adapted from the local reviewer prompt to this repo.
- Write scope: review artifact only. No source code changes. No commit.

## Method

1. Read `AGENTS.md`, `CLAUDE.md`, and `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md`.
2. Inventoried UI surfaces under:
   - `apps/web/src/app/[locale]/(public)/**`
   - `apps/web/src/app/[locale]/admin/**`
   - `apps/web/src/components/**`
   - `apps/web/src/app/[locale]/globals.css`
   - `apps/web/messages/{en,ko}.json`
3. Reviewed frontend components/pages/messages/styles for professional gallery UX, keyboard/focus, mobile, Korean i18n, accessibility, visual hierarchy, touch targets, error/loading/empty states, and perceived performance.
4. Used `agent-browser` where feasible:
   - `/en` on `127.0.0.1:3001` stayed in the loading shell because local data queries fail.
   - `/en/admin` at 390 x 844 rendered the mobile login form correctly.
   - `/ko/admin` at 390 x 844 rendered the localized mobile login form correctly.
5. Ran targeted validation:
   - `npm test --workspace=apps/web -- touch-target-audit.test.ts`: passed, 16 tests.
   - `node` message-leaf count: `en 806`, `ko 806`.
   - An initial Vitest run with `--runInBand` failed because Vitest does not support that option; reran without it successfully.

## Inventory Summary

Primary public UI:
- Home/masonry: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/components/home-client.tsx`
- Photo page/viewer: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`
- Search/nav: `apps/web/src/components/search.tsx`, `apps/web/src/components/nav-client.tsx`
- Topic/category/share/year/timeline/map routes under `apps/web/src/app/[locale]/(public)/**`
- Color/HDR inspection: `apps/web/src/components/color-details-section.tsx`, `apps/web/src/components/lightbox-color-pip.tsx`, `apps/web/src/components/wide-gamut-hint.tsx`, `apps/web/src/components/histogram.tsx`

Primary admin UI:
- Login/admin shell: `apps/web/src/app/[locale]/admin/**`
- Dashboard/settings/SEO/users/tokens/db/analytics/categories/tags/upload/image manager under `apps/web/src/app/[locale]/admin/(protected)/**` and `apps/web/src/components/**`

System UI:
- Global tokens and motion/forced-colors behavior: `apps/web/src/app/[locale]/globals.css`
- Messages: `apps/web/messages/en.json`, `apps/web/messages/ko.json`

## Findings

### UIUX-C15-01 - Photo-page swipe navigation is attached to `window`, so mobile horizontal gestures outside the image can navigate photos

- Severity: Medium
- Status: Likely user-facing defect, source-confirmed
- Confidence: High
- Scenario: On a phone photo page, a user starts a horizontal drag in metadata/sidebar-adjacent page content, browser-edge areas, or any non-image region while the photo viewer is mounted. The global handler records the gesture and can call `preventDefault()` or navigate to the previous/next photo even though the gesture did not start on the image canvas.
- Evidence:
  - `apps/web/src/components/photo-navigation.tsx:43-60` records every `window` touch start/move and calls `preventDefault()` once horizontal movement exceeds 10 px.
  - `apps/web/src/components/photo-navigation.tsx:96-133` completes navigation from the same global `window` gesture.
  - `apps/web/src/components/photo-viewer.tsx:688-695` mounts `PhotoNavigation` inside the media box, but only disables it for lightbox or bottom sheet states; the listener itself is not scoped to that media box.
- UX impact: Professional gallery browsing needs predictable gestures. Accidental photo changes are especially costly when users are reading metadata, inspecting color/HDR details, or trying to use browser/system gestures.
- Recommended fix: Attach touch listeners to a media-container ref instead of `window`, or record the original target and ignore gestures that start outside the image/navigation surface, inside controls, inside scrollable metadata, or near OS/browser edge-swipe zones. Add a mobile e2e/touch regression that swipes metadata and verifies no navigation.

### UIUX-C15-02 - Public map is visually primary but lacks an accessible named map region and gives the fallback list a generic label

- Severity: Medium
- Status: Confirmed from source
- Confidence: High
- Scenario: A keyboard or screen-reader user opens the public map page. The large Leaflet map appears before the deterministic list, but the map is not wrapped in a named landmark/region with instructions, and the list is labelled only with the generic "open photo" text.
- Evidence:
  - `apps/web/src/app/[locale]/(public)/map/page.tsx:52-66` renders the heading and then the `MapLoader`.
  - `apps/web/src/app/[locale]/(public)/map/page.tsx:67-79` renders the fallback list after the map with `aria-label={t('openPhoto')}` rather than a list-specific label.
  - `apps/web/src/components/map/map-client.tsx:107-144` renders `MapContainer` directly with no accessible wrapper, heading, description, or keyboard instructions around the third-party map.
  - Marker popups do have 44 px buttons and labels at `apps/web/src/components/map/map-client.tsx:127-140`, so the issue is the page-level structure, not every map control.
- UX impact: The map is usable visually, but assistive-tech users do not get a clear "map vs. list" mental model or a fast bypass to the reliable list. This is a professional gallery discoverability issue for geotagged work.
- Recommended fix: Wrap the map in a `<section aria-labelledby="map-title" aria-describedby="map-help">`, add concise visible or sr-only instructions, add a "Skip map to photo list" link before the map, and label the list with a dedicated message such as `map.photoListLabel`. Consider placing the accessible list before the map in DOM order while preserving visual order if desired.

### UIUX-C15-03 - Several settings switch rows can squeeze long Korean/help copy against the control on mobile

- Severity: Low
- Status: Confirmed source pattern, likely responsive defect
- Confidence: Medium-High
- Scenario: On a narrow admin settings screen in Korean, long color/HDR/privacy/auto-alt help text shares one non-wrapping horizontal row with a switch. Text can become cramped and the control can visually detach from its label.
- Evidence:
  - Non-wrapping switch rows use `flex items-center justify-between` at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:407-421`, `423-437`, `439-453`, `553-568`, and `614-628`.
  - The semantic-search row already uses the safer responsive pattern `flex flex-col gap-3 sm:flex-row ...` at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:642-671`.
  - Korean settings copy is intentionally long and explanatory, for example `apps/web/messages/ko.json:737-746` for color/HDR settings and `apps/web/messages/ko.json:754-759` for wide-gamut/backfill settings.
- UX impact: This does not block the setting, but it makes high-risk photographer/admin controls harder to scan on mobile. The settings page already has one good responsive pattern that these rows should match.
- Recommended fix: Use `flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`, add `min-w-0` to the copy column, and keep the switch `shrink-0`. Preserve `aria-describedby` on each switch.

### UIUX-C15-04 - Fresh-gallery empty state is descriptive but not operational

- Severity: Low
- Status: Confirmed from source
- Confidence: High
- Scenario: A newly deployed or fully filtered public gallery has no visible photos. The empty state explains that no photos are visible, but when there is no tag filter it does not offer an owner/operator path to upload, configure topics, or understand first-run status.
- Evidence:
  - `apps/web/src/components/home-client.tsx:424-440` renders an icon, `home.noImages`, and either a filter-clearing link or `home.emptyHint`.
  - The filtered state includes a clear-filter action at `apps/web/src/components/home-client.tsx:430-435`; the unfiltered/fresh-gallery state has no action at `apps/web/src/components/home-client.tsx:437-439`.
- UX impact: For a self-hosted professional gallery, first-run polish matters. The public visitor copy can stay minimal, but an authenticated owner should get a path back to the admin/upload flow.
- Recommended fix: If admin session state is available, show an owner-only link to admin upload or dashboard. Otherwise make the public empty text more explicit that photos appear after publication. Keep the public visitor version non-promotional and do not expose admin-only affordances to anonymous users.

### UIUX-C15-05 - Root layout hard-codes `dir="ltr"` while the comment promises RTL future-proofing

- Severity: Low
- Status: Risk, not a current en/ko defect
- Confidence: High
- Scenario: GalleryKit currently ships only English and Korean, both LTR. If another locale is added later, the HTML direction will remain LTR even when locale metadata should be RTL.
- Evidence:
  - `apps/web/src/app/[locale]/layout.tsx:94-100` sets `lang={locale}` but hard-codes `dir="ltr"` while the comment says it future-proofs for RTL locales.
  - Message parity is currently healthy: `en 806`, `ko 806`.
- UX impact: No current Korean issue, but the implementation contradicts the comment and would silently break navigation, focus flow expectations, text alignment, and photo metadata layouts for RTL locales.
- Recommended fix: Derive `dir` from locale metadata, even if the current mapping returns only `ltr`, or change the comment and add a locale-expansion test so future RTL work cannot miss this.

### UIUX-C15-06 - Public-route browser validation is blocked by local data/schema failures, leaving key gallery flows unverified in this cycle

- Severity: Medium as review risk
- Status: Confirmed validation blocker
- Confidence: High
- Scenario: The reviewer tries to validate the public gallery in a browser. The route stays in the loading shell instead of exposing the masonry/gallery experience.
- Evidence:
  - `agent-browser` snapshot for `http://127.0.0.1:3001/en` showed only the skip link, `status "Loading..."`, and the notifications region after waiting.
  - `curl http://127.0.0.1:3001/en` returned streamed error templates for failed topics/latest-image queries against local DB state.
  - The public layout renders `Nav` before `<main>` at `apps/web/src/app/[locale]/(public)/layout.tsx:7-16`.
  - The home page depends on multiple data queries before `HomeClient` renders at `apps/web/src/app/[locale]/(public)/page.tsx:149-166` and passes results to the masonry UI at `apps/web/src/app/[locale]/(public)/page.tsx:221-223`.
- UX impact: This cycle could source-review the public UI and validate admin login, but could not browser-validate public masonry, photo viewer, search, map, or topic flows against local data. That increases residual risk for runtime-only focus, loading, layout, and perceived-performance issues.
- Recommended fix: Keep a small seeded local/e2e dataset aligned with current migrations, or add a deterministic fixture mode for public UI review. Also consider isolating navigation metadata failures so the public shell can render a recoverable error instead of an indefinite loading state.

## Positive Observations

- Touch targets: The targeted touch audit passed (`16` tests), and inspected controls consistently use 44 px minimums in search, lightbox, map popup buttons, tag filters, and admin controls.
- Search: `apps/web/src/components/search.tsx:359-403` now has dialog semantics, combobox state, IME-safe keyboard handling, and an `h-11` input; `apps/web/src/components/search.tsx:503` portals the dialog to `document.body`.
- Lightbox: `apps/web/src/components/lightbox.tsx:430-457` handles focus/scroll lock and dialog semantics; controls at `apps/web/src/components/lightbox.tsx:551-656` meet touch sizing and expose keyboard shortcuts.
- Photo viewer: Blur placeholders and reduced-motion-aware transitions are present at `apps/web/src/components/photo-viewer.tsx:703-719`; the info sidebar avoids width tweening at `apps/web/src/components/photo-viewer.tsx:737-746`.
- Korean i18n: `/ko/admin` browser snapshot rendered localized login labels/buttons, and EN/KO message leaf counts match at 806 each.
- Admin tables: Prior responsive overflow fixes are present in the table primitive and admin table consumers reviewed during inventory.
- Color/HDR: The settings and viewer surfaces expose photographer-relevant color/HDR controls and warnings instead of hiding pipeline details.

## Final Missed-Issues Sweep

- Rechecked prior cycle defects against current HEAD: search touch size/portal, mobile nav controls, admin table overflow, dialog descriptions, SEO/settings header wrapping, semantic search select, and image edit inline validation are fixed or materially improved.
- Searched for obvious hard-coded English in reviewed UI paths; no new actionable public/admin Korean issue found beyond third-party attribution and locale-neutral technical values.
- Reviewed keyboard/focus hotspots: search dialog, lightbox, info bottom sheet, tag input, nav, and admin login. No additional high-confidence focus trap or lost-focus defect found in source.
- Reviewed perceived-performance hotspots: masonry uses `content-visibility`, image priority is bounded, blur placeholders exist, and reduced motion is respected globally. No new high-confidence perf UX defect beyond the public validation blocker.

## Finding Count

6 findings:
- 2 medium user-facing/product issues
- 1 medium validation risk
- 3 low severity issues/risks
