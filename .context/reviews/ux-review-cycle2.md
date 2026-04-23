# UX / Accessibility Review — Cycle 2 (2026-04-19)

## C2-UX-01: Image manager table checkbox lacks visible focus indicator
**File:** `apps/web/src/components/image-manager.tsx:268-274, 289-296`
**Confidence:** HIGH **Severity:** MEDIUM

The checkboxes use raw `<input type="checkbox">` with Tailwind classes but no visible focus ring. Keyboard users navigating the admin table would have no visual indication of which checkbox is focused.

**Fix:** Add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to the checkbox classes (matching the existing `focus:ring-primary` which only shows on `:focus`, not `:focus-visible`).

---

## C2-UX-02: `ImageZoom` keyboard handler conflicts with lightbox keyboard handler
**File:** `apps/web/src/components/image-zoom.tsx:97-107`, `apps/web/src/components/lightbox.tsx:110-133`
**Confidence:** MEDIUM **Severity:** MEDIUM

When the lightbox is open and the user presses Escape, the `ImageZoom` component's `keydown` handler fires before (or concurrently with) the lightbox's handler. If the image is zoomed inside the lightbox, pressing Escape should first un-zoom, then close the lightbox. However, `ImageZoom` does not check whether it's inside a lightbox context. Both handlers are registered on `window`.

The lightbox handler checks `!document.fullscreenElement` before closing on Escape, but doesn't check zoom state. The ImageZoom handler always runs when `isZoomed` is true. Since the lightbox renders `ImageZoom` as a child, the ImageZoom handler will fire and un-zoom on the first Escape, then a second Escape closes the lightbox. This is actually the correct behavior! The two-press Escape is intuitive (un-zoom first, then close).

However, there's a subtle issue: when the lightbox is NOT open but the user is on the photo viewer page with a zoomed image, pressing Escape un-zooms (from ImageZoom) but also fires the photo viewer's keydown handler (which doesn't handle Escape for anything). This is fine.

**Revised finding:** The behavior is actually correct. The zoom-unzoom-close flow is intuitive. No fix needed.

---

## C2-UX-03: Admin image manager `tag_names` parsing splits on comma but tags with commas are rejected by validation
**File:** `apps/web/src/components/image-manager.tsx:322-323`
**Confidence:** HIGH **Severity:** LOW

`image.tag_names.split(',').filter(Boolean)` splits the GROUP_CONCAT result on commas. Since `isValidTagName` rejects commas, individual tag names can't contain commas, so this split is safe. However, if a tag name somehow contained a comma (e.g., via direct DB insertion), the split would break. This is a defense-in-depth concern.

**Fix:** Low priority — the validation layer prevents commas in tag names.

---

## C2-UX-04: Photo viewer info sidebar `showInfo` state doesn't persist across navigation
**File:** `apps/web/src/components/photo-viewer.tsx:45-46`
**Confidence:** MEDIUM **Severity:** LOW

When the user pins the info sidebar and then navigates to the next/previous photo (which stays within the component), the pinned state is preserved. However, when navigating across the boundary (prevId/nextId triggers a router.push), the entire component remounts and `isPinned` resets to `false`. The auto-lightbox state IS preserved via sessionStorage, but the info sidebar state is not.

**Fix:** Persist `isPinned` in sessionStorage similar to `gallery_auto_lightbox`, or accept the current behavior as intentional (the sidebar was a temporary view).

---

## C2-UX-05: Lightbox close button exits fullscreen before closing — potential visual flash
**File:** `apps/web/src/components/lightbox.tsx:232-238`
**Confidence:** LOW **Severity:** LOW

The close button handler calls `document.exitFullscreen().then(() => onClose())`. This means there's a brief moment where the page is no longer fullscreen but the lightbox is still visible, creating a visual flash. A smoother approach would be to call `onClose()` first and let the cleanup effect handle fullscreen exit.

**Fix:** Call `onClose()` first; the lightbox unmount will trigger the `fullscreenchange` listener to update `isFullscreen` state (though the component is already unmounting).

---

## C2-UX-06: Search combobox missing `aria-autocomplete` attribute
**File:** `apps/web/src/components/search.tsx:127`
**Confidence:** MEDIUM **Severity:** LOW

The search input has `role="combobox"` and `aria-expanded` but lacks `aria-autocomplete="list"` which helps screen readers understand the type of autocomplete behavior. WCAG 2.2 pattern for combobox recommends this attribute.

**Fix:** Add `aria-autocomplete="list"` to the Input component.

---

## Summary

| ID | Severity | Confidence | Description |
|----|----------|------------|-------------|
| C2-UX-01 | MEDIUM | HIGH | Admin checkbox lacks visible focus indicator |
| C2-UX-03 | LOW | HIGH | tag_names split on comma (defensive) |
| C2-UX-04 | LOW | MEDIUM | Info sidebar state doesn't persist across page navigation |
| C2-UX-05 | LOW | LOW | Lightbox close button fullscreen flash |
| C2-UX-06 | LOW | MEDIUM | Search combobox missing aria-autocomplete |
