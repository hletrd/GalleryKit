# GalleryKit UI/UX Review — Comprehensive Designer Assessment (Cycle 12)

> **Date:** 2026-06-27
> **Reviewer:** Designer Agent (Cycle 12 — Independent Review)
> **Scope:** Full UI/UX audit of GalleryKit Next.js 16 photo gallery application at HEAD (2a9976a1)
> **Prior cycle HEAD:** bcd67b12 (cycle 10)

---

## 1. Executive Summary

GalleryKit remains at **A-grade** UI/UX quality heading into cycle 12. Five accessibility fixes from cycle 10 (Sheet close button, Progress ARIA, Tooltip delay, Skeleton motion, Badge focus ring) landed in `f1f6202d`. Two outstanding MED/LOW findings from cycle 10 were also silently fixed: the search modal `aria-modal` gap (3.3) and the admin nav `aria-current` gap (16.6).

Two prior findings remain open: swipe-gesture ARIA (3.2, MED) and ImageZoom forced-colors cursor (3.4, LOW). Two new LOW findings surfaced in cycle 12.

**Severity counts (new findings only):**
- CRIT: 0
- HIGH: 0
- MED: 0
- LOW: 2

**Prior open findings still open:** 1 MED (3.2), 1 LOW (3.4)

---

## 2. Commits Since Cycle 10 (bcd67b12 → 2a9976a1)

| SHA | Description | UI impact |
|-----|-------------|-----------|
| `f1f6202d` | fix(ui): improve touch targets, ARIA, and motion safety | fixes 16.1–16.5 |
| `92ce7a9e` | fix(photo-viewer): local ConnInfo interface for navigator.connection | backend only, no UI change |
| `b3c55036` | fix(shutdown): SIGTERM handler, geoip-lite pre-warm, runtime validation | backend only |
| `29d2552e` | docs(reviews): cycle-10 security findings | docs only |
| `f7b205c9` | docs(reviews): cycle-10 client-side findings | docs only |

---

## 3. Component Inventory (unchanged from cycle 10 unless noted)

All surfaces reviewed at HEAD 2a9976a1:

| File | Status |
|------|--------|
| `components/lightbox.tsx` | Reviewed |
| `components/photo-viewer.tsx` | Reviewed |
| `components/search.tsx` | Reviewed — finding 3.3 FIXED |
| `components/image-zoom.tsx` | Reviewed — finding 3.4 still open |
| `components/color-details-section.tsx` | Clean |
| `components/lightbox-color-pip.tsx` | Clean |
| `components/similar-photos.tsx` | Clean |
| `components/on-this-day-widget.tsx` | Clean |
| `components/topic-empty-state.tsx` | Clean |
| `components/nav-client.tsx` | Clean |
| `components/admin-nav.tsx` | Reviewed — finding 16.6 FIXED |
| `components/upload-dropzone.tsx` | Clean |
| `components/info-bottom-sheet.tsx` | Clean |
| `components/image-manager.tsx` | Clean |
| `components/tag-filter.tsx` | Clean |
| `components/ui/sheet.tsx` | Finding 16.1 FIXED |
| `components/ui/progress.tsx` | Finding 16.2 FIXED |
| `components/ui/tooltip.tsx` | Finding 16.3 FIXED |
| `components/ui/skeleton.tsx` | Finding 16.4 FIXED |
| `components/ui/badge.tsx` | Finding 16.5 FIXED |
| `app/[locale]/globals.css` | Clean — global motion rule at line 291 covers Tailwind transitions |
| `app/[locale]/admin/.../settings-client.tsx` | Clean |
| `app/[locale]/admin/.../analytics-client.tsx` | Clean |
| `app/[locale]/admin/.../tokens-client.tsx` | Clean |
| `app/[locale]/admin/.../dashboard-client.tsx` | Clean |

---

## 4. Prior Findings — Updated Status

### FIXED Since Cycle 10

**3.3** (MED, cycle 10) — **FIXED.** Search modal now wraps in `<FocusTrap>` with `role="dialog"` and `aria-modal="true"`. Evidence: `search.tsx:324–335`.

**16.1** (MED, cycle 10) — **FIXED.** Sheet close button now has `min-h-11 min-w-11 flex items-center justify-center`. Evidence: `ui/sheet.tsx:84`.

**16.2** (MED, cycle 10) — **FIXED.** Progress has `role="progressbar"`, `aria-valuemin={0}`, `aria-valuemax={100}`, `aria-valuenow={pct}` with clamping. Evidence: `ui/progress.tsx:14–17`.

**16.3** (LOW, cycle 10) — **FIXED.** Tooltip `delayDuration` changed from `0` to `100`. Evidence: `ui/tooltip.tsx`.

**16.4** (LOW, cycle 10) — **FIXED.** Skeleton now has `motion-reduce:animate-none`. Evidence: `ui/skeleton.tsx`.

**16.5** (LOW, cycle 10) — **FIXED.** Badge has `focus-visible:outline-none` to prevent double ring. Evidence: `ui/badge.tsx`.

**16.6** (LOW, cycle 10) — **FIXED.** Admin nav `<Link>` now has `aria-current={isActive ? "page" : undefined}` at line 35. Evidence: `components/admin-nav.tsx:35`.

---

### STILL OPEN From Cycle 10

**3.2** — **STILL OPEN.** Lightbox swipe gesture on touch devices has no `aria-roledescription` on the swipe target and no screen-reader announcement that horizontal swipe navigates slides. AT users cannot discover the swipe affordance. `lightbox.tsx:457–458`. WCAG 1.3.3. See §5 below.

**3.4** — **STILL OPEN.** `ImageZoom` uses `cursor-grab` / `cursor-grabbing` / `cursor-zoom-in` Tailwind classes (`image-zoom.tsx:340–341`) with no `@media (forced-colors: active)` override. Under Windows High Contrast, custom cursors render as forced-color default cursors — the grab/zoom visual affordance is lost. WCAG 1.4.11. See §5 below.

---

## 5. All Findings

### 3.2 — Lightbox swipe: no ARIA announcement for swipe navigation
- **ID:** 3.2 (cycle 10, still open)
- **File:** `apps/web/src/components/lightbox.tsx:457–458`
- **Issue:** The lightbox region handles `onTouchStart`/`onTouchEnd` for horizontal swipe-to-navigate, but has no `aria-roledescription`, no `aria-description`, and no off-screen hint that swipe is available. AT users on mobile are not informed that swiping navigates slides. The `aria-label={t('aria.lightbox')}` on the dialog does not mention swipe.
- **Who:** Screen reader users on touch devices (VoiceOver/iOS, TalkBack/Android).
- **WCAG:** 1.3.3 Sensory Characteristics (Level A).
- **Suggested fix:** Add `aria-description={t('aria.lightboxSwipeHint')}` to the dialog element, or include a visually-hidden `<p id="lightbox-hint">` referenced via `aria-describedby`. i18n key: `aria.lightboxSwipeHint` → "Swipe left or right to navigate photos."
- **Severity:** MED
- **Confidence:** HIGH

---

### 3.4 — ImageZoom: custom cursors invisible under forced-colors
- **ID:** 3.4 (cycle 10, still open)
- **File:** `apps/web/src/components/image-zoom.tsx:340–341`
- **Issue:** `cursor-grab`, `cursor-grabbing`, `cursor-zoom-in` are applied via Tailwind. Under `@media (forced-colors: active)` (Windows High Contrast, WCAG 1.4.11), custom cursors are overridden by the OS. The functional difference between zoom-in and grab modes is communicated only through the cursor — there is no other visual indicator. AT/keyboard users do not use the cursor at all, but low-vision users who rely on High Contrast mode AND use a pointer lose the affordance.
- **Who:** Keyboard users and Windows High Contrast mode users.
- **WCAG:** 1.4.11 Non-text Contrast (Level AA).
- **Suggested fix:** Add a `@media (forced-colors: active)` rule that sets `cursor: auto` and optionally a visible border or `outline` on the zoomed image element to replace the cursor affordance with a structural indicator. Low effort: the cursor contrast issue is cosmetic only since the image still zooms correctly on click.
- **Severity:** LOW
- **Confidence:** MEDIUM

---

### R12-DES-01 — Lightbox position counter: `aria-label` changes silently, text content lacks context
- **ID:** R12-DES-01 (new in cycle 12)
- **File:** `apps/web/src/components/lightbox.tsx:667–675`
- **Code:**
  ```tsx
  <div
    className={`... transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}
    role="status"
    aria-live="polite"
    aria-label={t('aria.photoPosition', { current: currentIndex + 1, total: totalCount })}
  >
    {currentIndex + 1} / {totalCount}
  </div>
  ```
- **Issue:** The `aria-label` attribute carries the full descriptive text ("Photo 3 of 5"), but `aria-label` changes on an element do **not** trigger live-region announcements. Only changes to the DOM text content within a live region trigger `aria-live` announcements. Screen reader users will hear "3 / 5" announced on slide change — without the "Photo N of M" framing. The `aria-label` is effectively dead for change announcements.
- **Secondary issue:** `role="status"` has implicit `aria-live="polite"`, so the explicit `aria-live="polite"` attribute is redundant (harmless, but noise).
- **Who:** Screen reader users navigating the lightbox.
- **WCAG:** 4.1.3 Status Messages (Level AA).
- **Suggested fix:** Move the descriptive text into the element's text content and remove `aria-label`, or use a visually-hidden description alongside the visible fraction:
  ```tsx
  <div role="status" className="...">
    <span className="sr-only">{t('aria.photoPosition', { current: currentIndex + 1, total: totalCount })}</span>
    <span aria-hidden="true">{currentIndex + 1} / {totalCount}</span>
  </div>
  ```
  This way the full "Photo 3 of 5" text is announced on change, and sighted users still see "3 / 5".
- **Severity:** LOW
- **Confidence:** HIGH

---

### R12-DES-02 — Search combobox `<Input>` height is 32 px, below 44 px touch-target floor
- **ID:** R12-DES-02 (new in cycle 12)
- **File:** `apps/web/src/components/search.tsx:375`
- **Code:**
  ```tsx
  <Input
    id="search-input"
    role="combobox"
    className="border-0 p-0 h-8 shadow-none ..."
  />
  ```
- **Issue:** The combobox Input has `h-8` (32 px). WCAG 2.5.5 Target Size (Level AAA, 44×44 px) and the repository's own touch-target policy apply to interactive controls. The wrapping `flex items-center p-4 border-b` container is 44 px tall due to the co-located `h-11` close button, but the input element itself is constrained to 32 px — a touch user tapping in the top/bottom 6 px margin of the row may miss the input.
- **Note:** The automated `touch-target-audit.test.ts` does not scan `<Input>` patterns (only `<Button>`, `<button>`, `<Link>`, `<a>`, `<select>`, `<Badge asChild>`), so this is not caught by existing gates.
- **Mitigation:** Because the input spans the full available width and is inside a modal, the practical miss-rate is low. This is a policy gap, not a blocking usability issue.
- **Who:** Touch device users opening the ⌘K search modal.
- **WCAG:** 2.5.5 Target Size (Level AAA).
- **Suggested fix:** Change `h-8` to `h-11` (or `min-h-11`) on the Input className, removing the explicit height constraint so the input fills the container row naturally:
  ```tsx
  className="border-0 p-0 min-h-11 shadow-none ..."
  ```
- **Severity:** LOW
- **Confidence:** HIGH

---

## 6. Design Quality Assessment

No changes to the public-facing design system since cycle 10. The palette (oklch P3 overrides, three themes via CSS variables), typography (local fonts, variable `--font-sans` / `--font-mono`), and motion system (Framer Motion with `useReducedMotion`, global CSS media query at `globals.css:291`) remain cohesive and production-grade.

The global `@media (prefers-reduced-motion: reduce)` rule at `globals.css:291–297` correctly strips `animation-duration` and `transition-duration` to 0.01ms, covering Tailwind utility transitions that are not also gated in JS (including `transition-opacity duration-300` on the lightbox position counter at `lightbox.tsx:668`). This is belt-and-braces correct — no new motion violation.

---

## 7. Summary Table

| ID | Severity | Status | Component | One-line description |
|----|----------|--------|-----------|----------------------|
| 3.2 | MED | Open | `lightbox.tsx:457` | Swipe gesture has no ARIA description for AT users |
| 3.4 | LOW | Open | `image-zoom.tsx:340` | Grab/zoom cursors invisible under forced-colors |
| R12-DES-01 | LOW | New | `lightbox.tsx:671` | Position counter aria-label silent on change; text content lacks context |
| R12-DES-02 | LOW | New | `search.tsx:375` | Search Input `h-8` (32 px) below 44 px touch-target floor |
| 3.3 | MED | Fixed | `search.tsx:324` | Search modal now has aria-modal + FocusTrap |
| 16.6 | LOW | Fixed | `admin-nav.tsx:35` | Admin nav now has aria-current="page" |
| 16.1–16.5 | MED/LOW | Fixed | `ui/sheet,progress,tooltip,skeleton,badge` | Batch ARIA/motion/focus fixes in f1f6202d |

---

*Reviewed at HEAD 2a9976a1 by Designer Agent, cycle 12, 2026-06-27.*
