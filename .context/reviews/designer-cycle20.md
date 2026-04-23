# Designer (UI/UX) — Cycle 20

## Review Scope
Web frontend components, accessibility (WCAG 2.2), responsive breakpoints, loading/empty/error states, form validation UX, dark/light mode, i18n/RTL, and perceived performance.

## Methodology
Static code review of all React components. No live browser testing was performed this cycle (dev server not running).

## New Findings

### UX-20-01: `InfoBottomSheet` touch move handler calls `e.preventDefault()` which may conflict with browser pull-to-refresh on some mobile browsers [LOW] [LOW confidence]
- **File**: `apps/web/src/components/info-bottom-sheet.tsx` line 58
- **Description**: The `handleTouchMove` callback calls `e.preventDefault()` to prevent background scroll while dragging the sheet. On some mobile browsers (particularly Chrome on Android), calling `preventDefault()` on a touchmove event requires the event listener to be registered with `{ passive: false }`. React's synthetic event system registers touch handlers as passive by default in newer versions, which means `preventDefault()` may be silently ignored, causing background scroll during sheet drag. However, this is a minor UX degradation, not a bug — the sheet still functions, just with potential background scroll interference.
- **Fix**: If this becomes a user-reported issue, attach a native event listener with `{ passive: false }` via `useEffect` + `addEventListener`.

### UX-20-02: Mobile bottom sheet EXIF fields are now complete — verified [N/A] [HIGH confidence]
- **File**: `apps/web/src/components/info-bottom-sheet.tsx` lines 291-326
- **Description**: C19-03 fix confirmed — the mobile bottom sheet now displays `white_balance`, `metering_mode`, `exposure_compensation`, `exposure_program`, `flash`, and `bit_depth`, matching the desktop `photo-viewer.tsx`. The GPS annotation is also present (lines 327-330). Parity achieved.
- **Verdict**: Confirmed fixed.

## Accessibility Assessment

No new WCAG issues found. Prior fixes remain in place:
- Admin user creation form labels properly associated with inputs (C39-03 fix verified)
- Locale cookie includes Secure flag on HTTPS (SEC-39-01 fix verified)
- Password confirmation field present in admin user creation (UX-39-02 fix verified)
