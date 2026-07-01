# Cycle 83 Designer / Accessibility / Photographer UX Review

Reviewed HEAD: `cc46b1d69c11cb175c88df69f17cbe526d23aa0d`.
Date: 2026-07-01.

## Scope

- Role lane: designer/accessibility/photographer-facing UX review.
- Write constraint honored: no source edits; only this review artifact was written.
- Required context read: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/cycle-82/_aggregate.md`, `.context/plans/cycle-82-2026-07-01-plan.md`, `.context/plans/cycle-82-2026-07-01-deferred.md`, and the Cycle 82 designer review.
- Current focus: public search, similar photos, map, photo viewer/lightbox/mobile info sheet, color/HDR honesty surfaces, admin failed-image retry UX, touch-target/focus contracts, and English/Korean i18n for changed surfaces.

## Findings

No new confirmed designer/accessibility/photographer-facing UX findings.

## Evidence And Inventory

- Cycle 82 baseline: the prior aggregate scheduled search/similar result-label normalization and failed-image retry accessible-name fixes (`C82-02`, `C82-03`) at `.context/reviews/cycle-82/_aggregate.md:27` and `.context/reviews/cycle-82/_aggregate.md:37`. The Cycle 82 plan required helper coverage and retry `aria-label` / `aria-describedby` coverage at `.context/plans/cycle-82-2026-07-01-plan.md:24` and `.context/plans/cycle-82-2026-07-01-plan.md:25`.
- Search result labels now route through `getPhotoResultLabel(image, localized Photo id)` before rendering the result text, with decorative thumbnails hidden from AT: `apps/web/src/components/search.tsx:71`, `apps/web/src/components/search.tsx:88`, `apps/web/src/components/search.tsx:104`. The search dialog keeps combobox/listbox wiring, active-descendant management, live status, and 44 px open/close controls: `apps/web/src/components/search.tsx:376`, `apps/web/src/components/search.tsx:424`, `apps/web/src/components/search.tsx:440`, `apps/web/src/components/search.tsx:481`, `apps/web/src/components/search.tsx:491`.
- Similar-photo thumbnails now use the same result-label helper with a localized id fallback, and the link carries a stable accessible name plus 44 px minimum target: `apps/web/src/components/similar-photos.tsx:183`, `apps/web/src/components/similar-photos.tsx:228`, `apps/web/src/components/similar-photos.tsx:230`, `apps/web/src/components/similar-photos.tsx:232`, `apps/web/src/components/similar-photos.tsx:236`.
- The shared label helper rejects blank/filename-like titles, preserves meaningful descriptions, and trims labels: `apps/web/src/lib/photo-title.ts:85`, `apps/web/src/lib/photo-title.ts:89`, `apps/web/src/lib/photo-title.ts:94`. Unit coverage pins those cases at `apps/web/src/__tests__/photo-title.test.ts:92`.
- Failed-image retry rows derive a per-row label from title, original filename, or id; the retry button uses localized per-row `aria-label` and `aria-describedby` for the processing error when present: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:39`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:85`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:112`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:122`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123`. Source-contract coverage pins this at `apps/web/src/__tests__/failed-image-retry.test.ts:152`.
- Changed English/Korean retry strings are present and matched in intent: `apps/web/messages/en.json:73`, `apps/web/messages/en.json:74`, `apps/web/messages/ko.json:73`, `apps/web/messages/ko.json:74`.
- Public map labels continue to use the meaningful photo-title helper, with skip link, map instructions, accessible list fallback, and popup button labels: `apps/web/src/app/[locale]/(public)/map/page.tsx:60`, `apps/web/src/app/[locale]/(public)/map/page.tsx:75`, `apps/web/src/app/[locale]/(public)/map/page.tsx:81`, `apps/web/src/app/[locale]/(public)/map/page.tsx:93`, `apps/web/src/components/map/map-client.tsx:126`, `apps/web/src/components/map/map-client.tsx:130`.
- Photo viewer and mobile sheet keep meaningful alt/display-title paths, keyboard shortcuts guarded from editable targets, visible/focusable controls at 44 px, and color/HDR honesty surfaces: `apps/web/src/components/photo-viewer.tsx:34`, `apps/web/src/components/photo-viewer.tsx:371`, `apps/web/src/components/photo-viewer.tsx:426`, `apps/web/src/components/photo-viewer.tsx:537`, `apps/web/src/components/photo-viewer.tsx:562`, `apps/web/src/components/info-bottom-sheet.tsx:149`, `apps/web/src/components/info-bottom-sheet.tsx:223`, `apps/web/src/components/color-details-section.tsx:144`, `apps/web/src/components/color-details-section.tsx:194`, `apps/web/src/components/color-details-section.tsx:303`.
- Touch-target and focus-visible guardrails inventory: 44 px audit scans components, admin routes, public routes, and app-level route files at `apps/web/src/__tests__/touch-target-audit.test.ts:79`; focus-visible scanner covers `components/` and the full `app/` tree at `apps/web/src/__tests__/focus-visible-links-scan.test.ts:56`. The search combobox role-option exception is documented and bounded at `apps/web/src/__tests__/focus-visible-links-scan.test.ts:71`.
- Cycle 82 recorded gate evidence shows the focused regression suite, lint, auth/action/rate-limit lint, typecheck, build, and full Vitest passed before the current HEAD: `.context/plans/cycle-82-2026-07-01-plan.md:54` through `.context/plans/cycle-82-2026-07-01-plan.md:61`.

## Deferred Not Re-Raised

- I did not re-raise the known deferred items in `.context/plans/cycle-82-2026-07-01-deferred.md:12` through `.context/plans/cycle-82-2026-07-01-deferred.md:17`: site-config runtime/build contract, restore foreground mutation barrier, bottom-sheet dropdown portal runtime coverage, processed-predicate coverage, bulk-edit validation alert association, and historical carry-forward items.

## Validation

- Source/DOM-accessibility evidence only; no screenshots used.
- I did not run the full gate suite in this review lane. The prompt says gates are required later and this lane is write-limited to the review artifact.
