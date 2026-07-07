# Cycle 11 UI/UX Designer Reviewer - 2026-07-07

Review lane: professional UI/UX/accessibility reviewer adapted to GalleryKit's Next.js photo-gallery product. I used `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md` only for rigor and review posture; its BurstPick/SwiftUI-specific instructions do not apply to this repo.

Constraints honored: no source edits, no plan edits, no local Docker/MySQL/container start or stop, no production mutation, no admin credential use. This report is the only file intentionally written.

## Inventory First

- Project guidance: supplied `AGENTS.md`, repo `CLAUDE.md`, prior `.context/reviews/*` UX/designer history.
- Public UI source: `nav-client.tsx`, `home-client.tsx`, `masonry-card.tsx`, `tag-filter.tsx`, `search.tsx`, `photo-viewer.tsx`, `photo-navigation.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`, `image-zoom.tsx`, `similar-photos.tsx`, `wide-gamut-hint.tsx`, map/timeline/year/shared public routes.
- Admin UI source: `admin-header.tsx`, `admin-nav.tsx`, dashboard/upload/image-manager, login, users, tokens, settings, SEO, tags/categories, analytics, DB/password pages.
- i18n/theme/a11y source: `messages/en.json`, `messages/ko.json`, `globals.css`, `theme-provider.tsx`, UI primitives, touch-target/focus/i18n/password tests.
- Live read-only browser evidence: `https://gallery.atik.kr/en`, `/ko`, `/en/p/348`, search dialog for `JIHOON`, mobile viewport `390x844`, desktop/public snapshots where feasible.

Verification:

```sh
npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/password-form-a11y.test.ts
```

Result: 4 test files passed, 34 tests passed.

## Findings

### UIUX-C11-01 - Search results can expose twenty identical options for near-duplicate event photos

- Severity: Medium
- Confidence: High
- Validation: Confirmed
- Evidence:
  - Live URL/selector: `https://gallery.atik.kr/en`, search dialog, selector `#search-results [role=option]`.
  - Live query `JIHOON` returned 20 options whose accessible names and visible row text repeat `#JIHOON TWS · ILCE-7RM5 · FE 100-400mm F4.5-5.6 GM OSS · November 2, 2025`; only `href` differs (`/en/p/348`, `/en/p/347`, etc.).
  - Source uses the non-unique row label at `apps/web/src/components/search.tsx:71`, sets each result row to `role="option"` at `apps/web/src/components/search.tsx:75-83`, and renders secondary metadata without id, ordinal, or capture time at `apps/web/src/components/search.tsx:103-109`.
  - The result data includes `id` (`apps/web/src/components/search.tsx:115-127`) but the row does not expose it in visible text or accessible name.
- Failure scenario / impact:
  - A keyboard or screen-reader visitor searching a performer/event gets a list of visually and semantically indistinguishable burst-adjacent photos. Arrowing through the combobox tells them the same option name repeatedly, so they cannot choose or return to a specific photo without trial opening each result.
- Concrete fix:
  - Add a stable differentiator to each search option's visible and accessible label: photo id, localized "result N of M", capture timestamp with time, or a sequence label. Prefer a shared helper so keyword and semantic search format results the same way.
  - Add a regression test with multiple untitled/tag-matched photos from the same date asserting unique `role=option` accessible names.

### UIUX-C11-02 - Mobile home puts a tag-filter wall before the first photo

- Severity: Medium
- Confidence: High
- Validation: Confirmed
- Evidence:
  - Live URL: `https://gallery.atik.kr/en` at `390x844`.
  - DOM boxes: tag buttons occupy rows from y=180 through y=380; first photo link starts at y=412. Horizontal overflow was 0 and targets were 44 px, so this is IA/layout cost, not a touch-target failure.
  - `TagFilter` renders every tag as a wrapping button group with no collapse/overflow model at `apps/web/src/components/tag-filter.tsx:62-123`.
  - `HomeClient` places `TagFilter` before the masonry grid at `apps/web/src/components/home-client.tsx:303-305`, with the grid starting afterward at `apps/web/src/components/home-client.tsx:318-330`.
- Failure scenario / impact:
  - On phones, a public visitor arrives for photos but spends roughly half the first viewport on taxonomy controls. As tag count grows, the first impression becomes filter-first instead of photo-first.
- Concrete fix:
  - Use a compact mobile filter model: show `All` plus the top few tags, move the full list to a filter sheet, or use a horizontally scrollable chip rail with a clear overflow affordance. Keep `aria-pressed` and 44 px targets.
  - Add a mobile visual/DOM check asserting the first photo remains in the initial viewport for representative live/tag-heavy data.

### UIUX-C11-03 - Normal photo viewer arrow controls do not expose their keyboard shortcuts

- Severity: Low
- Confidence: High
- Validation: Confirmed
- Evidence:
  - Live URL: `https://gallery.atik.kr/en/p/348`; selector evidence from mobile snapshot shows `button "Next photo"` with no `aria-keyshortcuts`.
  - Source handles `ArrowLeft`/`ArrowRight` globally in the normal viewer at `apps/web/src/components/photo-viewer.tsx:400-410`.
  - Source renders normal viewer previous/next buttons at `apps/web/src/components/photo-navigation.tsx:306-328` with labels only, no `aria-keyshortcuts`.
  - Lightbox gets this right for equivalent controls at `apps/web/src/components/lightbox.tsx:655-677`.
- Failure scenario / impact:
  - Keyboard users can navigate if they discover the prose hint, but assistive tech and shortcut-discovery tooling do not get structured shortcut metadata on the normal viewer's visible arrow controls. The same app communicates shortcut support in lightbox but not in the default viewer.
- Concrete fix:
  - Add `aria-keyshortcuts="ArrowLeft"` and `aria-keyshortcuts="ArrowRight"` to the normal viewer prev/next buttons. Keep visible titles/tooltips consistent with lightbox where appropriate.
  - Add a small source or E2E assertion that `PhotoNavigation` buttons expose shortcut metadata.

### UIUX-C11-04 - Admin image management remains table-first instead of photo-workbench-first

- Severity: Medium
- Confidence: Medium-High
- Validation: Likely, source-confirmed; manual admin validation still needed
- Evidence:
  - Dashboard constrains recent uploads inside `max-h-[calc(100vh-16rem)] overflow-auto` at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:140-143`.
  - `ImageManager` renders a horizontally scrollable table at `apps/web/src/components/image-manager.tsx:427-603`.
  - The row model has nine columns and embeds preview, title, filename, topic, tags, gamut, date, and row actions at `apps/web/src/components/image-manager.tsx:431-451` and `apps/web/src/components/image-manager.tsx:473-589`.
- Failure scenario / impact:
  - Admins reviewing a batch must scan and edit across a dense horizontal table. On laptop/mobile widths or Korean UI, the photo, tags, and actions can be separated by scroll, which is inefficient for photo-first metadata cleanup.
- Concrete fix:
  - Add a photo workbench layout: grid/list of photos plus an inspector panel for metadata/tags, with sticky batch actions. Keep the table as an optional dense list view if useful.
  - Manually validate with real admin data at mobile, laptop, and wide desktop widths before designing the replacement.

### UIUX-C11-05 - Admin navigation is still a flat ten-link wrap

- Severity: Low-Medium
- Confidence: High
- Validation: Likely, source-confirmed; manual admin validation still needed
- Evidence:
  - `AdminNav` defines ten peer links in one array at `apps/web/src/components/admin-nav.tsx:15-26`.
  - It renders them as a wrapping horizontal nav at `apps/web/src/components/admin-nav.tsx:29-49`.
  - `AdminHeader` places that nav beside the admin brand and logout form in a flex-wrapping header at `apps/web/src/components/admin-header.tsx:13-27`.
- Failure scenario / impact:
  - Content, operations, access/security, and analytics destinations all compete at the same visual level. Wrapped positions change by viewport and locale, weakening spatial memory for repeat admin work.
- Concrete fix:
  - Group admin IA into stable sections: Content, Publishing, Operations, Access, Insights. On narrow widths, use a sectioned menu/drawer rather than wrapping every destination into the header.

## Verified Good / Not Reopened

- Home masonry accessible names now include the photo id (`apps/web/src/components/masonry-card.tsx:47-65`); live first-page links were unique (`#348`, `#347`, ...). I did not reopen the older duplicate-home-card finding.
- Timeline/year archive routes now mirror the id suffix (`apps/web/src/app/[locale]/(public)/timeline/page.tsx:229-252`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:192-212`), so I did not reopen the cycle-10 archive finding.
- Search no longer falls back to generic `Photo {id}` for the tested `JIHOON` query; the remaining search issue is duplicate option distinguishability, not missing tag context.
- Targeted touch, focus-visible, i18n parity, and password-form accessibility tests passed.
- i18n leaf-key parity is clean: local flatten check found 869 English keys and 869 Korean keys, with no missing keys either direction.
- Public photo/mobile controls met 44 px target expectations in live DOM checks; no horizontal overflow was observed on tested mobile home/photo views.

## Final Missed-Issue Sweep

I swept ARIA labels/roles, focus indicators, shortcut metadata, touch-target tests, modal/focus-trap patterns, loading/empty/error states, public Korean/English routes, tag-heavy mobile layout, search result semantics, photo viewer/lightbox controls, admin table/nav/settings/tokens/upload surfaces, and prior current-day UX reports. I did not find another distinct current UI/UX issue with enough evidence to file without duplicating already-fixed or already-recorded findings.
