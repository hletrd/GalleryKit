# Cycle 22 — Designer Review (UI/UX + WCAG 2.2 Accessibility)

**Date:** 2026-06-29  
**Reviewer:** oh-my-claudecode:designer (Sonnet 4.6)  
**Cycle:** 22  
**Branch:** master (HEAD post-cycle-21 fixes, commit 0e475ba1+)

---

## Summary

Two real accessibility findings. Both are scanner blind spots — interactive `<button>` elements with no `hover:` styling (so the focus-visible scanner's heuristic skips them) that are also missing `focus-visible:ring`. No i18n parity failures. No reduced-motion regressions. No new touch-target violations. Skip link, focus traps, heading hierarchy, ARIA roles/labels, and form validation UX all remain correct.

---

## Cycle 21 Fix Verification

All 13 cycle-21 findings (D21-01 through D21-13) confirmed fixed:

| Finding | File | Status |
|---------|------|--------|
| D21-01 footer GitHub/Admin links | `components/footer.tsx:47,52` | confirmed — ring-ring ring-offset-2 present |
| D21-02 s/[key] View Gallery | `app/[locale]/(public)/s/[key]/page.tsx:105` | confirmed |
| D21-03 year/[year] back link | `app/[locale]/(public)/year/[year]/page.tsx:109` | confirmed |
| D21-04 analytics window selectors + table links | `analytics-client.tsx:68,117,227` | confirmed |
| D21-05 not-found Back Home | `app/[locale]/not-found.tsx:45` | confirmed |
| D21-06/07 error.tsx retry+home | `app/[locale]/error.tsx:34,40` | confirmed |
| D21-08 on-this-day-widget links | `components/on-this-day-widget.tsx:42,58` | confirmed |
| D21-09 home-client clear-filter + back-to-top | `components/home-client.tsx:459,472` | confirmed |
| D21-10 admin error.tsx | `app/[locale]/admin/(protected)/error.tsx:37,43` | confirmed |
| D21-11 topic-empty-state | `components/topic-empty-state.tsx:18` | confirmed |
| D21-12 admin-header logo | `components/admin-header.tsx:16` | confirmed |
| D21-13 nav-client logo + controls | `components/nav-client.tsx:85,96,127,157,168` | confirmed |

---

## New Findings

### D22-01 — Histogram tooltip-trigger button missing focus ring (HIGH)

**File:** `apps/web/src/components/histogram.tsx:707–712`  
**Severity:** HIGH — keyboard users (Tab navigation) reach this button but see no focus indicator  
**WCAG:** 2.4.7 Focus Visible (AA), 2.4.11 Focus Appearance (AA)

The histogram key-type label is a `<button>` wrapped by `<TooltipTrigger asChild>` from Radix UI. It has `cursor-help underline decoration-dotted underline-offset-2` styling but no `hover:` token and no `focus-visible:ring-*` class. Radix's `TooltipTrigger asChild` passes focus handling to the child element — the button IS keyboard-focusable (default browser focusability for `<button>`) — but when a user Tabs to it, focus is invisible.

```tsx
// histogram.tsx:706-713
<TooltipTrigger asChild>
    <button
        type="button"
        className="text-xs text-muted-foreground cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
        // NO hover: token, NO focus-visible: token
    >
        {t(`viewer.keyType${keyType}`)}
    </button>
</TooltipTrigger>
```

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` to the className.

**Scanner note:** The focus-visible-links-scan.test.ts heuristic is `hover: present → require focus indicator`. This button has no `hover:` so the scanner never evaluates it. See Scanner Blind Spot Analysis below.

---

### D22-02 — Map popup button missing focus ring (MEDIUM)

**File:** `apps/web/src/components/map/map-client.tsx:128–133`  
**Severity:** MEDIUM — keyboard users who open a Leaflet popup reach this button without a visible focus indicator  
**WCAG:** 2.4.7 Focus Visible (AA)

The Leaflet popup renders a `<button>` that navigates to the photo detail page. The button has touch-target sizing (`min-h-[44px] min-w-[44px]`) and an `aria-label`, but has no `hover:` styling and no `focus-visible:ring-*`.

```tsx
// map-client.tsx:128-133
<button
    type="button"
    onClick={() => handleMarkerClick(marker.id)}
    className="flex flex-col items-center gap-1 min-h-[44px] min-w-[44px] cursor-pointer text-left"
    aria-label={`${openPhotoLabel}: ${marker.title ?? marker.id}`}
    // NO hover: token, NO focus-visible: token
>
```

Leaflet maps are partially keyboard-navigable; once a popup is open, its contents are reachable by Tab. The button has no visible focus ring.

**Fix:** Add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md` to the className.

**Scanner note:** Same blind spot — no `hover:` token on the button, so the scanner skips it.

---

## Scanner Blind Spot Analysis

The `focus-visible-links-scan.test.ts` scanner (added in cycle 21) correctly handles:

- **`role="option"` exemption:** `<Link role="option">` in `search.tsx:74` is skipped — these are managed via `aria-activedescendant` on the parent combobox (`tag-input.tsx:197–202` pattern), not via DOM focus. The `KNOWN_VIOLATIONS: {'components/search.tsx': 0}` entry is correct.
- **Group-hover parents:** Elements with `group-hover:` get a 12-line lookahead for a child `group-focus-visible:` ring. Confirmed working for lightbox nav arrow buttons (`lightbox.tsx:623–649`).
- **Multi-line normalization:** Template-literal classNames and multi-line JSX are joined before scanning. Confirmed working — no false negatives from multi-line histogram buttons or home-client masonry links.
- **shadcn `<Button>` exclusion:** Capital-B Button is skipped (ring baked into shadcn variants).

**Confirmed blind spot:** The heuristic is `hover: present → require focus-visible:`. An interactive element with NO `hover:` styling (but still keyboard-focusable and needing a ring) is never evaluated. Both D22-01 (histogram tooltip trigger) and D22-02 (map popup button) fall into this gap.

**Recommendation for scanner improvement (D22-03):** Add a secondary scan pass that checks all native `<button>` elements lacking BOTH `hover:` and `focus-visible:` AND not wrapped by a known-exempt pattern (shadcn `<Button>`, `aria-hidden`, `disabled`, `tabIndex={-1}`). Scope the pass to the same `SCAN_ROOTS` as the existing scanner to avoid false positives from vendored code.

---

## Passing Checks (No Action Required)

### i18n Parity (en.json vs ko.json)

780 keys on each side — exact parity. No missing keys in either direction. The ICU plural vs. fixed-form asymmetry (English uses `{count, plural, ...}`; Korean uses `{count}장`) is intentional per the project convention (DOC-R5C3-07).

### Reduced Motion

`app/[locale]/globals.css:291` catch-all: `animation-duration: 0.01ms`, `transition-duration: 0.01ms` on `*`, plus explicit suppression of `group-hover:scale-105` transforms (WCAG 2.3.3, AGG-M4). Framer-motion in `photo-viewer.tsx:704–726` gates on `prefersReducedMotion` (sets `duration: 0` / `initial: false`). No regressions.

### Heading Hierarchy

- Home: `h1` (photo grid title) → `h2 sr-only` (photos section) → `h3` (photo card overlay titles). Valid.
- Timeline: `h1` → `h2` per month with `id` for `aria-labelledby` on the enclosing `<section>`. Valid.
- Admin: one `h1` per page, `h2` subsections. Valid.

### Skip Link

`app/[locale]/layout.tsx:119–127` — skip link `href="#main-content"`. Both `(public)/layout.tsx:12` and `admin/layout.tsx:26` have matching `id="main-content" tabIndex={-1} className="... focus:outline-none"`. Correct.

### Focus Traps

Lightbox: `<FocusTrap>` (`lazy-focus-trap.tsx`) with `allowOutsideClick: true`, fallback to close button. On open: `closeButtonRef.current?.focus()`. On close: `previouslyFocusedRef.current.focus()`. WCAG 2.1 Modal Dialog pattern fulfilled.

### ARIA Labels and Roles

Sampled controls (all pass):
- Lightbox: `role="dialog"`, `aria-modal="true"`, `aria-label`, per-button `aria-label`+`aria-keyshortcuts`, slideshow `aria-pressed`, position counter `role="status" aria-live="polite"`.
- Histogram cycle button: `aria-label={t('aria.cycleHistogram')}`.
- Map popup button: `aria-label` present (D22-02 has correct ARIA, only missing visual ring).
- Bulk-edit: `SelectTrigger` components all have `aria-label`.
- Tag input: full combobox ARIA (`role="combobox"`, `aria-autocomplete`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role="listbox"`, `role="option"`, `aria-selected`).

### Form Validation UX

- Password form: server error → shadcn `<Alert role="alert">` proactive announce; client mismatch → `<Alert>` summary + inline `<p id="confirmPassword-error">` + `aria-invalid="true"` + `aria-describedby` on the field.
- Login form: `<p role="alert" aria-live="assertive">` for server errors. Correct.
- Bulk-edit dialog: `<p role="alert">` for validation errors (`DES-R4C16-05`).

### Touch Targets

`touch-target-audit.test.ts` passes (32/32 tests). New map popup button uses `min-h-[44px] min-w-[44px]` (D22-02 is missing a focus ring, not a touch target problem). Histogram tooltip button is a small inline text element — acceptable as an information-only tooltip trigger, not a primary navigation control.

### Windows High Contrast Mode

`globals.css:330+` `@media (forced-colors: active)` block correctly pins `.masonry-card h3` and `.masonry-card p` to `Canvas`/`CanvasText` system pair and suppresses the gradient overlay. No regressions observed.

### Dark Mode

All components use CSS custom property tokens (`hsl(var(--...))`). Lightbox-color-pip inner buttons use `ring-white ring-offset-black` which is correct for the dark overlay context.

---

## Controls Explicitly Not Re-Reported

Per task instructions — confirmed fixed in cycle 21, not re-reported here: footer GitHub/Admin links, s/[key] View Gallery, year/[year] back link, analytics window selectors + table links, not-found Back Home, error.tsx retry+home (both locales), on-this-day-widget links, home-client clear-filter + back-to-top, topic-empty-state clear-filter, admin-header logo, nav-client logo + nav controls, histogram cycle button, info-bottom-sheet + photo-viewer GPS links.
