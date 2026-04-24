# Critic Review — Cycle 1

## Inventory examined
- Root guidance and repo docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.context/reviews/prompts/critic.md`, `.context/reviews/prompts/common_review_scope.md`
- App surface: all public routes, shared-group routes, admin routes, server actions, API routes, core lib modules, client components, and CSS under `apps/web/src/**`
- Test surface: unit tests under `apps/web/src/__tests__/**` and Playwright specs under `apps/web/e2e/**`
- Cross-checks: existing `.context/plans/**` and prior `.context/reviews/**` artifacts to avoid repeating already-fixed items

## Confirmed Issues

### 1) Masonry order still changes after hydration on most viewports
- **Files / region:** `apps/web/src/components/home-client.tsx:80-107, 174-175, 214-247`
- **Why this is a problem:** `useColumnCount()` boots from a hard-coded `2`, then updates from `window.innerWidth` in an effect. `orderedImages` is derived from that client-only state, so the SSR order is rendered for two columns and then recomputed for 1/3/4 columns after hydration on most screens.
- **Concrete failure scenario:** A user lands on the gallery at 1440px wide. The server sends a two-column ordering, hydration recomputes to four columns, and cards visually jump to new positions. Keyboard users can see focus land on one card and then watch it move; scroll anchoring and visual regression snapshots become brittle because the DOM order is not stable.
- **Suggested fix:** Make the ordering deterministic across server and client, or remove JS-driven reordering and let CSS handle the masonry layout. If viewport-dependent ordering must remain, gate the first render until the width is known so the initial DOM matches the hydrated DOM.
- **Confidence:** High

### 2) Public photo entry points lose collection context, so next/prev jumps out of the filtered gallery
- **Files / region:** `apps/web/src/components/home-client.tsx:247`, `apps/web/src/components/search.tsx:211-219`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:118-145`, `apps/web/src/lib/data.ts:441-545`
- **Why this is a problem:** Gallery cards and search results both link to bare `/p/[id]`. The photo page then computes `prevId` / `nextId` from `getImage()`, which walks the entire processed-image table rather than the originating filtered set. Only the shared-group flow preserves context through `syncPhotoQueryBasePath`.
- **Concrete failure scenario:** A visitor browses `/en?tags=night`, opens a photo from the topic grid, and presses Next. Instead of moving to the next image in the tag-filtered collection, the UI jumps to the globally next processed image, which may be unrelated to the current gallery context.
- **Suggested fix:** Preserve origin scope when linking into photo detail, e.g. via a return token or scoped route/query string, and compute next/prev within that scope. If the product wants global navigation, remove the scoped-gallery affordance so the behavior is explicit.
- **Confidence:** High

### 3) `PhotoViewer` does not resync local state when `initialImageId` changes
- **Files / region:** `apps/web/src/components/photo-viewer.tsx:56-76, 98-105, 145-148`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:109-143`
- **Why this is a problem:** `currentImageId` is initialized from `initialImageId` once and is never updated when the parent provides a new `initialImageId`. The component only syncs state outward to the URL; it never syncs the URL/prop change back into internal state.
- **Concrete failure scenario:** On the shared-group route, a user opens `/g/<key>?photoId=7`, then navigates via browser history or a direct URL edit to `photoId=12`. The server can select a different image, but the mounted client component can keep rendering the old photo because its local `currentImageId` still points at the previous value.
- **Suggested fix:** Add a `useEffect(() => setCurrentImageId(initialImageId), [initialImageId])`, or key the viewer by `initialImageId` so a route change recreates the state cleanly.
- **Confidence:** Medium

### 4) Tag-filtered metadata still uses raw slugs instead of canonical display names
- **Files / region:** `apps/web/src/app/[locale]/(public)/page.tsx:18-42, 64-101`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:18-52, 73-92`, `apps/web/src/components/home-client.tsx:181-197`
- **Why this is a problem:** The visible UI resolves slugs back to canonical tag names, but the metadata builders still compose titles and descriptions from `tagSlugs`. That means the browser tab, OG tags, and search snippets can show slug text even when the page itself shows proper human-readable labels.
- **Concrete failure scenario:** A canonical tag like `Black & White` with slug `black-white` renders correctly in the heading, but the page title and share preview become `#black-white`, which looks rough to users and weakens the share/SEO copy.
- **Suggested fix:** Resolve requested tag slugs to tag records before composing metadata, then reuse the same canonical names that `HomeClient` already shows to users.
- **Confidence:** High

### 5) Current automated coverage does not protect the public-gallery regressions above
- **Files / region:** `apps/web/e2e/public.spec.ts:4-19, 61-119`, `apps/web/src/__tests__/shared-page-title.test.ts:81-119`
- **Why this is a problem:** The existing Playwright coverage exercises the homepage, search dialog, photo lightbox, heading hierarchy, and shared-group navigation. It does not cover the public `/p/[id]` entry path from filtered galleries or the masonry hydration/order behavior in `home-client`, so the two most user-visible regressions above can slip through CI.
- **Concrete failure scenario:** A refactor changes the photo detail route or the masonry ordering logic; the current tests still pass because they never assert scope-preserving next/prev on topic/tag pages and never validate the hydration-time order stability of the masonry grid.
- **Suggested fix:** Add an E2E test for a topic/tag-filtered gallery that opens a photo and asserts next/prev stays within the intended scope, and add a focused unit or integration test for stable masonry ordering / hydration behavior.
- **Confidence:** Medium

## Risks Requiring Manual Validation
- I rechecked the common a11y and privacy hotspots that were problematic in earlier cycles — search dialog focus trap, nav locale prefixing, shared-group title behavior, and public privacy guards — and did not find a new regression there in the current tree.
- The remaining issues above are therefore the main live risks: layout stability, collection-scoped navigation, route-state synchronization, metadata consistency, and missing coverage for the public-gallery path.

## Final missed-issues sweep
- I did a second pass over the full public route set, shared-group flow, search flow, and the key client components to look for stale assumptions and cross-file mismatches.
- No additional high-confidence issue emerged beyond the five findings above.
