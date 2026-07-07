# Cycle 13 UI/UX Designer Reviewer - GalleryKit

Review lane: `ui-ux-designer-reviewer`, adapted to GalleryKit's Next.js public photo gallery and admin UI. I used the registered reviewer posture from `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md` but ignored its stale BurstPick/SwiftUI path requirements.

Constraints honored: no source edits, no plan edits, no local MySQL/Docker/container start, no production mutation, no admin credential use, no commit, no push. This review file is the only intentional write.

## Executive Summary

GalleryKit is not blocked by basic accessibility hygiene: touch targets, focus-visible policy, i18n key parity, theme token contracts, and lightbox control contracts all passed targeted tests. The biggest remaining UX problem is information architecture at small widths: the mobile public home page makes visitors and keyboard users traverse a tag-filter wall before the first photo, and the mobile header focus order jumps right-to-left. Admin still has two product-shape issues: the workbench is table-first instead of photo-first, and destructive tag/category confirmations do not name the target. Design quality score: 7/10 for public gallery consumption, 5.5/10 for repeat admin photo operations.

## Inventory And Evidence

UI-relevant inventory examined:

- Project guidance/docs: supplied `AGENTS.md`, repo `CLAUDE.md`, `.context/plans/README.md`, prior UI reviews at `.context/reviews/ui-ux-designer-reviewer.md`, `.context/reviews/ui-ux-r2/_aggregate.md`, `.context/reviews/run9-cycle7/designer.md`.
- Public routes: all localized public App Router pages under `apps/web/src/app/[locale]/(public)/`, including home/topic/smart collection/year/timeline/map/photo/shared/privacy/about/loading states.
- Admin routes/forms: all localized admin pages under `apps/web/src/app/[locale]/admin/`, including login, dashboard/upload/image manager, categories, tags, SEO, settings, tokens, users, DB, password, analytics, protected loading/error layouts.
- Components: all files under `apps/web/src/components/`, including nav, search, masonry, photo viewer, lightbox, bottom sheet, map, admin nav/header, upload dropzone, image manager, bulk edit dialog, tag input, UI primitives, theme provider, service worker registration.
- i18n/theme/a11y support: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/app/[locale]/globals.css`, theme/locale/photo-title/display-capability helpers, and UI/a11y tests.

Static inventory counts from this pass: 58 app route files, 61 component files, 2 message catalogs, 18 UI-adjacent lib files. Hardcoded visible-string sweep only surfaced expected literals (`en_US`, Next image `blur`, OpenStreetMap attribution).

Browser-backed evidence:

- `https://gallery.atik.kr/en`, `https://gallery.atik.kr/ko`, `https://gallery.atik.kr/en/p/348`, `https://gallery.atik.kr/ko/admin`, `https://gallery.atik.kr/en/map`.
- Viewports: desktop `1440x900`, mobile `390x844`.
- Live search query `JIHOON`: 20 options, 20 unique accessible names; the prior duplicate-search-result finding is closed.

Verification run:

```sh
npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/password-form-a11y.test.ts src/__tests__/theme-token-contract.test.ts src/__tests__/lightbox-controls-contract.test.ts
```

Result: 6 test files passed, 44 tests passed.

## Findings

### UIUX-C13-01 - Mobile header focus order jumps to the far-right menu before left-side controls

- Severity: Medium
- Confidence: High
- WCAG: 2.4.3 Focus Order
- Evidence:
  - Live URL/selector: `https://gallery.atik.kr/en` at `390x844`; tab trail after brand was `Expand menu` at `x=330`, then `Search photos` at `x=186`, theme at `x=234`, language at `x=282`.
  - Source renders the mobile expand toggle before the controls in DOM order at `apps/web/src/components/nav-client.tsx:106-125`.
  - The toggle uses `order-last` only visually when collapsed at `apps/web/src/components/nav-client.tsx:112-115`, while search/theme/language controls are rendered later at `apps/web/src/components/nav-client.tsx:167-190`.
- Failure scenario:
  - A keyboard user tabs across the collapsed mobile header and focus visibly jumps from the brand to the far-right chevron, then back left to search/theme/language. This breaks spatial predictability and makes the control cluster feel reordered by accident.
- Suggested fix:
  - Align DOM and visual order. Either render controls before the mobile menu button when collapsed, or use a layout that does not visually reorder focusable elements. Add a mobile tab-order E2E assertion for brand -> search -> theme -> locale -> menu, or intentionally choose another visual order and make DOM match it.

### UIUX-C13-02 - Mobile home still puts the full tag-filter wall before the first photo

- Severity: Medium
- Confidence: High
- Areas: information architecture, responsive behavior, keyboard efficiency
- Evidence:
  - Live URL/selector: `https://gallery.atik.kr/en` at `390x844`; tag buttons occupy y `180-380`, first photo link starts at y `412`; first 15 tab stops after header traverse every tag chip before the first photo.
  - `HomeClient` places `TagFilter` before the masonry grid at `apps/web/src/components/home-client.tsx:287-305`, with the grid starting at `apps/web/src/components/home-client.tsx:318-330`.
  - `TagFilter` renders every tag as wrapping chips with no mobile collapse/overflow model at `apps/web/src/components/tag-filter.tsx:62-122`.
- Failure scenario:
  - A mobile visitor arrives to view photos but the first viewport is dominated by taxonomy controls. Keyboard users must tab through `All`, `Color in Music Festival`, `SHINYU`, `Asia Top Artist Festival`, `JIHOON`, `KYUNGMIN`, `DOHOON`, `YOUNGJAE`, and `HANJIN` before reaching the first image.
- Suggested fix:
  - Use a compact mobile filter model: `All` plus top 2-3 tags, a horizontal chip rail with overflow affordance, or a filter sheet. Preserve `aria-pressed`, 44 px targets, and a visible active-filter summary. Add a mobile DOM check that first photo content remains in the first viewport for tag-heavy data.

### UIUX-C13-03 - Admin navigation remains a flat ten-link wrap

- Severity: Low-Medium
- Confidence: High from source; authenticated visual validation still needed
- Areas: information architecture, responsive behavior, admin repeat-use efficiency
- Evidence:
  - `AdminNav` defines ten peer destinations in a single flat array at `apps/web/src/components/admin-nav.tsx:15-26`.
  - It renders them as one wrapping horizontal nav at `apps/web/src/components/admin-nav.tsx:28-49`.
  - `AdminHeader` places that nav beside the admin brand and logout form in a flex-wrapping header at `apps/web/src/components/admin-header.tsx:13-27`.
- Failure scenario:
  - Content, publishing, security, operations, and insights destinations all compete at the same level. On narrower widths and Korean labels, wrapped link positions change, weakening spatial memory for repeat admin work.
- Suggested fix:
  - Group admin IA into stable sections: Content (`Dashboard`, `Categories`, `Tags`), Publishing (`SEO`, `Settings`, `Tokens`), Access (`Password`, `Users`), Operations (`DB`), Insights (`Analytics`). On narrow widths, use a sectioned menu/drawer rather than wrapping every destination in the header.

### UIUX-C13-04 - Admin recent uploads is still table-first instead of photo-workbench-first

- Severity: Medium
- Confidence: Medium-High from source; authenticated visual validation still needed
- Areas: admin workflow, interaction design, responsive behavior
- Evidence:
  - Dashboard constrains recent uploads inside a scroll region at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-143`.
  - `ImageManager` renders a horizontally scrollable table at `apps/web/src/components/image-manager.tsx:427-452`.
  - Each row packs preview, title, filename, topic, tags, gamut, date, and actions across the table at `apps/web/src/components/image-manager.tsx:473-553`.
- Failure scenario:
  - Admins cleaning up an upload batch must scan and edit photos horizontally. On laptop/mobile widths, preview, tags, and row actions can be separated by scroll, which is slower than a photo grid plus inspector for visual metadata cleanup.
- Suggested fix:
  - Add a photo workbench mode: grid/list of images with persistent selection and a right/bottom inspector for title, topic, tags, gamut/HDR, date, and destructive actions. Keep the current table as an optional dense list view for power users.

### UIUX-C13-05 - Category and tag delete confirmations do not name the target

- Severity: Medium
- Confidence: High
- Areas: admin forms, error prevention, destructive-action UX
- Evidence:
  - Tag delete dialog renders generic title/description at `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:141-147`.
  - Category delete dialog renders generic title/description at `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:327-333`.
  - English messages are generic: `Delete this category?` and `Delete this tag?` at `apps/web/messages/en.json:93-94` and `apps/web/messages/en.json:128-129`; Korean messages are generic at `apps/web/messages/ko.json:93-94` and `apps/web/messages/ko.json:128-129`.
  - The same category UI already has a safer precedent: GPS publish confirmation includes `{label}` at `apps/web/messages/en.json:112-114`.
- Failure scenario:
  - An admin opens delete from a dense table, gets interrupted, and returns to a dialog that does not identify which category/tag will be removed. The irreversible action depends on memory of the row that launched the dialog.
- Suggested fix:
  - Store the selected tag/category object, not only id/slug, and interpolate the visible name into both title and description: `Delete tag "JIHOON"?` / `Delete category "TWS"?`. Include affected count where available. Keep the destructive button text short.

### UIUX-C13-06 - Long Settings form has only a top save action

- Severity: Low-Medium
- Confidence: Medium from source; authenticated visual validation still needed
- Areas: admin forms, perceived completion, keyboard/mouse efficiency
- Evidence:
  - Settings renders the save button only in the top page header at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:316-330`.
  - The form continues through Image Processing, Upload, Slideshow, Auto Alt-Text, and Semantic Search cards, with lower sections at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:731-858`.
- Failure scenario:
  - An admin changes Semantic Search or Auto Alt-Text near the bottom, then has to scroll back to the top to save. On mobile this is easy to miss because the last visible state looks like the form ended without an apply control.
- Suggested fix:
  - Add a sticky bottom action bar or repeat save/cancel actions after the final card. Include dirty-state text such as `Unsaved changes` and keep focus restoration on the invoked save button.

## Verified Good / Not Reopened

- Search result distinguishability is fixed on the live site: `https://gallery.atik.kr/en`, query `JIHOON`, selector `[role="option"]` returned 20 unique accessible names, each including the photo id.
- Normal photo viewer navigation now exposes structured shortcuts: live `https://gallery.atik.kr/en/p/348`, selector `button[aria-label="Next photo"]`, `aria-keyshortcuts="ArrowRight"`; source at `apps/web/src/components/photo-navigation.tsx:321-330`.
- Public home/photo mobile tested with no horizontal overflow at `390x844`.
- Admin login page is clean at the unauthenticated surface: live `https://gallery.atik.kr/ko/admin` showed persistent labels, password visibility toggle with `aria-pressed`, and 44 px controls; source at `apps/web/src/app/[locale]/admin/login-form.tsx:61-130`.
- Global reduced-motion and forced-colors support remain present in `apps/web/src/app/[locale]/globals.css:253-300`.
- Theme support is explicit (`system`, `light`, `dark`, `oled`) in `apps/web/src/app/[locale]/layout.tsx:137-143`; theme token tests passed.
- Map empty state is honest on live `https://gallery.atik.kr/en/map` and does not expose an empty interactive map when no geotagged photos are available.

## Coverage By Requested Area

- Information architecture: findings C13-02, C13-03, C13-04.
- Visual/interaction design: findings C13-01, C13-02, C13-04, C13-06.
- Keyboard/focus: finding C13-01; mobile tag tab-order cost in C13-02; focus-visible tests passed.
- WCAG 2.2: C13-01 maps to 2.4.3; target-size and focus-visible checks passed.
- Responsive behavior: C13-01, C13-02, C13-03, C13-04.
- Loading/empty/error states: reviewed source and live states; no new issue filed. Existing loading and empty states are present in home, map, dashboard failed images, image rows, load-more, and route errors.
- Admin/public forms: C13-05 and C13-06; login verified good.
- Dark/light modes: token and reduced-motion/forced-colors checks passed; no new issue filed.
- i18n: en/ko parity test passed; live `/en` and `/ko` smoke checked; no new issue filed.
- Perceived performance: no new source-backed issue filed. Existing masonry `content-visibility`, lazy loading, status regions, and reduced-motion rules remain in place.

## Final Sweep For Skipped Files

Skipped files: none in the UI-relevant inventory. Authenticated admin pages were source-reviewed and not live-clicked past login because no credentials were used and no production mutation was allowed. Existing unrelated dirty review files were left untouched. No source, plan, commit, push, deploy, container, or database action was performed.
