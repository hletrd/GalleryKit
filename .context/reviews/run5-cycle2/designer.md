# Designer Review — run-5 cycle-2
**Date:** 2026-06-12
**Reviewer lane:** UI/UX + Accessibility
**Scope:** `apps/web/src/components/**`, `apps/web/src/app/[locale]/**`
**Method:** Static source analysis (git range `b7d4729b..HEAD` for cycle-1 fix verification; full sweep for new findings). Browser/runtime review not performed this cycle (feasible — MySQL UP, .env.local present — but the source sweep yielded sufficient signal without runtime cost).

---

## 1. Cycle-1 Fix Verification

All four explicitly targeted cycle-1 a11y fixes are confirmed correct by source code inspection.

### DES-R5C1-01 — Upload dropzone accessible name VERIFIED FIXED
**File:** `apps/web/src/components/upload-dropzone.tsx:400`
The `role="button"` dropzone div now carries `aria-label={t('upload.dropzoneLabel')}` and `aria-disabled={uploading || !hasTopics}`. Screen readers announce the control name and its disabled state correctly.

### DES-R5C1-03 + DES-R5C1-22 — Lightbox counter announceability VERIFIED FIXED
**File:** `apps/web/src/components/lightbox.tsx:666–674`
The position counter `role="status" aria-live="polite"` region is now always present in the AT tree. Visibility is toggled exclusively via CSS opacity (`opacity-0` / `opacity-100` className) so the counter is never removed from the accessibility tree. `aria-label={t('aria.photoPosition', { current: currentIndex + 1, total: totalCount })}` provides unambiguous context (e.g. "Photo 3 of 12").

### DES-R5C1-04 — Info bottom-sheet focus trap + drag-handle label VERIFIED FIXED
**File:** `apps/web/src/components/info-bottom-sheet.tsx:192–197, 237`
`FocusTrap` now has `initialFocus: () => closeButtonRef.current ?? dragHandleRef.current ?? false`. Focus lands on the close button (44 px, h-11) on open, not the drag handle. The drag handle carries a state-aware label: `aria-label={sheetState === 'expanded' ? t('viewer.collapseSheet') : t('viewer.expandSheet')}`. The `useEffect` that previously forced re-focus on every state change has been removed, eliminating the spurious focus jank. On close, `FocusTrap active={isOpen}` becomes false and focus-trap-react's default return-focus behaviour restores focus to the triggering element.

### DES-R5C1-05 — Masonry P3 badge aria-hidden VERIFIED FIXED
**File:** `apps/web/src/components/home-client.tsx:356`
`<span className="gamut-p3-badge ..." aria-hidden="true">P3</span>` — the decorative badge is now correctly hidden from assistive technology.

### DES-R5C1-02 — Password form submit button VERIFIED NON-ISSUE (plan-317)
`apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:108` uses `<Button type="submit">` with no explicit size. The `ui/button.tsx` component now floors every size variant at `min-h-11` (44 px), so this button renders at ≥ 44 px at runtime. No finding.

---

## 2. New Findings

Findings follow ID format `DES-R5C2-NN`. Carry-forward findings from cycle-1 that are not suppressed receive new IDs in this cycle.

---

### DES-R5C2-01
**Severity:** MED
**Confidence:** HIGH
**Classification:** Touch-target / WCAG 2.5.5
**File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:140, 172`

**Problem:** The "View Gallery" back link in the shared group page uses `className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"`. It renders as an inline flex row with a 16 px `ArrowLeft` icon and `text-sm` label text. Line height on `text-sm` is ~20 px; with default body padding the clickable area on mobile is approximately 20 px tall — well below the 44 px project floor. This appears on both the photo-viewer sub-path (line 140) and the grid sub-path (line 172). The shared-group page is the primary mobile entry point for shared photos, making this the highest-impact touch-target miss in cycle 2.

**Impact:** Visitors on touch devices have difficulty tapping the only navigation link that exits the shared view. Fails WCAG 2.5.5 (Level AAA, project policy) and Apple HIG 44 pt minimum.

**Fix:** Add `min-h-11 py-2` (or equivalent) to both link instances, or wrap in a `<div className="py-2">`. Because the link is inline-flex, `min-h-11` alone is sufficient:
```tsx
className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 min-h-11"
```

---

### DES-R5C2-02
**Severity:** LOW
**Confidence:** HIGH
**Classification:** Touch-target / WCAG 2.5.5
**File:** `apps/web/src/app/[locale]/not-found.tsx:43`

**Problem:** The "Back to gallery" inline text link uses `className="text-primary hover:underline text-sm"`. This is a raw `<Link>` with no height class. Rendered height equals line height of `text-sm` ≈ 20 px. A user who accidentally lands on a 404 on mobile has trouble tapping the sole recovery link.

**Impact:** Below project 44 px floor. Lower severity than DES-R5C2-01 because 404 is not a common mobile flow, but it is the only actionable element on the page.

**Fix:**
```tsx
className="text-primary hover:underline text-sm inline-flex items-center min-h-11"
```

---

### DES-R5C2-03
**Severity:** LOW
**Confidence:** HIGH
**Classification:** Contrast / WCAG 1.4.3
**File:** `apps/web/src/app/[locale]/error.tsx:18`

**Problem:** (Carry-forward of DES-R5C1-21 — not previously suppressed.)
```tsx
<h1 id="route-error-title" className="text-7xl font-bold text-muted-foreground/30">
```
`text-muted-foreground` maps to `--muted-foreground: 240 3.8% 40%` in `globals.css` (HSL → `#636366`). At `/30` alpha on white: approximate contrast ratio ≈ 1.4:1. This is a deliberate large-text decorative "error code" treatment (similar to the `not-found.tsx` "404" span), but unlike `not-found.tsx` which has `aria-hidden="true"` on the decorative number and a separate semantic `<h1>`, this `h1` IS the page heading. Screen readers announce a heading with 1.4:1 contrast. Sighted low-vision users cannot read it.

**Impact:** Fails WCAG 1.4.3 (AA, 4.5:1 for normal text; 3:1 for large bold text ≥ 18.67 px). The `text-7xl` at 72 px bold does clear the "large text" threshold, so the minimum is 3:1 — still unmet at 1.4:1.

**Fix option A (semantic heading preserved):** Split into decorative span + accessible heading:
```tsx
<span aria-hidden="true" className="text-7xl font-bold text-muted-foreground/30 block">
  {t('serverError')}
</span>
<h1 id="route-error-title" className="sr-only">{t('serverError')}</h1>
```
**Fix option B (raise opacity to meet 3:1 large-text minimum):** `/30` → `/60` gives approximately 3.2:1 on white with the current muted-foreground value. Preserves the faded aesthetic while being readable.

---

### DES-R5C2-04
**Severity:** LOW
**Confidence:** HIGH
**Classification:** ARIA correctness
**File:** `apps/web/src/components/home-client.tsx:395`

**Problem:** (Carry-forward of DES-R5C1-19.)
The empty-state SVG icon rendered when the gallery has no photos:
```tsx
<svg className="h-12 w-12 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
```
has no `aria-hidden="true"`. The SVG contains `<path>` elements with no title or desc, so VoiceOver/NVDA either skips it or announces "image" with no name — polluting the AT reading flow at the page's main content area.

**Fix:** Add `aria-hidden="true"` to the svg element.

---

### DES-R5C2-05
**Severity:** LOW
**Confidence:** HIGH
**Classification:** i18n correctness
**File:** `apps/web/src/components/nav-client.tsx:164`

**Problem:** (Carry-forward of DES-R5C1-17.)
```tsx
{otherLocale === 'ko' ? '한국어' : 'English'}
```
Locale names are hardcoded English/Korean strings in a ternary rather than resolved from the translation system or a locale-display-names map. Adding a third locale (e.g. `ja`) would silently fall through to `'English'`. The pattern is inconsistent with the rest of the i18n approach.

**Impact:** LOW — only affects maintainability and future locale additions. No runtime regression today.

**Fix:** Use a `LOCALE_DISPLAY_NAMES` map (`{ en: 'English', ko: '한국어' }`) keyed by locale code. Adding a locale then requires one map entry rather than a ternary update.

---

### DES-R5C2-06
**Severity:** LOW
**Confidence:** HIGH
**Classification:** Dead markup / ARIA
**File:** `apps/web/src/components/photo-viewer.tsx:592`

**Problem:** (Carry-forward of DES-R5C1-18.)
```tsx
<div id="photo-viewer-shortcuts" className="sr-only">
```
This element has an `id` but is never referenced by `aria-describedby` or any other ARIA pointer anywhere in the codebase. It occupies the AT tree as a visible-to-SR region with no semantic role, adding no value.

**Impact:** Noise in AT tree; misleads future developers about the intended pattern.

**Fix:** Either wire up `aria-describedby="photo-viewer-shortcuts"` on the relevant interactive element, or remove the dead element.

---

### DES-R5C2-07
**Severity:** LOW
**Confidence:** MEDIUM
**Classification:** ARIA state correctness
**File:** `apps/web/src/components/upload-dropzone.tsx:490`

**Problem:** (Carry-forward of DES-R5C1-20.)
The "Inherited global tags" display area (the list of tags automatically applied to all uploads) renders as:
```tsx
<span className="... opacity-60 cursor-not-allowed">
```
when the dropzone is uploading. The visual disabled treatment (opacity, pointer cursor) has no ARIA equivalent. If a user tabs to any of these tag spans and their screen reader announces them, there is no `aria-disabled` or `aria-label` indicating why interaction is blocked.

**Impact:** MEDIUM in context, LOW in practice because the spans are not focusable (`tabIndex` not set) and the enclosing dropzone `role="button"` already carries `aria-disabled`. The visual state is cosmetic.

**Fix:** If the tag spans are intentionally non-interactive, confirm no `tabIndex` lands on them. If they are meant to be interactive in a future state, add `aria-disabled="true"` alongside the opacity class.

---

### DES-R5C2-08
**Severity:** LOW
**Confidence:** LOW (needs manual device validation)
**Classification:** Responsive layout / iOS viewport
**File:** `apps/web/src/components/info-bottom-sheet.tsx` (sheet height classes)

**Problem:** (Carry-forward of DES-R5C1-23.)
The bottom sheet uses `max-h-[95vh]`. On iOS 15 Safari with the collapsing address bar, `100vh` and `95vh` can include the browser chrome area, causing the sheet to overflow or clip the drag handle. The fix (using CSS `dvh` units or `min-height: -webkit-fill-available`) was deferred in cycle-1. The cycle-1 FocusTrap fix (DES-R5C1-04) was implemented in the same file; the viewport-unit issue remains unaddressed.

**Impact:** On-device validation required. If confirmed, the top of the sheet is clipped on iPhone with Safari 15's collapsing chrome. `dvh` is supported in iOS 16+ (Safari 16); a `@supports` fallback to `95vh` covers older devices.

**Fix:** Replace `max-h-[95vh]` with `max-h-[95dvh]` with a `95vh` fallback for iOS 15:
```css
max-height: 95vh;            /* fallback */
max-height: 95dvh;           /* iOS 16+ / Chrome 108+ */
```
In Tailwind: use an arbitrary value with the `@supports` trick, or add a custom utility in `globals.css`.

---

## 3. Suppressed Findings (per task brief)

The following findings from cycle-1 are suppressed in this cycle per the brief's explicit suppression list. They are not re-reported here:

- **DES-R5C1-06 through DES-R5C1-16** — Already targeted by plan-315 (run5-cycle1 medium/high plan)
- **plan-316 scope** (low/docs findings) — Deferred by design
- **DES-R5C1-24** — Deferred per plan-317
- **DES-R5C1-08** (nav `bg-background/50` fallback) — Already planned

---

## 4. Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRIT | 0 | — |
| HIGH | 0 | — |
| MED | 1 | DES-R5C2-01 |
| LOW | 7 | DES-R5C2-02, -03, -04, -05, -06, -07, -08 |

**Total new findings: 8**

---

## 5. Components Swept

- `apps/web/src/components/upload-dropzone.tsx` (539 lines)
- `apps/web/src/components/lightbox.tsx` (680 lines)
- `apps/web/src/components/info-bottom-sheet.tsx` (546 lines)
- `apps/web/src/components/home-client.tsx` (428 lines)
- `apps/web/src/components/photo-viewer.tsx` (1109 lines)
- `apps/web/src/components/search.tsx` (444 lines)
- `apps/web/src/components/nav-client.tsx` (173 lines)
- `apps/web/src/components/photo-navigation.tsx` (252 lines)
- `apps/web/src/components/lightbox-color-pip.tsx` (partial, 80 lines)
- `apps/web/src/components/color-details-section.tsx` (partial, 80 lines)
- `apps/web/src/components/lazy-focus-trap.tsx` (5 lines)
- `apps/web/src/app/[locale]/error.tsx` (39 lines)
- `apps/web/src/app/[locale]/not-found.tsx` (55 lines)
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` (250 lines)
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` (132 lines)
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` (310 lines)
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` (partial)
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx` (114 lines)
- `apps/web/src/app/[locale]/globals.css` (60 lines reviewed)
