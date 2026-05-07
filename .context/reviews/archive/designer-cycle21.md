# UI/UX Review — Cycle 21

**Reviewer:** designer
**Date:** 2026-04-19

## Review Scope

UI/UX review of the web frontend, covering information architecture, accessibility, responsive design, and perceived performance.

## Findings

### DES-21-01: No visual regressions detected from recent code changes [INFO]
- **Description:** The recent changes (C20-01 upload tracker clamping, C20-02 deleteAdminUser fix, C19-03 mobile EXIF fields) are all backend logic changes with no UI impact. The mobile EXIF field additions from C19-03 were verified in the previous cycle to be correctly implemented in `info-bottom-sheet.tsx`.

### DES-21-02: `info-bottom-sheet.tsx` EXIF field expansion may cause excessive scrolling on small screens [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/components/info-bottom-sheet.tsx` — expanded EXIF section
- **Description:** With the addition of 6 new EXIF fields (white_balance, metering_mode, exposure_compensation, exposure_program, flash, bit_depth), the expanded EXIF grid now contains 14 fields. On a small mobile screen (320px height viewport), this may require significant scrolling within the bottom sheet. The bottom sheet's max-height constraint may cause the EXIF section to be cut off, requiring the user to scroll within the sheet while also scrolling the page.
- **Concrete failure scenario:** On an iPhone SE (320px viewport), the expanded EXIF section extends beyond the bottom sheet's visible area. The user must scroll within the sheet to see all fields. If the sheet's scroll container doesn't have proper momentum scrolling on iOS, the experience feels janky.
- **Fix:** Consider adding a "Show more" toggle that shows the first 8 fields by default and reveals the rest on tap. Or use a two-column grid on wider mobile screens to reduce vertical height.

### DES-21-03: Previous UI/UX deferred items remain relevant [INFO]
- **Description:** The previously deferred UI/UX items (font subsetting, dark mode, reduced motion) remain unchanged.

## Summary
- 0 CRITICAL findings
- 0 MEDIUM findings
- 1 LOW finding (mobile EXIF scrolling)
- 2 INFO findings
