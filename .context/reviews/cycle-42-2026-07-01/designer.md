# Cycle 42 Designer Review

Date: 2026-07-01
Current HEAD reviewed: `6efd00a8`
Lane: UI/UX, accessibility, responsive behavior, public/shared viewer context, search/similar UI, color/HDR honesty, and i18n.
Scope note: GalleryKit photo gallery app, not BurstPick. Read `AGENTS.md`, `CLAUDE.md`, latest Cycle 41 aggregate/deferred plans, Cycle 41 critic/designer artifact, and current UI source. No application source edits.

## Evidence

- Latest aggregate/deferred context: `.context/reviews/cycle-41-2026-07-01/_aggregate.md`, `.context/plans/cycle-41-2026-07-01-deferred.md`, `.context/reviews/cycle-41-2026-07-01/critic-designer.md`.
- Current source checked: public routes under `apps/web/src/app/[locale]/(public)`, UI components under `apps/web/src/components`, i18n messages, and relevant source-contract tests.
- Targeted verification: `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/cycle-41-source-contracts.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts` -> 6 files, 71 tests passed.
- Browser automation not run; source and targeted tests were sufficient for this read-only lane.

## Findings

### UX-C42-01 - Shared-group selected-photo back link exits the share instead of returning to the shared set

Severity: Medium
Confidence: High

Evidence:

- In the selected-photo branch of `/g/[key]`, the visible back link points to the public home route: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:150-153`.
- The same selected-photo branch passes `isSharedView` and `syncPhotoQueryBasePath={localizePath(locale, \`/g/${key}\`)}` into `PhotoViewer`, so the viewer is already scoped to the shared group URL for photo-to-photo navigation: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:159-174`.
- `PhotoViewer` hides its normal topic/gallery back button for every shared view: `apps/web/src/components/photo-viewer.tsx:558-568`.
- Within the shared viewer, photo navigation builds `/g/{key}?photoId={id}` and synchronizes the query string on current-image changes: `apps/web/src/components/photo-viewer.tsx:214-219` and `apps/web/src/components/photo-viewer.tsx:324-327`.
- The only visible escape from the selected shared photo is therefore the top `View Gallery` link, and it leaves the curated share for `/`.

Failure scenario:

A client opens a shared album, selects one photo, then taps the top-left back affordance expecting to return to the shared album grid. Instead, they land on the public gallery home page, losing the curated shared set and potentially browsing unrelated public work. This weakens the share boundary that Cycle 41 just tightened by hiding whole-library similar-photo discovery.

Fix:

In the selected-photo branch, change the link target to `localizePath(locale, \`/g/${key}\`)` and use copy that distinguishes the destination, such as `Back to shared photos` / `공유 사진으로 돌아가기`. Add a source-contract or render test that the selected-photo branch links back to `/g/${key}` while the grid-level escape can still link to `/` if that is intentional.

### A11Y-C42-02 - Lightbox color pip remains pointer-interactive while visually hidden by auto-hide

Severity: Medium
Confidence: High

Evidence:

- The lightbox fades the entire controls overlay to `opacity: 0` when controls auto-hide: `apps/web/src/components/lightbox.tsx:545-550`.
- Other lightbox controls receive `controlPointerEventsClass`, which becomes `pointer-events-none` when hidden: `apps/web/src/components/lightbox.tsx:371-373`, `apps/web/src/components/lightbox.tsx:553-600`, and `apps/web/src/components/lightbox.tsx:620-658`.
- `LightboxColorPip` is passed only `interactive={controlsVisible}`: `apps/web/src/components/lightbox.tsx:661-672`.
- Inside `LightboxColorPip`, `interactive` removes keyboard focus with `tabIndex={interactive ? 0 : -1}` and suppresses the expanded panel, but the wrapper is always `pointer-events-auto` and the button always keeps `onClick={onToggle}`: `apps/web/src/components/lightbox-color-pip.tsx:162-168` and `apps/web/src/components/lightbox-color-pip.tsx:194-195`.

Failure scenario:

On a fine-pointer device, the lightbox controls auto-hide after three seconds. The bottom-left color chip is invisible with the rest of the controls, but it can still receive pointer input. A photographer or client clicking that part of the photo can toggle an invisible/hidden control instead of simply revealing controls or interacting with the image, creating a hidden hit target and an inconsistent accessibility state.

Fix:

Make pointer interactivity match the `interactive` prop. For example, change the wrapper to `interactive ? 'pointer-events-auto' : 'pointer-events-none'`, guard `onClick` when not interactive, and consider `aria-hidden={!interactive}` while the controls are hidden. Add a source-contract test beside `lightbox-controls-contract.test.ts` proving the color pip disables pointer events when `interactive` is false.

## Rechecked Clean Surfaces

- Cycle 41 UX fixes are present: shared views now suppress `SimilarPhotos`, and semantic/similar public API responses strip internal `score` fields before JSON return.
- Touch-target, focus-visible, i18n parity, semantic search, similar route, and Cycle 41 source-contract tests passed in the targeted run.
- Search and similar UI now keep semantic score data internal and continue to show localized setup/rate-limit/error states.
- Color/HDR copy remains generally honest: public HDR badges are still admin-gated, wide-gamut hints explain Display P3 delivery, and JPEG download labels use the public-safe `getJpegDownloadCopy` path.
- No active public edit/culling/rating/scoring UI was found in this pass.
