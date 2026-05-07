# UI/UX Review — Cycle 38 (2026-04-19)

## Reviewer: designer
## Scope: Information architecture, accessibility, responsive design, perceived performance

### Findings

**Finding UX-38-01: Mobile navigation expand button lacks focus-visible styling**
- **File**: `apps/web/src/components/nav-client.tsx` lines 78-92
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: The mobile expand/collapse button uses `hover:bg-accent rounded-full` but does not have an explicit `focus-visible:ring-2` style. While Tailwind's base styles may provide some focus indication, the button should have a visible focus ring for keyboard users. The theme toggle and locale switch buttons (lines 139-152) have `min-w-[44px] min-h-[44px]` which meets the WCAG 2.5.8 target size minimum, but the expand button doesn't specify a minimum size.
- **Fix**: Add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` and ensure minimum touch target size of 44x44px.

**Finding UX-38-02: `home-client.tsx` back-to-top button uses inline SVG instead of accessible component**
- **File**: `apps/web/src/components/home-client.tsx` lines 334-348
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: The back-to-top button uses an inline SVG chevron icon. It has an `aria-label` which is good. However, the button's transition between hidden and visible states uses `opacity-0 pointer-events-none` / `opacity-100 pointer-events-auto`, which is a CSS-only transition. Screen readers may still announce the button even when it's "hidden" via opacity. Adding `aria-hidden={showBackToTop ? undefined : true}` and `tabIndex={showBackToTop ? 0 : -1}` would prevent the button from being focusable when invisible.
- **Fix**: Add `aria-hidden` and `tabIndex` based on `showBackToTop` state.

**Finding UX-38-03: Photo viewer info sidebar has no keyboard-accessible toggle on desktop**
- **File**: `apps/web/src/components/photo-viewer.tsx` lines 260-276
- **Severity**: LOW | **Confidence**: MEDIUM
- **Description**: The desktop info panel toggle button (`PanelRightOpen`/`PanelRightClose`) is properly implemented with `hidden lg:flex` to only show on desktop. It has visible text labels and changes variant based on state. The button is keyboard accessible (it's a `<Button>` component). No issue found on closer inspection — the button is accessible.

**Finding UX-38-04: `image-manager.tsx` checkboxes lack proper ARIA role for select-all**
- **File**: `apps/web/src/components/image-manager.tsx` lines 293-300
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: The "select all" checkbox uses `checked={images.length > 0 && selectedIds.size === images.length}` but doesn't use `indeterminate` state when some (but not all) images are selected. The WCAG pattern for select-all checkboxes recommends using the `indeterminate` property when the selection is partial. This is a minor accessibility improvement.
- **Fix**: Add a `ref` to the checkbox and set `indeterminate = selectedIds.size > 0 && selectedIds.size < images.length` in an effect.

**Finding UX-38-05: `upload-dropzone.tsx` file removal button only visible on hover**
- **File**: `apps/web/src/components/upload-dropzone.tsx` lines 288-295
- **Severity**: LOW | **Confidence**: HIGH
- **Description**: The file removal button (`X` icon) uses `opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity`. The `focus:opacity-100` is correct for keyboard accessibility, but on touch devices, there's no hover state. Users must tap precisely on the button area without any visual indication that a remove action exists. Adding an always-visible delete button on mobile breakpoints would improve usability.
- **Fix**: Add `sm:opacity-0 sm:group-hover:opacity-100 opacity-100` to make the button always visible on small screens.

### Summary
No critical UX issues found. The application has:
- Proper ARIA labels on interactive elements
- Keyboard navigation support in photo viewer
- Reduced motion support via `useReducedMotion()`
- Responsive breakpoints for mobile/desktop
- Focus management in lightbox
- Proper heading hierarchy
- i18n support with locale switching
