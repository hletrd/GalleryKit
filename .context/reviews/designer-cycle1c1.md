# Designer (UI/UX) -- Cycle 1 (Fresh)

## Files Reviewed
All component files in `apps/web/src/components/`, page layouts, admin pages

## UI1-01: Focus trap audit needed for admin modals/dialogs
**File:** `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/sheet.tsx`
**Severity:** MEDIUM | **Confidence:** High
**Problem:** While Radix UI Dialog/Sheet provide built-in focus trapping, the custom `LazyFocusTrap` component suggests some dialogs may not use the Radix primitives. If any dialog or sheet is implemented without focus trapping, keyboard users can tab out of the modal into the background, creating a confusing accessibility experience.
**Fix:** Audit all dialog/sheet usages to ensure they use the Radix primitives (which include focus trap). Remove or document any custom focus trap implementations.

## UI1-02: Upload dropzone doesn't show accepted file types
**File:** `apps/web/src/components/upload-dropzone.tsx`
**Severity:** LOW | **Confidence:** High
**Problem:** The upload dropzone doesn't display which file formats are accepted (.jpg, .png, .webp, .avif, .heic, etc.). Users may waste time attempting to upload unsupported formats (e.g., .svg, .pdf).
**Fix:** Add a small text line below or inside the dropzone listing accepted formats. Also add `accept` attribute to the file input for native browser filtering.

## UI1-03: No visual indicator for images still processing
**File:** `apps/web/src/components/image-manager.tsx`, admin dashboard
**Severity:** LOW | **Confidence:** Medium
**Problem:** When images are uploaded but still processing ( Sharp conversion in progress), there's no visual indicator in the admin UI. The image appears as a broken thumbnail or empty card until processing completes.
**Fix:** Add a "Processing..." badge, skeleton placeholder, or shimmer effect for images with `processed: false`.

## UI1-04: Keyboard navigation in photo viewer needs verification
**File:** `apps/web/src/components/photo-viewer.tsx`, `photo-navigation.tsx`
**Severity:** LOW | **Confidence:** Medium
**Problem:** The photo viewer uses arrow keys for prev/next navigation. Need to verify: (1) left/right arrow keys work for prev/next, (2) Escape closes the lightbox, (3) ARIA labels on navigation buttons, (4) Tab focus management when lightbox opens/closes.
**Fix:** Manual keyboard navigation test. If gaps found, add appropriate event handlers and ARIA attributes.
