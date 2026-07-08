# Run-10 Cycle 29/100 Designer UI/UX Accessibility Review

Date: 2026-07-08 KST  
Reviewed HEAD: `f4faad29`  
Scope: fresh current-HEAD UI/UX/a11y review for the Next.js photo gallery UI, covering WCAG 2.2, the repo 44 px touch-target policy, keyboard/focus, ARIA, responsive states, loading/empty/error states, i18n, photo-viewing honesty, and admin/public workflows.

## Inventory

Project rules and current-cycle context inspected:

- `CLAUDE.md:670-680` documents the test surface; `CLAUDE.md:706-729` defines the 44 x 44 px target policy and audit scope.
- `.context/plans/archive/75-deferred-cycle29.md:8-17` has no current UI/a11y deferred item beyond carry-forward.
- `.context/reviews/run10-cycle29/test-engineer-verifier.md:38-100` records new test-gate findings, not UI rendering defects.
- Prior UI items checked for duplication: `.context/reviews/run10-cycle28/designer.md` nested-main restore finding is fixed at `apps/web/src/components/public-restore-maintenance.tsx:8-14`; historical zoom-keyboard and admin responsive table risks remain deferred, not newly counted.

Public UI surfaces inspected:

- Main navigation: `apps/web/src/components/nav-client.tsx:92-195` has named nav, 44 px home/topic/control targets, active `aria-current`, and mobile disclosure wiring.
- Search dialog: `apps/web/src/components/search.tsx:383-397` trigger; `apps/web/src/components/search.tsx:422-572` modal focus trap, combobox semantics, live results/empty state, and semantic-search honesty copy.
- Photo viewer: `apps/web/src/components/photo-viewer.tsx:570-755` heading strategy, toolbar controls, mobile info trigger, navigation, image loading/blur state, and position live region.
- Mobile info sheet: `apps/web/src/components/info-bottom-sheet.tsx:255-325` focus trap, dialog semantics, trigger/close targets, and 44 px drag handle.
- Lightbox: `apps/web/src/components/lightbox.tsx:490-725` dialog semantics, focus trap, keyboard shortcuts, live counters, 44 px controls, and color pip integration.
- Color/HDR honesty surfaces: `apps/web/src/components/lightbox-color-pip.tsx:167-205`, `apps/web/src/components/color-details-section.tsx:303-550`, and `apps/web/src/components/histogram.tsx:656-755`.
- Shared and map routes: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:149-263`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:122-149`, `apps/web/src/app/[locale]/(public)/map/page.tsx:81-111`, and `apps/web/src/components/map/map-client.tsx:121-140`.

Admin workflow surfaces inspected:

- Admin nav and dashboard flow: `apps/web/src/components/admin-nav.tsx:29-49`; `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:71-184`.
- Upload and image management: `apps/web/src/components/upload-dropzone.tsx:436-590`; `apps/web/src/components/image-manager.tsx:321-410` and `apps/web/src/components/image-manager.tsx:520-590`.
- Analytics and settings/tokens spot checks: `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:75-103`, `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:226-263`, and the previously inspected settings/token form error and focus paths.

Regression/tests inspected:

- `apps/web/src/__tests__/touch-target-audit.test.ts:42-88` scan roots; `apps/web/src/__tests__/touch-target-audit.test.ts:117-249` documented exemptions and current 44 px primitive notes.
- `apps/web/src/__tests__/image-zoom-source-contracts.test.ts:7-23` keyboard-toggle source contract; `apps/web/src/__tests__/image-zoom-source-contracts.test.ts:25-43` drag-pan math contracts.

## Validation Evidence

- `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/image-zoom-source-contracts.test.ts src/__tests__/lightbox-controls-contract.test.ts src/__tests__/info-bottom-sheet-ia.test.ts` passed: 5 files, 37 tests.
- Static source review found no fresh 44 px touch-target regression in the scanned public/admin/component surfaces.
- Static ARIA/focus review found current dialog/disclosure wiring for search, lightbox, mobile info sheet, nav, color details, map/list fallback, and shared photo viewer.
- I did not run browser/aXe checks. The local source/tests were sufficient for this review lane, and spinning a seeded visual/browser environment would have added setup risk without a specific suspect flow. I did not rely on screenshots.

## Findings

No new current-HEAD UI/UX/a11y findings for Cycle 29.

## Carried-Forward Context, Not Counted As New

### C94-06 / C93-09 - Zoomed photos remain keyboard-toggleable but not keyboard-pannable

Severity: Medium  
Confidence: High  
Status: already deferred; not refiled as a fresh Cycle 29 finding.

Regions:

- `apps/web/src/components/image-zoom.tsx:121-165` implements mouse drag pan.
- `apps/web/src/components/image-zoom.tsx:238-319` implements touch pinch/single-finger pan.
- `apps/web/src/components/image-zoom.tsx:206-214` and `apps/web/src/components/image-zoom.tsx:391-395` implement keyboard zoom toggle only.
- `apps/web/src/components/photo-viewer.tsx:400-431` reserves arrow keys for previous/next photo navigation.
- `.context/plans/cycle-95-2026-07-01-deferred.md:34-39` and `.context/plans/deferred-carry-forward.md:128-134` preserve the exit criteria.

Concrete failure scenario:

A keyboard-only visitor focuses the photo, presses Enter/Space to zoom, then cannot inspect off-center details. Pointer and touch users can drag/pinch-pan, while ArrowLeft/ArrowRight still navigate photos rather than pan the zoomed image.

Fix:

Add an explicit keyboard zoom mode: while zoomed and focused, Arrow keys pan via `clampPan`, prevent parent slide navigation, Escape exits/reset zoom, and a visible or sr-only instruction explains the mode. Add focused accessibility tests for pan keys and parent-navigation suppression.

### AGG-C21-24 / AGG-C17-21 - Admin image management remains table-first on narrow screens

Severity: Medium  
Confidence: High  
Status: already deferred; not refiled as a fresh Cycle 29 finding.

Regions:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144` places Recent Uploads inside a constrained scroll pane.
- `apps/web/src/components/image-manager.tsx:321-410` has the sticky bulk toolbar.
- `apps/web/src/components/image-manager.tsx:520-590` keeps row-level tags, color state, date, edit, and delete actions in a table layout.
- `.context/plans/cycle-21-2026-06-30-deferred.md:23` and `.context/plans/cycle-17-2026-07-08-deferred.md:28` preserve the responsive admin redesign exit criteria.

Concrete failure scenario:

An admin using a phone or small tablet reviews recent uploads, then must horizontally pan a dense table while keeping thumbnail/title, tags, color state, and destructive actions associated with the same row.

Fix:

When admin mobile becomes a priority, replace the narrow-screen table with photo cards or a split workbench layout where thumbnail, metadata, tags, and actions remain in one visible row/card context. Keep the current table for desktop if desired.

## Notable Non-Findings

- The Cycle 28 restore-maintenance nested-main issue is fixed: `PublicRestoreMaintenance` now returns a neutral wrapper plus `section role="status"` at `apps/web/src/components/public-restore-maintenance.tsx:8-14`, and the public home route returns it before DB-backed page content at `apps/web/src/app/[locale]/(public)/page.tsx:155-160`.
- Public photo-viewing honesty is preserved: public color details show delivered bit depth/formats from public-safe fields, while transfer function, pipeline decision, source bit depth, matrix, downscale, and HDR badge remain admin-gated in `apps/web/src/components/color-details-section.tsx:384-550` and `apps/web/src/components/lightbox-color-pip.tsx:174-195`.
- Shared photo/group pages avoid duplicate top-level headings by rendering their own visible `<h1>` and passing `showDocumentHeading={false}` to `PhotoViewer` at `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:155-174` and `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:129-149`.
- The map page has a keyboard skip link and accessible list fallback at `apps/web/src/app/[locale]/(public)/map/page.tsx:81-111`; marker popups use 44 px buttons with localized labels at `apps/web/src/components/map/map-client.tsx:129-140`.

## Summary

New findings: 0.

- High: 0
- Medium: 0
- Low: 0
