# GalleryKit Designer/A11y Review — Cycle 18

**HEAD:** bcd67b12 (post Cycle 17 convergence)
**Date:** 2026-06-27
**Reviewer:** Designer agent (oh-my-claudecode:designer)

---

## Scope

Static code review covering: WCAG 2.2 focus indicators (2.4.7, 2.4.11), touch targets and audit regex gaps, ARIA roles/labels/focus traps, reduced-motion coverage, loading/empty/error states, i18n key parity (en.json vs ko.json), dark/light token consistency, perceived performance (blur placeholders, CLS, masonry above-fold prioritization).

---

## 1. WCAG 2.2 Focus Indicators

### 1.1 Cycle 17 Fixes — Verified Held

- **Hamburger / mobile expand button** (`nav-client.tsx` L93-108): `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` present. PASS.
- **Lightbox controls** (close, fullscreen, play/pause, prev, next): all carry `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. PASS.
- **info-bottom-sheet drag handle and close button**: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. PASS.

---

### FINDING D18-01 — HIGH — WCAG 2.4.7 / 2.4.11: Nav Controls Missing Focus Ring
**File:** `apps/web/src/components/nav-client.tsx`, lines 155–172
**Controls:** Theme toggle button (L155-165) and locale switch button (L166-172)

Both buttons in the `#primary-nav-controls` group have no `focus-visible` declarations. The adjacent hamburger button at L93-108 received `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` in Cycle 17. These two siblings were not updated:

```tsx
// theme toggle — L155-165
className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-accent rounded-full transition-colors"
// locale switch — L166-172
className="min-w-[44px] min-h-[44px] flex items-center justify-center text-xs font-medium ... rounded-full transition-colors"
```

Neither suppresses `outline`, so the browser default outline applies. WCAG 2.4.7 AA technically passes (some default outline is visible). However, browser default focus rings on `<button>` do not reliably meet WCAG 2.4.11's requirements of a ≥2px enclosing area with ≥3:1 contrast against adjacent colors in all browser/OS/theme combinations. The omission also creates a visible inconsistency: keyboard users see a sharp design-system ring on the hamburger and raw browser chrome on the adjacent theme/locale controls.

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to both buttons, mirroring the hamburger pattern at L96.

---

### FINDING D18-02 — MEDIUM — WCAG 2.4.11: Hardcoded Blue Focus Outline (Token Inconsistency + Photo-Content Contrast Risk)
**Files:**
- `apps/web/src/components/lightbox-color-pip.tsx`, L161 (pip toggle button)
- `apps/web/src/components/image-zoom.tsx`, L347 (zoom container, `role="button"`)

Both use a hardcoded blue outline instead of the design system `ring-ring` token:

```tsx
// both files
focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400
```

The pip button was flagged as a deferred item in Cycle 17. The image-zoom container adds a second instance. Two problems:

1. **Token drift:** `ring-ring` is the design system's resolved focus token and adapts correctly to theme overrides. The hardcoded blue does not.
2. **Contrast risk on image-zoom:** The zoom container's outline sits directly over photo content. Blue-500 (#3b82f6) has low contrast against sky, water, or other blue-toned images, violating WCAG 2.4.11's requirement that the focus indicator area have ≥3:1 contrast against adjacent non-indicator colors. `ring-ring` with `ring-offset-2` uses a 2px white gap between the indicator and the image, which is the correct approach.

**Fix:** Replace both occurrences with `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.

---

### FINDING D18-03 — LOW — WCAG 2.4.11: Amber Ring at Contrast Threshold
**File:** `apps/web/src/components/wide-gamut-hint.tsx`, L203
**Control:** Wide-gamut hint dismiss button

```tsx
className="... focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
```

Ring size (2px) meets the WCAG 2.4.11 area criterion. However, amber-600 (#d97706) on the component's amber-50 (#fffbeb) light-mode background calculates to approximately 3.03:1 contrast. WCAG 2.4.11 requires ≥3:1. This is technically at the minimum threshold; display gamma variation and anti-aliasing can push the effective ratio below 3:1 on calibrated monitors. Additionally, no dark-mode ring override is declared, so amber-600 appears against an uncertain dark composite background.

**Fix:** Replace with `focus-visible:ring-amber-700 dark:focus-visible:ring-amber-400`. Amber-700 (#b45309) on amber-50 yields ~4.6:1, giving comfortable headroom. Amber-400 (#fbbf24) on the dark amber-900/40 composite provides a visible light ring on dark.

---

### FINDING D18-04 — LOW — WCAG 2.4.11: Nav Links Rely on Browser Default Focus Rings
**Files:**
- `apps/web/src/components/admin-nav.tsx`, L40
- `apps/web/src/components/nav-client.tsx`, L122-132 (topic nav links)

Both sets of `<Link>` elements omit explicit `focus-visible` styling:

```tsx
// admin-nav.tsx L40
"inline-flex min-h-11 items-center rounded-md px-3 py-2 transition-colors hover:bg-accent ..."
// nav-client.tsx topic links L127
"transition-all duration-200 flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full ..."
```

`outline` is not suppressed, so browser defaults apply. WCAG 2.4.7 AA passes in all modern browsers. But browser default focus rings are inconsistently styled across Safari/Chrome/Firefox and do not reliably meet WCAG 2.4.11's 2px/3:1 requirement. The admin-nav comment at L38-39 explicitly addressed the 44px touch floor — the focus ring was not addressed in the same pass. These are high-frequency keyboard navigation targets.

**Fix:** Add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to both link sets.

---

## 2. Touch Targets

### 2.1 Verified Compliant

- Tag filter chip buttons (`tag-filter.tsx`): `min-h-11 min-w-11` on Badge. The Badge base component (`ui/badge.tsx`) provides `focus-visible:ring-[3px] focus-visible:ring-ring/50`. Correct.
- photo-viewer.tsx toolbar buttons (Back, Info, Share, Pin): `<Button>` with `h-11`. Correct.
- LightboxTrigger (`lightbox.tsx` L50): `<Button size="icon" className="h-11 w-11">`. Correct.
- Home back-to-top (`home-client.tsx` L466-482): `p-3 min-h-11 min-w-11`. Correct.
- info-bottom-sheet download button: `min-h-11`. Correct.
- upload-dropzone (`upload-dropzone.tsx` L411-413): `role="button"` div with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`; `p-8` provides ample tap area. Correct.

### FINDING D18-05 — LOW — Search Input 32px (Audit Regex Gap)
**File:** `apps/web/src/components/search.tsx`, L375

```tsx
className="border-0 p-0 h-8 shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
```

The search `<Input>` is 32px tall (`h-8`). Text inputs are exempt from WCAG 2.5.5 "Target Size," so this is not a criterion failure. However, on a 390px phone the tap acquisition area is narrow, and the mismatch with the 44px floor applied everywhere else creates an inconsistency.

More critically, this is a **gap in the touch-target audit regex** (`touch-target-audit.test.ts`). The scanner covers `<Button>`, `<button>`, `<Badge>`, `<select>`, `<Link>`, `<a>`, and `<input type="checkbox|radio">` — but does not scan `<Input>` (the shadcn/ui wrapper component) in consumer files. A future `<Input className="h-9">` regression would be invisible to the audit.

**Fix options:**
1. Raise the Input to `h-11` or add a min-height wrapper for the 44px tap floor.
2. Add a FORBIDDEN pattern for `<Input[^>]+h-[6-9]\b` to `touch-target-audit.test.ts`, analogous to the existing `native <select>` reach added in AGG-C5-02.

---

## 3. ARIA Roles, Labels, and Focus Traps

### 3.1 Verified Compliant

- **Search dialog** (`search.tsx`): `role="combobox"`, `aria-autocomplete="list"`, `aria-controls`, `aria-expanded`, `aria-activedescendant`. Correct ARIA combobox. `aria-live="polite"` sr-only div announces results count. FocusTrap with `initialFocus: '#search-input'`.
- **Lightbox** (`lightbox.tsx`): FocusTrap wraps full dialog with `allowOutsideClick: true`. `controlVisibilityProps` sets `tabIndex: -1, aria-hidden: true` when controls are hidden. All controls carry `aria-label`.
- **Info bottom sheet** (`info-bottom-sheet.tsx`): FocusTrap active, initialFocus on drag/close button. `role="dialog"` with `aria-label`.
- **Tag filter group** (`tag-filter.tsx`): `role="group" aria-label`. Each chip has `aria-pressed`. Correct.
- **Wide-gamut hint** (`wide-gamut-hint.tsx`): `role="status" aria-live="polite" aria-atomic="true"`. Correct for async-mounted status.
- **Image zoom** (`image-zoom.tsx`): `role="button" tabIndex={0} aria-label` with `onKeyDown` Enter/Space handler. Correct ARIA button pattern.
- **Masonry card links** (`home-client.tsx`): `aria-label={t('aria.viewPhoto', { title })}` on `<Link>`. Parent div uses `focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2` — correct pattern for delegating focus visibility to an ancestor. Compliant.
- **Hamburger** (`nav-client.tsx`): `aria-expanded`, `aria-controls="primary-nav-topics primary-nav-controls"`. Correct.
- **Admin nav** (`admin-nav.tsx`): `aria-label` on `<nav>`, `aria-current="page"` on active link. Correct.
- **Topic nav links** (`nav-client.tsx`): `aria-current={isActive ? "page" : undefined}`. Correct.

---

## 4. Reduced Motion

### 4.1 Verified Compliant

- Lightbox Ken Burns (`lightbox.tsx` L92-109, L527-534): `prefers-reduced-motion` tracked via MQ listener in `useState`/`useEffect`. Ken Burns gated on `!shouldReduceMotion`. Correct.
- Framer Motion in photo-viewer: `useReducedMotion()` from framer-motion. Correct.
- Home back-to-top scroll (`home-client.tsx` L467-469): inline `window.matchMedia('(prefers-reduced-motion: reduce)').matches` check; uses `behavior: 'auto'` when preferred. Correct.

### FINDING D18-06 — LOW — Masonry Hover Scale Not Reduced-Motion Gated
**File:** `apps/web/src/components/home-client.tsx`, L380 and L425

```tsx
// L380
className="... transition-transform duration-500 group-hover:scale-105"
// L425
className="... sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity duration-300"
```

The 5% card zoom and overlay fade on hover are CSS-only animations triggered by mouse interaction. WCAG 2.3.3 (Animation from Interactions) is AAA, but `prefers-reduced-motion: reduce` should suppress non-essential movement regardless of WCAG level to respect the user's OS-level preference. The back-to-top scroll is gated; these hover animations are not.

**Fix:**

```tsx
// L380
"... transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
// L425
"... transition-opacity duration-300 motion-reduce:transition-none"
```

Tailwind's `motion-reduce:` prefix applies `@media (prefers-reduced-motion: reduce)` at the CSS layer.

---

## 5. Loading, Empty, and Error States

### 5.1 Verified Compliant

- **Blur placeholder → crossfade** (`photo-viewer.tsx`): `blur_data_url` used as background-image preview; fades out on `onLoad`. Correct.
- **Masonry CLS prevention** (`home-client.tsx`): `style={{ aspectRatio, containIntrinsicSize }}` on each card. `hasValidDims` guard for zero-dimension edge case. Correct.
- **Home empty gallery** (`home-client.tsx` L450-464): Decorative SVG with `aria-hidden`, message text, and a clear-filter link with `min-h-11`. Correct.
- **Search no-results**: `aria-live="polite"` announces state. Correct.

---

## 6. i18n Key Parity

Full key-set comparison via Python JSON parse:

```
en.json: 854 lines
ko.json: 854 lines
Keys only in en.json: []
Keys only in ko.json: []
```

100% symmetric. PASS.

The documented asymmetry (English uses ICU plural blocks `{count, plural, one {...} other {...}}`; Korean uses flat strings `{count}장` — DOC-R5C3-07) is confirmed correctly structured. No unintended divergence.

---

## 7. Dark / Light Mode Token Consistency

Color tokens are CSS variables throughout (`ring-ring`, `foreground`, `muted`, `accent`, `background`, `primary`, `muted-foreground`). No hardcoded hex in semantic slots except the two `blue-500`/`blue-400` instances in D18-02. The amber-50/amber-600/amber-900 chain in `wide-gamut-hint.tsx` is intentional semantic color for the themed banner — not a token violation. Dark-mode overrides are present for background/text/border on that component; the missing dark ring override is addressed in D18-03.

---

## 8. Perceived Performance

- **Above-fold prioritization**: `useColumnCount()` mirrors Tailwind breakpoints exactly. Above-fold images get `loading="eager" fetchPriority="high"`. Correct.
- **containIntrinsicSize**: Derived from `estimatedCardWidth * image.height / image.width` with `hasValidDims` guard. Prevents content-visibility layout shifts on scroll-reveal. Correct.
- **Histogram**: Lazy-mounted, worker-driven, canvas capped at 256×256. No layout shift on mount.

---

## Finding Summary

| ID | File(s) | Severity | WCAG Criterion |
|----|---------|----------|----------------|
| D18-01 | `nav-client.tsx` L155–172 | HIGH | 2.4.7 Focus Visible (AA); 2.4.11 Focus Appearance (AA) |
| D18-02 | `lightbox-color-pip.tsx` L161; `image-zoom.tsx` L347 | MEDIUM | 2.4.11 Focus Appearance (AA) — token inconsistency + photo-content contrast risk |
| D18-03 | `wide-gamut-hint.tsx` L203 | LOW | 2.4.11 Focus Appearance (AA) — amber-600 on amber-50 ~3.03:1 borderline |
| D18-04 | `admin-nav.tsx` L40; `nav-client.tsx` L122–132 | LOW | 2.4.11 Focus Appearance (AA) — nav links rely on browser defaults |
| D18-05 | `search.tsx` L375 | LOW | 2.5.5 Target Size (informational); `<Input>` audit regex gap |
| D18-06 | `home-client.tsx` L380, L425 | LOW | 2.3.3 Animation from Interactions (AAA) |

**PASS — No Action Required:**
- i18n: 100% key parity (en.json = ko.json, 854 lines)
- Lightbox controls: `ring-2 ring-ring ring-offset-2` on all 5 controls
- Tag filter chips: Badge base provides `ring-[3px] ring-ring/50`
- Masonry card focus: `focus-within:ring-2` on parent div (correct delegation pattern)
- Upload dropzone: `ring-2 ring-ring ring-offset-2`
- FocusTrap: lightbox, search, info-bottom-sheet all correctly wired
- ARIA: combobox in search, `role=status` in wide-gamut-hint, `aria-current` in nav, `aria-pressed` in tag filter, `aria-expanded`/`aria-controls` in hamburger
- `prefers-reduced-motion`: lightbox Ken Burns, framer-motion hooks, back-to-top scroll
- Dark/light mode tokens: CSS variables throughout; no hardcoded hex in semantic slots
- Blur placeholder crossfade and masonry CLS reservation: both correct

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
