# GalleryKit Designer/A11y Review — Cycle 17

**HEAD:** 7b5c1943
**Date:** 2026-06-27
**Reviewer:** Designer agent (oh-my-claudecode:designer)
**Live instance reached:** No — production returned 307 redirect; all findings are from static analysis.

---

## Cycle-16 Verification

### (A) Back-to-top focus ring — CONFIRMED FIXED

`apps/web/src/components/home-client.tsx:472`

All three required properties present: `outline-none`, 2px `ring-ring` token, `ring-offset-2`. ARIA management also correct: `aria-hidden={showBackToTop ? undefined : true}` and `tabIndex={showBackToTop ? 0 : -1}`. CLOSED.

### (B) bit\_depth isAdmin gating — CONFIRMED CONSISTENT

`apps/web/src/components/color-details-section.tsx:481`
`apps/web/src/components/lightbox-color-pip.tsx` (matching guard)

Both surfaces gate `bit_depth`, `transfer_function`, `color_pipeline_decision`, `icc_profile_name`, `is_hdr`, and `has_gain_map` on `isAdmin`. No layout shift: guarded rows do not render for public users — they are not empty containers with conditional visibility. CLOSED.

---

## Findings Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH     | 0 |
| MEDIUM   | 3 |
| LOW      | 2 |

---

## MEDIUM Findings

### M-01 · lightbox-color-pip.tsx:219,301 — 1 px focus ring violates WCAG 2.4.11

**File:** `apps/web/src/components/lightbox-color-pip.tsx` lines 219, 301
**WCAG criterion:** 2.4.11 Focus Appearance (AA, WCAG 2.2) — minimum 2 px ring enclosing the component perimeter, 3:1 contrast ratio of ring color against adjacent colours.

The DCI-P3 info tooltip button and the copy button inside the color pip panel share this pattern:

```tsx
className="... focus-visible:ring-1 focus-visible:ring-white/50"
```

`ring-1` = 1 px. WCAG 2.4.11 requires at least 2 px. `white/50` = 50 % opacity white against a `bg-black/70` panel background — effective contrast is well below 3:1.

**User impact:** Keyboard users navigating the lightbox color-pip panel cannot reliably see which inner tooltip button or copy button is focused. These are the only way to access color metadata details or copy color info via keyboard.

**Fix:**
```tsx
// Replace: focus-visible:ring-1 focus-visible:ring-white/50
// With:
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
```

`ring-ring` is the design-system token that satisfies contrast in both light and dark modes. `ring-offset-2` separates the ring from the dark panel background for perceptual clarity.

**Confidence:** High.

---

### M-02 · nav-client.tsx:94 — Mobile hamburger button missing focus-visible ring

**File:** `apps/web/src/components/nav-client.tsx` lines 94–109
**WCAG criterion:** 2.4.11 Focus Appearance (AA, WCAG 2.2), 2.4.7 Focus Visible (AA, WCAG 2.1)

This is the primary navigation expansion control on mobile viewports. A keyboard user tabbing into the nav bar reaches this button — the only way to access topic links on mobile — and sees no focus indicator at all. The button has `hover:bg-accent` (pointer-device feedback only) but no `focus-visible:*` classes:

```tsx
<button
    className={cn(
        "ml-auto min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-accent rounded-full md:hidden shrink-0",
        // NO focus-visible classes
    )}
    aria-label={isExpanded ? t('aria.collapseMenu') : t('aria.expandMenu')}
    aria-expanded={isExpanded}
>
```

**User impact:** Keyboard-primary users cannot tell when this control has focus. It is the only entry point to all topic navigation on narrow viewports.

**Fix:**
```tsx
className={cn(
    "ml-auto min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-accent rounded-full md:hidden shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    isExpanded && "mt-1"
)}
```

**Confidence:** High.

---

### M-03 · image-zoom.tsx:347 and login-form.tsx:84 — Hardcoded blue-500 outline departs from ring-ring token

**Files:**
- `apps/web/src/components/image-zoom.tsx:347`
- `apps/web/src/app/[locale]/admin/login-form.tsx:84`

**WCAG criterion:** 2.4.11 Focus Appearance (AA) — 3:1 contrast ratio of focus indicator.
**UX heuristic:** Consistency (Nielsen #4) — focus indicators should follow the design system token so theme changes propagate correctly.

Both controls use:
```tsx
focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400
```

`blue-500` on a white background passes 4.1:1 (AA), but `blue-400` on a light background is approximately 2.78:1 — below the 3:1 minimum for WCAG 2.4.11. The dark-mode variant `outline-blue-400` was likely intended for dark mode but dark mode inverts the background, making the contrast uncertain without runtime verification. More critically, both elements are inconsistent with the `ring-ring` CSS variable used on every other interactive control in the app.

**User impact:** On the image viewer zoom container (primary photo interaction), keyboard users get an off-token focus ring that may fail contrast in some theme states. On the login show/hide-password toggle, the mismatch is visible against the admin login card.

**Fix (image-zoom.tsx):**
```tsx
// Replace:
'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400'
// With:
'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
```

**Fix (login-form.tsx show/hide button):**
```tsx
// Replace the focus-visible classes:
className="... outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
```

**Confidence:** High (token inconsistency confirmed). Contrast failure of `blue-400` in light mode is medium confidence pending verified compiled CSS variable value.

---

## LOW Findings

### L-01 · wide-gamut-hint.tsx:203 — ring-amber-500/40 (40 % opacity) likely fails WCAG 2.4.11 contrast

**File:** `apps/web/src/components/wide-gamut-hint.tsx:203`
**WCAG criterion:** 2.4.11 Focus Appearance (AA) — 3:1 contrast ratio of focus indicator against adjacent colours.

```tsx
className="... focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
```

Ring width is correct (2 px via `ring-2`). However, `amber-500` at 40 % opacity against the hint's amber-50/amber-100 background will produce a contrast ratio below 3:1 — the ring blends into the surrounding warm-yellow surface. A same-hue low-opacity ring against a same-hue background is the canonical WCAG 2.4.11 failure pattern.

**Fix:**
```tsx
// Option A — use design-system token (safest):
focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50

// Option B — keep amber personality at full opacity with offset:
focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50
```

**Confidence:** Medium — contrast math depends on exact compiled amber values, but same-hue low-opacity is the textbook failure case.

---

### L-02 · lightbox-color-pip.tsx:161 — Pip trigger uses hardcoded blue-500 focus outline

**File:** `apps/web/src/components/lightbox-color-pip.tsx:161`

Same token-inconsistency issue as M-03. The pip trigger button uses:
```tsx
focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400
```

Lower severity than M-03 because the pip is an admin-facing panel used infrequently, but it should be fixed in the same pass.

**Fix:** Replace with `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.

**Confidence:** High.

---

## Confirmed Correctly Handled (no action needed)

The following were audited in full and require no fix:

- **tag-input.tsx raw `<input>` outline-none** — ACCEPTABLE. Wrapper `<div>` carries `focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2`. The ring IS visible on the container when the inner input is focused. ARIA combobox pattern (`aria-activedescendant` on input, `role="option"` on non-focusable divs) is correctly implemented.
- **search.tsx input `h-8`** — ACCEPTABLE. The `<Input>` component base class includes `min-h-11` (44 px). CSS renders the element at 44 px because `min-height` overrides `height`. No 44 px violation.
- **image-zoom.tsx role="button"** — `aria-label` dynamically set to `aria.zoomIn` / `aria.zoomOut`. `Enter` and `Space` key handlers present. Full-height container gives adequate tap target. ✓
- **upload-dropzone.tsx role="button"** — `aria-label` present; `aria-disabled` + `tabIndex=-1` when disabled. ✓
- **lightbox focus trap** — `<FocusTrap>` with `fallbackFocus` pointing to the close button ref; Escape layered (pip-close first, then lightbox-close when not in fullscreen); `previouslyFocusedRef.current?.focus()` on unmount. ✓
- **info-bottom-sheet drag handle and close button** — both carry `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` and explicit `aria-label`. ✓
- **photo-navigation prev/next buttons** — `aria-label` tokens `aria.previousPhoto` / `aria.nextPhoto`. ✓
- **photo-viewer toolbar (back, info, share, pin)** — all have visible text labels; back button wraps a `<Link>` with visible topic text. ✓
- **nav-client theme/locale toggles** — `aria-label` tokens `aria.toggleTheme` and `aria.switchLocale`. ✓
- **admin icon buttons (topic-manager, tag-manager, tokens-client)** — all `size="icon"` Buttons carry explicit `aria-label`. ✓
- **admin pagination (dashboard-client)** — both enabled and disabled states carry `aria-label`; disabled states use `<Button disabled>` (not `<Link>`) so they are correctly inert. ✓
- **login form error feedback** — `role="alert" aria-live="assertive"` on the error paragraph. ✓
- **login form show/hide password button** — 44 px (`w-11 h-11`), `aria-label` + `aria-pressed`. Focus ring issue logged under M-03 but ARIA semantics are correct. ✓

---

## Recommended Fix Order

| Priority | Finding | File | Effort |
|----------|---------|------|--------|
| 1 | M-02: hamburger missing ring | nav-client.tsx:94 | 1 className line |
| 2 | M-01: 1 px ring on pip inner buttons | lightbox-color-pip.tsx:219,301 | 2 className lines |
| 3 | M-03 + L-02: blue outline to ring-ring | image-zoom.tsx:347, login-form.tsx:84, lightbox-color-pip.tsx:161 | 3 lines (same commit) |
| 4 | L-01: amber ring opacity | wide-gamut-hint.tsx:203 | 1 className line |

All four items fit in a single atomic commit. Estimated total diff: approximately 8 lines across 5 files. No test changes required — the existing touch-target-audit.test.ts does not scan for focus-visible token consistency.
