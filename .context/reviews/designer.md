# Designer Review — Cycle 14

**Reviewer:** Designer (UI/UX + Accessibility)
**Date:** 2026-06-27
**Scope:** Static TSX/ARIA analysis of `apps/web/src/components/` and `apps/web/src/app/[locale]/` route UIs
**Prior context read:** `.context/reviews/_aggregate.md` (cycle 13), `.context/plans/cycle-13-plan.md`
**i18n parity check:** Python key-diff across `en.json` / `ko.json` — **0 keys missing in either file** (765 total each, all namespaces present in both)

---

## Severity Summary

| ID | File : Line | Severity | WCAG / Category | Status |
|----|-------------|----------|-----------------|--------|
| DES-14-01 | `tag-input.tsx:184` | LOW | 2.4.11 Focus Appearance | **NEW** |
| DES-14-02 | `load-more.tsx:148` | LOW | 4.1.2 Name, Role, Value | **NEW** |
| DES-14-03 | `photo-viewer.tsx:731`, `lightbox.tsx:671` | LOW (confidence: Medium) | 1.3.3 Sensory Characteristics | **NEW** |
| DES-13-02 | `search.tsx:352` | MEDIUM | 4.1.2 Name, Role, Value | DEFERRED (still present) |
| DES-13-03 | `color-details-section.tsx:332` | LOW | 2.3.3 Animation from Interactions | DEFERRED (still present) |
| DES-13-04 | `nav-client.tsx:158` | LOW | 4.1.2 Name, Role, Value | DEFERRED (still present) |
| DES-13-05 | `home-client.tsx:412` | LOW | 1.1.1 Non-text Content | DEFERRED (still present) |
| DES-13-06 | `info-bottom-sheet.tsx` | LOW | 4.1.2 Name, Role, Value | DEFERRED (still present) |

**CRIT/HIGH new findings: 0**

---

## NEW Findings

### DES-14-01 — Remove-tag button: `focus:ring` instead of `focus-visible:ring`

**File:** `apps/web/src/components/tag-input.tsx:184`

**Selector / className fragment:**
```
focus:ring-2 focus:ring-ring focus:ring-offset-2
```

**WCAG:** 2.4.11 Focus Appearance (AA, WCAG 2.2)

**User-impact scenario:** Keyboard navigation is not impaired — the ring IS visible on keyboard focus. However, the ring also appears on mouse click, creating unexpected visual noise that makes the interaction feel unintentional. The rest of the codebase uses `focus-visible:ring-*` uniformly (lightbox-color-pip.tsx:196, color-details-section.tsx:330, upload-dropzone.tsx:413, etc.), so this is a style-consistency defect as well as a minor UX regression.

**Fix:**
```tsx
// tag-input.tsx:184 — change:
focus:ring-2 focus:ring-ring focus:ring-offset-2
// to:
focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
```
No new i18n keys needed.

**Confidence:** High (reproducible pattern mismatch)

---

### DES-14-02 — Load-more spinner icon not `aria-hidden`

**File:** `apps/web/src/components/load-more.tsx:148`

**Code:**
```tsx
{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
{loading ? t('home.loadingMore') : t('home.loadMore')}
```

**WCAG:** 4.1.2 Name, Role, Value (AA)

**User-impact scenario:** When loading is in progress the Button text changes to the "Loading…" translation, which already announces the state to screen readers. The Lucide `<Loader2>` icon is purely decorative in this context — but without `aria-hidden="true"` some screen readers (JAWS, NVDA in browse mode) may pause on the unlabeled element, producing a brief blank announcement before the text. The sibling pattern at `search.tsx:377` already uses `role="status" aria-label={t('common.loading')}` on its spinner; at minimum `aria-hidden="true"` should be added here for consistency.

**Fix:**
```tsx
// load-more.tsx:148 — add aria-hidden:
{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
```
No new i18n keys needed.

**Confidence:** High (well-established AT behavior; pattern established in search.tsx)

---

### DES-14-03 — Position counter live region announces "2 / 10" rather than descriptive text

**File:** `apps/web/src/components/photo-viewer.tsx:731`, `apps/web/src/components/lightbox.tsx:671`

**Code (photo-viewer):**
```tsx
<div
  role="status"
  aria-live="polite"
  aria-label={t('aria.photoPosition', { current: currentIndex + 1, total: images.length })}
  className="absolute bottom-2 left-1/2 ...">
  {currentIndex + 1} / {images.length}
</div>
```

**WCAG:** 1.3.3 Sensory Characteristics (AA)

**User-impact scenario:** `aria-label` defines the accessible *name* of the live region (read on explicit virtual-cursor navigation). Live region *updates* are driven by text content changes — so when the user navigates photos the announcement is the inner text: `"2 / 10"`. VoiceOver reads this as "2 slash 10"; NVDA reads "2 / 10" without vocalising the slash, which is understandable but context-free. The fully descriptive `aria-label` ("Photo 2 of 10") is never heard as a live announcement.

**Fix (preferred):** Replace the single text node with a sr-only span carrying the full translation and an `aria-hidden` span for the visual "2 / 10":
```tsx
<div role="status" aria-live="polite" className="absolute bottom-2 ...">
  <span className="sr-only">
    {t('aria.photoPosition', { current: currentIndex + 1, total: images.length })}
  </span>
  <span aria-hidden="true">{currentIndex + 1} / {images.length}</span>
</div>
```
Apply the same pattern to `lightbox.tsx:671`. No new i18n keys needed — `aria.photoPosition` already exists in both `en.json` and `ko.json`.

**Confidence:** Medium — "2 / 10" is contextually clear in a photo gallery; this is a precision/polish issue, not a hard blocker.

---

## Confirmed-Deferred Findings

All five items deferred from cycles 12–13 remain unchanged in the codebase. Recorded here for continuity; none re-opened.

### DES-13-02 — Combobox `aria-expanded` tracks result count, not popup visibility

**File:** `apps/web/src/components/search.tsx:352`
**Code:** `aria-expanded={results.length > 0}` (on the combobox `<input>`)
**Status:** Still present. The correct value must track whether the listbox popup is rendered, not whether it has content. A completed search with zero results should have `aria-expanded={false}` while the `aria-controls` target is absent. The `isOpen` state variable (line 307, on the surrounding dialog) is a different boolean; the combobox needs its own popup-visibility state. Deferred.

### DES-13-03 — ChevronDown rotation not gated on `prefers-reduced-motion`

**File:** `apps/web/src/components/color-details-section.tsx:332`
**Code:** `` className={`h-4 w-4 transition-transform ${showColorDetails ? 'rotate-180' : ''}`} ``
**Status:** Still present. No `motion-reduce:transition-none` prefix. Minor animation; deferred.

### DES-13-04 — Theme toggle: static `aria-label`, no `aria-pressed` for current state

**File:** `apps/web/src/components/nav-client.tsx:158–164`
**Code:** `aria-label={t('aria.toggleTheme')}` + `title={t(\`theme.${theme}\`)}`
**Status:** `title` communicates the current theme for pointer users. Screen readers do not reliably announce `title` on buttons. A dynamic label ("Switch to dark mode", current state: light) or `aria-pressed` would correctly communicate state. Deferred pending new i18n keys for per-state labels.

### DES-13-05 — P3 gamut badge `aria-hidden` without sr-only equivalent on masonry card

**File:** `apps/web/src/components/home-client.tsx:412–413`
**Code:** `<div className="gamut-p3-badge ..." aria-hidden="true">`
**Status:** The P3 badge is visually present on wide-gamut photos but invisible to screen readers. Deferred pending sr-only text addition (requires new i18n key for badge accessible label).

### DES-13-06 — Bottom sheet drag handle `aria-expanded` is binary for a 3-state component

**File:** `apps/web/src/components/info-bottom-sheet.tsx`
**Code:** `aria-expanded={sheetState === 'expanded'}` (drag handle button)
**Status:** Sheet states are `'collapsed'`, `'peek'`, `'expanded'`. The "peek" state reads as `false`. Deferred pending design decision on intermediate-state representation (requires new i18n keys for per-state labels or an `aria-valuenow` pattern).

---

## Scope Completions — No Issues Found

The following areas were inspected and found clean:

- **`lightbox.tsx`:** FocusTrap, `aria-modal`, `aria-hidden` on auto-hidden controls, `controlVisibilityProps` pattern, Ken Burns gated on `shouldReduceMotion`, play/pause `aria-pressed`, position counter `role="status"` structure — all correct.
- **`search.tsx`:** FocusTrap, `role="combobox"`, `aria-controls` conditional on popup DOM presence, `aria-activedescendant`, `role="listbox"` / `role="option"`, `aria-live` status region — all correct except the deferred DES-13-02.
- **`info-bottom-sheet.tsx`:** FocusTrap, `role="dialog" aria-modal`, close button `min-h-11 min-w-11`, download dropdown `min-h-11 py-2` — all correct except the deferred DES-13-06.
- **`photo-viewer.tsx`:** AGG-R13-03 fix confirmed at line 575 (`sr-only md:not-sr-only`, `id="photo-viewer-shortcuts"` correctly in-tree on mobile and referenced by `aria-describedby` at line 557).
- **`tag-input.tsx`:** ARIA combobox pattern (`role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`) correct. `min-h-11` on all option rows. DES-14-01 is the sole defect.
- **`tag-filter.tsx`:** `role="group"` with `aria-label`, `aria-pressed` on all pills, `min-h-11 min-w-11` — correct.
- **`image-manager.tsx`:** Checkbox labels `min-h-11 min-w-11`, action buttons `h-11 w-11`, processing overlay `role="status" aria-live` — correct.
- **`bulk-edit-dialog.tsx`:** `SelectTrigger h-11`, `role="alert"` on validation error, `aria-label` on all form fields — correct.
- **`upload-dropzone.tsx`:** Dropzone `role="button"`, `aria-disabled`, `role="progressbar"` with `aria-valuemin/max/now`, native select `h-11`, tags `role="group" aria-labelledby` — correct.
- **`lightbox-color-pip.tsx`:** `aria-expanded`, tooltip trigger `min-h-11 min-w-11 focus-visible:*`, copy button `min-h-11 min-w-11 focus-visible:*` — correct.
- **`color-details-section.tsx`:** `aria-expanded`, `aria-controls`, accordion trigger `min-h-[44px] focus-visible:*`, tooltip trigger `min-h-[44px] min-w-[44px] focus-visible:*`, HDR badge `role="img"` — correct except deferred DES-13-03.
- **`on-this-day-widget.tsx`:** `<aside aria-label>`, photo links `min-h-[44px]` — correct.
- **`home-client.tsx`:** Back-to-top `aria-hidden`/`tabIndex={-1}` when hidden, sr-only heading — correct except deferred DES-13-05.
- **`admin-nav.tsx`:** `aria-current="page"`, `min-h-11` on all nav links — correct.
- **`nav-client.tsx`:** `aria-label` on `<nav>`, `aria-expanded/controls` on mobile toggle, `aria-current` on active links — correct except deferred DES-13-04.
- **`admin-user-manager.tsx`:** Contextual `aria-label` on delete button, `aria-invalid/describedby/role="alert"` on password error — correct.
- **Admin route pages:** No sub-44px touch targets found; all `SelectTrigger` elements at `h-11`; `role="group" aria-label` on filter groups.
- **i18n parity:** 765 keys in both `en.json` and `ko.json`; zero keys present in one file but absent from the other. `lrToken.*` namespace confirmed in both files.

---

## Notes for Planner

- **DES-14-01** and **DES-14-02** are single-line mechanical fixes with no design decisions and no new i18n keys. Both can be batched into one micro-commit.
- **DES-14-03** is a two-span refactor at two call sites (`photo-viewer.tsx:731` and `lightbox.tsx:671`). No new i18n keys needed; `aria.photoPosition` already exists correctly in both locale files. Low priority given contextual clarity of "2 / 10".
- **DES-13-04, DES-13-05, DES-13-06** all require new i18n keys before they can be fixed. Keep deferred until the planner decides to add the keys.
- **DES-13-02** (combobox `aria-expanded`) requires only a new boolean state variable in `search.tsx`. No i18n keys needed. MEDIUM effort relative to the deferred group.
