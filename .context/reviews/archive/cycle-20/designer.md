# GalleryKit Designer/A11y Review — Cycle 20

**Date:** 2026-06-27
**HEAD:** 9af705f4
**Reviewer:** Designer agent (oh-my-claudecode:designer)
**Scope:** `apps/web/src/components/`, `apps/web/src/app/[locale]/(public)/`, `apps/web/src/app/[locale]/admin/`
**Method:** Static source review — class selectors, ARIA attributes, semantic structure, token contracts

---

## Cycle-19 Fix Verification

All four cycle-19 scheduled fixes are confirmed landed:

| Finding | Status | Evidence |
|---------|--------|----------|
| D19-01 lightbox hitbox → group-focus-visible | FIXED | `lightbox.tsx:628,649` inner `<span>` carries `group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2`; outer button has `group outline-none` |
| D19-07 skip link `focus:` → `focus-visible:` | FIXED | `layout.tsx:125` and `not-found.tsx:21` both use `focus-visible:not-sr-only focus-visible:absolute …` |
| D19-08 blue outlines → ring-ring token | FIXED | `image-zoom.tsx:347` now `ring-2 ring-ring ring-offset-2`; `lightbox-color-pip.tsx:165` trigger button fixed; `login-form.tsx:84` fixed |
| D19-09 upload remove button `focus:` → `focus-visible:` | FIXED | `upload-dropzone.tsx:472` now `focus-visible:opacity-100` |

---

## MAJOR-2 Exit Criterion: MET

The deferred MAJOR-2 finding stated the exit criterion as "A designer pass finds ≥3 fresh siblings in one cycle." This cycle found five `<Link>` elements across three previously-unaudited files with no `focus-visible:` styling (D20-01 × 2 locations, D20-03 × 2 links, D20-04 × 2 links). Three of these files are entirely new territory. The ≥3-sibling threshold is met. The general focus-visible scanner (blocked on the deferred work from cycle 19) should now be prioritised.

---

## Finding D20-01 — MEDIUM

### Primary nav topic links and admin nav links still missing `focus-visible:` rings

**Files:**
- `apps/web/src/components/nav-client.tsx` L122–145 (topic filter pills)
- `apps/web/src/components/admin-nav.tsx` L32–46 (admin section nav)

**WCAG:** 2.4.7 Focus Visible (AA — technically passes via browser default), 2.4.11 Focus Appearance (AA, WCAG 2.2 — fails)

**Evidence:**

`nav-client.tsx:127`:
```tsx
"transition-all duration-200 flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full whitespace-nowrap shrink-0"
// no focus-visible: classes
```

`admin-nav.tsx:40`:
```tsx
"inline-flex min-h-11 items-center rounded-md px-3 py-2 transition-colors hover:bg-accent hover:text-accent-foreground"
// no focus-visible: classes
```

The immediately adjacent controls in `nav-client.tsx` — hamburger (L96), theme toggle (L157), locale switch (L168) — all received `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` in cycles 17–18. The `<Link>` sibling elements in the same nav bar were never updated. This is the recurring "fix one sibling, miss the next" failure mode predicted by the deferred MAJOR-2.

WCAG 2.4.11 requires a focus indicator of at least 2 px that encloses the visible perimeter at ≥3:1 contrast. Browser-default outlines on `<a>`/`<Link>` elements do not reliably meet this on all browser/OS combinations (Safari produces a blue shadow glow, not a 2 px ring; Chrome on macOS uses a 3 px blue outline that fails against the `bg-foreground text-background` active pill variant on some display profiles).

**User impact:** Keyboard users navigating through topics on every public page, and through admin sections, see either no ring or an inconsistent browser chrome ring while adjacent buttons produce the crisp design-system ring. The primary navigation is the highest-frequency keyboard-navigation target in the product.

**Fix:**

```tsx
// nav-client.tsx L127 — add to cn() call:
"outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

// admin-nav.tsx L40 — add to cn() call:
"outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
```

**Confidence:** High

---

## Finding D20-02 — MEDIUM

### lightbox-color-pip expanded panel: inner buttons use `ring-white` not `ring-ring`, missing `ring-offset-2`

**File:** `apps/web/src/components/lightbox-color-pip.tsx` L223, L305
**WCAG:** 2.4.11 Focus Appearance (AA, WCAG 2.2)

The trigger button (L165) was correctly fixed in cycle 19. Two inner-panel buttons were not:

```tsx
// L223 — DCI-P3 info tooltip trigger inside expanded panel:
className="ml-0.5 inline-flex min-h-11 min-w-11 items-center justify-center
  rounded-full text-white/60 hover:text-white
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
  // ↑ ring-white, no ring-offset-2

// L305 — copy-to-clipboard button:
className="inline-flex min-h-11 min-w-11 items-center gap-1.5 text-white/60
  hover:text-white transition-colors
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded px-1 py-1"
  // ↑ ring-white, no ring-offset-2
```

Two distinct issues:

1. **Missing `ring-offset-2`**: Without the 2 px offset gap, the ring is drawn flush against the button's own background. WCAG 2.4.11 criterion 2 requires the focus indicator to enclose the component perimeter; the ring must be visually separable from the control itself. The panel background is `bg-black/80` so `ring-white` is visible, but no offset means the ring merges with any dark edge on the button.

2. **Token escape**: `ring-white` hardcodes white. While the panel is always `bg-black/80` (near-opaque black), if the panel ever gains a light-mode variant or the OLED theme changes the panel color, `ring-white` becomes invisible while `ring-ring` would still adapt. This is the same token-inconsistency class as D19-08 (now fixed on the trigger).

**Fix:**
```tsx
// Both L223 and L305:
"… focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
```

On the `bg-black/80` panel, `ring-ring` resolves to the `--ring` CSS variable. In light mode this is typically a dark/neutral color with `ring-offset-2` providing the white gap. If the white gap is undesirable on the dark panel, add `focus-visible:ring-offset-black` to override just the offset color:

```tsx
"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
  focus-visible:ring-offset-2 focus-visible:ring-offset-black"
```

This maintains token compliance while ensuring the offset color matches the panel surface.

**Confidence:** High

---

## Finding D20-03 — MEDIUM

### Timeline year scrubber links and year-in-review link have no `focus-visible:` styling

**File:** `apps/web/src/app/[locale]/(public)/timeline/page.tsx` L131–157
**WCAG:** 2.4.7 Focus Visible (AA — technically passes via browser default), 2.4.11 Focus Appearance (AA, WCAG 2.2 — fails)

The timeline page year scrubber is a `<nav>` containing pill-shaped `<Link>` elements for each year. The active variant uses `bg-primary text-primary-foreground` — a coloured surface that makes browser-default blue outlines inconsistent and low-contrast.

```tsx
// L131–143 — year scrubber:
<Link
    href={…}
    className={
        `h-11 min-w-[44px] px-4 inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors ` +
        (isActive ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-foreground')
    }
    aria-current={isActive ? 'page' : undefined}
>
// No focus-visible: classes

// L152–157 — year-in-review link:
<Link
    href={…}
    className="inline-flex items-center min-h-11 px-2 text-sm text-muted-foreground
      hover:text-primary transition-colors underline underline-offset-4"
>
// No focus-visible: classes
```

Touch target: PASS (h-11 / min-h-11). Focus indicator: FAIL at 2.4.11.

**User impact:** A keyboard user navigating the timeline year scrubber — the only way to switch between years — sees browser chrome focus rings that are visually discordant with the design system and inconsistent across browsers. On Safari, the year scrubber is the most impacted because Safari's blue-glow outline is especially inconsistent against the `bg-primary` active pill.

**Fix:**

```tsx
// Year scrubber — add to both branches of the ternary:
`h-11 min-w-[44px] px-4 inline-flex items-center justify-center rounded-lg text-sm
 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring
 focus-visible:ring-offset-2 ` +
(isActive ? … : …)

// Year-in-review link — add:
"inline-flex items-center min-h-11 px-2 text-sm text-muted-foreground
  hover:text-primary transition-colors underline underline-offset-4
  outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
```

**Confidence:** High

---

## Finding D20-04 — LOW

### Shared group "View Gallery" back-links missing `focus-visible:` styling

**File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` L140, L172
**WCAG:** 2.4.11 Focus Appearance (AA, WCAG 2.2)

Two instances of the "← View Gallery" `<Link>` are missing focus-visible styling:

```tsx
// L140 (selected-image branch):
<Link href={…} className="text-sm text-muted-foreground hover:text-primary transition-colors
  flex items-center gap-1 min-h-11">

// L172 (grid branch):
<Link href={…} className="text-sm text-muted-foreground hover:text-primary transition-colors
  flex items-center gap-1 min-h-11">
```

The masonry grid `<Link>` at L186–189 in the same file correctly has `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`. The header back-link was not addressed.

**Fix:**
```tsx
className="… outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
```

**Confidence:** High

---

## Finding D20-05 — LOW

### Four new locations with hover-scale animations relying solely on the global reduced-motion catch-all

**Files:**
- `apps/web/src/components/on-this-day-widget.tsx` L72
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx` L190, L195
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx` L238, L243
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` L229, L237

**WCAG:** 2.3.3 Animation from Interactions (AAA)

**Evidence (representative):**

```tsx
// on-this-day-widget.tsx:72
className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"

// year/[year]/page.tsx:190,195
className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
// …
<div className="… sm:opacity-0 sm:group-hover:opacity-100 … transition-opacity duration-300">

// timeline/page.tsx:238,243 — identical pattern
// g/[key]/page.tsx:229,237 — identical pattern
```

None of these four files contain `motion-reduce:transition-none`, `motion-reduce:scale-100`, or any `prefers-reduced-motion` check. They rely on the global CSS catch-all in `globals.css` (`transition-duration: 0.01ms !important`).

This is the same class of fragility already documented in deferred items D19-02/D19-03 for `info-bottom-sheet.tsx` and `photo-viewer.tsx`. The global catch-all is correct today. The concern is that these are four **newly-audited locations** added since the catch-all was written, meaning the catch-all's coverage of new code cannot be verified by inspection alone.

The `home-client.tsx` masonry grid (D18-06) was fixed with `motion-reduce:transition-none motion-reduce:group-hover:scale-100`. These four files should receive the same treatment.

**Exit criterion for D19-02/D19-03 (deferred):** "If the global catch-all is ever removed/scoped, or a reduced-motion user reports motion." The exit criterion has not been met, but the four new instances in public route files increase the surface area to be monitored.

**Fix (representative — apply to all four files/locations):**

```tsx
// image thumbnail:
"w-full h-full object-cover group-hover:scale-105 transition-transform duration-300
  motion-reduce:transition-none motion-reduce:scale-100"

// hover overlay:
"… sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-300
  motion-reduce:transition-none"
```

**Confidence:** Medium (currently correct; risk is silent future regression across four new files)

---

## Deferred Item Status (from cycle 19)

| ID | Finding | Status |
|----|---------|--------|
| D19-04 | EXIF `<dl>/<dt>/<dd>` semantics | Still deferred. Exit criterion not met. |
| D19-02/03/06 | Reduced-motion explicit overrides | Still deferred. D20-05 adds 4 new locations — monitor for exit criterion. |
| MAJOR-2 | General focus-visible scanner | **EXIT CRITERION MET** — ≥3 fresh focus-visible sibling misses found this cycle. Promote. |

---

## Observations (No Code Change Required)

**Cycle-19 D18-03 (amber ring on wide-gamut-hint.tsx):** `focus-visible:ring-2 focus-visible:ring-amber-600` at L203. Deferred as LOW. Still present, not materially worse.

**i18n parity:** 780 keys in both en.json and ko.json. Zero keys exclusively in either file. PASS.

**on-this-day-widget.tsx ARIA structure:** `<aside aria-label={t('widgetLabel')}>` correct. `<ul role="list">` correct. Each `<Link>` carries `aria-label={t('viewPhotoAria', { title })}` and `min-h-[44px]` — touch target PASS. The only issue is the thumbnail hover scale (D20-05).

**timeline/page.tsx year scrubber ARIA:** `<nav aria-label={t('yearScrubberLabel')}>` correct. `aria-current="page"` on active year. PASS for ARIA structure; only focus ring is missing (D20-03).

**g/[key]/page.tsx photo grid links:** `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2` on masonry card links at L186-189. PASS for the grid cards; only the header back-link lacks a ring (D20-04).

**lightbox-color-pip.tsx trigger button:** Correctly fixed in cycle 19 — `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` at L165. The INNER panel buttons are the new gap (D20-02).

**admin pages (settings, categories, tags, tokens, users, db, analytics):** All icon `<Button size="icon">` elements carry `aria-label`. `<SelectTrigger className="h-11 …">` meets 44 px floor. `role="alert"` on error surfaces correct. `role="status"` on backfill progress correct. No new touch-target or ARIA violations found.

---

## Summary Table

| ID | Severity | Confidence | File:Line | WCAG Criterion |
|----|----------|------------|-----------|----------------|
| D20-01 | MEDIUM | High | `nav-client.tsx:122`, `admin-nav.tsx:40` | 2.4.11 Focus Appearance (AA) |
| D20-02 | MEDIUM | High | `lightbox-color-pip.tsx:223,305` | 2.4.11 Focus Appearance (AA) |
| D20-03 | MEDIUM | High | `timeline/page.tsx:131-157` | 2.4.11 Focus Appearance (AA) |
| D20-04 | LOW | High | `g/[key]/page.tsx:140,172` | 2.4.11 Focus Appearance (AA) |
| D20-05 | LOW | Medium | `on-this-day-widget.tsx:72`, `year/[year]/page.tsx:190,195`, `timeline/page.tsx:238,243`, `g/[key]/page.tsx:229,237` | 2.3.3 Animation from Interactions (AAA) |

**Total new findings: 5** (3 MEDIUM, 2 LOW). Zero CRITICAL or HIGH. The product focus management infrastructure remains sound; all gaps are in navigation `<Link>` elements, which are systematically exempt from the existing `touch-target-audit.test.ts` scanner's focus-visible coverage. MAJOR-2 exit criterion is met — a focus-visible scanner analogous to the touch-target audit should now be scheduled.

---

# GalleryKit Designer/A11y Review — Cycle 19

**Date:** 2026-06-27
**Reviewer:** Designer agent (oh-my-claudecode:designer)
**Scope:** `apps/web/src/components/` and `apps/web/src/app/[locale]/` (public + admin)
**Method:** Static source review — class selectors, ARIA attributes, CSS patterns, semantic structure

---

## Status of Known-Deferred Items

- **D18-02** (blue-outline → ring-ring token): Partially deferred. Three new sibling instances identified as D19-08 in components not previously audited (`image-zoom.tsx`, `lightbox-color-pip.tsx`, `login-form.tsx`).
- **D18-06** (masonry hover reduced-motion): Confirmed fully resolved. `globals.css` carries dual coverage: catch-all `transition-duration: 0.01ms !important` plus explicit `group-hover:scale-105` suppression via `transform: none !important` under `@media (prefers-reduced-motion: reduce)`. No re-raise needed.

---

## Executive Summary

Nine findings remain, none critical. The codebase is in strong shape: 44px touch-target enforcement (blocking test), focus-visible ring adoption across components, and reduced-motion infrastructure (global CSS catch-all, component-level `matchMedia` checks, and `motion-reduce:` Tailwind utilities) are all genuinely thorough. The two HIGH findings are both focus-indicator precision issues: the skip link surface appearing on mouse clicks, and lightbox nav rings painting on an invisible full-height hitbox rather than the visible circular affordance. The remaining MEDIUM findings are semantic HTML structure (EXIF data needs `<dl>/<dt>/<dd>`) and a design-system token escape in three components. LOW findings are mostly future-fragility risks from relying on the global reduced-motion catch-all instead of explicit overrides.

---

## Finding D19-01 — HIGH

### Lightbox prev/next: focus ring paints on invisible hitbox, not visible circular affordance

**File:** `apps/web/src/components/lightbox.tsx` L613–651
**WCAG:** 2.4.7 Focus Visible (AA), 2.4.11 Focus Appearance (AA, WCAG 2.2)

The outer `<button>` spans the full height of the lightbox (`h-full w-16`) and is invisible to sighted users. The `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` class is applied to this invisible boundary, not on the inner circular `<span className="flex h-11 w-11 ... rounded-full bg-black/50">` that users actually see. A keyboard user navigating to prev/next sees a ring painted against the viewport edge, completely disconnected from the circular control affordance.

WCAG 2.4.11 requires the focus indicator to enclose the component's visible perimeter. The visual component here is the 44×44 circle; the outer button ghost is not a visual component.

**Fix:** Use `group` on the outer button with `focus-visible:outline-none`, and `group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2` on the inner `<span>`:

```tsx
<button
  className="pointer-events-auto absolute left-0 top-0 h-full w-16
    flex items-center justify-center group focus-visible:outline-none"
  ...
>
  <span className="flex h-11 w-11 items-center justify-center
    rounded-full bg-black/50 hover:bg-black/70
    group-focus-visible:ring-2 group-focus-visible:ring-ring
    group-focus-visible:ring-offset-2">
    <ChevronLeft className="h-6 w-6" />
  </span>
</button>
```

**Confidence:** High

---

## Finding D19-07 — HIGH

### Skip link uses `focus:` not `focus-visible:` — appears on mouse click

**Files:**
- `apps/web/src/app/[locale]/layout.tsx` L125
- `apps/web/src/app/[locale]/not-found.tsx` L21
**WCAG:** 2.4.1 Bypass Blocks (A)

```tsx
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:absolute focus:top-4
    focus:left-4 focus:z-50 focus:px-4 focus:py-2
    focus:bg-primary focus:text-primary-foreground focus:rounded-md"
>
```

`focus:` maps to `:focus`, which fires on both keyboard navigation and mouse clicks. A user who mouse-clicks anywhere that causes the skip link to gain `:focus` (programmatic focus, or an accidental click) will see it jump into view. The standard convention since `:focus-visible` is broadly supported is to gate skip-link visibility on `focus-visible:` so it only surfaces for keyboard users.

The identical pattern appears in both `layout.tsx` and `not-found.tsx`.

**Fix:** Replace all `focus:` prefixes with `focus-visible:` in both files:
```tsx
className="sr-only focus-visible:not-sr-only focus-visible:absolute
  focus-visible:top-4 focus-visible:left-4 focus-visible:z-50
  focus-visible:px-4 focus-visible:py-2 focus-visible:bg-primary
  focus-visible:text-primary-foreground focus-visible:rounded-md"
```

**Confidence:** High

---

## Finding D19-08 — MEDIUM

### Three components use hardcoded `outline-blue-500/400` instead of `ring-ring` design-system token

**Files:**
- `apps/web/src/components/image-zoom.tsx` L347
- `apps/web/src/components/lightbox-color-pip.tsx` L161
- `apps/web/src/app/[locale]/admin/login-form.tsx` L84
**WCAG:** 2.4.7 Focus Visible (AA)
**Context:** New siblings of deferred D18-02; these locations were not previously audited.

All three use:
```tsx
focus-visible:outline focus-visible:outline-2
focus-visible:outline-offset-2
focus-visible:outline-blue-500
dark:focus-visible:outline-blue-400
```

The established codebase pattern is `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`, which resolves through the `--ring` CSS variable and adapts to all themes (light, dark, OLED) and future rebranding. The hard-coded blue escapes this:

- The image-zoom zoom-toggle button (`image-zoom.tsx:347`) is a primary photo-viewer interaction.
- The lightbox color-pip open button (`lightbox-color-pip.tsx:161`) is overlaid on black — blue outline may be acceptable there but is inconsistent.
- The password-visibility toggle in the login form (`login-form.tsx:84`) is especially user-visible.

**Fix for all three:**
```tsx
focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
```
Remove `focus-visible:outline`, `focus-visible:outline-2`, and `focus-visible:outline-offset-2` — the `ring` utilities already produce the correct inset/offset ring without requiring `outline`.

**Confidence:** High

---

## Finding D19-04 — MEDIUM

### EXIF data key-value pairs lack `<dl>/<dt>/<dd>` semantics

**Files:**
- `apps/web/src/components/photo-viewer.tsx` L792–916
- `apps/web/src/components/info-bottom-sheet.tsx` L346–467
**WCAG:** 1.3.1 Info and Relationships (A)

Both the photo-viewer info panel and the mobile bottom sheet EXIF grid render metadata as:
```tsx
<div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
  <div>
    <p className="text-xs text-muted-foreground uppercase tracking-wide">Aperture</p>
    <p className="font-medium">f/2.8</p>
  </div>
  ...
</div>
```

WCAG 1.3.1 requires that label-value relationships conveyed visually be programmatically determinable. A `<dl>/<dt>/<dd>` structure (definition list) satisfies this; adjacent `<p>` elements in a `<div>` do not. Screen readers traversing the grid will announce each item without identifying its term-definition relationship.

**Fix:** Convert to `<dl>/<dt>/<dd>`. The visual output is identical:
```tsx
<dl className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
  <div>
    <dt className="text-xs text-muted-foreground uppercase tracking-wide">
      {t('exif.aperture')}
    </dt>
    <dd className="font-medium mt-0.5">f/2.8</dd>
  </div>
  ...
</dl>
```

Apply to both the photo-viewer info panel and the bottom sheet EXIF grid identically.

**Confidence:** High

---

## Finding D19-05 — MEDIUM

### P3 gamut and HDR peek chips use 10px text — WCAG 1.4.4

**File:** `apps/web/src/components/info-bottom-sheet.tsx` L272, L277
**WCAG:** 1.4.4 Resize Text (AA)

```tsx
<span className="... text-[10px] font-bold bg-purple-200 text-purple-900
  dark:bg-purple-900/40 dark:text-purple-200 rounded gamut-p3-badge">
  P3
</span>
<span className="... text-[10px] font-bold
  bg-gradient-to-r from-amber-300 to-orange-400 text-amber-950 ...">
  HDR
</span>
```

10px is below the practical legibility floor for most body text (12–14px is standard minimum). At 10px, the 200% resize requirement of WCAG 1.4.4 only brings the text to 20px, and many users configure their browser minimum font size above that. The labels carry meaningful semantic content (gamut and HDR capability status), not merely decoration. The peek-state is also the first and only visible state of these badges when the sheet is collapsed — the user can not expand to see a larger version.

**Fix:** Raise to `text-xs` (12px Tailwind default) or `text-[11px]` as a compromise. The peek row has sufficient horizontal room:
```tsx
<span className="text-xs font-semibold px-2 py-0.5 ...">P3</span>
<span className="text-xs font-semibold px-2 py-0.5 ...">HDR</span>
```

**Confidence:** High

---

## Finding D19-02 — LOW

### Bottom sheet slide transition relies on global CSS catch-all for reduced-motion, not an explicit override

**File:** `apps/web/src/components/info-bottom-sheet.tsx` L203
**WCAG:** 2.3.3 Animation from Interactions (AAA)

```tsx
className="fixed inset-x-0 bottom-0 z-50 bg-card border-t rounded-t-xl
  shadow-2xl transition-transform duration-300 ease-out"
```

The `globals.css` global `transition-duration: 0.01ms !important` catch-all effectively snaps this transition for reduced-motion users — the current behavior is correct. The concern is fragility: `lightbox.tsx` and `photo-viewer.tsx` both explicitly test `prefersReducedMotion` for their motion decisions, while the bottom sheet relies solely on the global catch-all. If the global rule is ever scoped (for instance, to stop it from interfering with a specific animation library), the bottom sheet regresses silently.

**Fix:** Add an explicit `motion-reduce:` modifier, which documents intent at the callsite:
```tsx
className="... transition-transform duration-300 ease-out
  motion-reduce:transition-none"
```

**Confidence:** Medium (currently correct; risk is silent future regression)

---

## Finding D19-03 — LOW

### Photo-viewer layout transitions rely on global CSS catch-all rather than explicit overrides

**File:** `apps/web/src/components/photo-viewer.tsx` L663, L743
**WCAG:** 2.3.3 Animation from Interactions (AAA)

Same fragility as D19-02. The grid layout switch at L663 uses `transition-all duration-500 ease-in-out` and the info sidebar at L743 uses `transition-[opacity,transform] duration-500 ease-in-out` — both rely on the global CSS catch-all. The component already imports and uses `prefersReducedMotion` (from framer-motion) for its animated content.

**Fix:** Add explicit `motion-reduce:` modifiers:
```tsx
// L663:
className={cn(
  "grid gap-8 flex-1 transition-all duration-500 ease-in-out photo-viewer-grid",
  "motion-reduce:transition-none",
  showInfo ? "..." : "..."
)}

// L743:
className={cn(
  "... transition-[opacity,transform] duration-500 ease-in-out ...",
  "motion-reduce:transition-none"
)}
```

**Confidence:** Medium (currently correct; risk is silent future regression)

---

## Finding D19-06 — LOW

### HDR badge gradient may have variable contrast across its width

**File:** `apps/web/src/components/info-bottom-sheet.tsx` L277–279
**WCAG:** 1.4.3 Contrast Minimum (AA)

```tsx
<span className="... bg-gradient-to-r from-amber-300 to-orange-400 text-amber-950 ...">
  HDR
</span>
```

Estimated contrasts against amber-950 (#451A03): amber-300 (#FCD34D) ≈ 7.2:1 (passes AAA), orange-400 (#FB923C) ≈ 4.8:1 (passes AA). Given the badge is 3 characters wide the contrast gradient is minimal; both ends pass AA. This finding is informational — no code change required unless visual verification reveals that the rendered gradient washes the text at the lighter end.

**Note:** If simplification is desired, a solid `bg-amber-300 text-amber-950` removes the gradient complexity while maintaining identical contrast.

**Confidence:** Low (likely acceptable as-is)

---

## Finding D19-09 — LOW

### Upload remove button uses `focus:opacity-100` instead of `focus-visible:opacity-100`

**File:** `apps/web/src/components/upload-dropzone.tsx` L472
**WCAG:** Convention consistency

```tsx
className="... sm:opacity-0 sm:group-hover:opacity-100 opacity-100
  focus:opacity-100 transition-opacity"
```

`focus:` fires on `:focus`, which includes mouse-click focus. On `sm:` breakpoints where the button starts hidden (opacity-0), a mouse click triggers the action handler and the button becomes briefly visible before the image is removed. Real harm is negligible (the button disappears immediately after the click), but this is inconsistent with the `focus-visible:` convention used everywhere else in the codebase.

**Fix:**
```tsx
focus-visible:opacity-100
```

**Confidence:** High (fix is unambiguously correct); Low (current code causes no observable user harm)

---

## Summary Table

| ID | Severity | Confidence | File:Line | Criterion |
|----|----------|------------|-----------|-----------|
| D19-01 | HIGH | High | `lightbox.tsx:613` | WCAG 2.4.7, 2.4.11 |
| D19-07 | HIGH | High | `layout.tsx:125`, `not-found.tsx:21` | WCAG 2.4.1 |
| D19-08 | MEDIUM | High | `image-zoom.tsx:347`, `lightbox-color-pip.tsx:161`, `login-form.tsx:84` | WCAG 2.4.7 |
| D19-04 | MEDIUM | High | `photo-viewer.tsx:792`, `info-bottom-sheet.tsx:346` | WCAG 1.3.1 |
| D19-05 | MEDIUM | High | `info-bottom-sheet.tsx:272,277` | WCAG 1.4.4 |
| D19-02 | LOW | Medium | `info-bottom-sheet.tsx:203` | WCAG 2.3.3 |
| D19-03 | LOW | Medium | `photo-viewer.tsx:663,743` | WCAG 2.3.3 |
| D19-06 | LOW | Low | `info-bottom-sheet.tsx:277` | WCAG 1.4.3 |
| D19-09 | LOW | Low (harm) | `upload-dropzone.tsx:472` | Convention |
