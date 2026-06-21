# Designer Review — Run 9 Cycle 2

**Date:** 2026-06-21
**Reviewer:** oh-my-claudecode:designer (Sonnet 4.6)
**HEAD since last convergence:** f63af3b9 → two new test files only (TE-R9C1-01, TE-R9C1-02 — upload-processing-contract-lock and upload-tracker-state). Zero UI code changed.

---

## Checklist Results

### 1. Touch-Target Gate

```
npm test --workspace=apps/web -- touch-target-audit
Test Files  1 passed (1)
Tests  15 passed (15)
```

**GREEN. No regressions.** KNOWN_VIOLATIONS register reflects reality:
- `components/image-manager.tsx`: 1 (batchAddButton DialogTrigger, admin keyboard-primary, documented)
- `components/admin-user-manager.tsx`: 2 (Add admin + per-row delete, admin keyboard-primary, documented)
- `components/admin-header.tsx`: 1 (Logout link as size="sm" Button, documented)
- All other entries at 0 — correct.

### 2. i18n Key Parity (en.json vs ko.json)

Node key-extraction diff: **0 missing in ko, 0 missing in en.**

Parity holds. Korean plural asymmetry (no ICU plural block) is by-design and not a defect.

### 3. ARIA / Focus Management / Keyboard Nav

Reviewed: `lightbox.tsx`, `search.tsx`, `photo-viewer.tsx`, `color-details-section.tsx`, `lightbox-color-pip.tsx`, `histogram.tsx`, `wide-gamut-hint.tsx`, `info-bottom-sheet.tsx`, `nav-client.tsx`, `home-client.tsx`, `similar-photos.tsx`, and the admin route group.

**All pass:**

- **Lightbox** (`lightbox.tsx`): `role="dialog"` + `aria-label` + FocusTrap with `fallbackFocus` on close button. Keyboard: Escape, ArrowLeft, ArrowRight, F, C with `aria-keyshortcuts` declared on the respective buttons. `role="status"` live-region for photo position counter.
- **Search** (`search.tsx`): Full combobox pattern — `role="combobox"`, `aria-autocomplete="list"`, `aria-controls` (conditional on results), `aria-expanded`, `aria-activedescendant`, results container `role="listbox"`. FocusTrap with `initialFocus: '#search-input'`. IME composition guard present.
- **Photo viewer** (`photo-viewer.tsx`): SR-only `<h1>` for heading-based navigation. `role="status"` photo position counter. Keyboard navigation guarded against lightbox-active state.
- **Color Details / Lightbox PIP**: All interactive elements (calibration tooltip, copy button, DCI-P3 info button, HDR badge) carry `aria-label`. Copy button and histogram expand/collapse/cycle buttons carry `min-h-11 min-w-11` (44px).
- **Wide Gamut Hint**: `role="status"` with documented rationale for NVDA polite-vs-assertive tradeoff. Dismiss button `aria-label` present.
- **Info Bottom Sheet**: `role="dialog"` + `aria-modal="true"` + `aria-label` + FocusTrap.
- **Nav**: `aria-label` on `<nav>` landmark. Skip-to-main-content link present in root layout (`sr-only focus:not-sr-only`). `aria-current="page"` on active topic links. `aria-expanded` + `aria-controls` on hamburger toggle.
- **Admin**: Login error uses `role="alert"` + `aria-live="assertive"`. Settings status banners use `role="status"`. Pagination Previous/Next buttons carry `aria-label`. All icon-only buttons (back, edit, delete, revoke, copy) carry `aria-label`.
- **Landmark structure**: Public layout wraps content in `<main id="main-content" tabIndex={-1}>`. Admin layout has its own `<main id="main-content">`. Skip link targets `#main-content` correctly.

### 4. Sub-44px Interactive Elements Outside Scanner Scope

No new pattern found. Verified manually:
- `div`/`span` with `onClick` handlers do not appear as primary interactive controls outside already-audited components.
- `lightbox-color-pip.tsx:189` info tooltip button: `inline-flex min-h-11 min-w-11` — compliant.
- `color-details-section.tsx:308,326,400` inline icon buttons: all carry `min-h-[44px] min-w-[44px]` — compliant.
- `histogram.tsx:619,706` collapse/cycle buttons: `min-h-11 min-w-11` — compliant.

### 5. Color Contrast (Spot Check)

Values using semantic Tailwind tokens (`text-muted-foreground`, `text-foreground`, `bg-card`, etc.) inherit from CSS variables — no hardcoded low-contrast hex values found in component files. The HDR badge (`text-amber-950` on `bg-gradient-to-r from-amber-300 to-orange-400`) is decorative/supplementary text in addition to the icon; contrast is acceptable for informational status indicators. No new concern.

---

## Verdict

**0 new findings.**

- Touch-target gate: GREEN (15/15 tests pass).
- i18n key parity: HOLDS (0 missing keys in either locale).
- ARIA/focus/keyboard: All surfaces adequately covered, no regressions.
- KNOWN_VIOLATIONS register: Matches empirical reality, no stale entries.

**Convergence confirmed.** The two new commits (TE-R9C1-01, TE-R9C1-02) are pure test files touching upload-processing-contract-lock and upload-tracker-state — no UI surface changed. No designer action required this cycle.
