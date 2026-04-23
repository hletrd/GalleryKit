# UI/UX Review — Cycle 1 (2026-04-19)

**Scope:** Accessibility, usability, responsive design, interaction patterns, i18n
**Methodology:** Code review of all client components

---

## FINDINGS

### UX-01: `info-bottom-sheet.tsx` has no live touch-drag tracking — no `onTouchMove` handler
**File:** `apps/web/src/components/info-bottom-sheet.tsx:47-84`
**Severity:** MEDIUM
**Confidence:** HIGH

The bottom sheet only handles `onTouchStart` and `onTouchEnd` — no `onTouchMove`. The sheet snaps between discrete states (`collapsed`, `peek`, `expanded`) instead of following the user's finger. This creates a janky mobile UX compared to native-like bottom sheets that track the finger in real-time.

Additionally, without `onTouchMove` + `preventDefault()`, the browser may scroll the page behind the sheet during swipe gestures, causing double-scroll behavior.

The previous review (S-04) identified this but it was not implemented.

**Fix:** Add `onTouchMove` handler that:
1. Calls `e.preventDefault()` to prevent background scroll
2. Updates `translateY` based on finger position for live tracking
3. Determines final snap state on touch end

---

### UX-02: `image-zoom.tsx` `preventDefault()` on click suppresses interactive children
**File:** `apps/web/src/components/image-zoom.tsx:41-51`
**Severity:** LOW
**Confidence:** MEDIUM

`handleClick` calls `e.preventDefault()` unconditionally on every click inside the zoom container. If a clickable child element (e.g., a link or button) is added inside the zoom area in the future, clicks on it would be suppressed.

The previous review (S-15) identified this but it was not implemented.

**Current impact:** Low — the zoom container only wraps the image element, which has no interactive children.

**Fix:** Check `e.target` before calling `preventDefault()`, or only call it when the click target is the zoom container itself (not a descendant interactive element).

---

### UX-03: `lightbox.tsx` fullscreen errors are silently swallowed
**File:** `apps/web/src/components/lightbox.tsx:101-104`
**Severity:** LOW
**Confidence:** MEDIUM

```ts
document.documentElement.requestFullscreen().catch(() => {});
document.exitFullscreen().catch(() => {});
```

If fullscreen is not supported or denied by browser policy, the error is swallowed with no user feedback. The previous review (S-12) identified this.

**Fix:** Show a brief toast or tooltip when fullscreen fails (e.g., "Fullscreen not available").

---

### UX-04: `search.tsx` `resultRefs` array accumulates stale refs across searches
**File:** `apps/web/src/components/search.tsx:24`
**Severity:** LOW
**Confidence:** MEDIUM

`resultRefs.current` is an array that grows across searches without being cleared. Old entries remain even when the results list changes. The `ref={(el) => { resultRefs.current[idx] = el; }}` pattern only updates entries at the current indices, leaving stale entries from previous (longer) result sets.

The previous review (S-11) identified this but it was not implemented.

**Fix:** Reset `resultRefs.current` when results change: `useEffect(() => { resultRefs.current = []; }, [results]);`

---

### UX-05: `upload-dropzone.tsx` preview flash when adding files
**File:** `apps/web/src/components/upload-dropzone.tsx:43-57`
**Severity:** MEDIUM
**Confidence:** HIGH

Same as CQ-01/PERF-03. When a new file is added, all existing preview images flicker because all object URLs are revoked and recreated. This is a noticeable UX issue on the upload page.

**Fix:** Use incremental URL management.

---

## ISSUE SUMMARY

| ID | Severity | File | Description | Status |
|----|----------|------|-------------|--------|
| UX-01 | MEDIUM | `info-bottom-sheet.tsx:47` | No live touch-drag tracking on bottom sheet | New (prev S-04) |
| UX-02 | LOW | `image-zoom.tsx:41` | Click preventDefault suppresses interactive children | New (prev S-15) |
| UX-03 | LOW | `lightbox.tsx:101` | Fullscreen errors silently swallowed | New (prev S-12) |
| UX-04 | LOW | `search.tsx:24` | Stale refs accumulate across searches | New (prev S-11) |
| UX-05 | MEDIUM | `upload-dropzone.tsx:43` | Preview flash on file addition | Same as CQ-01 |
