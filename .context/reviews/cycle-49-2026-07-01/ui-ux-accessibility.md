# Cycle 49 UI/UX Accessibility Review

## Inventory

Required context examined:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-48-2026-07-01/_aggregate.md`
- `.context/plans/cycle-48-2026-07-01-plan.md`
- `.context/plans/cycle-48-2026-07-01-deferred.md`

Frontend surfaces examined:

- Public gallery routes: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`, `apps/web/src/app/[locale]/(public)/layout.tsx`
- App states: `apps/web/src/app/[locale]/loading.tsx`, `apps/web/src/app/[locale]/error.tsx`, `apps/web/src/app/[locale]/admin/(protected)/error.tsx`, `apps/web/src/app/global-error.tsx`
- Photo viewing workflow: `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/lightbox-color-pip.tsx`, `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/components/color-details-section.tsx`
- Gallery browsing/search/filtering: `apps/web/src/components/home-client.tsx`, `apps/web/src/components/grid-picture.tsx`, `apps/web/src/components/grid-picture-fallback-boundary.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/tag-filter.tsx`, `apps/web/src/components/nav.tsx`, `apps/web/src/components/nav-client.tsx`
- Admin/media management surfaces: `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/tag-input.tsx`, `apps/web/src/components/admin-nav.tsx`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- Map UI: `apps/web/src/components/map/map-client.tsx`
- Styling and forced-colors/reduced-motion/HDR hooks: `apps/web/src/app/[locale]/globals.css`
- UI/accessibility guard tests: `apps/web/src/__tests__/touch-target-audit.test.ts`, `apps/web/src/__tests__/focus-visible-links-scan.test.ts`, `apps/web/src/__tests__/a11y-us-p15.test.ts`, `apps/web/src/__tests__/lightbox.test.ts`, `apps/web/src/__tests__/lightbox-controls-contract.test.ts`, `apps/web/src/__tests__/grid-picture-fallback-boundary.test.ts`, `apps/web/src/__tests__/picture-fallback-contract.test.ts`, `apps/web/src/__tests__/info-bottom-sheet-ia.test.ts`, `apps/web/src/__tests__/privacy-page-landmark.test.ts`

## Findings

No new UI/UX/accessibility findings.

## Evidence

- Targeted verification passed:
  - `npm test --workspace=apps/web -- touch-target-audit.test.ts focus-visible-links-scan.test.ts a11y-us-p15.test.ts lightbox.test.ts lightbox-controls-contract.test.ts grid-picture-fallback-boundary.test.ts picture-fallback-contract.test.ts info-bottom-sheet-ia.test.ts privacy-page-landmark.test.ts`
  - Result: 9 test files passed, 65 tests passed.
- Touch-target coverage remains actively enforced by `apps/web/src/__tests__/touch-target-audit.test.ts`, including component, admin, public-route, and app-level scans. Existing documented exceptions were not re-raised as new findings.
- Focus-visible coverage remains actively enforced by `apps/web/src/__tests__/focus-visible-links-scan.test.ts`, including interactive links, buttons, role-option exceptions, and file coverage checks.
- Core a11y contracts are covered by `apps/web/src/__tests__/a11y-us-p15.test.ts`, including skip link/main target, error recovery target, lightbox semantics, load-more live region, reduced-motion CSS, home image alt text, and SEO form hints.
- Photo-viewer code review found current protections for editable-target shortcut suppression, neighbor image preloading, gamut data attributes, responsive info-sheet state, skip target, focus-visible toolbar controls, and fallback image handling in `apps/web/src/components/photo-viewer.tsx`.
- Lightbox code review found current protections for dialog semantics, focus restoration, scroll lock, keyboard navigation, touch swipe, auto-hide control focus preservation, fullscreen/play/pause labels, reduced-motion-aware behavior, and picture fallback handling in `apps/web/src/components/lightbox.tsx`.
- Gallery browsing code review found current empty/filter states, load-more live region/toast status, card labels, P3/HDR badges, and responsive masonry/perceived-performance hooks in `apps/web/src/components/home-client.tsx`, `apps/web/src/components/load-more.tsx`, and `apps/web/src/app/[locale]/globals.css`.
- Search and tag entry code review found current combobox/listbox roles, `aria-activedescendant`, IME guards, live status messaging, keyboard hints, focus restoration, and disabled/loading states in `apps/web/src/components/search.tsx` and `apps/web/src/components/tag-input.tsx`.
- Upload/admin review found current native form labeling, progress/error states, disabled dropzone semantics, file error alerts, selection controls, and focus management in `apps/web/src/components/upload-dropzone.tsx` and `apps/web/src/components/image-manager.tsx`.

## Scope Notes

- Browser automation was not started for this review because the static component contracts and targeted UI/accessibility tests were sufficient to validate the reviewed claims without blocking on local data/server setup.
- The Cycle 48 aggregate carried forward deploy/performance/script items only; no carried-forward UI/accessibility item was re-raised here.
- Confidence: high for source-level UI/accessibility contracts and regression-test-backed behavior; medium for live, data-dependent visual layout across all production galleries because no browser session with real media fixtures was used in this pass.
