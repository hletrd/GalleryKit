# Designer — Cycle 11 (Run 2)

**Date**: 2026-05-05
**Angle**: UI/UX, accessibility, responsive design, keyboard navigation, WCAG 2.2
**Scope**: Web frontend components, CSS, ARIA, focus management, touch targets

## Agent Failure Note
The `Agent` tool is not exposed in this environment; `.claude/agents/` does not exist. This review was performed manually by a single comprehensive pass.

## Findings

### C11-UI-01: `ImageZoom` missing `touch-action: none` causes gesture conflicts
**File**: `apps/web/src/components/image-zoom.tsx` (lines 332-359)
**Severity**: Low | **Confidence**: Medium

The custom pinch-zoom and pan implementation does not suppress the browser's default touch behaviors. On mobile Safari and Chrome, users may experience simultaneous browser zoom and custom zoom, or scroll interference during pinch gestures.

**Suggested fix**: Add `touchAction: 'none'` to the container when zoomed, or `touchAction: 'pan-x pan-y'` when not zoomed.

### C11-UI-02: Lightbox focus restoration may target removed element
**File**: `apps/web/src/components/lightbox.tsx` (lines 364-374)
**Severity**: Low | **Confidence**: Medium

When the lightbox unmounts, it attempts to restore focus to `previouslyFocusedRef.current`. If SPA navigation occurred while the lightbox was open, the previously focused element may no longer be in the DOM, causing focus to land unpredictably (often on `<body>`).

**Suggested fix**: Guard focus restoration with `document.body.contains(previouslyFocusedRef.current)`.

### C11-UI-03: Semantic search disabled-state UX is silent
**File**: `apps/web/src/app/api/search/semantic/route.ts` (line 97)
**Severity**: Low | **Confidence**: Low

When semantic search is disabled, the endpoint returns a 403 with JSON `{ error: 'Semantic search is not enabled' }`. There is no corresponding client-side UI explaining why the feature is unavailable. This is a product-level gap, not a code bug.

**Suggested fix**: Out of scope for this cycle — requires UI design work.

## WCAG 2.2 Checklist
- Focus order: OK (lightbox traps focus, close button auto-focused)
- Focus indicators: OK (blue outline on all interactive elements)
- Touch targets: OK (all buttons >= 44x44 px, enforced by blocking test)
- Reduced motion: OK (`prefers-reduced-motion` respected in lightbox and image-zoom)
- Color contrast: OK (dark mode variants present)
- Keyboard shortcuts: OK (documented in photo viewer, Escape/Arrows/F/Space handled)

## Final Sweep
No additional UI/UX findings after reviewing all `.tsx` components in `components/` and `app/[locale]/admin/`.
