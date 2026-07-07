# Cycle 16 UI/UX Designer Reviewer - GalleryKit

Review lane: `ui-ux-designer-reviewer`, adapted to GalleryKit's Next.js photo-gallery product. I used `/Users/hletrd/.codex/agents/ui-ux-designer-reviewer.md` for rigor and review posture only; its BurstPick/SwiftUI source paths do not apply to this repository.

Constraints honored: no source edits, no plan edits, no DB/container/deploy action, no admin credential use, no commit, no push. This review file is the only intentional write.

## Executive Summary

GalleryKit's public gallery is broadly accessible and visually coherent, but the largest remaining UX fault is still mobile information architecture: the home page spends the first meaningful viewport on tag controls before the visitor reaches photos. Admin photo operations also still look more like a maintenance table than a photo workbench, and one destructive image confirmation regressed behind the stronger target-naming pattern now used for tags/categories. Design quality score: 7/10 for public browsing, 5.5/10 for repeat admin photo operations.

## Inventory First

- Project guidance/docs: supplied `AGENTS.md`, repo `CLAUDE.md`, prior UI reviews at `.context/reviews/ui-ux-designer-reviewer.md`, `.context/reviews/ui-ux-designer-reviewer-cycle13.md`, and `.context/reviews/run9-cycle8/designer.md`.
- UI inventory: 111 UI/source files under `apps/web/src/components` and `apps/web/src/app/[locale]`; 61 component files; 58 app route files; 2 message catalogs.
- Public UI inspected: nav, home, masonry cards, tag filtering, search, photo viewer, lightbox, image zoom, bottom sheet, map, timeline, year, topic, smart collection, shared photo/group, privacy/about, loading/not-found/error routes.
- Admin UI inspected: login, admin header/nav, dashboard, upload dropzone, image manager, bulk edit, categories, tags, SEO, settings, tokens, users, password, DB, analytics, protected loading/error layouts.
- UI support inspected: `globals.css`, theme provider, i18n provider, locale direction helper, UI primitives, touch/focus/i18n/theme/lightbox/source tests.

## Browser And Validation Evidence

- Local browser validation blocker: `npm run dev --workspace=apps/web` and `npm run dev --workspace=apps/web -- -p 3001` both failed because Next reported an existing dev server lock for PID 7042 on `localhost:3000`; `curl http://localhost:3000/en` could not connect. I did not kill the PID or remove `.next/dev` state.
- Agent-browser live read-only checks: `https://gallery.atik.kr/en`, `https://gallery.atik.kr/en/p/348`, mobile `390x844`, desktop `1440x900`, light/dark media. Screenshots captured at `/tmp/gallery-home-mobile.png`, `/tmp/gallery-home-mobile-5s.png`, and `/tmp/gallery-photo-desktop-dark.png`.
- Confirmed mobile home DOM: 30 photo links present; tag group occupied `y=116..316`; first photo link started at `y=348`; no horizontal overflow on tested mobile home.
- Focused tests passed:

```sh
npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/password-form-a11y.test.ts src/__tests__/theme-token-contract.test.ts src/__tests__/lightbox-controls-contract.test.ts src/__tests__/client-source-contracts.test.ts src/__tests__/settings-save-affordance-source.test.ts
```

Result: 8 test files passed, 64 tests passed.

## Findings

### UIUX-C16-01 - Mobile home still puts a full tag-filter wall before photos

- Severity: Medium
- Confidence: High
- Validation: Confirmed with live DOM and source
- Area: information architecture, responsive behavior, keyboard/touch workflow
- Evidence:
  - Live selector: `https://gallery.atik.kr/en`, viewport `390x844`, `[role="group"][aria-label="Filter by tag"]` measured `y=116..316`; first `a[href*="/en/p/"]` started at `y=348`.
  - Source places `TagFilter` before the masonry grid in `HomeClient`: `apps/web/src/components/home-client.tsx:303-305`, grid begins at `apps/web/src/components/home-client.tsx:318-330`.
  - `TagFilter` renders every tag as wrapping chips with no mobile collapse or overflow model: `apps/web/src/components/tag-filter.tsx:62-122`.
- Why this is a problem:
  - A photo gallery's first mobile task is viewing photos. Here, taxonomy controls consume about 200 px before the first image, and keyboard users traverse every chip before photo content.
- Concrete failure scenario:
  - A mobile visitor lands from a social link or searches the gallery, then must scroll or tab through `All`, event tags, and member tags before reaching the first photograph.
- Suggested fix:
  - On mobile, show `All` plus 2-3 top/current tags and move the full taxonomy to a filter sheet, or use a horizontal chip rail with a clear overflow affordance. Preserve `aria-pressed`, 44 px targets, and active-filter summary.

### UIUX-C16-02 - Individual image delete confirmation does not name the image

- Severity: Medium
- Confidence: High
- Validation: Source-confirmed
- Area: error prevention, admin destructive-action UX, accessibility
- Evidence:
  - The row delete button has a target-specific accessible label: `apps/web/src/components/image-manager.tsx:562`.
  - The confirmation dialog title/description are generic and do not receive the current image title/id: `apps/web/src/components/image-manager.tsx:566-570`.
  - English copy is generic at `apps/web/messages/en.json:201-202`; Korean copy is generic at `apps/web/messages/ko.json:201-202`.
  - Tags and categories now use the safer target-naming pattern: `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:145-148` and `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:331-334`.
- Why this is a problem:
  - The highest-risk admin action in the image row still asks "Delete this image?" without naming the asset, even though neighboring admin delete flows now identify the target.
- Concrete failure scenario:
  - An admin opens a delete dialog from a dense table, is interrupted, then returns to a generic dialog and confirms deletion from memory rather than from visible target context.
- Suggested fix:
  - Track the selected image object for delete, not only the id, and interpolate a concise target label into both title and description: `Delete image "#JIHOON... #348"?`. Include filename/id fallback for untitled images.

### UIUX-C16-03 - Admin image management remains table-first instead of photo-workbench-first

- Severity: Medium
- Confidence: Medium-High
- Validation: Source-confirmed; authenticated browser validation not performed
- Area: admin workflow, interaction design, responsive behavior
- Evidence:
  - Dashboard puts recent uploads in a constrained scroll region: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-143`.
  - `ImageManager` renders a horizontally scrollable table: `apps/web/src/components/image-manager.tsx:427-603`.
  - Each row spreads preview, title, filename, topic, tags, gamut, date, and actions across nine columns: `apps/web/src/components/image-manager.tsx:431-451` and `apps/web/src/components/image-manager.tsx:473-589`.
- Why this is a problem:
  - Metadata cleanup is photo-first work. A table separates the image preview, editable tags, and actions across horizontal space, which is slow on laptop and mobile widths.
- Concrete failure scenario:
  - After uploading an event batch, an admin has to scan thumbnails, assign tags, check gamut/HDR, and edit titles while horizontally scrolling a table instead of selecting a photo and editing an inspector.
- Suggested fix:
  - Add a photo workbench mode: grid/list with persistent selection and a right or bottom inspector for title, description, topic, tags, gamut/HDR, date, sharing, and delete. Keep the table as an optional dense list view.

### UIUX-C16-04 - Admin navigation is still a flat ten-link wrap

- Severity: Low-Medium
- Confidence: High from source; admin browser validation not performed
- Validation: Likely issue
- Area: information architecture, responsive behavior, repeat admin efficiency
- Evidence:
  - `AdminNav` defines ten peer destinations in one array: `apps/web/src/components/admin-nav.tsx:15-26`.
  - It renders them as a single wrapping horizontal nav: `apps/web/src/components/admin-nav.tsx:28-49`.
  - `AdminHeader` places this wrap beside the brand and logout action in one flex header: `apps/web/src/components/admin-header.tsx:13-27`.
- Why this is a problem:
  - Content, publishing, security, operations, and analytics all compete at the same level. Wrapped positions change by viewport and locale, weakening spatial memory.
- Concrete failure scenario:
  - On a narrow admin viewport or Korean labels, `Tokens`, `Users`, `DB`, and `Analytics` wrap into new positions, so repeat operational tasks require re-scanning the header.
- Suggested fix:
  - Group destinations into stable sections: Content, Publishing, Access, Operations, Insights. Use a sectioned drawer/menu at narrow widths instead of allowing every destination to wrap.

### UIUX-C16-05 - Desktop info-sidebar animation is slow for a high-frequency viewer toggle

- Severity: Low
- Confidence: Medium
- Validation: Source-confirmed; not timing-measured locally due dev-server blocker
- Area: interaction design, perceived performance
- Evidence:
  - The `I` shortcut toggles the desktop info sidebar: `apps/web/src/components/photo-viewer.tsx:410-418`.
  - The sidebar uses a 500 ms opacity/transform transition: `apps/web/src/components/photo-viewer.tsx:747-756`.
  - Global reduced-motion CSS collapses transition duration for users who request it: `apps/web/src/app/[locale]/globals.css:253-261`, so this is normal-mode perceived performance, not a reduced-motion failure.
- Why this is a problem:
  - Metadata inspection is a common photo-viewing task. A half-second transition makes the UI feel slower than the keypress that requested it.
- Concrete failure scenario:
  - A desktop visitor or admin presses `I` repeatedly while checking camera, lens, color, and map metadata across photos; the UI spends visible time animating instead of feeling instant.
- Suggested fix:
  - Reduce the sidebar transition to 150-200 ms, or make the grid snap and only fade small internal metadata. Keep the existing reduced-motion override.

### UIUX-C16-06 - RTL support is only structural, not design-validated

- Severity: Low
- Confidence: Medium
- Validation: Manual-validation risk, not a current en/ko defect
- Area: i18n/RTL, layout resilience
- Evidence:
  - Layout emits `dir={getLocaleDirection(locale)}` and comments that this future-proofs RTL: `apps/web/src/app/[locale]/layout.tsx:101-107`.
  - Only LTR locales are shipped: `apps/web/src/lib/constants.ts:1-4`.
  - `RTL_LOCALES` is empty and unsupported locale strings fall back to LTR: `apps/web/src/lib/locale-path.ts:37-40`; tests assert `getLocaleDirection('ar')` returns `ltr`: `apps/web/src/__tests__/locale-path.test.ts:73-81`.
  - Many UI regions still use physical left/right utilities and icons, e.g. nav margins `apps/web/src/components/nav-client.tsx:100,112,148,180`, lightbox controls `apps/web/src/components/lightbox.tsx:582-670`, and admin header spacing `apps/web/src/components/admin-header.tsx:15-21`.
- Why this is a problem:
  - There is no current RTL locale bug because GalleryKit only supports English and Korean. The risk is that the HTML-level `dir` hook can make RTL look supported before physical positioning, icon direction, and focus order have been audited.
- Concrete failure scenario:
  - A future Arabic locale is added to `LOCALES`; `dir="rtl"` flips text flow, but left/right-positioned controls, chevrons, margins, and admin table alignment remain LTR.
- Suggested fix:
  - Treat adding an RTL locale as a design task: replace physical classes with logical utilities where possible, mirror directional icons, and add RTL Playwright screenshots for home, photo, search, admin dashboard, and forms.

## Coverage By Requested Area

- Information architecture: C16-01, C16-03, C16-04.
- Visual design: public gallery remains coherent; no new color-token or spacing-system defect found. Mobile first viewport hierarchy remains weak due C16-01.
- Interaction/workflow: C16-03 and C16-05 cover admin/photo workflow speed; photo viewer shortcuts are present on live `/en/p/348`.
- Accessibility: focused touch/focus/i18n/password/theme/lightbox/source tests passed. C16-02 is an error-prevention issue, not a raw WCAG control-name failure.
- Responsive behavior: C16-01 and C16-04.
- Dark/light: theme tokens and reduced-motion CSS are present; dark photo viewer smoke checked on live `/en/p/348`.
- i18n/RTL: en/ko parity passed; RTL is documented as a future/manual risk in C16-06.
- Loading/empty/error states: loading, empty, and route-error surfaces exist and were source-reviewed; no new source-backed defect filed.
- Focus/keyboard: skip link, focus-visible checks, lightbox shortcuts, and normal viewer shortcut metadata are in place; no reopened mobile nav focus-order issue.
- Touch targets: audit passed; tag chips, nav controls, and image-manager row controls meet the 44 px floor in source/tests.
- Perceived performance: C16-05; masonry uses `content-visibility` and sized derivatives, so no new grid-performance finding filed.

## Verified Good / Not Reopened

- Mobile nav focus order is fixed in source: controls render before the expand toggle, with comments at `apps/web/src/components/nav-client.tsx:145-174`.
- Settings has both top and bottom save actions now: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:339-350` and `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:878-891`.
- Tag and category delete dialogs now name the target: `tag-manager.tsx:145-148`, `topic-manager.tsx:331-334`.
- Search result ids were previously fixed and source keeps structured `role="option"` rows; I did not get a stable agent-browser search-dialog interaction this pass, so I did not re-file or close anything new there.
- Normal photo viewer previous/next controls expose `aria-keyshortcuts`: `apps/web/src/components/photo-navigation.tsx:313-329`.
- Reduced-motion CSS globally reduces animation/transition duration and suppresses masonry hover scale: `apps/web/src/app/[locale]/globals.css:253-279`.

## Competitive UX Comparison

| Feature | Lightroom / Photo Mechanic baseline | GalleryKit current | Verdict |
| --- | --- | --- | --- |
| Mobile browse-first hierarchy | Photos first, filters secondary | Full tag wall before first photo | Worse |
| Admin batch metadata workflow | Grid/filmstrip plus inspector | Horizontal table with inline controls | Missing workbench |
| Destructive confirmation | Names target or scope | Image delete is generic; tag/category fixed | Partial |
| Keyboard photo navigation | Arrow keys discoverable | Arrow shortcuts work and are exposed | Same for basic viewing |
| Metadata panel toggle | Fast, stable panel behavior | 500 ms sidebar transition | Slower |
| RTL readiness | Requires explicit localized design pass | Structural `dir` hook only; no RTL locale | Manual risk |

## Design System Assessment

GalleryKit has a real design-system layer: shadcn/Radix primitives, Tailwind tokens, button variants with enforced 44 px floors, theme tokens, focus-visible patterns, and source tests. The main system gaps are product-level composition, not component primitives: mobile filters need a compact pattern, admin needs grouped navigation and a photo workbench pattern, and destructive dialogs should consistently name targets.

## Prioritized Recommendations

- Tier 0: None found that blocks public browsing or basic admin operation.
- Tier 1: Fix mobile tag-filter hierarchy; name the individual image in delete confirmations; design an admin photo workbench.
- Tier 2: Group admin navigation into stable sections; shorten the desktop info sidebar transition.
- Tier 3: Treat RTL as unsupported until a full logical-layout/icon/focus-order audit is done.

## Final Sweep

I swept ARIA/roles, focus indicators, keyboard shortcuts, touch targets, modal/focus-trap patterns, loading/empty/error states, public English/Korean routes, mobile responsiveness, theme/reduced-motion CSS, admin forms/tables/nav/settings/tokens/upload surfaces, prior UX reports, and common missed patterns (`role="button"`, `tabIndex`, physical direction classes, generic destructive copy). Authenticated admin browser validation was not performed because no credentials were used and local app validation was blocked by stale Next dev state.

Final verdict: the public gallery helps visitors browse photos once they reach the grid, but the mobile entry hierarchy still gets in the way. The admin UI is functional and increasingly accessible, but it needs photo-workbench IA before it feels designed for repeat photo operations rather than database maintenance.
