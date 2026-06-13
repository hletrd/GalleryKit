# Designer Review — run-5 cycle-3
**Date:** 2026-06-12
**Reviewer lane:** UI/UX + Accessibility
**Method:** Runtime (dev server on port 3105, agent-browser headless Chromium) + static source sweep.
Dev server started via `PORT=3105 npm run dev --workspace=apps/web`; all pages loaded successfully. Browser closed after review; dev server killed.
**Viewports tested:** 320×568, 768×1024, 1280×800
**Locales tested:** en, ko

---

## 1. Cycle-2 a11y Fix Verification

All three explicitly targeted cycle-2 a11y fixes hold at runtime.

### Error-page heading contrast (commit 0e8fd431) — VERIFIED FIXED
`apps/web/src/app/[locale]/error.tsx:18-19`
The `text-7xl` decorative span is now `aria-hidden="true"` and the real `<h1 id="route-error-title">` is `sr-only`. The DES-R5C2-03 carry-forward (wrong in cycle-1 analysis) is resolved: no sighted contrast failure for the decorative element; screen readers announce the `sr-only` heading.

### 44px shared-group/404 links (commit d8307299) — VERIFIED FIXED
`apps/web/src/app/[locale]/not-found.tsx:45` — `min-h-11` present.
`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:140,172` — both "Back to gallery" links carry `min-h-11`.
Runtime at 1280px viewport confirmed 44px rendered heights.

### Sheet focus-on-open (commit 2f67ed66) — VERIFIED FIXED
`apps/web/src/components/info-bottom-sheet.tsx:196`
`initialFocus: () => closeButtonRef.current ?? dragHandleRef.current ?? false` — focus lands on close button (44px, h-11) on open. Verified via accessibility snapshot: focus trapped inside dialog on open.

---

## 2. Previously Reported Carry-Forward Items — Status

The following cycle-2 findings are suppressed per brief (already in plan-315/plan-322):
- DES-R5C2-01 (shared-group touch target) — FIXED per d8307299 above
- DES-R5C2-02 (404 touch target) — FIXED per d8307299 above
- DES-R5C2-03 (error.tsx heading contrast) — FIXED per 0e8fd431 above
- DES-R5C2-04 (empty-state SVG aria-hidden) — plan-316 DES-R5C1-19; still not implemented (svg at home-client.tsx:395 now has `aria-hidden="true"` — VERIFIED FIXED by source inspection)
- DES-R5C2-05 (locale display names ternary) — FIXED: nav-client.tsx:19-22 now uses `LOCALE_DISPLAY_NAMES` map
- DES-R5C2-06 (dead photo-viewer-shortcuts id) — FIXED: photo-viewer.tsx:579 now wires `aria-describedby="photo-viewer-shortcuts"` to the container; target element at :592 exists
- DES-R5C2-07 (upload dropzone tag ARIA) — plan-316 DES-R5C1-20; needs-manual-validation, not re-reported
- DES-R5C2-08 (info-bottom-sheet dvh fallback) — PARTIALLY FIXED: `maxHeight: '95dvh'` added via inline style spread at info-bottom-sheet.tsx:211; `paddingBottom: 'env(safe-area-inset-bottom, 0px)'` also present at :214

Plan-315 designer items (items 23-33) are NOT yet implemented as of this cycle. Each is noted in findings below where they constitute new or confirmable evidence.

---

## 3. New Findings

Findings follow ID format `DES-R5C3-NN`.

---

### DES-R5C3-01
**Severity:** HIGH
**Confidence:** HIGH
**Classification:** WCAG 2.4.1 — Bypass Blocks; skip link targets non-existent element
**Status:** confirmed (runtime DOM inspection)
**File:** `apps/web/src/app/[locale]/layout.tsx:124`; admin layout `apps/web/src/app/[locale]/admin/layout.tsx:20,24`
**Runtime evidence:** `agent-browser eval` on `/en/admin` returned `brokenSkipLinks: ["#main-content"]`. The global locale layout renders a `href="#main-content"` skip link on every route including admin. The admin sub-layout sets `<main id="admin-content">`. On admin pages, `document.getElementById("main-content")` is null — the skip link's activation sends keyboard focus to `body` (or nowhere), defeating bypass-blocks for keyboard and AT users on every admin route.

**Problem:** Two skip links are present simultaneously on admin pages: one from the global `[locale]/layout.tsx` targeting `#main-content` (broken on admin routes), and one from `admin/layout.tsx` targeting `#admin-content` (correct). The global layout comment at line 119-121 says "target id='main-content' is set by the public sub-layout" — this assumption fails on admin routes.

**User-impact scenario:** A keyboard user on `/en/admin` (login, settings, image manager) presses Tab then Enter on "Skip to content" expecting to bypass the nav. Focus goes nowhere. They must Tab through the entire nav and admin sidebar before reaching content. Affects all admin users who rely on keyboard navigation.

**Suggested fix:** Option A — add a guard in the global layout's skip link so it only renders on non-admin routes (e.g. check if the current path includes `/admin`). Option B — in `admin/layout.tsx`, add a hidden `<span id="main-content" />` alias before the admin content so both skip links resolve. Option C — consolidate: remove the global skip link and ensure every sub-layout provides its own. Option A is cleanest for App Router.

---

### DES-R5C3-02
**Severity:** MED
**Confidence:** HIGH
**Classification:** WCAG 2.4.7 — Focus Visible; design-token consistency
**Status:** confirmed (source inspection + runtime)
**File:** `apps/web/src/components/lightbox.tsx:550, 570, 594, 617, 637`
**Runtime evidence:** `blueOutlineCount: 3` confirmed via `agent-browser eval` during lightbox interaction (close, fullscreen, slideshow buttons all visible). Source shows 5 occurrences of `focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400`.

**Problem:** All five interactive lightbox buttons (close, fullscreen, slideshow, prev, next) use hardcoded `focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400` instead of the project's design token (`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`). In dark mode, the blue-400 outline may not meet 3:1 contrast against the dark `bg-black/50` button background. More critically, changing the project's accent color does not update these buttons.

**User-impact scenario:** In a custom-theme deployment or high-contrast mode, the lightbox focus indicator may conflict with the brand color or fail contrast. Keyboard users navigating the lightbox (the primary fullscreen navigation surface) see inconsistent focus treatment compared to every other interactive element in the app.

**Suggested fix:** Replace `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400` with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` on all 5 buttons. This is plan-315 item 33 (DES-R5C1-16), still unimplemented.

---

### DES-R5C3-03
**Severity:** MED
**Confidence:** HIGH
**Classification:** Touch-target / WCAG 2.5.5 — visual badge below 44px
**Status:** confirmed (source inspection)
**File:** `apps/web/src/components/lightbox.tsx:627, 647`
**Evidence:** `span` elements wrapping the prev/next chevron icons: `className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 hover:bg-black/70"`. The enclosing `<button>` is full-width/full-height (`h-full w-16`), so the touch target itself passes (100% viewport height). However, the visible badge (the `h-10 w-10` = 40px rounded pill) is the perceived affordance — it renders 40×40px — 4px short of the 44px project floor for visible interactive elements.

**Problem:** The plan-315 item 27 (DES-R5C1-10) fix was to bump these badges to `h-11 w-11` for visual parity. Source shows they are still `h-10 w-10`. The button's total hit area passes (it spans the full edge of the lightbox), but the visible badge remains below the documented project floor.

**User-impact scenario:** Photographers auditing gamut/HDR data in the lightbox tap near the chevron pill but miss it because the visual target appears smaller than the actual touch area, creating perceived precision mismatch on touch screens.

**Suggested fix:** Change `h-10 w-10` → `h-11 w-11` at lightbox.tsx:627 and :647. This is plan-315 item 27 (DES-R5C1-10), still unimplemented.

---

### DES-R5C3-04
**Severity:** LOW
**Confidence:** HIGH
**Classification:** Perceived performance / CLS risk
**Status:** confirmed (source inspection)
**File:** `apps/web/src/components/home-client.tsx:261`
**Evidence:** `containIntrinsicSize: \`auto ${Math.round(300 * image.height / image.width)}px\``

**Problem:** The `containIntrinsicSize` intrinsic height estimate uses a constant 300px assumed card width regardless of viewport width or column count. At 320px viewport with 1 column, the card width is ~296px (close to 300px, so roughly correct). At 1280px with 4 columns, each column is ~296px (still close). At 2560px with 5 columns via `2xl:columns-5`, each column is ~490px — the estimate is 38% too short, causing content-visibility layout shift when the card enters the viewport.

**User-impact scenario:** On very wide monitors at 2xl breakpoint, masonry cards jump as they scroll into view (content-visibility kicks in). This is a CLS source on 4K/ultra-wide displays.

**Suggested fix:** Derive the estimated card width from `containerWidth / columnCount` per the plan-315 item 26 (DES-R5C1-09). Specifically: read `containerRef.current?.offsetWidth` and divide by the current column count (already computed as `columnCount`), cap to image width. Update on resize. The constant 300 remains a valid fallback (SSR / before mount).

---

### DES-R5C3-05
**Severity:** LOW
**Confidence:** HIGH
**Classification:** Animation performance / paint cost
**Status:** confirmed (source inspection)
**File:** `apps/web/src/components/photo-viewer.tsx:804`
**Evidence:** `"space-y-6 transition-all duration-500 ease-in-out overflow-hidden transform hidden lg:block"`

**Problem:** `transition-all` on an `overflow-hidden` container animates the `width` property when the info sidebar toggles. Animating width inside `overflow-hidden` is compositor-unfriendly — it triggers layout, paint, and composite on every frame, janking the 500ms sidebar transition on mid-range devices. Plan-315 item 30 (DES-R5C1-13) specified replacing with `transition-[opacity,transform]` and fading/sliding the sidebar instead of width-animating it. Still unimplemented.

**User-impact scenario:** Photographers pressing `I` to toggle the sidebar see jank on devices without a discrete GPU (MacBook Air, iPad).

**Suggested fix:** Replace `transition-all` with `transition-[opacity,transform]` and drive visibility via `opacity-0`/`opacity-100` + `translate-x-full`/`translate-x-0` rather than width (which requires `overflow-hidden`). This eliminates layout thrashing on each keystroke.

---

### DES-R5C3-06
**Severity:** LOW
**Confidence:** HIGH
**Classification:** Nav backdrop contrast without backdrop-filter support
**Status:** confirmed (source inspection)
**File:** `apps/web/src/components/nav-client.tsx:78`
**Evidence:** `className="sticky top-0 z-50 w-full bg-background/50 backdrop-blur-xl supports-[backdrop-filter]:bg-background/20 transition-all duration-300"`

**Problem:** The `bg-background/50` base (50% opacity) is the fallback for browsers without `backdrop-filter` support. In browsers without backdrop-filter (older Firefox, some Chromium forks), the nav is only 50% opaque — content scrolling behind it bleeds through, making nav labels unreadable. Plan-315 item 25 (DES-R5C1-08) specified raising the non-backdrop fallback to `bg-background/90`. Still unimplemented.

**User-impact scenario:** On Firefox < 103 or environments with forced `prefers-reduced-transparency`, the sticky nav at 50% opacity allows photo content to show through the nav links, reducing readability.

**Suggested fix:** Change `bg-background/50` to `bg-background/90` (the opaque fallback), keep `supports-[backdrop-filter]:bg-background/20` for the blur path.

---

### DES-R5C3-07
**Severity:** LOW
**Confidence:** HIGH
**Classification:** Masonry card text legibility on high-key photos
**Status:** confirmed (source inspection)
**File:** `apps/web/src/components/home-client.tsx:362, 368`
**Evidence:**
- Mobile top overlay: `from-black/65 to-transparent` — 65% black gradient
- Desktop hover overlay: `from-black/60 to-transparent` — 60% black gradient

**Problem:** For high-key (bright white/cream) photos, a gradient starting at 65% opacity may not provide sufficient contrast for white text overlay titles. Plan-315 item 31 (DES-R5C1-14) specified deepening to `from-black/75` (mobile) and `from-black/70` (hover). The plan also mentioned adding a text-shadow floor for extreme cases. Still unimplemented.

**User-impact scenario:** On gallery collections with many high-key lifestyle or product photos, the `h3` card titles (white text) can be difficult to read on mobile where the top gradient fires unconditionally.

**Suggested fix:** Raise mobile overlay to `from-black/75` and desktop hover overlay to `from-black/70`. Optionally add `[text-shadow:0_1px_3px_rgba(0,0,0,0.5)]` to the `h3` elements.

---

### DES-R5C3-08
**Severity:** LOW
**Confidence:** HIGH
**Classification:** Usability — bottom-sheet missing peek-state dismiss affordance
**Status:** confirmed (source inspection)
**File:** `apps/web/src/components/info-bottom-sheet.tsx:181-187`
**Evidence:** `{sheetState === 'expanded' && (<div className="fixed inset-0 z-40 bg-black/40" onClick={handleBackdropClick} />)}`

**Problem:** The dimming backdrop with tap-to-dismiss is rendered only in `expanded` state. In `peek` state (the initial/default state where ~140px of the sheet is visible at the bottom), there is no backdrop and no tap-outside-to-dismiss gesture. Users who want to close the sheet in peek state must find and tap the close button. Plan-315 item 29 (DES-R5C1-12) specified adding a low-opacity backdrop in peek state. Still unimplemented.

**User-impact scenario:** A photographer opens photo info on mobile, sees the peek strip. They intuitively tap the photo to dismiss but the sheet stays open (the photo area below the sheet is not the backdrop). They must hunt for the close button.

**Suggested fix:** Add a second backdrop branch for `sheetState === 'peek'` with lower opacity (e.g. `bg-black/10`) that calls `onClose()` on click. Ensure it does not intercept the lightbox trigger button.

---

### DES-R5C3-09
**Severity:** LOW
**Confidence:** MEDIUM
**Classification:** Keyboard shortcut discoverability / WCAG 2.4.11
**Status:** confirmed (source inspection)
**File:** `apps/web/src/components/photo-viewer.tsx:592-593, 665-666`
**Evidence:** `<p className="mb-2 text-xs text-muted-foreground hidden md:block" id="photo-viewer-shortcuts">` — hint hidden on mobile. `aria-keyshortcuts="I"` on info button at :666 with no tooltip equivalent on mobile (no `title` attribute triggers on touch).

**Problem:** The keyboard shortcut hint paragraph is `hidden md:block`, meaning it is invisible on mobile. On desktop it is visually present. On both, `aria-keyshortcuts="I"` on the info button has no discoverable tooltip (the `title` attribute at :667 `title={\`${t('viewer.info')} (I)\`}` is not reliably presented on mobile browsers). Plan-315 item 24 (DES-R5C1-07) specified making the hint visible at all breakpoints or adding a Tooltip. Still unimplemented.

**User-impact scenario:** Mobile users do not discover keyboard shortcuts (admittedly less relevant on touch), but more importantly AT users relying on `aria-keyshortcuts` have no visual counterpart of the shortcut description on mobile.

**Suggested fix:** Either show the shortcut hint at all breakpoints (e.g. remove `hidden md:block` and use `text-xs`), or add a `<Tooltip>` component wrapping the info button on both mobile and desktop so the keyboard shortcut is discoverable on focus/hover.

---

### DES-R5C3-10
**Severity:** LOW
**Confidence:** MEDIUM
**Classification:** Hidden subtree renders during lightbox — battery/CPU
**Status:** confirmed (source inspection)
**File:** `apps/web/src/components/photo-viewer.tsx:579, 1074`
**Evidence:**
- Line 579: `className={cn("flex flex-col ... photo-viewer-container", showLightbox && "hidden")}` — CSS `display:none` via class
- Line 1074: `{showLightbox && <Lightbox ... />}` — lightbox conditionally rendered

**Problem:** When the lightbox is open, the photo-viewer subtree (the full scrollable info sidebar, zoom canvas, navigation buttons, EXIF grid) is hidden via CSS `display:none` but remains mounted. Framer Motion animations, ResizeObserver callbacks, and scroll listeners inside that subtree continue running while invisible. Plan-315 item 28 (DES-R5C1-11) specified conditionally rendering or gating the viewer subtree. Still unimplemented.

**User-impact scenario:** On battery-constrained devices (iPad, iPhone), slideshow mode runs the lightbox animation AND keeps the hidden photo-viewer subtree active. This wastes CPU/battery measurably during extended slideshow sessions.

**Suggested fix:** Gate the viewer subtree with `{!showLightbox && <div className="photo-viewer-container">...</div>}`, keeping viewer state in parent (it already is: `showLightbox` is parent state). Verify focus restoration on lightbox close (the close handler calls `setShowLightbox(false)` which remounts the viewer — focus should return to the lightbox trigger).

---

## 4. Cycle-2 carry-forward items NOT re-reported (suppressed or resolved)

| ID | Disposition |
|---|---|
| DES-R5C2-04 (empty-state SVG aria-hidden) | FIXED: home-client.tsx:395 now has `aria-hidden="true"` |
| DES-R5C2-05 (locale display names ternary) | FIXED: `LOCALE_DISPLAY_NAMES` map at nav-client.tsx:19-22 |
| DES-R5C2-06 (dead photo-viewer-shortcuts id) | FIXED: `aria-describedby` wired at photo-viewer.tsx:579 |
| DES-R5C2-07 (upload dropzone tag ARIA) | Still needs-manual-validation; not re-reported this cycle |
| DES-R5C2-08 (iOS dvh viewport) | Partially addressed (dvh + safe-area-inset-bottom in inline style); needs device validation; not re-reported |

---

## 5. Plan-315 Designer Items — Implementation Status

| Plan item | Finding | Status |
|---|---|---|
| Item 23 (DES-R5C1-06) | Search backdrop mobile-only | NOT IMPLEMENTED |
| Item 24 (DES-R5C1-07) | Keyboard shortcut hint all breakpoints | NOT IMPLEMENTED — re-reported as DES-R5C3-09 |
| Item 25 (DES-R5C1-08) | Nav backdrop fallback opacity | NOT IMPLEMENTED — re-reported as DES-R5C3-06 |
| Item 26 (DES-R5C1-09) | containIntrinsicSize column-based | NOT IMPLEMENTED — re-reported as DES-R5C3-04 |
| Item 27 (DES-R5C1-10) | Prev/next badge h-11 w-11 | NOT IMPLEMENTED — re-reported as DES-R5C3-03 |
| Item 28 (DES-R5C1-11) | Viewer hidden subtree gate | NOT IMPLEMENTED — re-reported as DES-R5C3-10 |
| Item 29 (DES-R5C1-12) | Peek state backdrop | NOT IMPLEMENTED — re-reported as DES-R5C3-08 |
| Item 30 (DES-R5C1-13) | Sidebar transition-[opacity,transform] | NOT IMPLEMENTED — re-reported as DES-R5C3-05 |
| Item 31 (DES-R5C1-14) | Overlay gradient depth | NOT IMPLEMENTED — re-reported as DES-R5C3-07 |
| Item 32 (DES-R5C1-15) | Lightbox animation reduced-motion (CSS) | COVERED by global `*` reduced-motion block in globals.css:275-283 — functionally addressed |
| Item 33 (DES-R5C1-16) | Blue focus rings → ring-ring tokens | NOT IMPLEMENTED — re-reported as DES-R5C3-02 |

---

## 6. Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRIT | 0 | — |
| HIGH | 1 | DES-R5C3-01 |
| MED | 2 | DES-R5C3-02, DES-R5C3-03 |
| LOW | 7 | DES-R5C3-04 through DES-R5C3-10 |

**Total new findings: 10**

---

## 7. Runtime Verification Summary

| Check | Result |
|---|---|
| Homepage AT snapshot | Pass — correct heading hierarchy (H1, H2 sr-only, H3 per card) |
| Homepage touch targets (nav, tags, photos) | Pass — all 44px at 320px, 768px, 1280px |
| Photo viewer AT snapshot | Pass — H1 sr-only present, `aria-describedby` wired |
| Lightbox focus trap | Pass — focus lands on Close button (44px), trapped inside dialog |
| Admin login form | Pass — all fields and buttons 44px; `role="alert"` fires on wrong password |
| Admin login skip link | FAIL — `#main-content` skip link targets non-existent element on admin pages |
| Korean locale | Pass — all strings translated, no overflow at 320px |
| Dark mode | Pass — nav/body backgrounds adapt correctly |
| Reduced-motion | Pass — global `*` block covers lightbox animations |
| Error page heading | Pass — decorative `aria-hidden`, semantic `sr-only` h1 |
| 404 / shared-group 44px | Pass — `min-h-11` present and renders correctly |
| Info sheet focus-on-open | Pass — close button receives initial focus |

---

## 8. Components Swept

**Runtime:** `/en`, `/en/p/75` (photo viewer + lightbox), `/en/admin` (login form), `/ko` (locale), 320/768/1280px viewports, dark mode, reduced-motion.

**Static:** `components/home-client.tsx`, `components/lightbox.tsx`, `components/photo-viewer.tsx`, `components/info-bottom-sheet.tsx`, `components/nav-client.tsx`, `components/search.tsx`, `components/on-this-day-widget.tsx`, `components/lightbox-color-pip.tsx`, `components/image-manager.tsx`, `components/bulk-edit-dialog.tsx`, `components/color-details-section.tsx`, `components/tag-filter.tsx`, `components/photo-navigation.tsx`, `app/[locale]/error.tsx`, `app/[locale]/not-found.tsx`, `app/[locale]/layout.tsx`, `app/[locale]/admin/layout.tsx`, `app/[locale]/globals.css`.
