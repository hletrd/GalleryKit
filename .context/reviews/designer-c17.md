# Designer (UI/UX) Review — Cycle 17

## UI/UX review scope

This project contains a web frontend (Next.js, React, Tailwind CSS, shadcn/ui) so the designer review applies.

## Findings

### C17-DG-01: Lightbox controls auto-hide may confuse users who expect persistent navigation
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/components/lightbox.tsx:94-118`
- **Issue**: On devices with `hover: hover` and `pointer: fine` (desktop), lightbox controls auto-hide after 3 seconds of inactivity. While this is good for photo viewing, users may not realize the controls exist if they don't move their mouse within the first 3 seconds. There's no visual hint (e.g., brief flash or pulsing indicator) that controls will appear on interaction.
- **Fix**: Consider a brief initial pulse/highlight on the close button when the lightbox opens, or a small persistent corner indicator that hints at the auto-hide controls.

### C17-DG-02: Photo viewer info sidebar transition may cause layout shift on desktop
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/components/photo-viewer.tsx:355-358`
- **Issue**: The grid layout changes from `grid-cols-1` to `lg:grid-cols-[1fr_350px]` when the info sidebar is toggled. The transition uses `duration-500 ease-in-out` but the image container width changes abruptly, causing the image to reflow. This is a minor visual jank that's noticeable when toggling the info panel while viewing a landscape photo.
- **Fix**: Consider using CSS `transition` on the grid template columns, or using a fixed-width sidebar that slides in/out without changing the image container width.

### C17-DG-03: Mobile bottom sheet for EXIF info has no maximum height
- **Confidence**: Low
- **Severity**: Low
- **Location**: `apps/web/src/components/info-bottom-sheet.tsx`
- **Issue**: On mobile devices with extensive EXIF data (camera, lens, GPS, histogram, etc.), the bottom sheet may extend beyond the viewport, requiring scrolling within the sheet. The sheet's drag handle suggests it's dismissible by dragging down, but scrolling EXIF content and dismissing the sheet use the same gesture (vertical drag), which can conflict.
- **Fix**: Set a max-height (e.g., 70vh) on the bottom sheet content area with internal scrolling, and ensure the drag-to-dismiss gesture only triggers from the handle area, not the scrollable content.

### C17-DG-04: Photo viewer "Back" button uses topic slug, not topic label
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/components/photo-viewer.tsx:281-284`
- **Issue**: The "Back to [topic]" button shows `image.topic` (the slug) in the link text when `image.topic_label` is falsy, falling back to `image.topic`. For topics with slug "landscape-photography" but label "Landscape Photography", the slug is readable but uses hyphens instead of spaces. The code uses `image.topic_label || image.topic` which prefers the label but falls back to the slug.
- **Fix**: The fallback is acceptable but could be improved by converting slug to title case (replace hyphens with spaces, capitalize). However, this is cosmetic and the label should always be available for properly configured topics.

### C17-DG-05: Keyboard shortcut hint is hidden on mobile (correct) but no touch alternative for fullscreen
- **Confidence**: Low
- **Severity**: Low
- **Location**: `apps/web/src/components/photo-viewer.tsx:272-274` and `lightbox.tsx:346-362`
- **Issue**: The keyboard shortcut hint (`← → F`) is hidden below `md` breakpoint (correct — no keyboard on mobile). The fullscreen toggle button is visible in the lightbox controls, but the lightbox must first be opened to access it. On mobile, users might not discover the lightbox/fullscreen feature without the shortcut hint.
- **Fix**: The lightbox trigger button (maximize icon) in the toolbar serves as the touch-friendly entry point. This is adequate, but consider adding a brief onboarding tooltip on first visit.

### C17-DG-06: WCAG contrast — lightbox control buttons on dark background
- **Confidence**: High
- **Severity**: Low
- **Location**: `apps/web/src/components/lightbox.tsx:329,348`
- **Issue**: Lightbox control buttons use `bg-black/50 text-white` with `hover:bg-black/70`. The contrast ratio of white text on 50% black is approximately 7.5:1 (passes AAA). On hover, it's approximately 10:1. **Passes WCAG 2.1 AAA for normal text.**
- **Fix**: No fix needed. Contrast is compliant.
