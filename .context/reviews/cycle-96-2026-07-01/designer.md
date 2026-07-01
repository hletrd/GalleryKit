# Cycle 96 UI/UX Review — GalleryKit

**Mode:** review-only; no files modified.
**Reviewed HEAD:** `2f22620c361304ba0408053f546f45e3c74ddfdb`
**Browser validation:** attempted, but local app startup was blocked by sandbox/network permissions.

## Validation blocker

`omx explore` and local Next startup were blocked:

```text
omx explore ... -> Operation not permitted (os error 1)
npm run dev --workspace=apps/web -- --hostname 127.0.0.1 --port 3100
-> Error: listen EPERM: operation not permitted 127.0.0.1:3100
```

Retrying with `0.0.0.0:3000` produced the same `listen EPERM`. Because no local server could bind, I could not collect live agent-browser accessibility snapshots, computed styles, focus traces, or DOM state. Findings below are source/test-evidence based; browser-only risks are labeled separately.

## UI/UX inventory reviewed

- **Public routes:** `apps/web/src/app/[locale]/(public)/page.tsx`, topic/category pages, collection/share/gallery/photo detail, map, timeline, year, privacy.
- **Admin routes:** dashboard, login, categories, tags, settings, SEO, password, tokens, users, database, analytics.
- **Core UI components:** navigation, search dialog, gallery grid, photo viewer, photo navigation, image zoom, lightbox, info bottom sheet, map client, load more, upload/image manager/admin controls.
- **Styling/theme:** `globals.css`, theme provider, dark/OLED tokens, forced-colors rules, reduced-motion rules.
- **i18n:** `messages/en.json`, `messages/ko.json`, locale helpers.
- **Tests/docs:** Playwright public/admin/nav specs, touch-target audit, `.context` plans/reviews.

---

## Confirmed findings

### 1. Zoomed mobile photo panning can accidentally trigger previous/next navigation

**Severity:** Medium
**Confidence:** Medium-high

**Evidence**

- `PhotoViewer` always mounts `PhotoNavigation`; it is disabled only for lightbox/bottom sheet, not zoom state: `apps/web/src/components/photo-viewer.tsx:667-675`.
- `PhotoNavigation` attaches native touch listeners to the swipe target: `apps/web/src/components/photo-navigation.tsx:155-158`.
- Horizontal touch deltas navigate when threshold is exceeded: `apps/web/src/components/photo-navigation.tsx:72-139`.
- `ImageZoom` handles pinch/pan internally and calls `preventDefault`/`stopPropagation` in React touch handlers, but does not notify the parent navigation layer: `apps/web/src/components/image-zoom.tsx:232-303`.

**Failure scenario**

On mobile, a user pinches/double-taps to zoom a photo, then drags horizontally to inspect detail. The ancestor swipe listener can interpret that pan as gallery navigation and move to the previous/next photo.

**Suggested fix**

Lift zoom/pan state from `ImageZoom` to `PhotoViewer`, then pass `disabled={showLightbox || showBottomSheet || isZoomed}` to `PhotoNavigation`. Also ignore swipe gestures whose composed path includes the zoomable image while zoom scale is greater than 1.

---

### 2. Zoomed image has no keyboard panning path

**Severity:** Medium
**Confidence:** High

**Evidence**

- `ImageZoom` keyboard support only toggles zoom with Enter/Space: `apps/web/src/components/image-zoom.tsx:197-208`, `362-365`.
- Escape resets zoom globally: `apps/web/src/components/image-zoom.tsx:328-337`.
- Panning exists for mouse/touch only: `apps/web/src/components/image-zoom.tsx:118-142`, `232-303`.
- `PhotoViewer` ignores global shortcuts from interactive targets such as `[role="button"]`: `apps/web/src/components/photo-viewer.tsx:42-63`, `371-380`.

**Failure scenario**

A keyboard-only or switch-control user can zoom into a photo but cannot pan around the enlarged image. Arrow keys neither pan the zoomed image nor navigate while focus remains on the zoom control.

**Suggested fix**

When zoomed and focused, support Arrow keys for pan, Home/End or `0` for reset, and document shortcuts via `aria-describedby`. Preserve existing Escape reset behavior.

---

### 3. Token label field rejects valid Unicode labels before server validation

**Severity:** Low
**Confidence:** High

**Evidence**

- Server validates token labels by Unicode code points, max 128: `apps/web/src/app/actions/lr-tokens.ts:60-68`.
- Client input uses HTML `maxLength={128}`: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:209-223`.
- Tests confirm 128 emoji/code-point labels should be accepted: `apps/web/src/__tests__/lr-tokens-action.test.ts:127-143`.

**Failure scenario**

An admin entering emoji or other surrogate-pair characters can hit the browser’s UTF-16 `maxLength` limit before reaching the server’s intended 128-code-point limit.

**Suggested fix**

Remove strict HTML `maxLength` or set a generous transport cap, then validate with `Array.from(label).length <= 128` client-side and show inline helper/error text.

---

### 4. Token-list load failures can appear as “No tokens yet”

**Severity:** Medium
**Confidence:** High

**Evidence**

- `listTokensForUser` catches SELECT failures and returns `[]`: `apps/web/src/lib/admin-tokens.ts:178-190`.
- The action forwards that array: `apps/web/src/app/actions/lr-tokens.ts:131-140`.
- The client only shows retry/error UI when it receives `{ error }`: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:37-47`.
- Empty array renders the empty state: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:141-163`.

**Failure scenario**

If the token table/migration/query is broken, an admin sees “No tokens yet” instead of a service error. That can hide operational failure and mislead recovery workflows.

**Suggested fix**

Return a discriminated failure from token-list actions, render persistent retry/error copy, and reserve the empty state for successful zero-result responses.

---

### 5. Mobile admin navigation is a wrapped link cloud

**Severity:** Medium
**Confidence:** High source-level; needs browser validation once startup works

**Evidence**

- Header uses wrapped flex layout: `apps/web/src/components/admin-header.tsx:13-24`.
- Admin nav has ten destinations: `apps/web/src/components/admin-nav.tsx:15-25`.
- Links render in a wrapping flex row: `apps/web/src/components/admin-nav.tsx:28-49`.

**Failure scenario**

On narrow screens, admin navigation becomes multiple rows of small text links. This increases scan cost, focus traversal length, and tap/focus ambiguity for admin tasks.

**Suggested fix**

Use a responsive disclosure/menu, segmented admin sidebar, or select-style section switcher below `md`. Keep `aria-current`, visible focus, and focus restoration when the menu closes.

---

### 6. Admin image manager is horizontal-scroll table only on mobile

**Severity:** Medium
**Confidence:** High source-level; needs browser validation once startup works

**Evidence**

- Dashboard wraps image manager in `max-w-full` / `overflow-auto`: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`.
- Image manager uses a dense table with many columns/actions: `apps/web/src/components/image-manager.tsx:424-449`, `456-588`.

**Failure scenario**

Mobile admins must horizontally scroll through preview, filename, topic, tags, gamut, date, and actions. This is difficult for touch, magnification, and keyboard users.

**Suggested fix**

Add a responsive card/list layout under `md` with labeled fields and the same actions. Keep the table for desktop.

---

## Manual-validation risks

- **RTL:** Current locales are `en`/`ko` only, and `RTL_LOCALES` is empty: `apps/web/src/lib/constants.ts:2-4`, `apps/web/src/lib/locale-path.ts:37-40`. Many components use physical `left/right/ml/mr` classes, so adding RTL would need a layout audit.
- **Map keyboard behavior:** Source provides skip/list fallback in `apps/web/src/app/[locale]/(public)/map/page.tsx:75-93`, but Leaflet keyboard/focus behavior needs live browser validation.
- **Focus traps/computed contrast:** Source looks strong, but actual tab order, computed contrast over images, and mobile viewport behavior could not be verified due local server bind failure.

## Positive coverage observed

- Skip link and main target exist in layouts.
- Radix dialogs/sheets provide strong focus-trap foundations.
- UI primitives generally enforce 44px touch targets.
- Reduced-motion and forced-colors rules are present in `globals.css`.
- Search/lightbox/info sheet include accessible dialog patterns and live-region/status affordances.
- Existing Playwright specs cover search focus trap, lightbox close, heading hierarchy, mobile nav, and photo info sheet behavior. These were reviewed as committed evidence, not freshly executed.