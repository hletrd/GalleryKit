# Designer Review — Cycle 21

**Reviewer:** oh-my-claudecode:designer
**Date:** 2026-06-29
**Cycle:** 21 (mature codebase — 20 prior cycles)

---

## Cycle-20 Fix Verification

All D20 fixes verified against source before looking for new issues.

| Finding | Status | Notes |
|---------|--------|-------|
| D20-01 nav-client topic pills | FIXED | `outline-none focus-visible:ring-ring focus-visible:ring-offset-2` present at ~L127 |
| D20-01 admin-nav section link | FIXED | same token at ~L40 |
| D20-02 lightbox-color-pip inner buttons | FULLY FIXED | Both L224 and L305 now carry `focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black`; cycle-20 pin test regex passes |
| D20-03 timeline year scrubber + year-in-review | FIXED | both have `focus-visible:ring-ring focus-visible:ring-offset-2` |
| D20-04 g/[key] back-links | FIXED | both branches have `outline-none rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| D20-05 group-hover:scale-105 (deferred) | STILL DEFERRED | globals.css catch-all suppresses the scale transform entirely under `prefers-reduced-motion`; exit criterion unchanged |

---

## Systematic Inventory

Scanned all `components/*.tsx` and `app/[locale]/**/*.tsx` (public + admin). Checked every `<Link>`, `<a>`, and raw `<button>` that is NOT wrapped by shadcn `<Button>` or `<Badge asChild>` (both provide built-in focus-visible rings via their className or Radix Slot). Shadcn `<Button asChild>` wrappers confirmed OK in: dashboard pagination, all admin back-button nav, photo-viewer back-to-topic, lightbox controls, tag-filter chips.

---

## New Findings

### D21-01 — footer.tsx: both Links missing focus-visible ring
**File:** `apps/web/src/components/footer.tsx` L43, L52
**WCAG:** 2.4.7 Focus Visible (AA) / 2.4.11 Focus Appearance (AA in WCAG 2.2)
**Severity:** HIGH
**Elements:**
- L43: GitHub social link — `className="flex min-h-11 items-center gap-2 hover:underline"` — no focus ring
- L52: Admin login link — `className="inline-flex min-h-11 min-w-11 items-center justify-center text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"` — no focus ring

**Impact:** Keyboard-navigating users reach the footer (which appears on every public page) and receive no visible focus indicator on these two interactive links. The admin link is especially significant — it is the entry point for administrative access and may be the target of keyboard-only access flows.

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` to both links' `className`.

---

### D21-02 — s/[key]/page.tsx: "View Gallery" Link missing focus-visible ring
**File:** `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` L105
**WCAG:** 2.4.7 / 2.4.11
**Severity:** HIGH
**Element:**
```
className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 min-h-11"
```
No `outline-none focus-visible:ring-*` classes. The shared-link page is a public surface; this "View Gallery" back-link is the primary navigation escape.

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` to the className.

---

### D21-03 — year/[year]/page.tsx: "Back to Timeline" Link missing focus-visible ring
**File:** `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx` L107
**WCAG:** 2.4.7 / 2.4.11
**Severity:** HIGH
**Element:**
```
className="text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1 min-h-11"
```
No focus ring. Note: the timeline year scrubber links were fixed in D20-03, but the year detail page back-link is a sibling that was missed — recurring "fix one page, miss the adjacent page" pattern.

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` to the className.

---

### D21-04 — analytics-client.tsx: window-selector buttons missing focus-visible ring
**File:** `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx` L64–78
**WCAG:** 2.4.7 / 2.4.11
**Severity:** HIGH
**Element:** Raw `<button>` elements rendered in a `role="group"` for the analytics time-window selector (7d/30d/90d). The buttons carry `aria-pressed` (correct toggle semantics) and `min-h-11` (correct touch target) but no focus ring:
```jsx
<button
  onClick={() => setWindow(w.value)}
  aria-pressed={currentWindow === w.value}
  className={`min-h-11 min-w-11 rounded-md px-4 py-2 text-sm font-medium transition-colors ${...}`}
>
```
**Fix:** Append `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to the static part of the className string (outside the conditional).

---

### D21-05 — not-found.tsx: "Back Home" Link missing focus-visible ring
**File:** `apps/web/src/app/[locale]/not-found.tsx` L43
**WCAG:** 2.4.7 / 2.4.11
**Severity:** HIGH
**Element:**
```
className="inline-flex items-center min-h-11 text-primary hover:underline text-sm"
```
The 404 page has a full nav shell (fixed in a prior cycle) but the primary recovery action link has no keyboard focus indicator. A keyboard user who lands on a 404 page cannot visibly navigate the recovery link.

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` to the className.

---

### D21-06 — error.tsx (public): "Try Again" button missing focus-visible ring
**File:** `apps/web/src/app/[locale]/error.tsx` L32
**WCAG:** 2.4.7 / 2.4.11
**Severity:** HIGH
**Element:**
```
className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
```
Raw `<button>` (not shadcn Button) without `outline-none focus-visible:ring-*`. This is the error boundary recovery button shown when the React subtree throws.

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to the className.

---

### D21-07 — error.tsx (public): "Back to Gallery" Link missing focus-visible ring
**File:** `apps/web/src/app/[locale]/error.tsx` L38
**WCAG:** 2.4.7 / 2.4.11
**Severity:** HIGH
**Element:**
```
className="flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm hover:bg-muted"
```
Sibling of D21-06 on the same error page. Both action buttons on the error boundary are keyboard-invisible.

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to the className.

---

### D21-08 — on-this-day-widget.tsx: "View Timeline" and photo Links missing focus-visible ring
**File:** `apps/web/src/components/on-this-day-widget.tsx` L40, L56
**WCAG:** 2.4.7 / 2.4.11
**Severity:** HIGH
**Elements:**
- L40 "View Timeline" link: `className="text-xs text-muted-foreground hover:text-primary transition-colors min-h-[44px] flex items-center"` — no focus ring
- L56 per-photo Links: `className="flex items-center gap-3 group min-h-[44px]"` — no focus ring

The on-this-day widget is embedded in the public photo viewer page. Both links are navigable via keyboard but invisible during focus.

**Fix:**
- L40: Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` to className
- L56: Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md` to className

---

### D21-09 — home-client.tsx: "Clear filter" Link missing focus-visible ring
**File:** `apps/web/src/components/home-client.tsx` L459
**WCAG:** 2.4.7 / 2.4.11
**Severity:** HIGH
**Element:**
```
className="inline-flex items-center min-h-11 px-2 text-sm underline hover:text-primary"
```
The empty-state "Clear filter" link (shown when tag filters return no results) has no focus ring. Note: `topic-empty-state.tsx` L18 has an identical instance — see D21-11.

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` to the className.

---

### D21-10 — admin/(protected)/error.tsx: both action elements missing focus-visible ring
**File:** `apps/web/src/app/[locale]/admin/(protected)/error.tsx` L35, L41
**WCAG:** 2.4.7 / 2.4.11
**Severity:** HIGH
**Elements:**
- L35 `<button>`: `className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"` — no focus ring
- L41 `<Link>`: `className="flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm hover:bg-muted"` — no focus ring

Exact duplicate pattern of D21-06/D21-07 on the admin subtree's error boundary page.

**Fix:** Same as D21-06/D21-07 — add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to both.

---

### D21-11 — topic-empty-state.tsx: "Clear filter" Link missing focus-visible ring
**File:** `apps/web/src/components/topic-empty-state.tsx` L18
**WCAG:** 2.4.7 / 2.4.11
**Severity:** HIGH
**Element:**
```
className="inline-flex items-center min-h-11 px-2 underline hover:text-primary"
```
This is the topic-filter empty-state variant of D21-09. Both components render "Clear filter" links in empty states and both lack focus rings. Fix together.

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` to the className.

---

### D21-12 — admin-header.tsx: admin logo Link missing focus-visible ring
**File:** `apps/web/src/components/admin-header.tsx` L16
**WCAG:** 2.4.7 / 2.4.11
**Severity:** MED
**Element:**
```
className="mr-6 flex items-center space-x-2 font-bold min-h-11"
```
The admin panel's header logo/brand link (navigates to dashboard) has no focus ring. Admin panel users frequently keyboard-navigate; the primary brand link being invisible on focus is inconsistent with the design system.

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` to the className.

---

### D21-13 — nav-client.tsx: site logo/home Link missing focus-visible ring
**File:** `apps/web/src/components/nav-client.tsx` L85
**WCAG:** 2.4.7 / 2.4.11
**Severity:** MED
**Element:**
```
className="flex items-center space-x-2 shrink-0 min-h-[44px]"
```
The public nav's site name/logo Link (line 85, distinct from the topic pill links fixed in D20-01) has no focus-visible ring. Keyboard navigation starting at the top of any page will Tab to this link first.

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` to the className.

---

## Structural Finding (Persistent)

### MAJOR-2 — Focus-visible scanner: exit criterion reached cycle 20, action required cycle 21

**Status:** Exit criterion MET in cycle 20 (≥3 fresh siblings found); cycle 21 found 13 new instances. After 5+ cycles of finding 3–13 new focus-visible gaps each cycle, the manual sweep model is not converging.

**Root cause:** There are pin tests for components fixed in cycles 17–20 (`focus-visible-rings-cycle17.test.ts`, `focus-visible-rings-cycle19.test.ts`, `focus-visible-rings-cycle20.test.ts`) but NO proactive scanner that detects uncovered `<Link>` and `<a>` elements before they ship. Every cycle uncovers a new batch of siblings adjacent to previously-fixed elements.

**Proposed scanner test** (`__tests__/focus-visible-links-scan.test.ts`):
Walk all `.tsx` files under `components/` and `app/[locale]/`. For each file, extract raw `<Link` and `<a ` JSX openings (not inside `<Button asChild>`). Assert that any such element with a `className` containing an interactive signal (`hover:`, `underline`, `min-h-`, `text-primary`, `text-muted-foreground`) also contains `focus-visible:ring` within the same JSX opening tag block. Exempt by path + anchor-text with a mandatory comment. This scanner would have caught all 13 D21 findings automatically.

**Alternative (simpler):** A grep-based count assertion: in the repo's `components/` and `app/[locale]/`, count `<Link` and `<a ` elements that have `hover:` in their className but NOT `focus-visible:ring`. Assert the count is zero (or equals a documented allowlist). A count increase fails CI.

**Required this cycle:** build the scanner. MAJOR-2 will not converge via manual sweep alone.

---

## Confirmed OK

| Component | Status |
|-----------|--------|
| `lightbox.tsx` close/nav/slideshow buttons | OK — explicit `focus-visible:ring-2 focus-visible:ring-ring` |
| `lightbox-color-pip.tsx` all three buttons | OK — D20-02 fully fixed; trigger + tooltip + copy all confirmed |
| `photo-navigation.tsx` prev/next | OK — `<Button size="icon">` provides ring |
| `upload-dropzone.tsx` remove button | OK — `<Button variant="ghost" size="icon">` |
| `tag-filter.tsx` tag chips | OK — `<Badge asChild><button>` via Radix Slot |
| `color-details-section.tsx` all buttons | OK — explicit `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` |
| `search.tsx` combobox + result items | OK — combobox/listbox pattern; result `<Link>` items are `role="option"` managed via `aria-activedescendant`, not Tab-focused |
| `wide-gamut-hint.tsx` dismiss button | OK — `ring-amber-600` (cycle-17 fix) |
| `login-form.tsx` password toggle | OK — explicit ring |
| Admin back-nav (tags, seo, settings, categories) | OK — all use `<Button asChild variant="ghost" size="icon">` |
| `dashboard-client.tsx` pagination | OK — `<Button asChild>` |
| `bulk-edit-dialog.tsx` | OK — uses shadcn Dialog/Button throughout |
| `not-found.tsx` skip-to-content link | OK — `focus-visible:not-sr-only` pattern |
| `similar-photos.tsx` expand toggle | OK — explicit `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| `home-client.tsx` back-to-top button | OK — explicit `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| `home-client.tsx` masonry card links | OK — parent div uses `focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2` |

---

## i18n Parity

Flat-key diff between `messages/en.json` and `messages/ko.json`: zero gaps in either direction. Full parity confirmed via programmatic key enumeration.

---

## Reduced-motion

`globals.css` L291: global `@media (prefers-reduced-motion: reduce)` catch-all suppresses `animation-duration`, `transition-duration`, and `scroll-behavior`. A secondary rule (AGG-M4) explicitly removes the CSS `group-hover:scale-*` transform (not just the transition) for vestibular safety, covering D20-05. Component-level handling verified in `lightbox.tsx`, `home-client.tsx` back-to-top, `image-zoom.tsx`. No new issues.

---

## Contrast

Light mode `--muted-foreground` (240 3.8% 40%) on white: ~6.1:1 — WCAG AA pass.
Dark mode `--muted-foreground` (240 5% 64.9%) on near-black (240 10% 3.9%): ~7.4:1 — WCAG AA pass.
OLED `--muted-foreground` (same) on black: ~5.7:1 — WCAG AA pass.
`--destructive-text` light on white: ~5.9:1 — WCAG AA pass.
`--destructive-text` dark on near-black: ~7:1 — WCAG AA pass.
No contrast regressions found.

---

## ARIA Audit

- `search.tsx`: combobox + listbox pattern correct. `role="combobox"`, `aria-autocomplete="list"`, `aria-controls`, `aria-expanded`, `aria-activedescendant` all present and wired. `aria-live="polite"` result-count region present. `aria-haspopup="dialog"` on trigger is accurate.
- `analytics-client.tsx` window selector: `role="group"` with `aria-label` on wrapper; individual buttons use `aria-pressed` — correct toggle-button semantics.
- `lightbox.tsx`: `aria-modal="true"`, `aria-label` on dialog, focus trap managed by Radix Dialog.
- `on-this-day-widget.tsx`: `<aside aria-label={t('widgetLabel')}>` landmark present.
- `similar-photos.tsx`: disclosure button uses `aria-expanded` + `aria-controls`. Photo links have `aria-label` with photo title.
- `not-found.tsx`: skip-link, `<main id="main-content" tabIndex={-1}>` focus target, correct heading hierarchy.
- No new ARIA issues found.

---

## Summary Table

| ID | File | Location | Issue | Severity | WCAG |
|----|------|----------|-------|----------|------|
| D21-01 | `footer.tsx` | L43, L52 | GitHub + Admin links missing focus-visible ring | HIGH | 2.4.7 / 2.4.11 |
| D21-02 | `s/[key]/page.tsx` | L105 | "View Gallery" link missing focus-visible ring | HIGH | 2.4.7 / 2.4.11 |
| D21-03 | `year/[year]/page.tsx` | L107 | "Back to Timeline" link missing focus-visible ring | HIGH | 2.4.7 / 2.4.11 |
| D21-04 | `analytics-client.tsx` | L64–78 | Window-selector buttons missing focus-visible ring | HIGH | 2.4.7 / 2.4.11 |
| D21-05 | `not-found.tsx` | L43 | "Back Home" link missing focus-visible ring | HIGH | 2.4.7 / 2.4.11 |
| D21-06 | `error.tsx` (public) | L32 | "Try Again" button missing focus-visible ring | HIGH | 2.4.7 / 2.4.11 |
| D21-07 | `error.tsx` (public) | L38 | "Back to Gallery" link missing focus-visible ring | HIGH | 2.4.7 / 2.4.11 |
| D21-08 | `on-this-day-widget.tsx` | L40, L56 | "View Timeline" + photo links missing focus-visible ring | HIGH | 2.4.7 / 2.4.11 |
| D21-09 | `home-client.tsx` | L459 | "Clear filter" link missing focus-visible ring | HIGH | 2.4.7 / 2.4.11 |
| D21-10 | `admin/(protected)/error.tsx` | L35, L41 | Error boundary actions missing focus-visible ring | HIGH | 2.4.7 / 2.4.11 |
| D21-11 | `topic-empty-state.tsx` | L18 | "Clear filter" link missing focus-visible ring | HIGH | 2.4.7 / 2.4.11 |
| D21-12 | `admin-header.tsx` | L16 | Admin logo link missing focus-visible ring | MED | 2.4.7 / 2.4.11 |
| D21-13 | `nav-client.tsx` | L85 | Site logo/home link missing focus-visible ring | MED | 2.4.7 / 2.4.11 |
| MAJOR-2 | Structural | Repo-wide | No automated scanner for uncovered interactive `<Link>`/`<a>` elements — build required this cycle | SYSTEMIC | — |

**Total new findings:** 13 (11 HIGH, 2 MED) + 1 systemic scanner gap requiring action.
**Deferred from cycle-20 (still deferred):** D20-05 reduced-motion scale (global catch-all covers).
**Confidence:** HIGH on all findings — direct source inspection of exact className strings.
