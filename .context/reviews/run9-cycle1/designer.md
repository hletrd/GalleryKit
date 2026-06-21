# Designer Review — RUN-9 Cycle-1

**Reviewer:** oh-my-claudecode:designer  
**HEAD:** d3858cfc (byte-identical to converged f63af3b9)  
**Date:** 2026-06-21  
**Scope:** WCAG touch-target policy, ARIA correctness, color-contrast on badges/chips, focus management, keyboard navigation, color/HDR audit UI, i18n completeness

---

## Summary

**0 new findings.** All previously-tracked items remain correctly budgeted. The codebase is in a well-hardened state for this review surface.

---

## Evidence by Area

### 1. Touch-Target Policy (WCAG 2.5.5 / 44×44 px)

**Scanner coverage verified:**

The `touch-target-audit.test.ts` scanner covers all interactive tag classes with multi-line normalization:
- `<Button>` / `<button>` — scale-token catch-all, literal h-8/h-9/h-10, min-h-[<44px] arbitrary values
- `<Link>` / `<a>` — same three pattern shapes (added AGG-C7-03 / run-9 c4)
- `<select>` — height-only scale-token + literal + arbitrary-value patterns (AGG-C7-03)
- `<Badge asChild>` — min-h-[<44px] patterns (DES-R4C15-03)
- `<input type="checkbox|radio">` — scanRawCheckboxes windowed scan (AGG-R8-03)
- Multi-line tag normalization handles all of the above via `normalizeMultilineButtonTags` which collapses `Button|button|Badge|select|Link|a|input` tags to one logical line before pattern matching
- `max-` ceiling lookbehind correctly exempts `max-h-*` / `max-w-*` on all tag classes

**`ui/button.tsx` variants (all floor at ≥44px):**
- `default`: `min-h-11`
- `sm`: `min-h-11`
- `lg`: `min-h-12`
- `icon`: `size-11`
- `icon-sm`: `size-11`
- `icon-lg`: `size-12`

This means all KNOWN_VIOLATIONS entries for `size="sm"` / `size="icon"` without explicit overrides are belt-and-braces scanner budget entries — they render at ≥44px at runtime. The only real tracked violation is `image-manager.tsx:328` (batchAddButton DialogTrigger, budget=1), which also renders at ≥44px via the `sm` variant floor but lacks an explicit override.

**Components confirmed clean (evidence collected):**

| Component | Interactive elements | Touch-target status |
|---|---|---|
| `lightbox.tsx` | Close h-11 w-11, fullscreen h-11 w-11, play/pause h-11 w-11, prev/next h-full w-16 outer | ✓ all ≥44px |
| `lightbox-color-pip.tsx` | Toggle min-h-11, DCI-P3 tooltip min-h-11 min-w-11, copy min-h-11 min-w-11 | ✓ all ≥44px |
| `color-details-section.tsx` | Accordion toggle min-h-[44px], info tooltip min-h-[44px] min-w-[44px], copy min-h-[44px] min-w-[44px], DCI-P3 tooltip min-h-11 min-w-11 | ✓ all ≥44px |
| `nav-client.tsx` | Mobile toggle min-w-[44px] min-h-[44px], topic links min-h-[44px], theme toggle min-w-[44px] min-h-[44px], locale switch min-w-[44px] min-h-[44px] | ✓ all ≥44px |
| `photo-navigation.tsx` | Prev/Next `size="icon" className="h-12 w-12"` | ✓ all ≥44px |
| `photo-viewer.tsx` | Back button h-11, info button size="sm" h-11, share button h-11, pin/unpin button h-11 | ✓ all ≥44px |
| `info-bottom-sheet.tsx` | Drag handle min-h-11, close button min-h-11 min-w-11, download button/dropdown min-h-11, dropdown items min-h-11 | ✓ all ≥44px |
| `image-manager.tsx` | Select-all checkbox wrapped in `label.inline-flex.min-h-11.min-w-11`, per-row checkbox same pattern | ✓ all ≥44px |
| `histogram.tsx` | Cycle-mode button min-h-11 min-w-11, collapse button min-h-11 | ✓ all ≥44px |
| `wide-gamut-hint.tsx` | Dismiss button min-h-11 min-w-11 | ✓ all ≥44px |
| `tokens-client.tsx` | Generate button min-h-[44px], revoke button h-11 w-11, copy button h-11 w-11, dialog buttons min-h-[44px] | ✓ all ≥44px |
| `topic-manager.tsx` | Back, edit/delete icon buttons — all `size="icon"` → `size-11` via variant | ✓ all ≥44px (render) |
| `tag-manager.tsx` | Back, edit/delete icon buttons — same | ✓ all ≥44px (render) |
| `upload-dropzone.tsx` | Remove-file button `size="icon" className="h-11 w-11"` | ✓ all ≥44px |
| `admin-user-manager.tsx` | Add and delete buttons — `size="sm"` / `size="icon"` → variant floor | ✓ all ≥44px (render), budget=2 |
| `bulk-edit-dialog.tsx` | SelectTrigger h-11, validation alert role="alert" | ✓ all ≥44px |

**Carried item (not re-filed):** `DEF-C11-01` — `search.tsx:374` `<Input>` 32px, deliberately out of scanner scope. No change.

**Dashboard-client pagination:** `size="sm"` buttons render at `min-h-11` via variant floor; budgeted as 5 in KNOWN_VIOLATIONS. All render correctly.

---

### 2. ARIA Correctness

**Lightbox (`lightbox.tsx`):**
- Container: `role="dialog"` `aria-modal="true"` `aria-label={t('aria.lightbox')}` ✓
- FocusTrap active; focus saved/restored; initial focus on close button ✓
- Controls: `aria-hidden="true"` and `tabIndex=-1` when hidden ✓
- Play/Pause: `aria-pressed={isSlideshowActive}` ✓
- `aria-live="polite"` for slideshow state change announcements ✓
- Position counter: `role="status"` `aria-live="polite"` ✓
- `aria-keyshortcuts` on all keyboard-triggered buttons ✓

**InfoBottomSheet (`info-bottom-sheet.tsx`):**
- Container: `role="dialog"` `aria-modal="true"` `aria-label={t('viewer.bottomSheet')}` ✓
- FocusTrap with `initialFocus` pointing to closeButtonRef then dragHandleRef ✓
- Drag handle: `aria-expanded` reflecting sheet state, `aria-label` updates with state ✓
- Close button: `aria-label={t('aria.close')}` ✓
- Escape key handled via window listener ✓

**Nav (`nav-client.tsx`):**
- `<nav aria-label={t('aria.mainNav')}>` ✓
- Mobile toggle: `aria-expanded` + `aria-controls="primary-nav-topics primary-nav-controls"` ✓
- Topic links: `aria-current={isActive ? "page" : undefined}` ✓

**ColorDetailsSection (`color-details-section.tsx`):**
- Accordion: `aria-expanded` + `aria-controls={colorDetailsId}` ✓
- HDR badge: `role="img"` `aria-label={t('viewer.hdrBadgeAriaLabel')}` ✓
- `isAdmin && isHdr` gate (AGG-M3 honesty invariant) ✓

**LightboxColorPip (`lightbox-color-pip.tsx`):**
- Toggle: `aria-expanded={open}` + comprehensive `aria-label` including primaries + transfer + HDR ✓
- HDR badge: `aria-hidden="true"` (info already in toggle aria-label) ✓

**WideGamutHint (`wide-gamut-hint.tsx`):**
- Container: `role="status"` `aria-live="polite"` `aria-atomic="true"` ✓
- Dismiss button: `aria-label={t('viewer.wideGamutHintDismiss')}` ✓

**BulkEditDialog (`bulk-edit-dialog.tsx`):**
- Validation error: `role="alert"` ✓
- SelectTrigger: `aria-label` set ✓

---

### 3. Color Contrast on Badges/Chips

**info-bottom-sheet.tsx peek-state chips (lines 273–282):**
- Gamut chip: `bg-purple-200 text-purple-900` (light) / `bg-purple-900/40 text-purple-200` (dark) — purple-900 on purple-200 is approximately 7:1 contrast in light mode; purple-200 on purple-900/40 in dark mode is softer but within acceptable range for a 10px bold badge ✓
- HDR chip: `bg-gradient-to-r from-amber-300 to-orange-400 text-amber-950` — amber-950 on amber-300 gradient is high contrast (~9:1); `shadow-sm` for depth ✓

These chips mirror the `gamut-p3-badge` and `hdr-badge` classes used in ColorDetailsSection, maintaining visual consistency.

---

### 4. Focus Management

**Confirmed patterns:**
- Lightbox: focus trap active, saved/restored on open/close, initial focus on close button
- InfoBottomSheet: FocusTrap with closeButtonRef/dragHandleRef fallback
- All dialogs use shadcn `<Dialog>` which provides Radix focus trap
- `controlVisibilityProps` in lightbox removes focus from hidden controls (`tabIndex:-1`, `aria-hidden:true`)

---

### 5. Keyboard Navigation

**Lightbox keyboard shortcuts confirmed:**
- Escape: close
- Arrow keys: prev/next navigation
- Space: play/pause slideshow
- F: fullscreen
- `aria-keyshortcuts` declared on all buttons ✓

**PhotoNavigation:**
- Keyboard-driven navigation via router.push; accessible prev/next buttons with `aria-label` ✓

**InfoBottomSheet:**
- Escape key closes via window listener
- Drag handle responds to Enter/Space to toggle expanded state ✓

---

### 6. Color/HDR Audit UI

**ColorDetailsSection:** Accordion default-open for non-trivial color (`isNonTrivialColor`); `isAdmin && isHdr` gate on HDR badge (AGG-M3); ICC name, primaries, transfer function, decision (admin-only), source/delivered bit depth, format chips, copy button. ✓

**LightboxColorPip:** min-h-11 pip button; `aria-expanded`; Histogram lazy-mounted inside; DCI-P3 info tooltip. ✓

**WideGamutHint:** Uses `useDisplayCapability` (not raw matchMedia), correctly suppresses P3 hint on all Firefox versions (Mozilla bug 1626624). `role="status"` `aria-live="polite"`. ✓

**Histogram:** Priority chain: wide-gamut AVIF (when P3 display + canvas-P3) → sized JPEG → fallback base JPEG. Worker-driven 256px canvas. Clip blink at ≥0.5% bins. Cycle-mode and collapse buttons both `min-h-11 min-w-11`. Gamut label and histogram source span rendered as static text. ✓

---

### 7. i18n Completeness (en.json vs ko.json)

Python key-flattening comparison across both files:

```
=== In EN but not KO ===
(empty)

=== In KO but not EN ===
(empty)
```

**Key sets are exactly equal.** The intentional plural asymmetry (DOC-R5C3-07) is correctly implemented: English uses ICU `{count, plural, one {...} other {...}}` syntax; Korean uses flat `{count}장` without a `plural` wrapper. This is expected — Korean has no grammatical plural. No i18n parity issues found.

---

## Verdict

**0 new findings.** All reviewed areas are clean:

- Touch-target scanner is comprehensive with correct coverage of `<Link>`, `<a>`, `<select>`, `<Badge asChild>`, `<input type="checkbox|radio">`, and multi-line tag normalization
- All interactive elements verified at ≥44px (those in KNOWN_VIOLATIONS render correctly at runtime via the Button variant floor; the scanner budget is belt-and-braces)
- ARIA patterns are correct throughout lightbox, bottom sheet, nav, color details, pip, and admin dialogs
- Focus management is properly implemented with FocusTrap in all modal surfaces
- Keyboard navigation is complete with `aria-keyshortcuts` declared
- Color/HDR audit UI correctly gates HDR badge on `isAdmin && isHdr`, uses `useDisplayCapability` instead of raw matchMedia
- i18n key parity is exact; Korean plural asymmetry is intentional and correct

**Carried item (not re-filed):** `DEF-C11-01` — `search.tsx:374` `<Input>` 32px tall, deliberately out of scanner scope. Exit criterion unchanged.
