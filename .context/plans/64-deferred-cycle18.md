# Plan 64-Deferred — Deferred Items (Cycle 18)

**Created:** 2026-04-19 (Cycle 18)
**Status:** Deferred

## Deferred Findings

### C18-06: photo-viewer.tsx document.title cleanup flash (VERY LOW)

- **File+Line:** `apps/web/src/components/photo-viewer.tsx`, lines 72-78
- **Original Severity/Confidence:** VERY LOW / MEDIUM
- **Reason for deferral:** Cosmetic issue only. The current cleanup approach has proper semantics — it restores the previous title on unmount. The brief flash when navigating between photos is an acceptable trade-off for correct cleanup behavior. The alternative (tracking "expected" title) adds complexity for negligible UX improvement.
- **Exit criterion:** If a user reports the title flash as a noticeable bug, or if the navigation pattern changes to make the flash more prominent.

## Carry-Forward from Previous Cycles

All 17 previously deferred items remain deferred with no change in status (see cycle 14 aggregate for full list).
