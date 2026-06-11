# GalleryKit UI/UX Designer Review — R5C1
**Date:** 2026-06-11  
**Reviewer:** oh-my-claudecode:designer (static analysis, no runtime)  
**Scope:** `apps/web/src/components/**`, `apps/web/src/app/[locale]/**`, `messages/en.json`, `messages/ko.json`, `globals.css`

---

## Methodology

All findings are text-evidence–based with file+line citations. No screenshots; app was not booted (requires MySQL). Confidence levels: **confirmed** = pattern directly visible in source; **likely** = deduced from component contract; **needs-manual-validation** = requires a browser run to verify.

---

## Findings

---

### DES-R5C1-01
**Severity:** HIGH  
**Classification:** confirmed  
**File:** `apps/web/src/components/upload-dropzone.tsx` lines 398–411  
**Problem:** The react-dropzone root `<div {...getRootProps()}>` receives `role="presentation"` and a `tabIndex={0}` from react-dropzone's internal injection, but has no explicit `aria-label` and no associated `<label>` element. The only accessible description is the inline `<p>` text "Drop photos here / or click to browse", which is not wired as the element's accessible name. Screen-reader users activating this zone hear nothing meaningful about what the drop target accepts or does.  
**Who it affects:** Blind/low-vision admins uploading photos (the primary admin workflow). VoiceOver / NVDA will announce the element as a generic region with no name.  
**Suggested fix:** Add `aria-label={t('upload.dropzoneLabel')}` (new i18n key, e.g. "Photo upload area — drag and drop or click to browse") to the `getRootProps()` spread object override, or wrap the entire zone in a `<label>` element with an explicit `htmlFor` pointing to `getInputProps()`'s `id`. Also add `aria-disabled={uploading || !hasTopics}` when the zone is disabled so AT can reflect its inert state.  
**Affected scenario:** Admin opens Upload on mobile, activates the drag zone with a switch-access device. No context is announced.

---

### DES-R5C1-02
**Severity:** HIGH  
**Classification:** confirmed  
**File:** `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx` line 108  
**Problem:** The password change form's submit `<Button type="submit">` has no explicit size prop and no explicit height class. The shadcn Button `default` size renders at `h-10` (40 px), which is below the 44 px WCAG 2.5.5 / project touch-target policy floor documented in CLAUDE.md. The login form (`login-form.tsx:102`) correctly uses `h-11`; the password form missed the same fix.  
**Who it affects:** Mobile admins changing their passwords — the primary security-sensitive self-service action. A 40 px button is a real fat-finger failure surface on phones.  
**Suggested fix:** Add `className="h-11"` (or `size="lg"`) to the submit Button at `password-form.tsx:108` to match the login form pattern.

---

### DES-R5C1-03
**Severity:** HIGH  
**Classification:** confirmed  
**File:** `apps/web/src/components/lightbox.tsx` lines 539–675  
**Problem:** When `controlsVisible` is `false`, the controls overlay applies `{ tabIndex: -1, 'aria-hidden': true }` via `controlVisibilityProps` (line 370) to each interactive control. However, the prev/next navigation buttons (lines 614–650) and the position counter (lines 666–674) receive `controlVisibilityProps` spread, which means they are removed from the focus order AND hidden from AT when hidden. The issue is that the position counter `<div role="status" aria-live="polite">` also receives `controlVisibilityProps` (including `aria-hidden: true`). An `aria-live` region that is simultaneously `aria-hidden` will not announce updates to screen readers, so the position change (e.g. "3 / 20") will never be spoken when navigating while controls are hidden.  
**Who it affects:** Blind/low-vision users navigating the lightbox with keyboard — they will not hear the position counter updates after auto-hide fires.  
**Suggested fix:** Remove `controlVisibilityProps` from the `<div role="status">` counter element at line 666. The live region should always be in the AT tree regardless of visual visibility; use `visibility: hidden` instead of `aria-hidden` if CSS hiding is needed, or simply leave the counter permanently accessible and use opacity for the visual fade.

---

### DES-R5C1-04
**Severity:** HIGH  
**Classification:** confirmed  
**File:** `apps/web/src/components/info-bottom-sheet.tsx` lines 59–65 and 144–153  
**Problem:** When the bottom sheet transitions from `collapsed` → `peek` → `expanded`, focus is programmatically forced to `dragHandleRef` on every non-expanded state change (lines 149–153). This triggers on every intermediate swipe state, not just on open. More critically, at lines 59–65 the sheet resets to `'peek'` on re-open via `useEffect`. Since `dragHandleRef` is also focused on initial open (lines 149–153), users on keyboard who expand → close → reopen will always land on the drag handle button rather than on actionable content. The drag handle has `aria-expanded` but its `aria-label` is `t('viewer.info')` with no description of its current state meaning — the label does not reflect whether it means "expand" or "collapse".  
**Who it affects:** Keyboard and switch-access users on mobile who try to reach the EXIF/download content in the bottom sheet. They must Tab past the drag handle into the expanded content every time.  
**Suggested fix:** On open-to-peek, move focus to the close button (which has more affordance); reserve drag-handle focus only for explicit Tab navigation. Update the drag handle `aria-label` to include state: `t(sheetState === 'expanded' ? 'viewer.collapseSheet' : 'viewer.expandSheet')`.

---

### DES-R5C1-05
**Severity:** HIGH  
**Classification:** confirmed  
**File:** `apps/web/src/components/home-client.tsx` lines 363–375  
**Problem:** On mobile (`sm:hidden`), the masonry card title overlay at lines 363–368 is always visible (not hidden on hover), which is correct for touch. However, on desktop (`hidden sm:block`) the same overlay only reveals on `group-hover:opacity-100` and `group-focus-within:opacity-100`. The `group-focus-within` guard means focus on the `<Link>` inside the card triggers opacity — but the hover overlay contains `<h3>` and `<p>` elements that are not themselves focusable and lack their own ARIA labeling in the fallback state. The primary accessible name comes from `aria-label={t('aria.viewPhoto', { title: displayTitle })}` on the `<Link>`, which is correct. However the P3 gamut badge (`<span role="img" aria-label={...}>`) at lines 352–361 sits inside the `<Link>` and is announced as part of the link name, producing compound reads like "View photo [title] P3 wide-gamut photo." This is redundant for sighted users and confusing for AT since the badge information is also present in the photo-viewer's color details section.  
**Who it affects:** Screen-reader users browsing the gallery grid — every P3 photo's link is announced with a double description.  
**Suggested fix:** Add `aria-hidden="true"` to the P3 badge `<span>` on the masonry card (line 356). The badge is a visual affordance for display-gamut-capable users; AT gets the full color details in the photo viewer. The photo-viewer already provides a dedicated `aria-label` on the badge in the `<ColorDetailsSection>`.

---

### DES-R5C1-06
**Severity:** MEDIUM  
**Classification:** confirmed  
**File:** `apps/web/src/components/search.tsx` lines 305–312  
**Problem:** On mobile (`sm:inset-auto` removed), the search dialog occupies `fixed inset-0` (full-screen overlay) with `h-full`. The close button is present (line 359) and focus trap is active. However, the `FocusTrap` is only rendered when `isOpen` is true (no conditional issues there), but the `<div className="fixed inset-0 bg-black/50 z-40" onClick={handleClose} aria-hidden="true" />` backdrop (line 301) has `z-40` while the dialog wrapper has `z-50`. On mobile full-screen, the backdrop is completely beneath the full-screen dialog, so it can never be clicked (the dialog covers `inset-0`). This is not a bug per se, but the backdrop being rendered with `aria-hidden="true"` on mobile full-screen is misleading — the screen is entirely covered by the dialog and there is no visible backdrop.  
**Separately:** The search input's `<label>` is `sr-only` (line 323), which is correct. But the `<Input>` also has `aria-label={t('search.placeholder')}` at line 329. Having both `<label htmlFor>` and `aria-label` on the same element is redundant — `aria-label` wins the accessible-name computation and makes the `<label>` element's text irrelevant to AT. This is a minor labeling inconsistency, not harmful, but creates maintenance confusion.  
**Who it affects:** Developers maintaining the search input labeling. Also: the backdrop `z-index` situation means the component has dead code on mobile that may confuse future layout work.  
**Suggested fix:** Remove `aria-label` from the `<Input>` at line 329 and rely solely on the `<label htmlFor="search-input">`. Conditionally render the backdrop only on `sm:` and above, or document that on mobile it is a no-op behind the full-screen dialog.

---

### DES-R5C1-07
**Severity:** MEDIUM  
**Classification:** confirmed  
**File:** `apps/web/src/components/photo-viewer.tsx` lines 659–724  
**Problem:** The toolbar buttons "Info" (mobile, line 659–671) and "Info" (desktop pin toggle, lines 708–723) both carry `aria-keyshortcuts="I"` but the key handler at lines 423–429 only fires the `setIsPinned` / `setShowBottomSheet` toggle when `showLightbox` is false. There is no keyboard shortcut hint visible to non-mouse users — the shortcut hint paragraph at line 592 is hidden on mobile (`hidden md:block`). A mobile user with a Bluetooth keyboard will see the `aria-keyshortcuts="I"` attribute in AT output but the shortcut paragraph is hidden. This is a discoverability gap, not a functional breakage.  
**More critically:** The viewer toolbar has no visible focus indicator override — it relies on Tailwind's default `focus-visible:ring-*` from shadcn Button, which may be overridden to `outline: none` on some browser/theme combinations. The `.photo-viewer-toolbar` class in globals.css applies a sticky backdrop on landscape mobile but no focus-override styles.  
**Suggested fix:** Keep the shortcut hint visible on all viewport sizes (`block` instead of `hidden md:block`), or add a tooltip on the button. This is a perceived-performance / UX quality issue.

---

### DES-R5C1-08
**Severity:** MEDIUM  
**Classification:** confirmed  
**File:** `apps/web/src/components/nav-client.tsx` lines 73–112  
**Problem:** The sticky nav uses `bg-background/50 backdrop-blur-xl` with `supports-[backdrop-filter]:bg-background/20`. On browsers/devices where `backdrop-filter` is not supported (older Android WebView, some Samsung Browser versions), the background falls back to `bg-background/50` (50% opacity). At 50% opacity over white page content, the dark foreground text on a near-transparent background may fail WCAG AA contrast in light mode (hsl(240 10% 3.9%) at 50% blend over white gives an effective ~12% gray, not the full `--foreground`). The actual contrast depends on the underlying page content (photos vs. white space), but a systematically transparent nav creates a contrast risk during scrolling.  
**Who it affects:** Users on older Android browsers (WebView-based apps, Samsung Browser < 12) where backdrop-filter is unsupported. Low-vision users relying on the nav text to be readable.  
**Suggested fix:** Change the fallback from `bg-background/50` to `bg-background/90` or `bg-background` so the nav text remains WCAG AA compliant when backdrop-filter is absent. The blur effect is purely decorative; the opacity reduction is the risk.

---

### DES-R5C1-09
**Severity:** MEDIUM  
**Classification:** confirmed  
**File:** `apps/web/src/components/home-client.tsx` lines 240–379  
**Problem:** Dynamic Tailwind class generation — `columns-${colBase}`, `sm:columns-${colSm}`, `md:columns-${colMd}`, `xl:columns-${colXl}`, `2xl:columns-${col2xl}` at line 240 — depends on the Tailwind safelist in `tailwind.config.ts`. The safelist (confirmed present: lines 11–16) includes the variants. However `colBase` is computed as `Math.min(itemCount, 1)` (line 187), which is always `1` regardless of item count (a single image always gives `columns-1`). This is correct for `colBase` (the base breakpoint below `sm`), but the variable name `colBase` is misleading; it's not the "base column count" but the "under-sm column count." Not a bug, but a readability issue.  
**Separate CLS concern:** The masonry cards use `style={{ aspectRatio: '${w}/${h}' }}` (line 259) and `containIntrinsicSize` (line 261), which is a good CLS mitigation. However `containIntrinsicSize` uses a fixed estimated 300px base width. On mobile single-column layout, a card could be 390px wide, making the `containIntrinsicSize` height estimate wrong by ~30%. This causes the browser to reserve the wrong amount of space before `content-visibility: auto` renders the card, potentially causing minor CLS on slow connections.  
**Who it affects:** Users on slow connections; Core Web Vitals LCP/CLS scores.  
**Suggested fix:** Use viewport-relative width for `containIntrinsicSize` estimation, or compute estimated width from column count: e.g. `Math.round((window.innerWidth / columnCount) * image.height / image.width)`.

---

### DES-R5C1-10
**Severity:** MEDIUM  
**Classification:** confirmed  
**File:** `apps/web/src/components/lightbox.tsx` lines 613–650 (prev/next buttons)  
**Problem:** The previous and next navigation buttons span `h-full w-16` of the screen height — they are full-height hit targets along the left and right edges. This is intentional and good for touch. However the visible hit-target indicator is a `h-10 w-10` circular badge (lines 627, 647), which is 40px — below the 44px floor. The outer button itself satisfies the touch target via `h-full`, but the visual affordance misleads users about the actual tap zone. More importantly, in reduced-motion mode and on browsers without CSS `pointer: fine`, the full-height edge buttons overlap with the `<picture>` click (which calls `e.stopPropagation()`), so a click on the image center does NOT trigger close, but a click on the side 64px strips does trigger navigation — which can be surprising.  
**Suggested fix:** Minor: bump the inner `<span>` badge to `h-11 w-11` for visual parity with the touch target floor. The functional behavior is acceptable.

---

### DES-R5C1-11
**Severity:** MEDIUM  
**Classification:** likely  
**File:** `apps/web/src/components/photo-viewer.tsx` line 579  
**Problem:** `<div className={cn("flex flex-col h-full min-h-[calc(100vh-8rem)] photo-viewer-container", showLightbox && "hidden")}>` — when the lightbox is open, the entire photo viewer is `display: none` via the `hidden` class. The viewer still exists in the DOM and its keyboard handler (line 412) is still registered on `window`. Since the lightbox has its own `window.addEventListener('keydown', ...)` handler (lightbox.tsx line 307), both handlers coexist. The photo viewer handler at line 415 checks `if (showLightbox) return` — correctly bailing out. However framer-motion's `AnimatePresence` (line 777) and the `useEffect` for `imageLoaded` reset (line 165) continue running. No functional bug, but idle effects on a hidden subtree waste CPU during slideshow playback.  
**Suggested fix:** Conditionally render the viewer below the lightbox toggle instead of `display: none` — or gate the framer-motion `AnimatePresence` rendering on `!showLightbox`.

---

### DES-R5C1-12
**Severity:** MEDIUM  
**Classification:** confirmed  
**File:** `apps/web/src/components/info-bottom-sheet.tsx` lines 193–199  
**Problem:** The backdrop `<div className="fixed inset-0 z-40 bg-black/40">` is only rendered when `sheetState === 'expanded'`. In `'peek'` state, there is no backdrop — the photo behind is fully interactive. This means that while the bottom sheet is open in peek state, touch targets behind it (e.g. the photo navigation swipe area, the masonry grid links if the sheet is on the photo-viewer) remain active. The FocusTrap is active regardless of sheet state (line 202, `active={isOpen}`), which is correct for keyboard users. But on touch, a tap behind a peek-state sheet doesn't close it — the user has to use the close button or drag. This is acceptable UX, but the gap between "touch closes nothing" (peek) vs. "touch collapses to peek" (expanded via backdrop click, line 126–132) is inconsistent.  
**Who it affects:** Mobile users who expect a tap-outside-to-close behavior consistently across sheet states.  
**Suggested fix:** Add a backdrop in `'peek'` state too (with lower opacity, e.g. `bg-black/20`) that calls `onClose()` on click, creating consistent tap-to-dismiss behavior across states.

---

### DES-R5C1-13
**Severity:** MEDIUM  
**Classification:** confirmed  
**File:** `apps/web/src/components/photo-viewer.tsx` lines 803–805  
**Problem:** The info sidebar scroll container uses `overflow-y-auto` on the `<Card>` (line 808) but the surrounding div has `transition-all duration-500 ease-in-out overflow-hidden` (line 803). When the sidebar closes, `overflow-hidden` clips content mid-transition. During the 500ms animation, the sidebar content (especially long EXIF grids, histogram, download buttons) is visually clipped as it animates out via `lg:w-0`. This produces a jarring "content squish" effect on close rather than a clean fade. On low-end devices, the combination of `transition-all` (animates width, opacity, and transform simultaneously) and framer-motion `AnimatePresence` on the image causes two simultaneous CSS and JS animations, potentially dropping frames.  
**Who it affects:** All desktop users toggling the info sidebar. Particularly noticeable on integrated-GPU laptops.  
**Suggested fix:** Replace `transition-all` with `transition-[opacity,transform,width]` to limit the animated properties. Consider using `transition-opacity` and `translate-x` only (no width animation) — let the grid reflow handle the layout shift on open, and use opacity for the close.

---

### DES-R5C1-14
**Severity:** MEDIUM  
**Classification:** confirmed  
**File:** `apps/web/src/components/home-client.tsx` lines 363–378  
**Problem:** Mobile masonry card overlays use `bg-gradient-to-b from-black/65 to-transparent` (line 363). On desktop, hover shows `bg-gradient-to-t from-black/60 to-transparent` (line 369). These gradients are rendered over photos with extremely varied tonal content. For light-toned images (e.g. snowy landscapes, white-walled architecture), the gradient text overlay will have insufficient contrast even at `black/65` — white text on a half-transparent dark overlay over white image content can fall below 3:1 depending on the specific image. This is inherent to photo overlays but the project CLAUDE.md explicitly documents a WCAG AA goal.  
**Who it affects:** Users with low vision trying to read the card title on high-key (bright) photos.  
**Suggested fix:** Bump the mobile overlay to `from-black/75` and desktop hover to `from-black/70` for a more reliable contrast floor. Alternatively, add `text-shadow: 0 1px 3px rgba(0,0,0,0.8)` via a Tailwind arbitrary utility on `h3` elements.

---

### DES-R5C1-15
**Severity:** MEDIUM  
**Classification:** confirmed  
**File:** `apps/web/globals.css` lines 275–284  
**Problem:** The `@media (prefers-reduced-motion: reduce)` rule at line 275 blanket-sets `animation-duration: 0.01ms !important` and `transition-duration: 0.01ms !important` on `*`, `*::before`, and `*::after`. This is correct and intentional. However, the Ken Burns `@keyframes lightbox-ken-burns-0/1` at lines 265–272 are NOT suppressed by this rule in all browsers because they are applied via inline `style.animation` in `lightbox.tsx` line 528 (`animation: \`lightbox-ken-burns-${kenBurnsVariant} ${kenBurnsDuration} ...\``). The `!important` `animation-duration: 0.01ms` on `*` applies to the element, but an inline style `animation` shorthand may override the duration sub-property in some browser implementations. The JS-side guard `!shouldReduceMotion` at line 470 prevents setting the animation inline — this is correct. So this is not a bug IF the JS gate fires. But the CSS rule provides no belt-and-suspenders fallback for the case where the JS-side `shouldReduceMotion` fails to hydrate (e.g. initial SSR render before hydration completes, or a future regression).  
**Suggested fix:** Add `@media (prefers-reduced-motion: reduce) { .lightbox-image { animation: none !important; } }` explicitly in globals.css for the specific Ken Burns animation classes as a belt-and-suspenders CSS guard independent of the JS state.

---

### DES-R5C1-16
**Severity:** MEDIUM  
**Classification:** confirmed  
**File:** `apps/web/src/components/lightbox.tsx` lines 547–563 (close button) and `info-bottom-sheet.tsx` line 214  
**Problem:** The lightbox close button uses a non-standard custom `focus-visible:outline` (blue-500 hardcoded, lines 550, 570, 594, etc.) instead of the design-system `focus-visible:ring-ring` token. This creates an inconsistent focus ring color between the lightbox buttons (hardcoded `blue-500`/`blue-400`) and all other interactive elements in the app (which use `ring-ring`, currently `oklch(20.5% 0.01 264)` in light mode — near-black). In dark and OLED themes, `blue-400` is visible but diverges from the app's focus ring system. In Windows High Contrast Mode, hardcoded `blue-500` may be overridden by the forced-colors palette but inconsistently.  
**Who it affects:** Keyboard users in dark/OLED themes who rely on focus rings for orientation. The blue ring on a black background is higher contrast than the default dark theme ring (`ring-ring` = near-white in dark), so this is not a WCAG failure, but it is an inconsistency.  
**Suggested fix:** Replace `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400` with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` on all lightbox control buttons to use the design system token.

---

### DES-R5C1-17
**Severity:** LOW  
**Classification:** confirmed  
**File:** `apps/web/src/components/nav-client.tsx` line 164  
**Problem:** The locale-switch button's visible label is `{otherLocale.toUpperCase()}` — "EN" or "KO". This is a two-character label that visually communicates the language switch target. The `aria-label` is `t('aria.switchLocale', { language: otherLocale === 'ko' ? '한국어' : 'English' })`, which is better for AT. However, the hardcoded ternary `otherLocale === 'ko' ? '한국어' : 'English'` will break if a third locale is ever added — it silently falls through to `'English'` for any locale other than `'ko'`. This is a maintainability issue embedded in an accessibility-critical attribute.  
**Suggested fix:** Derive the language name from a locale → display-name map that i18n can own, e.g. a `localeDisplayNames` constant, rather than a hardcoded ternary.

---

### DES-R5C1-18
**Severity:** LOW  
**Classification:** confirmed  
**File:** `apps/web/src/components/photo-viewer.tsx` line 592  
**Problem:** The keyboard shortcut hint `<p className="mb-2 text-xs text-muted-foreground hidden md:block">` has `id="photo-viewer-shortcuts"` but nothing references this id via `aria-describedby`. It serves only as a visual reminder. At `--muted-foreground: 240 3.8% 40%` on white (computed contrast ~6.1:1), this text passes WCAG AA (≥4.5:1 for normal text). However at `text-xs` (12px), the WCAG AA threshold for small text is 4.5:1 and AAA is 7:1 — 6.1:1 is AA but not AAA. This is acceptable under WCAG AA.  
**Separate issue in same area:** The `id="photo-viewer-shortcuts"` attribute is declared on line 592 but no element has `aria-describedby="photo-viewer-shortcuts"`, making it a dead ID. Dead IDs don't break anything but fail HTML validators.  
**Suggested fix:** Either wire `aria-describedby="photo-viewer-shortcuts"` to the photo viewer container, or remove the dead `id` attribute.

---

### DES-R5C1-19
**Severity:** LOW  
**Classification:** confirmed  
**File:** `apps/web/src/components/home-client.tsx` lines 393–408  
**Problem:** The empty-state element uses a raw inline SVG without an `aria-label` or `aria-hidden` attribute (line 397). Screen readers will announce the SVG's `<path>` element as an unnamed graphic. The SVG is decorative (the accompanying text `t('home.noImages')` provides the message), so it should be `aria-hidden="true"`.  
**Suggested fix:** Add `aria-hidden="true"` to the `<svg>` at line 397.

---

### DES-R5C1-20
**Severity:** LOW  
**Classification:** confirmed  
**File:** `apps/web/src/components/upload-dropzone.tsx` lines 486–490  
**Problem:** Global tags displayed on per-file preview cards use a `<span>` with `opacity-60 cursor-not-allowed` styling but have no ARIA attribute communicating their read-only/inherited state. Screen-reader users cannot distinguish these greyed inherited global tags from editable per-file tags in the list. Both appear as plain `<span>` elements with no role.  
**Suggested fix:** Add `aria-label={t('upload.globalTagInherited', { tag })}` to inherited tag spans, or group them under a `<fieldset>` with `<legend>` separating "Inherited tags" from "File-specific tags".

---

### DES-R5C1-21
**Severity:** LOW  
**Classification:** confirmed  
**File:** `apps/web/src/app/[locale]/error.tsx` line 21  
**Problem:** The error page has `<h1 id="route-error-title" className="text-7xl font-bold text-muted-foreground/30">` with `t('error.title')`. The `text-7xl` heading with `text-muted-foreground/30` opacity means `--muted-foreground` at 30% opacity over `--card` background. In light mode: `240 3.8% 40%` at 30% alpha over white = approximately `#d3d3d7` on white. This fails WCAG AA for normal text contrast (contrast ≈ 1.4:1). The heading is the large decorative "Error" (or equivalent) string. However it is the semantic `<h1>` and the primary heading AT would announce.  
**Who it affects:** Low-vision users who rely on heading text contrast for page orientation.  
**Suggested fix:** This decorative oversized heading pattern is intentional (mirrors the 404 page), but the `h1` should have a separate visible heading at normal opacity. Move the large `text-7xl` decorative numeral/word to `aria-hidden="true"` and add a visible `<h1>` at normal contrast below it — the same pattern used in `not-found.tsx` (line 29 correctly uses `aria-hidden` on the "404" span).

---

### DES-R5C1-22
**Severity:** LOW  
**Classification:** confirmed  
**File:** `apps/web/src/components/lightbox.tsx` lines 666–674  
**Problem:** The position counter `{currentIndex + 1} / {totalCount}` renders as raw text nodes inside a `role="status" aria-live="polite"` div. When AT reads this, it announces "3 / 20" without context. There is no human-readable label like "Photo 3 of 20." The `aria-label` on the counter div itself could provide context, but none is present. Compare: the masonry grid's live region at `photo-viewer.tsx:796` uses `aria-label={t('aria.photoPosition', { current: currentIndex + 1, total: images.length })}` (the full translated string) to provide context — the lightbox counter is missing this pattern.  
**Suggested fix:** Add `aria-label={t('aria.photoPosition', { current: currentIndex + 1, total: totalCount })}` to the counter div in `lightbox.tsx:669`, mirroring the photo-viewer pattern.

---

### DES-R5C1-23
**Severity:** LOW  
**Classification:** needs-manual-validation  
**File:** `apps/web/src/components/info-bottom-sheet.tsx` line 221  
**Problem:** The bottom sheet uses `maxHeight: '95dvh'` via inline style (two assignments: lines 221 and 222 in the `style` object, with the second object spread `{...({'maxHeight': '95dvh'} as React.CSSProperties)}` intentionally overriding the first `'95vh'` for `dvh`-capable browsers). The `overflowY` is `auto` in expanded state. On iOS Safari 15.x (not 16+), `dvh` is not supported, and the `95vh` fallback is used — but iOS 15 Safari's address bar causes the viewport height to vary during scroll, potentially causing the sheet to extend behind the home indicator or be cut off. This needs manual validation on a physical device.  
**Suggested fix:** Add `padding-bottom: env(safe-area-inset-bottom, 0px)` as a `paddingBottom` in the sheet's `style` (already present in the content div's inline style at line 302, but not on the outer sheet container). Verify the home-indicator clearance on iOS 15/16 Safari.

---

### DES-R5C1-24
**Severity:** LOW  
**Classification:** confirmed  
**File:** `apps/web/src/components/photo-viewer.tsx` lines 852–855  
**Problem:** In the info sidebar's EXIF grid, EXIF label text uses `<p className="text-muted-foreground text-xs">` (e.g. "Camera", "Lens", "ISO"). At `text-xs` (12px) with `--muted-foreground: 240 3.8% 40%` on `--card` background (white in light mode), contrast is ~6.1:1. This passes WCAG AA (4.5:1 threshold for small text). However the text is rendered as small secondary metadata labels that some users with low vision may find difficult at 12px even at 6:1 contrast. This is a marginal finding at the LOW threshold — no fix strictly required for WCAG AA compliance.  
**Note:** The same pattern appears in `info-bottom-sheet.tsx` throughout the EXIF grid (e.g. lines 359–460).

---

### DES-R5C1-25
**Severity:** LOW  
**Classification:** confirmed  
**File:** `apps/web/src/components/home-client.tsx` line 369  
**Problem:** Desktop masonry card hover overlay (`sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100`) uses `transition-opacity duration-300`. The `duration-300` transition is NOT gated on `prefers-reduced-motion`. The `globals.css` blanket rule at line 275 suppresses all transitions via `!important`, which should catch this. However, the `transition-opacity duration-300` Tailwind class generates `transition-property: opacity; transition-duration: 300ms` without `!important`, and the globals rule uses `transition-duration: 0.01ms !important`. The `!important` in globals.css should win over the non-`!important` Tailwind utility, so this is technically handled. But it relies entirely on the globals.css rule — the component itself has no explicit reduced-motion check.  
**Suggested fix:** This is acceptable given the globals.css blanket rule, but for documentation clarity, add a comment noting the reduced-motion behavior is CSS-handled globally.

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 5 |
| MEDIUM | 8 |
| LOW | 12 |
| **Total** | **25** |

---

## HIGH Summary (one-line each)

- **DES-R5C1-01** (`upload-dropzone.tsx:398`): Dropzone `<div>` has no `aria-label` — screen readers cannot name the file upload target.
- **DES-R5C1-02** (`password-form.tsx:108`): Password form submit button renders at `h-10` (40px) — below the project's 44px touch-target floor.
- **DES-R5C1-03** (`lightbox.tsx:666`): `role="status" aria-live` position counter receives `aria-hidden: true` when controls are hidden — position updates never announced to AT.
- **DES-R5C1-04** (`info-bottom-sheet.tsx:149`): Focus forced to drag-handle button on every non-expanded state change — keyboard users always land on a low-value handle instead of actionable content.
- **DES-R5C1-05** (`home-client.tsx:352`): P3 gamut badge inside the masonry `<Link>` is announced by AT as part of the link name, producing redundant double-description reads for every wide-gamut photo.
