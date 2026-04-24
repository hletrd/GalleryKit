# Designer — Cycle 14

## Component Inventory

**44 component files reviewed** across `apps/web/src/components/` and `apps/web/src/app/[locale]/`.

### Public-facing components
- `nav.tsx`, `nav-client.tsx`, `footer.tsx`, `home-client.tsx`
- `lightbox.tsx`, `photo-viewer.tsx`, `image-zoom.tsx`, `photo-navigation.tsx`
- `info-bottom-sheet.tsx`, `histogram.tsx`
- `search.tsx`, `tag-filter.tsx`, `load-more.tsx`, `topic-empty-state.tsx`
- `optimistic-image.tsx`

### Admin components
- `admin-header.tsx`, `admin-nav.tsx`, `admin-user-manager.tsx`
- `upload-dropzone.tsx`, `image-manager.tsx`, `tag-input.tsx`

### UI primitives (shadcn/ui)
- `button.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `select.tsx`, `sheet.tsx`
- `input.tsx`, `textarea.tsx`, `switch.tsx`, `alert-dialog.tsx`, `alert.tsx`
- `badge.tsx`, `card.tsx`, `label.tsx`, `progress.tsx`, `scroll-area.tsx`
- `separator.tsx`, `skeleton.tsx`, `table.tsx`, `aspect-ratio.tsx`, `sonner.tsx`

### Providers
- `theme-provider.tsx`, `i18n-provider.tsx`, `lazy-focus-trap.tsx`

### Page-level files
- `(public)/layout.tsx`, `(public)/page.tsx`, `(public)/[topic]/page.tsx`
- `(public)/p/[id]/page.tsx`, `(public)/g/[key]/page.tsx`, `(public)/s/[key]/page.tsx`
- `admin/layout.tsx`, `admin/page.tsx`, `admin/login-form.tsx`
- `admin/(protected)/layout.tsx`, loading, error, not-found pages
- `admin/(protected)/dashboard/`, `categories/`, `tags/`, `seo/`, `settings/`, `password/`, `db/`, `users/`

---

## Findings

### UX-14-01: No RTL support — zero `dir` attributes anywhere in the codebase [HIGH] [HIGH confidence]
- **File**: Global — no file contains `dir="rtl"` or `dir="auto"`
- **Description**: The app supports Korean (ko) and English (en) locales. While Korean is not RTL, if any future locale is added (e.g., Arabic, Hebrew), the entire layout will break. More immediately, the `nav-client.tsx` expand/collapse, `info-bottom-sheet.tsx` drag handle, `admin-nav.tsx` horizontal scroll, and `photo-navigation.tsx` prev/next arrows all assume LTR. The `i18n-provider.tsx` wrapper doesn't set `dir` on `<html>`. The `next-intl` middleware also doesn't configure `dir`.
- **UX Impact**: If an RTL locale is ever added, the entire UI will be mirrored incorrectly — navigation, text alignment, icon directions, and swipe gestures will all be wrong. Even now, the `<html>` element lacks a `dir` attribute which is a WCAG 1.3.2 requirement for screen readers to correctly interpret bidirectional text.
- **Suggested Fix**: Set `dir` attribute on `<html>` in the root layout based on locale. Add `dir="auto"` on user-generated content fields (image titles, descriptions, tag names). Ensure CSS uses logical properties (`ms-`/`me-` instead of `ml-`/`mr-`) for spacing that should flip in RTL.
- **Confidence**: HIGH

### UX-14-02: Login form uses `sr-only` labels — no visible labels above inputs [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/[locale]/admin/login-form.tsx` lines 39-42
- **Description**: Both the username and password inputs have `<label>` elements with `className="sr-only"`, making the labels invisible. The inputs rely solely on `placeholder` text for identification. Placeholders disappear when the user starts typing, and screen magnifier users may not see them at all.
- **UX Impact**: WCAG 1.3.1 (Info and Relationships) and 3.3.2 (Labels or Instructions) — while programmatically associated labels exist, the visual design lacks persistent field labels. Users who type slowly or review their input lose the field context. This also affects users with cognitive disabilities who benefit from always-visible labels.
- **Suggested Fix**: Replace `sr-only` labels with visible labels above each input, consistent with the admin user creation form (`admin-user-manager.tsx` lines 101-111) which uses visible `<label>` elements. Or at minimum, use floating labels that remain visible.
- **Confidence**: HIGH

### UX-14-03: Photo navigation buttons invisible on desktop until hover — keyboard-only users cannot discover them [HIGH] [HIGH confidence]
- **File**: `apps/web/src/components/photo-navigation.tsx` lines 195, 209
- **Description**: The prev/next navigation buttons use `lg:opacity-0 lg:group-hover:opacity-100` — they are completely invisible on desktop until mouse hover. However, keyboard focus does not trigger `group-hover`, so a keyboard user Tab-ing to these buttons will see an invisible focus target. The `opacity-0` element still receives focus (visible via the focus ring on the Button), but the button content (chevron icons and background) is invisible.
- **UX Impact**: WCAG 1.4.1 (Use of Color) and 2.1.1 (Keyboard) — keyboard-only users cannot visually discover navigation buttons. The focus ring appears on an invisible element, which is confusing. This is a significant usability gap for keyboard-only and screen magnifier users.
- **Suggested Fix**: Add `lg:focus-within:opacity-100` alongside the hover rule, or better, use `lg:group-hover:opacity-100 lg:group-focus-within:opacity-100` so the buttons appear when any child receives focus. Alternatively, always show buttons on desktop with reduced opacity (e.g., `lg:opacity-40 lg:hover:opacity-100`).
- **Confidence**: HIGH

### UX-14-04: `info-bottom-sheet.tsx` backdrop not accessible — no keyboard dismiss path when sheet is in `peek` state [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/components/info-bottom-sheet.tsx` lines 99-105, 140-145
- **Description**: When the sheet is in `collapsed` or `peek` state, there is no backdrop (lines 140-145 only render backdrop when `expanded`). The Escape key handler (lines 107-114) always calls `onClose()`, which is correct, but there's no visible affordance that Escape works in the peek/collapsed states. Additionally, the backdrop `onClick` (line 143) has no `role` or keyboard handler — it's a mouse-only interaction.
- **UX Impact**: In the `peek` state, keyboard users must know to press Escape to dismiss; there's no visual cue. The backdrop click is mouse-only. WCAG 2.1.1 requires all functionality available via mouse also be available via keyboard.
- **Suggested Fix**: The Escape key handling is sufficient for keyboard users, but consider adding a visible close button in the peek state header area. The backdrop `<div>` already works as a click target; no additional keyboard handling is needed since the backdrop is only visible in `expanded` state where Escape works.
- **Confidence**: MEDIUM

### UX-14-05: `image-manager.tsx` checkbox inputs lack visible focus indicator consistency [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/components/image-manager.tsx` lines 303-309, 324-330
- **Description**: The "select all" and per-row checkboxes use raw `<input type="checkbox">` with `className="h-4 w-4 rounded border-gray-300 text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"`. These are native browser checkboxes, not the shadcn Checkbox component. The focus ring styles are defined, but the native checkbox appearance (check mark, border) varies across browsers and doesn't match the shadcn/ui design system used everywhere else.
- **UX Impact**: Visual inconsistency with the rest of the admin UI. On some browsers (especially Firefox), the native checkbox focus ring may not render correctly with these Tailwind classes. The checkboxes also lack the animation and visual polish of shadcn components.
- **Suggested Fix**: Replace native `<input type="checkbox">` with shadcn's `Checkbox` component for visual consistency and better cross-browser focus indicator behavior.
- **Confidence**: HIGH

### UX-14-06: Search component result thumbnails hardcoded to `_640.jpg` [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/components/search.tsx` line 210
- **Description**: `imageUrl(\`/uploads/jpeg/${image.filename_jpeg?.replace(/\.jpg$/i, '_640.jpg')}\`)` — if `image_sizes` doesn't include 640, this URL will 404 and the thumbnail won't render. This is the same class of bug as UX-13-03 (histogram hardcoded size), which was fixed for the histogram but not for search thumbnails.
- **UX Impact**: Broken search result thumbnails if admin removes 640 from configured sizes. Search results would show empty/broken image placeholders.
- **Suggested Fix**: Use `findNearestImageSize(imageSizes, 640)` like the histogram fix, or use the smallest configured size as the thumbnail source. The search component needs `imageSizes` passed as a prop.
- **Confidence**: MEDIUM

### UX-14-07: Admin nav horizontal scroll has no scroll indicator or keyboard accessibility [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/components/admin-nav.tsx` lines 27-44
- **Description**: The admin navigation uses `overflow-x-auto scrollbar-hide` which hides the scrollbar. On narrow viewports, links beyond the visible area are inaccessible to keyboard users because they're not focusable when scrolled out of view (actually they ARE focusable via Tab, but there's no visual indication that more items exist off-screen). There's also no left/right scroll affordance for mouse users.
- **UX Impact**: Keyboard users can Tab to off-screen links but won't see them scroll into view (no `scroll-into-view` on focus). Mouse users have no indication that more nav items exist. WCAG 1.4.13 (Content on Hover or Focus) and 2.4.7 (Focus Visible) concerns.
- **Suggested Fix**: Add `scrollIntoView({ block: 'nearest', inline: 'nearest' })` on focus for each `<Link>`. Add fade-gradient indicators on edges when content overflows. Consider wrapping on smaller viewports or using a Sheet-based mobile nav pattern.
- **Confidence**: MEDIUM

### UX-14-08: Error page retry button uses raw `<button>` without Button component styling consistency [LOW] [HIGH confidence]
- **File**: `apps/web/src/app/[locale]/error.tsx` lines 22-27
- **Description**: The "Try Again" button uses a raw `<button>` with inline Tailwind classes (`px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm`) instead of the shadcn `Button` component. This means it misses out on focus-visible ring styles, disabled states, and the component's consistent hover behavior.
- **UX Impact**: The error page button lacks the `focus-visible:ring-[3px]` focus indicator that all other buttons in the app have. This violates visual consistency and WCAG 2.4.7 (Focus Visible).
- **Suggested Fix**: Replace the raw `<button>` with the `Button` component from `@/components/ui/button`.
- **Confidence**: HIGH

### UX-14-09: `image-zoom.tsx` zoom state not announced to screen readers in real-time [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/components/image-zoom.tsx` lines 116-145
- **Description**: The zoom component has `role="button"`, `tabIndex={0}`, and `aria-label` that changes between "Zoom in" and "Zoom out" — which is good. However, when a screen reader user activates the zoom, the `aria-label` change alone may not be announced. There's no `aria-live` region to announce the zoom state change.
- **UX Impact**: Screen reader users may not be informed that the image is now zoomed and they can use mouse/touch to pan. The zoom state change is communicated only through `aria-label` mutation, which some screen readers don't announce automatically.
- **Suggested Fix**: Add a visually hidden `aria-live="polite"` region that announces zoom state changes, similar to the pattern used in `photo-navigation.tsx` line 222 and `load-more.tsx` line 93.
- **Confidence**: MEDIUM

### UX-14-10: Upload dropzone file remove button has poor discoverability on desktop — `sm:opacity-0` with only `group-hover` reveal [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/components/upload-dropzone.tsx` lines 288-296
- **Description**: The per-file remove button uses `sm:opacity-0 sm:group-hover:opacity-100 opacity-100 focus:opacity-100`. On desktop (sm+), the remove button is invisible until mouse hover on the card. Keyboard users can Tab to the button (the `focus:opacity-100` helps), but there's no visual cue that the button exists before focus reaches it. On touch devices it's always visible (`opacity-100` at mobile), which is fine.
- **UX Impact**: Desktop users may not realize they can remove individual files. The `focus:opacity-100` mitigates the keyboard concern, but the discoverability issue remains for mouse users who don't hover over each card.
- **Suggested Fix**: Consider a subtle always-visible state like `sm:opacity-30 sm:hover:opacity-100 sm:focus-within:opacity-100` to hint at the button's presence without visual clutter.
- **Confidence**: MEDIUM

### UX-14-11: `TagFilter` buttons lack `type="button"` to prevent unintended form submission [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/components/tag-filter.tsx` lines 57-64, 76-85
- **Description**: The `<button>` elements inside `TagFilter` do have `type="button"` — upon closer inspection, this is fine. However, the `Badge` component wraps these buttons, and the `asChild` pattern with Radix means the `Badge` styling is applied to the `<button>`. The `aria-pressed` attribute is correctly used. No issue here on re-examination.
- **UX Impact**: N/A (no issue found on closer look)
- **Suggested Fix**: N/A
- **Confidence**: LOW (withdrawn — components are correct)

### UX-14-12: `photo-viewer.tsx` sidebar info panel uses `hidden lg:block` which prevents screen reader access on mobile [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/components/photo-viewer.tsx` lines 320-322
- **Description**: The desktop info sidebar uses `hidden lg:block` which completely removes it from the layout and accessibility tree on viewports below `lg`. The mobile equivalent is the `InfoBottomSheet`, but it only opens when the user clicks the "Info" button. Screen reader users on mobile have no way to access the EXIF data without finding and activating the Info button.
- **UX Impact**: On mobile, the photo metadata (EXIF, title, description) is only accessible through an explicit user action (Info button). This isn't necessarily a bug — it's a design choice for mobile screen real estate — but the Info button itself has no affordance beyond the icon + label. The bigger concern: the sidebar content has no `aria-live` region to announce when it becomes visible on desktop.
- **Suggested Fix**: Ensure the Info button on mobile is clearly labeled and discoverable. Consider adding a screen-reader-only announcement when the bottom sheet opens. On desktop, when the sidebar toggles, consider an `aria-live` polite announcement.
- **Confidence**: HIGH

### UX-14-13: `TagInput` combobox dropdown doesn't have `aria-activedescendant` tracking [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/components/tag-input.tsx` lines 140-156
- **Description**: The input has `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, and `aria-controls="tag-suggestions"` — all correct per WAI-ARIA combobox pattern. However, it's missing `aria-activedescendant` to track which option is currently highlighted. The `highlightedIndex` state exists and visual highlighting works, but screen readers won't announce which option has focus.
- **UX Impact**: Screen reader users navigating the dropdown with arrow keys won't hear which option is currently selected/highlighted. This violates the WAI-ARIA Authoring Practices for combobox (1.10 pattern) and WCAG 4.1.2 (Name, Role, Value).
- **Suggested Fix**: Add `aria-activedescendant={highlightedIndex >= 0 ? `tag-option-${filteredTags[highlightedIndex]?.id}` : undefined}` to the input element. Add corresponding `id` attributes to each option `div` (e.g., `id="tag-option-${tag.id}"`).
- **Confidence**: MEDIUM

### UX-14-14: Lightbox controls auto-hide after 3 seconds — no persistent accessibility for screen magnifier users [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/components/lightbox.tsx` lines 69-91, 223-295
- **Description**: The lightbox controls (close, fullscreen, prev/next) auto-hide after 3 seconds of no mouse movement. They reappear on mouse move. For screen magnifier users or users with motor impairments who take longer to acquire targets, the 3-second timeout may be too short. The controls also don't reappear on keyboard focus since the auto-hide is driven by mouse events only.
- **UX Impact**: Keyboard users in the lightbox can Tab to the close/fullscreen buttons, but the visual container remains invisible (`opacity: 0`) — only the focused button's focus ring is visible. This is a WCAG 2.2.1 (Timing Adjustable) concern for users who need more time.
- **Suggested Fix**: Keep controls visible when any control has focus: add `focus-within` handler to the controls overlay div to cancel the auto-hide timer and set `controlsVisible = true` when a child has focus. Consider also increasing the timeout to 5 seconds, or making it configurable.
- **Confidence**: MEDIUM

### UX-14-15: `globals.css` reduced-motion media query only affects `animate-spin` — transitions and transforms not disabled [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/[locale]/globals.css` line 149 (via Grep)
- **Description**: The global `prefers-reduced-motion: reduce` media query only disables `animate-spin`. However, multiple components use CSS transitions and transforms that aren't covered: `photo-viewer.tsx` sidebar slide (`transition-all duration-500`), `home-client.tsx` hover scale (`transition-transform duration-500 group-hover:scale-105`), `info-bottom-sheet.tsx` translateY transitions, `nav-client.tsx` expand/collapse transitions, and framer-motion animations.
- **UX Impact**: Users who have enabled "Reduce motion" in their OS settings will still see: photo sidebar sliding in/out, masonry cards scaling on hover, bottom sheet sliding up, nav expanding/collapsing, and framer-motion page transitions. This violates WCAG 2.3.3 (Animation from Interactions) at level AAA, and may cause discomfort for vestibular disorder users.
- **Suggested Fix**: Add a global `prefers-reduced-motion: reduce` rule that sets `transition-duration: 0s !important` and `animation-duration: 0s !important` on all elements. The lightbox and home-client components already check this via JS; ensure the CSS layer also covers Tailwind transition utilities.
- **Confidence**: MEDIUM

### UX-14-16: `home-client.tsx` empty state SVG icon lacks `aria-hidden` and `role` attributes [LOW] [HIGH confidence]
- **File**: `apps/web/src/components/home-client.tsx` lines 325-327
- **Description**: The empty state illustration uses an inline `<svg>` with `className` and `stroke` attributes but no `aria-hidden="true"` or `role="img"`. Decorative SVGs should be hidden from assistive technology, or if meaningful, should have `role="img"` and an `aria-label`.
- **UX Impact**: Screen readers may announce the SVG's internal path content or leave an unnamed element in the accessibility tree. This creates noise for screen reader users.
- **Suggested Fix**: Add `aria-hidden="true"` to the decorative SVG, or add `role="img" aria-label={t('home.noImages')}` if it's considered informative.
- **Confidence**: HIGH

### UX-14-17: Admin layout missing skip-to-content link [HIGH] [HIGH confidence]
- **File**: `apps/web/src/app/[locale]/admin/layout.tsx` lines 1-14
- **Description**: The public layout (`(public)/layout.tsx` line 10) has a skip-to-content link (`<a href="#main-content">`). The admin layout (`admin/layout.tsx`) does NOT have one. Keyboard users navigating the admin must Tab through all header and nav elements before reaching the main content area on every page load.
- **UX Impact**: WCAG 2.4.1 (Bypass Blocks) — admin users who rely on keyboard navigation must tab through the admin header and nav bar on every page transition. This is a significant efficiency barrier.
- **Suggested Fix**: Add the same skip-to-content link pattern from the public layout to the admin layout, with `href="#admin-content"` and add `id="admin-content"` to the main content area.
- **Confidence**: HIGH

### UX-14-18: `upload-dropzone.tsx` native `<select>` for topic inconsistent with shadcn Select (confirmed from UX-13-02) [LOW] [HIGH confidence]
- **File**: `apps/web/src/components/upload-dropzone.tsx` lines 223-232
- **Description**: This was reported in cycle 13 as UX-13-02 but not yet fixed. Re-confirming it's still present. The topic selector uses a native `<select>` with manual Tailwind classes, inconsistent with shadcn's `<Select>` used in settings-client.tsx.
- **UX Impact**: Visual inconsistency: native select has different dropdown styling, focus ring, and dark mode behavior. On macOS, the native select renders with system styling that doesn't match the rest of the admin UI.
- **Suggested Fix**: Replace the native `<select>` with shadcn's `<Select>` component.
- **Confidence**: HIGH

### UX-14-19: `admin-header.tsx` logout form button has no explicit `type` attribute [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/components/admin-header.tsx` line 24
- **Description**: The logout button inside a `<form>` doesn't specify `type="submit"`. While the default `type` for buttons inside forms is `"submit"` per the HTML spec, explicitly declaring it improves clarity and prevents potential issues if the code is refactored.
- **UX Impact**: Low risk — the button works as expected due to HTML defaults. However, explicit `type="submit"` is a best practice that prevents accidental form submission issues if the button is moved outside the form later.
- **Suggested Fix**: Add `type="submit"` to the logout `<Button>`.
- **Confidence**: MEDIUM

### UX-14-20: `home-client.tsx` back-to-top button fixed position may overlap with content on small viewports [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/components/home-client.tsx` lines 339-355
- **Description**: The back-to-top button is `fixed bottom-6 right-6 z-40`. On very small viewports (320px wide), this button may overlap with masonry grid content or the tag filter area. The button also doesn't account for `safe-area-inset-bottom` (notch devices), unlike the info bottom sheet which uses `paddingBottom: 'env(safe-area-inset-bottom, 0px)'`.
- **UX Impact**: On small screens, the floating button may obscure content. On notched devices, the button may overlap the home indicator area, making it harder to tap.
- **Suggested Fix**: Add `bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))]` or use `pb-safe` utility. Consider hiding the button when the on-screen keyboard is active.
- **Confidence**: MEDIUM

---

## Summary Table

| ID | Severity | Confidence | Category | Component |
|----|----------|------------|----------|-----------|
| UX-14-01 | HIGH | HIGH | i18n/RTL | Global |
| UX-14-02 | MEDIUM | HIGH | Form UX | login-form.tsx |
| UX-14-03 | HIGH | HIGH | Keyboard Nav | photo-navigation.tsx |
| UX-14-04 | MEDIUM | MEDIUM | Accessibility | info-bottom-sheet.tsx |
| UX-14-05 | MEDIUM | HIGH | Visual Consistency | image-manager.tsx |
| UX-14-06 | MEDIUM | MEDIUM | Broken State | search.tsx |
| UX-14-07 | MEDIUM | MEDIUM | Keyboard Nav | admin-nav.tsx |
| UX-14-08 | LOW | HIGH | Visual Consistency | error.tsx |
| UX-14-09 | MEDIUM | MEDIUM | Accessibility | image-zoom.tsx |
| UX-14-10 | MEDIUM | MEDIUM | Discoverability | upload-dropzone.tsx |
| UX-14-11 | — | LOW | Withdrawn | tag-filter.tsx |
| UX-14-12 | MEDIUM | HIGH | Accessibility | photo-viewer.tsx |
| UX-14-13 | MEDIUM | MEDIUM | Accessibility | tag-input.tsx |
| UX-14-14 | MEDIUM | MEDIUM | Accessibility | lightbox.tsx |
| UX-14-15 | LOW | MEDIUM | Reduced Motion | globals.css |
| UX-14-16 | LOW | HIGH | Accessibility | home-client.tsx |
| UX-14-17 | HIGH | HIGH | Accessibility | admin/layout.tsx |
| UX-14-18 | LOW | HIGH | Visual Consistency | upload-dropzone.tsx |
| UX-14-19 | LOW | MEDIUM | Best Practice | admin-header.tsx |
| UX-14-20 | LOW | MEDIUM | Responsive | home-client.tsx |
| UX-14-21 | HIGH | HIGH | Accessibility | lightbox.tsx |
| UX-14-22 | HIGH | HIGH | Accessibility | lightbox.tsx |
| UX-14-23 | HIGH | HIGH | Valid HTML | photo-viewer.tsx |
| UX-14-24 | HIGH | HIGH | Accessibility | error.tsx |
| UX-14-25 | MEDIUM | HIGH | Accessibility | nav-client.tsx |
| UX-14-26 | MEDIUM | HIGH | Accessibility | nav-client.tsx |
| UX-14-27 | HIGH | HIGH | Form UX | topic-manager.tsx, tag-manager.tsx |
| UX-14-28 | MEDIUM | HIGH | Accessibility | topic-manager.tsx, tag-manager.tsx |
| UX-14-29 | MEDIUM | HIGH | Empty State | topic-manager.tsx |
| UX-14-30 | MEDIUM | HIGH | i18n | password/page.tsx |
| UX-14-31 | MEDIUM | MEDIUM | Accessibility | settings/seo/password forms |
| UX-14-32 | MEDIUM | HIGH | Focus Visible | home-client.tsx |
| UX-14-33 | LOW | HIGH | Accessibility | nav-client.tsx |
| UX-14-34 | MEDIUM | HIGH | Contrast | footer.tsx |
| UX-14-35 | HIGH | HIGH | Keyboard Nav | image-zoom.tsx |
| UX-14-36 | MEDIUM | MEDIUM | UX | lightbox.tsx |

## Additional Findings from Cross-Agent Analysis

These findings were surfaced by parallel review agents and validated against the primary review. They are numbered separately to avoid collision with the primary findings.

### UX-14-21: Lightbox fullscreen toggle `aria-label` is semantically inverted [HIGH] [HIGH confidence]
- **File**: `apps/web/src/components/lightbox.tsx` line 255
- **Description**: `aria-label={isFullscreen ? t('viewer.fullscreen') : t('aria.openFullscreen')}` — When already in fullscreen, the label says `t('viewer.fullscreen')` which reads as a state description ("Fullscreen"), not an action ("Exit fullscreen"). Screen reader users hear the button's purpose incorrectly when in fullscreen mode.
- **UX Impact**: Screen reader users cannot determine that the button will exit fullscreen. Violates WCAG 4.1.2 (Name, Role, Value).
- **Suggested Fix**: Use `aria-label={isFullscreen ? t('aria.exitFullscreen') : t('aria.openFullscreen')}` to clearly communicate the toggle action.
- **Confidence**: HIGH

### UX-14-22: Lightbox image alt text falls back to filename instead of using rich alt chain [HIGH] [HIGH confidence]
- **File**: `apps/web/src/components/lightbox.tsx` line 215
- **Description**: `alt={image.title ?? image.filename_jpeg ?? ''}` — When `image.title` is null, the alt text becomes a JPEG filename (e.g., "abc123_1536.jpg"), which is meaningless. The photo-viewer has a much better `getAltText()` function with fallback chain (description -> title -> tags -> "Photo"), but the lightbox doesn't use it.
- **UX Impact**: Screen reader users hear filenames instead of meaningful descriptions when image titles are empty.
- **Suggested Fix**: Pass the computed alt text from PhotoViewer to the Lightbox as a prop, or import the `getAltText` logic.
- **Confidence**: HIGH

### UX-14-23: Photo viewer download link nests `<Button>` inside `<a>` — invalid HTML [HIGH] [HIGH confidence]
- **File**: `apps/web/src/components/photo-viewer.tsx` lines 523-533
- **Description**: `<a href={downloadHref} download={...}><Button ...>...</Button></a>` — The `<a>` wraps a `<Button>` (which renders as `<button>`). Nesting a button inside an anchor is invalid HTML and creates confusing semantics for screen readers (two interactive elements in one).
- **UX Impact**: Screen readers may announce the element inconsistently. Some assistive technologies may not activate the link correctly. Invalid HTML per spec.
- **Suggested Fix**: Use `<Button asChild><a href={downloadHref} download={...}>...</a></Button>` to render button styles directly on the anchor element.
- **Confidence**: HIGH

### UX-14-24: Error boundary pages lack `role="alert"` for screen reader announcement [HIGH] [HIGH confidence]
- **File**: `apps/web/src/app/[locale]/error.tsx` lines 16-20, `apps/web/src/app/[locale]/admin/(protected)/error.tsx` lines 16-20
- **Description**: Error pages render error text visually but never announce the error to screen readers. The `<h1>` and `<p>` elements have no `role="alert"` or `aria-live="assertive"`, so assistive technology users navigating to this page may not realize an error occurred.
- **UX Impact**: Screen reader users are not notified of the error state, violating WCAG 4.1.3 (Status Messages).
- **Suggested Fix**: Add `role="alert"` to the error container div or use `aria-live="assertive"` on the description paragraph.
- **Confidence**: HIGH

### UX-14-25: Nav theme toggle has static `aria-label` — doesn't communicate current theme state [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/components/nav-client.tsx` line 143
- **Description**: The theme toggle has `aria-label={t('aria.toggleTheme')}` which is static regardless of current theme. Screen reader users don't know whether they're in light or dark mode before activating the button.
- **UX Impact**: Screen reader users lack context about the current state before toggling.
- **Suggested Fix**: Use dynamic label: `aria-label={resolvedTheme === 'dark' ? t('aria.switchToLight') : t('aria.switchToDark')}`.
- **Confidence**: HIGH

### UX-14-26: Nav locale switch button has no `aria-label` [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/components/nav-client.tsx` lines 148-153
- **Description**: The locale switch button displays only `{otherLocale.toUpperCase()}` (e.g., "KO" or "EN") but has no `aria-label`. Screen readers announce just "KO button" with no context about what the button does.
- **UX Impact**: Screen reader users cannot understand the button's purpose.
- **Suggested Fix**: Add `aria-label={t('aria.switchLocale', { locale: otherLocale })}` or similar.
- **Confidence**: HIGH

### UX-14-27: Admin category/topic manager dialog inputs lack visible labels [HIGH] [HIGH confidence]
- **File**: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` lines 167-168, 245-247; `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` line 154
- **Description**: Create/Edit topic dialogs and tag edit dialog use `<Input>` with only `placeholder` text — no visible `<Label>` components. Placeholder text disappears when typing, losing field context.
- **UX Impact**: Users lose context after starting to type. Violates WCAG 1.3.1 and 3.3.2. Inconsistent with password-form.tsx and seo-client.tsx which properly use `<Label>`.
- **Suggested Fix**: Add `<Label htmlFor="...">` components for each input, matching the pattern used in password-form.tsx and seo-client.tsx.
- **Confidence**: HIGH

### UX-14-28: Admin data tables lack accessible name or caption [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` line 180; `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` line 95
- **Description**: Both `<Table>` elements lack `aria-label`, `aria-labelledby`, or `<caption>`. Screen readers announce tables generically ("table, 5 rows") without context about what the table contains.
- **UX Impact**: Screen reader users cannot distinguish between tables or understand table purpose. Violates WCAG 1.3.1.
- **Suggested Fix**: Add `aria-labelledby` pointing to the page heading, or add a `<caption>` element.
- **Confidence**: HIGH

### UX-14-29: Admin categories table missing empty state [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` lines 190-215
- **Description**: The topics `<TableBody>` renders rows from `initialTopics.map()` with no empty state fallback when `initialTopics` is empty. Compare with tag-manager.tsx which correctly shows "No tags" when empty.
- **UX Impact**: Users see an empty table with headers but no explanation — confusing UX.
- **Suggested Fix**: Add empty row with `colSpan` matching tag-manager pattern.
- **Confidence**: HIGH

### UX-14-30: Password page metadata is hardcoded English [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx` lines 3-5
- **Description**: `metadata.title` is set to `'Change Password | Admin'` — a hardcoded English string. All other admin pages use dynamic translations. Korean-speaking admins see English in the browser tab.
- **UX Impact**: i18n gap — Korean users see English in the browser tab title.
- **Suggested Fix**: Use `generateMetadata` with `getTranslations` to produce a localized title, matching other admin pages.
- **Confidence**: HIGH

### UX-14-31: Form hint text not associated with inputs via `aria-describedby` [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` lines 89, 103, 115, 128, 143, 195, 246, 259, 290; `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx` line 84; `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx` lines 85, 98, 110, 122, 134
- **Description**: Multiple forms have `<p className="text-xs text-muted-foreground">` hint text below inputs, but none use `aria-describedby` to associate the hint with the input. Screen readers will not announce the hints when the input receives focus.
- **UX Impact**: Screen reader users miss contextual help (e.g., minimum password length, image size format).
- **Suggested Fix**: Add unique `id` attributes to hint paragraphs and `aria-describedby` on the associated input.
- **Confidence**: MEDIUM

### UX-14-32: Masonry card `overflow-hidden` clips focus ring [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/components/home-client.tsx` line 234
- **Description**: `focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2` applies a focus ring to the masonry card, but the card uses `overflow-hidden`. The ring offset may be clipped, making the focus indicator partially or fully invisible.
- **UX Impact**: Focus indicator may be invisible on masonry cards, violating WCAG 2.4.7 (Focus Visible).
- **Suggested Fix**: Remove `overflow-hidden` from the card container and apply it only to the inner image container, or use `outline` instead of `ring` which is not affected by `overflow: hidden`.
- **Confidence**: HIGH

### UX-14-33: Nav topic Image has redundant `title` attribute duplicating `alt` [LOW] [HIGH confidence]
- **File**: `apps/web/src/components/nav-client.tsx` line 121
- **Description**: `<Image alt={topic.label} title={topic.label}>` — the `title` attribute duplicates the `alt` text. Some screen readers announce both, causing repetition.
- **UX Impact**: Redundant announcement for screen reader users.
- **Suggested Fix**: Remove the `title` attribute since `alt` already provides the same information.
- **Confidence**: HIGH

### UX-14-34: Footer admin link has extremely low contrast in light mode [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/components/footer.tsx` line 46
- **Description**: The admin link uses `text-xs text-muted-foreground/50` which applies 50% opacity to an already-muted color. This likely fails WCAG AA contrast requirements (4.5:1 for small text).
- **UX Impact**: Low-vision users cannot read the admin link. Violates WCAG 1.4.3 (Contrast Minimum).
- **Suggested Fix**: Increase opacity to `text-muted-foreground/70` minimum and verify with a contrast checker.
- **Confidence**: HIGH

### UX-14-35: ImageZoom lacks keyboard panning when zoomed [HIGH] [HIGH confidence]
- **File**: `apps/web/src/components/image-zoom.tsx` lines 97-107, 129-132
- **Description**: When the image is zoomed, mouse users can move their cursor to pan, but keyboard users have no equivalent mechanism. Escape exits zoom, Enter/Space toggle zoom, but there is no way to explore different parts of the zoomed image via keyboard.
- **UX Impact**: Keyboard-only users cannot use the zoom feature fully. Inequitable experience violating WCAG 2.1.1 (Keyboard).
- **Suggested Fix**: Add arrow key handling when zoomed: Arrow keys pan the view in the respective direction.
- **Confidence**: HIGH

### UX-14-36: Lightbox `onClick` on outermost div also fires when clicking the image itself [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/components/lightbox.tsx` line 192
- **Description**: `onClick={handleBackdropClick}` is on the outermost container div, and there is no `e.stopPropagation()` on the `<picture>` element. This means clicking anywhere on the image closes the lightbox. For a photo gallery, accidental clicks on the image are common and result in unexpected close.
- **UX Impact**: Accidental lightbox closures when users click on the photo itself. Frustrating for gallery browsing.
- **Suggested Fix**: Add `onClick={(e) => e.stopPropagation()}` to the `<picture>` element so only clicking the dark backdrop area closes the lightbox.
- **Confidence**: MEDIUM

---

## Priority Remediation Order

1. **UX-14-17** — Admin skip-to-content (WCAG 2.4.1, easy fix)
2. **UX-14-03** / **UX-14-CRITICAL** — Photo nav invisible buttons on desktop (keyboard-blocking)
3. **UX-14-21** — Lightbox fullscreen aria-label inverted (screen reader misinformation)
4. **UX-14-24** — Error pages lack `role="alert"` (quick fix, high impact)
5. **UX-14-22** — Lightbox alt text fallback to filename (screen reader)
6. **UX-14-23** — Download button nested in anchor (invalid HTML)
7. **UX-14-01** — RTL `dir` attribute on `<html>` (foundational for i18n)
8. **UX-14-35** — ImageZoom keyboard panning (keyboard equity)
9. **UX-14-27** — Admin dialog inputs lack visible labels
10. **UX-14-14** — Lightbox controls focus-within (timing a11y)
11. **UX-14-13** — TagInput `aria-activedescendant` (screen reader combobox)
12. **UX-14-06** — Search thumbnails hardcoded size (functional bug)
13. **UX-14-02** — Login form visible labels (form UX consistency)
14. **UX-14-25** / **UX-14-26** — Nav toggle aria-labels (quick fixes)
15. **UX-14-32** — Masonry card focus ring clipping (focus visible)
16. Remaining MEDIUM and LOW items as capacity allows
