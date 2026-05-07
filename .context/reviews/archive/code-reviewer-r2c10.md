# Code Review — Cycle 10 (Run 2)

**Reviewer**: code-reviewer
**Date**: 2026-05-05
**Scope**: Full repository review focusing on correctness, edge cases, and maintainability of recently modified and core files.

## Findings

### MEDIUM

#### R2C10-MED-01: image-zoom.tsx keyboard zoom toggle is broken due to type-cast + role="button" self-match
- **File**: `apps/web/src/components/image-zoom.tsx:335`
- **Code**:
  ```tsx
  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(e as unknown as React.MouseEvent); } }}
  ```
- **Issue**: The `onKeyDown` handler casts `React.KeyboardEvent` to `React.MouseEvent` and passes it to `handleClick`. Inside `handleClick` (line 162-179), the first check is:
  ```tsx
  const target = e.target as HTMLElement;
  if (target.closest('a, button, [role="button"], input, textarea, select')) return;
  ```
  When the keyboard event fires on the zoom container div, `e.target` IS the div itself. The div has `role="button"` (line 332). Therefore `target.closest('[role="button"]')` matches the div itself, and `handleClick` returns early without toggling zoom.
- **Impact**: Users navigating by keyboard (Tab to focus the image, then press Enter or Space) cannot zoom in. This is a WCAG 2.1 Level A violation (keyboard operability).
- **Confidence**: High
- **Fix**: Add a dedicated keyboard handler that doesn't delegate to `handleClick`, or modify `handleClick` to accept a `fromKeyboard` flag that skips the `closest` guard. Alternatively, change `onKeyDown` to call `resetZoom(false)` / zoom-in logic directly instead of delegating through `handleClick`.

### LOW

#### R2C10-LOW-01: load-more.tsx maintenance status produces repeated toast spam
- **File**: `apps/web/src/components/load-more.tsx:62-69`
- **Issue**: When `loadMoreImages` returns `{ status: 'maintenance', hasMore: true }`, the component shows a toast but leaves `hasMore = true`. The IntersectionObserver sentinel remains in view, so as soon as `loadingRef.current` is cleared, the observer fires again, triggering another load-more request and another toast. During a sustained maintenance window, scrolling produces a rapid series of identical toasts.
- **Impact**: Poor UX during DB restore maintenance; not a functional bug.
- **Confidence**: Medium
- **Fix**: Add a cooldown or a transient `maintenanceAcknowledged` flag that suppresses further toasts/load attempts for a short period (e.g., 5s) after receiving a maintenance response. Alternatively, set `hasMore = false` temporarily when maintenance is detected and re-enable it on the next successful load.

## Previously fixed findings (verified)

- C9-MED-01 (analytics rate limiting): Fixed — `isViewRecordRateLimited` present in public.ts
- C9-MED-02 (search min query length): Fixed — uses `countCodePoints`
- C9-MED-03 (slideshow button on single image): Fixed — hidden when `totalCount <= 1`
- C9-LOW-01 (fractional seconds in EXIF): Confirmed not a bug — `process-image.ts` strips fractional seconds at extraction time

## Deferred / no action

- No deferred items introduced this cycle.
