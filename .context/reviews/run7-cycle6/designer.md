# Designer Review — Run 7 Cycle 6

**Reviewer:** Designer (UI/UX)
**Date:** 2026-06-20
**HEAD:** e855e6ee (byte-identical to cycle-5)
**Verdict: 0 new actionable findings. Truthful zero.**

---

## 1. Touch-Target Audit

### Test gate

```
npm test --workspace=apps/web -- touch-target-audit
Test Files  1 passed (1)
      Tests  15 passed (15)
```

Gate is green. All 15 sub-tests pass.

### KNOWN_VIOLATIONS budget

41 entries in the `KNOWN_VIOLATIONS` map; 8 files carry non-zero budgets summing to **17** — unchanged from cycle 5.

| File | Budget |
|---|---|
| `components/image-manager.tsx` | 1 |
| `components/admin-user-manager.tsx` | 2 |
| `components/admin-header.tsx` | 1 |
| `app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx` | 5 |
| `app/[locale]/admin/(protected)/categories/topic-manager.tsx` | 3 |
| `app/[locale]/admin/(protected)/tags/tag-manager.tsx` | 3 |
| `app/[locale]/admin/(protected)/settings/settings-client.tsx` | 1 |
| `app/[locale]/admin/(protected)/seo/seo-client.tsx` | 1 |

All remaining budgeted violations are documented admin-desktop-keyboard-primary surfaces with established re-open criteria.

### Manual scan of scan roots

Checked all `size="sm"` / `size="icon"` / `h-8` / `h-9` usages across `components/` and `app/[locale]/admin/` and `app/[locale]/(public)/`:

- **`photo-viewer.tsx` lines 616, 664, 679** — three `size="sm"` `<Button>` elements. All carry explicit height overrides:
  - L616: `className="gap-2 h-11"` (checkout button)
  - L664: `className="gap-2 lg:hidden h-11"` (Info button, touch-primary mobile)
  - L679: `className="gap-2 h-11"` (Share button)
  - Not in KNOWN_VIOLATIONS; not flagged by scanner because the `h-11` override clears the lookahead. Correct.
- **`search.tsx` L374** — `<Input className="border-0 p-0 h-8 ...">` — the documented DEF-C11-01 deferral. Full-width horizontal text input; not re-filed per standing instruction. No change to exit criterion.
- **`upload-dropzone.tsx`** — all `size="sm"` / `size="icon"` carry `min-h-11` or `min-h-11` overrides; budget is 0 and gate agrees.
- **`public/` route group** — zero interactive elements with sub-44 patterns found.

---

## 2. Accessibility — Key Interactive Surfaces

### Lightbox (`components/lightbox.tsx`)

**Focus management:**
- `FocusTrap` wraps the entire dialog with `allowOutsideClick: true` and `fallbackFocus: closeButtonRef`. On mount, `closeButtonRef.current?.focus()` fires (L437). On close, focus is restored to `previouslyFocusedRef.current` with a `document.body.contains` guard (L441). Both paths are implemented correctly.
- `role="dialog"` + `aria-modal="true"` + `aria-label={t('aria.lightbox')}` on the root div (L450–452). Correct ARIA dialog pattern.
- Controls: close (L560, `aria-label`+`aria-keyshortcuts="Escape"`), fullscreen (L576, `aria-label` dynamic on state, `aria-keyshortcuts="F"`), slideshow (L600, `aria-label` dynamic, `aria-pressed={isSlideshowActive}`), prev (L623, `aria-label`+`aria-keyshortcuts="ArrowLeft"`), next (L643, `aria-label`+`aria-keyshortcuts="ArrowRight"`). All buttons have `aria-label` and `focus-visible` ring styles; `aria-pressed` on the toggle is correct.
- `aria-live="polite" aria-atomic="true"` region announces slideshow state (L461). Photo position counter uses `role="status"` (L669) with `aria-live="polite"` + `aria-label` combining current/total (L671). Clean.
- Hidden slides carry `{ tabIndex: -1, 'aria-hidden': true }` (L370). No stale focus trap.

**No issues found.**

### Search Dialog (`components/search.tsx`)

- `FocusTrap active={isOpen}` with `initialFocus: '#search-input'` and `fallbackFocus: '#search-dialog'`.
- `role="dialog"` + `aria-modal="true"` + `aria-label` on the container (L333–335).
- Input: `role="combobox"` + `aria-autocomplete="list"` + `aria-controls` (conditionally set when results exist) + `aria-expanded={results.length > 0}` + `aria-activedescendant` on active result (L348–352). The combobox owns a `<label htmlFor="search-input" className="sr-only">` (L341) in addition to `aria-label` — redundant but harmless; the `aria-label` wins over the associated label for AT announcements.
- Results list: `role="listbox"` with `id="search-results"` (L402). Each result item carries `role="option"` + `aria-selected={idx === activeIndex}` (L75). Correct ARIA listbox/option pattern.
- Live region announces search status (L389, `aria-live="polite" aria-atomic="true"`).

**No issues found.**

### Info Bottom Sheet (`components/info-bottom-sheet.tsx`)

- `FocusTrap active={isOpen}` with `initialFocus` pointing to the close button ref (L194).
- `role="dialog"` + `aria-modal="true"` + `aria-label={t('viewer.bottomSheet')}` (L201–203).
- Expand/collapse handle: `aria-expanded={sheetState === 'expanded'}` + `aria-label` dynamic on state (L236–237).
- Close button: `aria-label={t('aria.close')}` (L249).

**No issues found.**

### Color Details Accordion (`components/color-details-section.tsx`)

- Toggle button: `aria-expanded={showColorDetails}` + `aria-controls={colorDetailsId}` (L291–292). `colorDetailsId` is a stable `useId()` value wiring the button to its panel — correct accordion pattern.
- Calibration info tooltip button: `aria-label={t('viewer.calibrationTooltip')}` + `min-h-[44px] min-w-[44px]` class (L308–309). 44 px target confirmed.
- Copy metadata button: `aria-label={t('viewer.copyColorMetadata')}` + `min-h-[44px] min-w-[44px]` (L324–326).
- HDR badge: `role="img"` + `aria-label={t('viewer.hdrBadgeAriaLabel')}` (L529–531). Correct for decorative-but-meaningful badge.

**No issues found.**

### Lightbox Color Pip (`components/lightbox-color-pip.tsx`)

- Toggle button: `aria-expanded={open}` + `aria-label` combining primaries and transfer function text (L132–133). Dynamic and informative.
- Pip button root carries `min-h-11` class (confirmed by KNOWN_VIOLATIONS entry count of 0 and scanner passing).
- Icon decorations are `aria-hidden="true"` (L144, L146, L148, L152). Correct.

**No issues found.**

### WideGamutHint (`components/wide-gamut-hint.tsx`)

- Outer container: `role="status"` + `aria-live="polite"` + `aria-atomic="true"` (L178–188). The comment notes the belt-and-suspenders reason (some NVDA configs don't auto-announce `role=status`). Correct.
- Dismiss button: `aria-label={t('viewer.wideGamutHintDismiss')}` (L202). X icon is `aria-hidden="true"` (L205). Correct.
- SSR/hydration boundary handled via `mounted` state guard to prevent CLS.

**No issues found.**

---

## 3. i18n Parity

Flattened both message files programmatically:

```
EN keys: 842
KO keys: 842
Missing in KO: 0
Missing in EN: 0
```

Perfect parity. The intentional Korean plural asymmetry (single `{count}장` form vs. ICU `{count, plural, …}` in English) is value-level only — both languages carry the same key set. Not flagged.

---

## Summary

| Area | Findings |
|---|---|
| Touch-target gate (`npm test … touch-target-audit`) | PASS — 15/15 tests green |
| KNOWN_VIOLATIONS budget | 17 across 8 files — unchanged |
| Manual scan (public route group) | 0 sub-44 interactive elements |
| Manual scan (components/) | 0 unbudgeted sub-44 interactive elements |
| Lightbox a11y | Clean |
| Search dialog a11y | Clean |
| Bottom sheet a11y | Clean |
| Color details accordion a11y | Clean |
| Lightbox color pip a11y | Clean |
| WideGamutHint a11y | Clean |
| i18n key parity (842 EN / 842 KO) | Clean |

**0 new actionable findings. Truthful zero.**
