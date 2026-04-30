# Designer & Critic Review — Cycle 13 (designer-critic)

## Review Scope
UI/UX, accessibility, information architecture, keyboard navigation, WCAG compliance, cross-agent critique.

## Findings

### C13-DC-01: Lightbox `<img>` alt text uses `getConcisePhotoAltText` — fix verified
- **File+line**: `apps/web/src/components/lightbox.tsx:310`
- **Severity**: N/A | **Confidence**: High
- **Issue**: The cycle 12 finding (C12-LOW-01) about lightbox alt text falling back to UUID-based filename has been FIXED. The code now uses `getConcisePhotoAltText(image, t('common.photo'))` which falls back to tags or "Photo" instead of a UUID filename. Verified this is correct.

### C13-DC-02: Admin navigation does not indicate active page
- **File+line**: `apps/web/src/components/admin-nav.tsx`
- **Severity**: Low | **Confidence**: Low
- **Issue**: Already deferred as C11-LOW-06 / C12-LOW-06. Admin navigation items don't visually indicate which page is currently active. This is a UX issue but not a bug.
- **Fix**: Already deferred.

### C13-DC-03: Photo viewer info sidebar collapse clips content without fade
- **File+line**: `apps/web/src/components/photo-viewer.tsx:426-429`
- **Severity**: Low | **Confidence**: Low
- **Issue**: Already deferred as C11-LOW-05 / C12-LOW-05. The sidebar collapse uses `overflow-hidden` which clips content instantly without a fade transition.
- **Fix**: Already deferred.

### C13-DC-04: Lightbox focus trap does not return focus to trigger on close
- **File+line**: `apps/web/src/components/lightbox.tsx:265-276`
- **Severity**: Low | **Confidence**: Medium
- **Issue**: The lightbox saves the previously focused element in `previouslyFocusedRef` and restores it in the cleanup function. This is correct — focus is returned when the lightbox unmounts. However, the close button gets initial focus on mount (line 271), which is good for keyboard accessibility. The focus trap is properly implemented with `FocusTrap`.
- **Fix**: No fix needed — focus management is correct.

### C13-DC-05: Photo viewer keyboard navigation uses `navigate` callback with correct guards
- **File+line**: `apps/web/src/components/photo-viewer.tsx:137-165`
- **Severity**: N/A | **Confidence**: High
- **Issue**: Verified that the `navigate` callback includes the `currentIndex === -1` guard (C7-LOW-03) and the `images[currentIndex]?.id !== currentImageId` guard (C8-MED-03). Both guards prevent stale-closure navigation bugs. The `currentImageId` is in the dependency array (line 165). This is correct.

### C13-DC-06: Lightbox `aria-modal="true"` and `role="dialog"` properly set
- **File+line**: `apps/web/src/components/lightbox.tsx:283-284`
- **Severity**: N/A | **Confidence**: High
- **Issue**: Verified that the lightbox dialog has correct ARIA attributes (`role="dialog"`, `aria-modal="true"`, `aria-label`). The `FocusTrap` component wraps the dialog for keyboard focus containment. This is correct.

## Summary
- Total findings: 6 (3 carried forward confirmations, 1 fix verified, 2 verified-as-correct)
- No new UI/UX issues found
- All prior accessibility fixes remain intact
