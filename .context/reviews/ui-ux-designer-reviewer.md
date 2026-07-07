# UI/UX Designer Reviewer - Cycle 21

Repository: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `45b32d1db373e03d82a29511f53832051c770880`
Lane: `ui-ux-designer-reviewer`, adapted from the stale BurstPick/SwiftUI profile to GalleryKit's Next.js web UI.

## Inventory

Required context read first: `AGENTS.md`, `CLAUDE.md`, and `.context/plans/README.md`. I also read the stale local reviewer prompt to adapt only its product-design review posture, not its BurstPick/SwiftUI assumptions.

UI-relevant current-HEAD inventory:

- Public routes: 46 TSX files under `apps/web/src/app/[locale]`, including home/topic galleries, photo viewer, shared links/groups, smart collections, map, timeline/year archive, privacy/about, loading/error/not-found shells.
- Admin routes: dashboard/upload/image manager, categories, tags, SEO, settings/backfill, tokens, password, users, DB backup/restore, analytics, login/protected shell.
- Components: 60 TSX files under `apps/web/src/components`, including nav/search/home/masonry/photo-viewer/lightbox/info sheet/color details/map/upload/admin nav/image manager/tag input and shadcn/Radix primitives.
- Localization/styling/tests: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/app/[locale]/globals.css`, 9 Playwright specs in `apps/web/e2e`, and 357 Vitest files under `apps/web/src/__tests__`.

Browser evidence: local `http://127.0.0.1:3000/en` was not reachable. I did not run `apps/web/scripts/run-e2e-server.mjs` because it explicitly seeds/destructively prepares a disposable DB, and the task is review-only. I loaded `https://gallery.atik.kr/en`, `/ko/admin`, and `/en/map` with Playwright/CDP and inspected DOM rectangles/computed styles/accessibility roles; however, the deployed public site did not exactly match current HEAD for the mobile tag filter, so live measurements are treated as non-authoritative for findings. Current findings below are source-backed.

Fresh validation run:

- `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/theme-token-contract.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/search-status-source.test.ts src/__tests__/focus-visible-rings-cycle20.test.ts src/__tests__/info-bottom-sheet-ia.test.ts` -> 6 files passed, 32 tests passed.
- `npm test --workspace=apps/web -- --run src/__tests__/focus-visible-links-scan.test.ts src/__tests__/hdr-badge-contrast.test.ts src/__tests__/switch-geometry-contract.test.ts src/__tests__/lightbox-controls-contract.test.ts` -> 4 files passed, 40 tests passed.

## Executive Summary

No Critical or High UI/UX regressions found at current HEAD. Current HEAD has closed several prior review issues: mobile tag filters now collapse behind a `<details>` disclosure, token/alias destructive confirmations name their targets, analytics country labels are localized, and focus/touch/contrast source contracts are materially stronger. The remaining confirmed issues are admin IA/ergonomics and a low-level public-gallery presentation tradeoff.

## Findings

### UIUX-C21-01 - Admin image management is still a horizontally scrolling table, not a photo workbench

Severity: Medium
Confidence: High
Exact file/region: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`; `apps/web/src/components/image-manager.tsx:427-591`

Evidence: the dashboard constrains recent uploads inside `max-h-[calc(100vh-16rem)] overflow-auto` (`dashboard-client.tsx:142`) and the manager renders a 9-column table inside `overflow-x-auto` (`image-manager.tsx:427-451`). Each photo preview is fixed at `h-32 w-32` (`image-manager.tsx:475`), tags live in a separate `min-w-[200px]` cell (`image-manager.tsx:503-553`), and edit/delete actions sit at the far-right cell (`image-manager.tsx:573-591`).

Concrete failure scenario: on a tablet or small laptop, an admin reviews a newly uploaded set, sees the thumbnail/title on the left, then must pan horizontally to reach tags or actions. Row context is easy to lose, especially when several adjacent photos share similar titles or filenames.

Suggested fix: keep the table as a wide-desktop compact mode, but add a responsive card/list workbench below large desktop widths: larger preview, title/filename/topic grouped with the image, status chips near the preview, and edit/delete/tag actions in the same visual cluster. Avoid nested horizontal + vertical scroll for the core admin review loop.

### UIUX-C21-02 - Admin navigation is a flat ten-link strip with no workflow grouping

Severity: Low-Medium
Confidence: High
Exact file/region: `apps/web/src/components/admin-nav.tsx:15-49`; `apps/web/src/components/admin-header.tsx:13-26`

Evidence: `AdminNav` defines dashboard, categories, tags, SEO, settings, tokens, password, users, DB, and analytics as ten peer links (`admin-nav.tsx:15-26`) and renders them as one wrapping `flex flex-wrap` nav (`admin-nav.tsx:29-49`). The header combines brand, nav, and logout in a wrapping row (`admin-header.tsx:13-26`) without separating publishing, organization, access, operations, and insights.

Concrete failure scenario: a Korean admin on a narrow tablet sees daily publishing links wrapped together with credentials, user management, DB restore, and analytics. Common upload/edit workflows take more scanning, while high-risk operational pages feel as visually routine as taxonomy links.

Suggested fix: group the admin IA into stable sections such as Publish, Organize, Site, Access, Operations, and Insights. On mobile/tablet, use a drawer or section menu instead of a single wrapping strip. Keep `aria-current`, focus-visible rings, and 44px targets from the current implementation.

### UIUX-C21-03 - Mobile masonry cards permanently overlay metadata on top of finished photos

Severity: Low
Confidence: Medium
Exact file/region: `apps/web/src/components/masonry-card.tsx:149-155`

Evidence: every mobile card renders an always-visible `absolute inset-x-0 top-0 sm:hidden` gradient overlay with title and topic text (`masonry-card.tsx:149-154`). Desktop moves metadata to a bottom overlay that is hidden until hover/focus (`masonry-card.tsx:155-160`), but mobile visitors have no clean-thumbnail state in the grid.

Concrete failure scenario: on a phone, a concert portrait or tightly cropped image with important subject detail near the top is partially covered by the title/topic gradient before the visitor has chosen to open the photo. For a finished-photo gallery, the browse grid becomes slightly less faithful to the photographer's crop.

Suggested fix: move mobile card metadata below the image, reserve a small caption band, or expose a compact "clean grid" presentation where metadata appears only on focus/long-press/open. Preserve the current accessible `aria-label` and H3 hierarchy if the visual treatment changes.

## Current Non-Issues Checked

- Mobile filter wall: fixed in current source. `TagFilter` uses collapsed mobile `<details>` and keeps full inline chips for `sm+` only (`apps/web/src/components/tag-filter.tsx:143-160`).
- Token revoke confirmation: fixed. The dialog title/description interpolate the selected token label (`tokens-client.tsx:307-313`; message keys include `{label}`).
- Category alias deletion confirmation: fixed. The dialog includes alias and category label (`topic-manager.tsx:431-445`; message keys include `{alias}` and `{label}`).
- Analytics country display: fixed. Country rows call `formatCountry(row.country_code)` and render localized label plus raw code (`analytics-client.tsx:202-210`).
- Basic touch/focus/contrast contracts: targeted Vitest suite passed 72 tests across touch target, focus-visible, switch geometry, HDR badge contrast, theme token, i18n parity, search status, lightbox controls, and info-sheet IA.

## Coverage Map

- Interaction design: reviewed nav/search, photo viewer, lightbox, tag filters, admin image manager, settings/backfill, upload, token/category dialogs.
- Keyboard/focus: source and tests cover search trap/restore, lightbox/info-sheet focus restore, focus-visible rings, shortcut labels, and status live regions.
- Touch targets: blocking audit passed; current source keeps 44px floors on nav, filters, upload, lightbox, and admin action controls.
- Responsive layout: findings C21-01 through C21-03.
- Color/contrast: HDR badge contrast, theme token, and focus-ring tests passed; no new contrast defect confirmed.
- i18n: EN/KO parity passed; Korean-specific protected admin runtime was not browser-clicked.
- Loading/empty/error states: upload no-topic/skip/progress, token empty/error, image processing loading, search empty/loading/error, and public not-found surfaces reviewed; no new confirmed issue.

## Final Sweep / Uninspected Categories

Uninspected with runtime evidence: credentialed protected-admin pages in a current local server, because local port 3000 was down and the available e2e server path performs DB seed/setup. Physical browser/display validation for P3/HDR rendering was also not performed. Live deployed Playwright data was used only as supplemental shape evidence because it did not fully match current HEAD.

No commits or pushes were made.
