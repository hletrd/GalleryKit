# Designer / UI-UX Reviewer — Cycle 1 Fresh Review

**Date**: 2026-05-05
**Scope**: UI/UX review — information architecture, affordances, focus/keyboard navigation, responsive breakpoints, loading/empty/error states.

---

## FINDINGS

### UI-01: Service Worker stale HTML may cause broken UI (Medium)
**File**: `apps/web/public/sw.template.js`

Cross-file finding with code-reviewer BUG-01. When cached HTML exceeds 24 hours, the service worker serves it anyway. If the deployment changed JS/CSS chunk hashes, the stale HTML references deleted files, causing:
- Broken styles (FOUC or unstyled content)
- Runtime JS errors (failed chunk loads)
- Potentially broken navigation if route structure changed

**User impact**: Returning visitors may see a broken site until they hard-refresh or the SW updates.

---

### UI-02: Masonry sizes attribute ordering is correct (Verified)
**File**: `apps/web/src/components/home-client.tsx`
**Lines**: 227-232

The `sizes` attribute matches the CSS column breakpoints:
- `<640px`: 1 column → 100vw
- `640-767px`: 2 columns → 50vw
- `768-1279px`: 3 columns → 33vw
- `1280-1535px`: 4 columns → 25vw
- `>=1536px`: 5 columns → 20vw

Verified correct.

---

### UI-03: Back-to-top button is keyboard-accessible (Verified)
**File**: `apps/web/src/components/home-client.tsx`
**Lines**: 309-325

The back-to-top button uses:
- `aria-label` for screen readers
- `aria-hidden` and `tabIndex={-1}` when hidden
- `prefers-reduced-motion` check for smooth scroll
- `min-h-11 min-w-11` for 44px touch target

Verified correct per WCAG 2.5.5.

---

## VERDICT

UI implementation is solid. The only UX risk is the service worker serving stale HTML indefinitely. All other reviewed surfaces (masonry grid, photo viewer, search, admin dashboard) show proper accessibility and responsive design.
