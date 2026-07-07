# GalleryKit UI/UX Designer Reviewer — Cycle 6 Prompt 1

Date: 2026-07-07
Scope: GalleryKit Next.js web app in `/Users/hletrd/flash-shared/gallery`.
Method: source-backed UI/UX review using the local professional reviewer prompt as methodology only. I adapted its professional-photo-tool lens to this web gallery: public browsing, photo inspection, sharing, admin upload/metadata management, responsive behavior, keyboard/mouse/touch parity, and accessibility. I did not edit application source and did not commit.

Runtime note: `http://localhost:3000/en` was reachable but returned HTTP 500 during this pass, so I did not rely on live runtime assertions. I used current source, existing local screenshots under `.context/`, e2e/source-test contracts, and the previous cycle review ledger as evidence. Existing screenshots reviewed: `.context/home-desktop-review.png`, `.context/home-mobile-review.png`, `.context/photo-mobile.png`, and `.context/photo-desktop-review.png`.

## Executive Summary

GalleryKit's public gallery UI is visually restrained and mostly respects the "photo first" hierarchy, but one core photo-inspection interaction is broken: the photo viewer advertises click-to-zoom through cursor, role, and accessible name, while the pointer click handler returns before toggling zoom. That is a direct manipulation failure in the highest-value public surface. Design quality score: 7/10 for the gallery, 6/10 for photo inspection until click-to-zoom and auto-lightbox hydration are fixed.

## Findings

### UXR-C6-01 — Desktop click-to-zoom is blocked by the zoom container's own role guard

Severity: High
Confidence: High
Status: New confirmed source-backed defect

Evidence:

- `apps/web/src/components/image-zoom.tsx:180-195` defines `handleClick`, but line 183 exits when `target.closest('a, button, [role="button"], input, textarea, select')` matches.
- The same component renders the zoom container itself with `role="button"`, `tabIndex={0}`, `onClick={handleClick}`, and a `cursor-zoom-in` class at `apps/web/src/components/image-zoom.tsx:355-380`.
- The local source comment at `apps/web/src/components/image-zoom.tsx:197-200` already documents that this exact guard matches the zoom container's own `role="button"` and prevented keyboard users from toggling zoom. Keyboard got a dedicated workaround, but pointer click still uses the broken guard.
- The photo viewer wraps the primary displayed image in this component at `apps/web/src/components/photo-viewer.tsx:693-730`.
- Test gap: `apps/web/src/__tests__/image-zoom-source-contracts.test.ts:7-17` only locks the keyboard workaround. `apps/web/src/__tests__/image-zoom-math.test.ts:110-163` covers math, not pointer activation. No e2e test clicks the zoom surface.

Selector/surface:

- Photo viewer media surface: `[data-testid="photo-media-container"] [role="button"][aria-label*="Zoom"]`
- Source path: `ImageZoom` in `photo-viewer.tsx`.

Failure scenario:

A desktop visitor opens a photo page, sees the zoom cursor over the image, and clicks the photograph expecting direct inspection. Because the event target is inside a container whose closest `[role="button"]` is the container itself, `handleClick` returns before `zoomInAt(...)`. The UI silently does nothing. A photographer checking focus/detail now has to discover keyboard Enter/Space or wheel zoom instead of the obvious pointer action.

Fix:

Change the guard so it ignores only nested interactive descendants, not the current zoom container. For example, compare `target.closest(...)` against `containerRef.current` and return only when the match exists and is not the container, or remove `[role="button"]` from the selector and explicitly guard nested controls. Add a Playwright regression: open a photo, click the zoom container, assert the inner transform changes from `scale(1)` to `scale(...)`, then click again and assert reset.

### UXR-C6-02 — Auto-lightbox restoration still reads `sessionStorage` during the first render

Severity: Medium
Confidence: High for source defect, Medium-High for runtime frequency
Status: Carry-forward confirmed source defect from the photo-viewer hydration class

Evidence:

- `apps/web/src/components/photo-viewer.tsx:76-82` initializes `showLightbox` with a lazy `useState` function that reads and removes `sessionStorage.gallery_auto_lightbox`.
- Server render always resolves the deterministic fallback (`false`); a real client hydration with that flag already set resolves `true`, changing both the main viewer visibility at `apps/web/src/components/photo-viewer.tsx:566` and conditional lightbox mount at `apps/web/src/components/photo-viewer.tsx:1013-1032`.
- The adjacent `isPinned` state was already fixed by moving client-only state into a mount effect at `apps/web/src/components/photo-viewer.tsx:102-133`; `showLightbox` did not get the same treatment.
- The flag is written before route navigation while the lightbox is open at `apps/web/src/components/photo-viewer.tsx:240-248` and also by the map client (`apps/web/src/components/map/map-client.tsx:103-104`).
- Loading fallback repeats the same client-first-render read pattern at `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx:7-18`.
- Existing hydration e2e only covers ordinary desktop photo entry with no auto-lightbox flag (`apps/web/e2e/hydration-photo-page.spec.ts:17-50`), so this branch is not locked.

Selector/surface:

- Lightbox dialog: `[role="dialog"][aria-label="Photo lightbox"]`
- Photo page root hidden when affected: `.photo-viewer-container.hidden`

Failure scenario:

The user is in fullscreen/lightbox, presses next, and the app stores `gallery_auto_lightbox=true` so the next photo preserves the fullscreen inspection context. If the tab hard reloads, is restored by the browser, or is interrupted during that handoff, the client can hydrate with `showLightbox=true` while the server HTML was generated with `false`. That can produce React hydration recovery and, more importantly for UX, lose the user's intended "stay in lightbox" state.

Fix:

Use the same pattern already applied to `isPinned`: initialize `showLightbox` to `false`, consume and clear `gallery_auto_lightbox` in a mount effect guarded for Strict Mode, then call `setShowLightbox(true)`. Include the loading fallback in the same audit. Add an e2e that sets `sessionStorage.gallery_auto_lightbox='true'`, hard reloads a photo page in a production-like build, and asserts no hydration/page errors plus expected lightbox state.

### UXR-C6-03 — Smart collections are implemented but still not admin-operable

Severity: Medium
Confidence: High
Status: Product/IA carry-forward, still open

Evidence:

- Public smart collection route renders `/c/[slug]` through `HomeClient`: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164`.
- Create/update/delete actions exist and are admin-hardened: `apps/web/src/app/actions/collections.ts:16-150`.
- Admin navigation exposes dashboard, categories, tags, SEO, settings, tokens, password, users, DB, and analytics, but no Collections entry: `apps/web/src/components/admin-nav.tsx:15-25`.
- The repo's own architecture note says rows are authored by direct DB insert and no admin UI/API surface invokes the actions: `CLAUDE.md:162`.

Selector/surface:

- Missing admin destination: `nav[aria-label="Admin navigation"] a[href$="/admin/collections"]`
- Public destination exists: `/[locale]/c/[slug]`.

Failure scenario:

An operator sees dynamic collection code and public routes, then has no safe UI to create, preview, edit, publish/unpublish, or retire a collection. The only effective workflow is hand-authoring `query_json` in the database. That is not acceptable for a photographer/admin tool: it makes a public IA feature depend on private schema knowledge.

Fix:

Either keep smart collections strictly internal in docs/product copy, or ship an admin Collections workflow: list, create/edit dialog or page, slug validation, predicate builder, preview count, public visibility, and destructive delete confirmation.

## Closed / Not Reopened

- Search shortcut copy is no longer open. The visible footer now renders neutral `Ctrl/⌘ K` copy at `apps/web/src/components/search.tsx:511-517`, and `apps/web/src/__tests__/search-status-source.test.ts:65-69` locks the source contract.
- `isPinned` photo-page hydration was not reopened. The state now renders deterministic `false` and restores after mount at `apps/web/src/components/photo-viewer.tsx:102-133`.
- Reduced-motion suppression for masonry hover scale is present in `apps/web/src/app/[locale]/globals.css:260-275`, so I did not file the old hover-zoom reduced-motion issue.

## Design System Assessment

The app has a coherent Tailwind/shadcn token layer, 44 px touch-target discipline in many high-risk surfaces, explicit dark/OLED tokens, forced-colors handling, and regression tests for several accessibility patterns. The remaining weakness is interaction-contract drift: source-contract tests verify pieces of zoom, hydration, focus, and shortcut behavior, but not always the actual user gesture that the UI advertises. `ImageZoom` is the clearest example: keyboard workaround and math are tested, while pointer activation is not.

## Prioritized Recommendations

Tier 0:

- Fix `ImageZoom` pointer activation and add browser coverage for click-to-zoom.

Tier 1:

- Move `showLightbox` auto-restore out of render-time `sessionStorage` reads and cover the hard-reload auto-lightbox case.
- Decide whether smart collections are internal or admin-operable; avoid the current half-shipped information architecture.

Tier 2:

- Add e2e coverage for pointer click, double tap, wheel, and keyboard zoom as a matrix, because this is the core photo-inspection surface.
- Add a manual mobile/WebKit pass for pinch zoom and the bottom-sheet drag path. The source has non-passive fixes in some places, but `localhost:3000` was not usable in this review for live validation.

## Final Sweep

Checked public nav, masonry cards, tag filters, search dialog, photo viewer, lightbox, image zoom, mobile info sheet, admin nav, upload/dashboard/image manager, settings, i18n copy, existing e2e contracts, and local screenshots. No source was edited outside this review artifact. Runtime validation remains blocked by the local HTTP 500, so claims above are source-backed unless explicitly labeled as screenshot/context-backed.
