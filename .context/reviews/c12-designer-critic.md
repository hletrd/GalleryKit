# Cycle 12 Designer/Critic Review

## Review Scope
UI/UX, accessibility, multi-perspective critique, code quality from a design standpoint.

## Findings

### C12-DC-01 (Low/Medium): Photo viewer info sidebar collapse clips content without opacity fade

- **File+line**: `apps/web/src/components/photo-viewer.tsx:426-429`
- **Issue**: Already flagged as C11-LOW-05 in prior cycles. When `showInfo` transitions to false, the sidebar width animates from 350px to 0 with `overflow-hidden`, visually clipping the content. Adding an opacity transition would improve the UX. The current implementation is functional but not polished. Confirming this remains valid and deferred.
- **Fix**: Already deferred.
- **Confidence**: Low — confirming existing deferred item.

### C12-DC-02 (Low/Low): Admin navigation does not indicate active page

- **File+line**: `apps/web/src/components/admin-nav.tsx`
- **Issue**: Already flagged as C11-LOW-06 in prior cycles. The admin sidebar doesn't visually distinguish the currently active page. Confirming this remains valid and deferred.
- **Fix**: Already deferred.
- **Confidence**: Low — confirming existing deferred item.

### C12-DC-03 (Low/Medium): Lightbox `alt` attribute falls back to `filename_jpeg` which is a UUID-based internal name

- **File+line**: `apps/web/src/components/lightbox.tsx:309`
- **Issue**: The lightbox `<img>` tag uses `alt={image.title ?? image.filename_jpeg ?? ''}`. When `image.title` is null (the default for uploaded images), the fallback is `image.filename_jpeg` which is a UUID-based name like `abc12345_2048.jpg`. This is not meaningful for screen reader users. The photo viewer itself uses `getConcisePhotoAltText()` which falls back to tags or "Photo". The lightbox should use the same accessible alt text logic.
- **Fix**: Import `getConcisePhotoAltText` (or derive the alt text from the parent) and use it in the lightbox `<img>` tag instead of the `filename_jpeg` fallback.
- **Confidence**: Medium — the alt text is used by screen readers and the UUID fallback is not meaningful.

## Summary
- Total findings: 3
- Low severity: 3
