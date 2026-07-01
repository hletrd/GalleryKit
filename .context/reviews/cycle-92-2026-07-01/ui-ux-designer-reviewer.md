# Cycle 92 UI/UX Designer Reviewer — Photographer/Admin UX

Date: 2026-07-01 requested cycle path; review executed 2026-07-02 KST.
Role lens: focused photographer/admin UX, mobile ergonomics, touch targets, image viewing, admin flows, accessibility, Korean/English i18n, and visual consistency.

## Inventory built first

Project context read first:
- `AGENTS.md` and `CLAUDE.md` were read. Relevant constraints: GalleryKit is a photographer-first Next.js app; touch targets must be ≥44 px; color/HDR surfaces must preserve the photographer's edited intent; Korean/English i18n is first-class; no edit/culling/scoring features.
- Runtime/browser evidence was attempted where feasible, but the local checkout has no `apps/web/.env.local` (`apps/web/.env.local.example` only), and Playwright loads `.env.local`/external secrets from `apps/web/playwright.config.ts:5-13` while DB-backed helpers throw without `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in `apps/web/e2e/helpers.ts:89-109`. I therefore used source-backed DOM/ARIA evidence plus static tests rather than an interactive browser session.
- `omx explore` was attempted as the first read-only lookup surface, but it failed in this sandbox before returning repo facts, so I fell back to direct source inspection.

Route/component inventory reviewed:
- Public route surfaces: `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `s/[key]/page.tsx`, `g/[key]/page.tsx`, `c/[slug]/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`, `map/page.tsx`, `privacy/page.tsx`, and public layout/error/not-found files.
- Admin route surfaces: dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics, login, protected layout/error.
- UI components reviewed: `home-client`, `photo-viewer`, `photo-navigation`, `image-zoom`, `lightbox`, `lightbox-color-pip`, `info-bottom-sheet`, `color-details-section`, `wide-gamut-hint`, `histogram`, `image-manager`, `bulk-edit-dialog`, `upload-dropzone`, `admin-header`, `admin-nav`, `admin-user-manager`, `search`, `tag-filter`, `tag-input`, `nav-client`, `load-more`, and core UI primitives.
- i18n/testing surfaces reviewed: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `touch-target-audit.test.ts`, `i18n-key-parity.test.ts`, `a11y-us-p15.test.ts`, `focus-visible-rings-cycle20.test.ts`, and `switch-geometry-contract.test.ts`.

## Validation evidence

- Targeted UX/accessibility/i18n/touch test gate passed:
  - Command: `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/a11y-us-p15.test.ts src/__tests__/focus-visible-rings-cycle20.test.ts src/__tests__/switch-geometry-contract.test.ts`
  - Result: 5 files passed, 37 tests passed.
- Touch-target guard is broad: it scans components, admin routes, public routes, and app-level route files in `apps/web/src/__tests__/touch-target-audit.test.ts:42-83`, then fails on new violations in `apps/web/src/__tests__/touch-target-audit.test.ts:740-803`.
- Korean/English key parity is gated by `apps/web/src/__tests__/i18n-key-parity.test.ts:43-66`; an additional quick count returned `en: 850`, `ko: 850`, `missingKo: []`, `missingEn: []`.
- A rough source sweep for visible hardcoded English found only comment/type false positives; no confirmed untranslated visible-string issue was found in this pass.

## Executive summary

The current UI has strong baseline guardrails: no confirmed 44 px touch-target regression, no confirmed Korean/English key drift, and the photographer-facing color/HDR surfaces are intentionally represented in both desktop and mobile viewers. The highest-confidence UX gaps are not individual tiny controls; they are mobile admin information architecture and mobile admin table ergonomics. The main likely photographer-viewing risk is gesture arbitration between swipe navigation and zoom/pinch interactions.

## Confirmed issues

### C92-UX-01 — Admin image management is still desktop table-first on mobile

Severity: **Medium**
Confidence: **High**
Type: **Confirmed source-backed issue**

Evidence:
- The dashboard places recent uploads in a constrained scroll container and renders `ImageManager` directly: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`.
- `ImageManager` renders a horizontally scrollable table, not a responsive card/list layout: `apps/web/src/components/image-manager.tsx:424-450`.
- The table requires many columns for preview, title, filename, topic, tags, gamut, date, and actions: `apps/web/src/components/image-manager.tsx:441-448`.
- Each row includes a 128 px preview cell: `apps/web/src/components/image-manager.tsx:470-486`.
- The tags column alone reserves `min-w-[200px]` and embeds `TagInput`: `apps/web/src/components/image-manager.tsx:498-531`.
- Actions are at the far right of the row: `apps/web/src/components/image-manager.tsx:551-586`.

Why it matters:
- Touch targets are large enough, but a photographer/admin triaging uploads on a phone must horizontally pan across a dense table to review metadata and reach row actions.
- This is especially costly for post-shoot workflows where title/topic/tag/gamut status and edit/delete actions need to be checked repeatedly.

Recommended fix:
- Add a mobile-first card/list layout under `lg` for image rows: preview, title/filename, topic/tags/gamut, date, and primary actions in one vertical card.
- Keep the table for desktop; do not remove existing bulk-selection affordances.
- Make edit/delete row actions visible without horizontal scroll on mobile.

### C92-UX-02 — Mobile admin navigation is a flat 10-link wrap in the header

Severity: **Medium**
Confidence: **High**
Type: **Confirmed source-backed issue**

Evidence:
- `AdminNav` defines 10 same-level destinations: dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics in `apps/web/src/components/admin-nav.tsx:15-26`.
- The nav is a wrapping flex row: `apps/web/src/components/admin-nav.tsx:28-49`.
- Each link correctly has a 44 px minimum target, which increases wrap height on narrow screens: `apps/web/src/components/admin-nav.tsx:37-43`.
- `AdminHeader` puts brand, the full `AdminNav`, and logout into the same wrapping top bar: `apps/web/src/components/admin-header.tsx:13-27`.

Why it matters:
- The 44 px policy is satisfied, but on mobile the header becomes a large control wall before the admin reaches the upload/recent-uploads task.
- Low-frequency maintenance routes (`DB`, `Tokens`, `Password`, `SEO`, `Analytics`) compete visually with high-frequency upload/organize actions.

Recommended fix:
- Collapse low-frequency admin routes behind a grouped “More”/“Maintenance” menu or a mobile drawer.
- Keep primary routes visible: Dashboard/Upload, Categories/Tags, and possibly Settings.
- Preserve `aria-current` and 44 px targets; this is an information-architecture issue, not a target-size issue.

## Likely issues

### C92-UX-L1 — Photo swipe navigation can compete with zoom/pinch direct manipulation

Severity: **Medium**
Confidence: **Medium**
Type: **Likely source-backed interaction risk; browser/device validation still needed**

Evidence:
- `PhotoViewer` attaches `PhotoNavigation` to the same media container that wraps `ImageZoom`: `apps/web/src/components/photo-viewer.tsx:667-675` and `apps/web/src/components/photo-viewer.tsx:701-704`.
- `PhotoNavigation` adds native touch listeners to the parent swipe target and begins horizontal navigation state when horizontal movement exceeds 10 px: `apps/web/src/components/photo-navigation.tsx:59-116`.
- It navigates when the horizontal delta crosses the 80 px threshold: `apps/web/src/components/photo-navigation.tsx:118-146`.
- `ImageZoom` handles two-finger pinch and one-finger pan inside React touch handlers, using `stopPropagation()`/`preventDefault()` once zoom/pinch state is active: `apps/web/src/components/image-zoom.tsx:232-303`.
- `ImageZoom` switches `touchAction` only after `isZoomed` is true: `apps/web/src/components/image-zoom.tsx:346-365`.

Why it matters:
- The photographer's core viewer task is direct manipulation: pinch to inspect focus/detail, pan the crop, then swipe to compare adjacent frames. Because the parent navigation uses native listeners and the child uses React handlers, there is a plausible race where the parent records movement before the child fully owns the gesture.
- The risk is highest during pinch start/end and single-finger pan after zooming, where an accidental horizontal swipe could navigate away from the inspected image.

Recommended fix:
- Expose zoom/pinch/drag state from `ImageZoom` to `PhotoViewer`, then disable `PhotoNavigation` while zoom level > 1, while pinching, or while dragging.
- Also ignore parent swipe handling when `TouchEvent.touches.length > 1` or when the initial target is inside an active zoom surface.
- Validate on iOS Safari and Android Chrome with: single-finger swipe, double-tap zoom, two-finger pinch, pan while zoomed, and pinch-release followed by swipe.

## Manual-validation risks

### C92-UX-MV1 — Mobile home/tag filtering may push photos below a chip wall on tag-heavy libraries

Severity: **Medium when tag count is high; Low otherwise**
Confidence: **Medium**
Type: **Manual-validation risk**

Evidence:
- The home heading/count and `TagFilter` render before the photo grid: `apps/web/src/components/home-client.tsx:255-286`.
- The tag filter renders all tag chips in one wrapping group: `apps/web/src/components/tag-filter.tsx:62-123`.
- Each chip intentionally meets the 44 px floor with `min-h-11 min-w-11`: `apps/web/src/components/tag-filter.tsx:64-79` and `apps/web/src/components/tag-filter.tsx:81-120`.

Risk:
- This is good for touch access, but a large tag set can occupy the first viewport on a phone before any photograph appears.

Validation/fix direction:
- Validate with production-like tag counts in Korean and English.
- If the first photo falls below the initial viewport, consider a horizontally scrollable chip rail, a “Filter” disclosure, or a compact selected-tags summary while preserving 44 px hit areas.

### C92-UX-MV2 — Mobile masonry title overlay is always visible at the top of photos

Severity: **Low to Medium**
Confidence: **Medium**
Type: **Manual-validation risk**

Evidence:
- Mobile cards render a permanent top gradient/title/topic overlay: `apps/web/src/components/home-client.tsx:399-404`.
- Desktop instead uses a bottom overlay revealed on hover/focus: `apps/web/src/components/home-client.tsx:405-410`.

Risk:
- Permanent context is useful, but top overlays can obscure important photographic content such as faces, skies, architecture lines, or intentional negative space.

Validation/fix direction:
- Review real production galleries at 360 px and 390 px widths.
- If the overlay frequently covers subject matter, move the mobile overlay to the bottom, reduce its default opacity, or make metadata reveal on focus/tap while keeping accessible names intact.

### C92-UX-MV3 — DB restore progress/announcement should be manually validated for long-running admin flows

Severity: **Low to Medium**
Confidence: **Medium**
Type: **Manual-validation risk**

Evidence:
- Restore closes the confirm dialog, sets `pendingAction`, starts the restore, and reloads on success: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:76-100`.
- The restore button label changes during `pendingAction === 'restore'`: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:206-214`.
- The code comment explicitly chooses to close the modal during the potential multi-minute restore and relies on page-level progress/button label: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:222-229`.

Risk:
- The chosen interaction may be reasonable, but a long restore should be manually checked with keyboard and screen-reader users to ensure there is a persistent, announced “restore in progress” state after the dialog disappears.

Validation/fix direction:
- Validate with a large restore file and VoiceOver/NVDA.
- If announcement is weak, add a visible `role="status"`/`aria-live="polite"` region near the restore controls while pending.

## Positive checks / non-issues confirmed in this lane

- **Touch target floor:** Button primitives define `min-h-11`, `size-11`, or larger sizes in `apps/web/src/components/ui/button.tsx:23-30`; switch root exposes a 44 px tap area while keeping a normal visual track in `apps/web/src/components/ui/switch.tsx:24-54`. The targeted touch audit passed.
- **Mobile photo metadata sheet:** The bottom sheet uses `FocusTrap`, `role="dialog"`, `aria-modal`, and a localized label in `apps/web/src/components/info-bottom-sheet.tsx:195-209`; it accounts for `95dvh`/safe-area padding in `apps/web/src/components/info-bottom-sheet.tsx:215-219`; drag/close controls have 44 px hit areas in `apps/web/src/components/info-bottom-sheet.tsx:223-254`.
- **Photographer color/HDR surfaces:** Mobile bottom sheet includes `ColorDetailsSection`, `WideGamutHint`, and a histogram before EXIF in `apps/web/src/components/info-bottom-sheet.tsx:321-341`; color detail controls have 44 px targets and localized labels in `apps/web/src/components/color-details-section.tsx:303-344`; lightbox color pip exposes P3/HDR/color metadata with 44 px controls in `apps/web/src/components/lightbox-color-pip.tsx:161-196` and `apps/web/src/components/lightbox-color-pip.tsx:290-317`.
- **i18n parity:** `en.json` and `ko.json` leaf-key sets match; the parity test intentionally compares keys only, not values, to allow Korean fixed count forms in `apps/web/src/__tests__/i18n-key-parity.test.ts:16-20` and `apps/web/src/__tests__/i18n-key-parity.test.ts:43-66`.

## Final missed-issue sweep

- Re-ran targeted touch/i18n/a11y/focus/switch tests: all passed.
- Re-swept visible hardcoded text candidates; only comment/type false positives were returned.
- Rechecked current cycle sibling reports for UI-adjacent overlap. The code-reviewer restore-maintenance finding is security/consistency focused, not duplicated here except for the separate manual progress-announcement UX risk.
- No additional confirmed UI/UX issue was found with the available source-backed evidence.

## Report-only stop condition

This lane wrote only this requested report file: `.context/reviews/cycle-92-2026-07-01/ui-ux-designer-reviewer.md`. No code, tests, messages, or config files were intentionally modified.
