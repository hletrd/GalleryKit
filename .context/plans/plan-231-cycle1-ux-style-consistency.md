# Plan 231 — Cycle 1 UX, Accessibility, Lifecycle, and Style Consistency Fixes

**Status:** TODO
**Source review:** `.context/reviews/_aggregate.md`
**Scope:** Implement the current-cycle UX, accessibility, lifecycle, and maintainability findings from AGG-09 through AGG-13, AGG-18 through AGG-21, and AGG-26 through AGG-33.

## Findings covered

| ID | Title | Severity | Confidence | Source citation |
| --- | --- | --- | --- | --- |
| AGG-09 | Mobile nav state persists after navigation | MEDIUM | HIGH | `apps/web/src/components/nav-client.tsx:26-156` |
| AGG-10 | Mobile info bottom sheet is touch-only and never moves focus into the panel | HIGH | HIGH | `apps/web/src/components/photo-viewer.tsx:269-277, 586-592`, `apps/web/src/components/info-bottom-sheet.tsx:24-176` |
| AGG-11 | Lightbox controls can disappear visually while remaining focusable | HIGH | HIGH | `apps/web/src/components/lightbox.tsx:111-148, 283-355` |
| AGG-12 | Invalid upload drops give no validation feedback | MEDIUM | HIGH | `apps/web/src/components/upload-dropzone.tsx:95-106, 258-269` |
| AGG-13 | The root error shell ignores the active theme | MEDIUM | MEDIUM | `apps/web/src/app/global-error.tsx:45-75` |
| AGG-18 | Public gallery ordering can change after hydration | MEDIUM | HIGH | `apps/web/src/components/home-client.tsx:80-107, 174-175, 214-247, 319` |
| AGG-19 | Public photo entry points lose collection context | HIGH | HIGH | `apps/web/src/components/home-client.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/lib/data.ts` |
| AGG-20 | `PhotoViewer` does not resync local state when `initialImageId` changes | MEDIUM | HIGH | `apps/web/src/components/photo-viewer.tsx` |
| AGG-21 | Tag-filtered metadata still uses raw slugs instead of canonical display names | MEDIUM | HIGH | `apps/web/src/components/home-client.tsx`, `apps/web/src/lib/tag-slugs.ts`, `apps/web/src/lib/data.ts` |
| AGG-26 | E2E seeding can use the wrong upload roots and image sizes | MEDIUM | HIGH | `apps/web/scripts/seed-e2e.ts:1-24`, `apps/web/src/lib/upload-paths.ts:11-37` |
| AGG-27 | `PhotoViewer` restores `document.title` from a stale mount snapshot | MEDIUM | HIGH | `apps/web/src/components/photo-viewer.tsx:79-105` |
| AGG-28 | `timerShowInfo` is effectively dead state | LOW | MEDIUM | `apps/web/src/components/photo-viewer.tsx:61,106,145-171,312-320` |
| AGG-29 | The locale switcher hardcodes a two-locale flip | MEDIUM | HIGH | `apps/web/src/components/nav-client.tsx:45-63, 149-155`, `apps/web/src/lib/constants.ts:1-4` |
| AGG-30 | Default image sizes are duplicated in two formats | MEDIUM | HIGH | `apps/web/src/lib/gallery-config-shared.ts:38-44, 71-73` |
| AGG-31 | The homepage metadata builder repeats almost the same object shape | LOW | HIGH | `apps/web/src/app/[locale]/(public)/page.tsx:18-101` |
| AGG-32 | The search overlay combines too many concerns in one component | LOW | MEDIUM | `apps/web/src/components/search.tsx:20-33, 40-123, 142-259` |
| AGG-33 | `globals.css` mixes layers, utilities, and component-specific rules | LOW | MEDIUM | `apps/web/src/app/[locale]/globals.css:13-165` |

## Implementation tasks

### Task 1 — Make mobile navigation and viewer panels stateful in a route-safe way [AGG-09, AGG-10, AGG-11, AGG-12, AGG-13]
**Files:**
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/app/global-error.tsx`

**Changes:**
1. Collapse the mobile nav on route changes.
2. Make the info bottom sheet keyboard- and focus-friendly, not touch-only.
3. Keep hidden lightbox controls out of the accessibility tree and tab order.
4. Surface upload file rejections clearly.
5. Preserve the active theme in the global error shell.

**Exit criterion:** The mobile/public interaction surfaces stay usable after navigation, hidden controls are not focus traps, invalid uploads explain themselves, and the error page respects theme state.

### Task 2 — Keep gallery/photo navigation context stable across routes and hydration [AGG-18, AGG-19, AGG-20, AGG-21, AGG-27, AGG-28]
**Files:**
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/tag-slugs.ts`

**Changes:**
1. Align client/server gallery ordering so hydration does not reshuffle cards.
2. Preserve filtered collection context through photo navigation.
3. Re-sync viewer state when the active photo prop changes.
4. Canonicalize tag-filtered metadata labels.
5. Remove stale title restoration and dead viewer state paths.

**Exit criterion:** Public browsing remains visually stable, photo navigation respects the selected collection, and viewer state / metadata stay synchronized with the active route.

### Task 3 — Clean up locale, defaults, and component-structure drift [AGG-29, AGG-30, AGG-31, AGG-32, AGG-33]
**Files:**
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/app/[locale]/globals.css`

**Changes:**
1. Drive the locale switcher from the shared locale list.
2. Centralize the default image-size list.
3. Extract the shared homepage metadata payload.
4. Split the search overlay into smaller named responsibilities.
5. Reorganize `globals.css` into clearly separated concern blocks.

**Exit criterion:** The UI code reads from the same source of truth as the rest of the app, and the common shell files are easier to extend without accidental drift.

## Deferred items
- None. All findings from this cycle are scheduled here.

## Progress
- [ ] Task 1 — Make mobile navigation and viewer panels stateful in a route-safe way
- [ ] Task 2 — Keep gallery/photo navigation context stable across routes and hydration
- [ ] Task 3 — Clean up locale, defaults, and component-structure drift

## Verification evidence
- Not run yet. This plan is implementation-only.
