# UI/UX Static Review — GalleryKit Cycle 16 (DES-16)

**HEAD:** 1f5fb245
**Agent:** oh-my-claudecode:designer (Sonnet)
**Scope:** WCAG 2.2, touch targets, loading/error states, responsive dark/light tokens, i18n parity, perceived performance
**Prior cycle fix exclusions:** DES-15-01 (dialog.tsx, sheet.tsx, upload-dropzone.tsx, topic-manager.tsx focus-visible) — verified fixed; DES-15-02 (LightboxColorPip controlVisibilityProps) — ruled NOT A DEFECT, not revisited.

---

## Summary

Two actionable findings this cycle. The PRIMARY finding is the one the task specification predicts: a `bit_depth` field rendered without an `isAdmin &&` guard in `photo-viewer.tsx` — the sibling location in `info-bottom-sheet.tsx` was patched in cycle-15 but this EXIF grid location was not listed as a fix target. The SECONDARY finding is a raw `<button>` in `home-client.tsx` missing the `focus-visible:ring-*` styling that every other interactive control in the codebase carries.

All other swept areas — i18n, color contrast, touch targets, ARIA, focus-visible convention, prefers-reduced-motion, loading/error state accessibility — are clean.

---

## Findings

### DES-16-01 — Back-to-top button missing focus-visible ring (MEDIUM)

**File:** `apps/web/src/components/home-client.tsx:466-482`
**WCAG:** 2.4.7 Focus Visible (Level AA) / 2.4.11 Focus Appearance (Level AA, WCAG 2.2)
**Confidence:** HIGH

**Evidence.** The back-to-top button is a raw `<button>` (not a shadcn `<Button>`) with this className:

```
"fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] right-6 z-40 p-3
 min-h-11 min-w-11 bg-primary text-primary-foreground rounded-full shadow-lg
 transition-opacity hover:bg-primary/90"
```

No `focus-visible:ring-*`, no `focus-visible:outline-*`, no `outline-none`. The shadcn `Button` base class at `ui/button.tsx:8` includes `outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]`, which suppresses the native outline and replaces it with a consistent ring. This raw `<button>` gets neither — it relies on the browser default `:focus` outline (not `:focus-visible`), which:

1. Fires on mouse click in older Chrome/Safari (the button visually rings on every click, not only keyboard focus).
2. The default browser outline may fail WCAG 2.4.11 minimum contrast requirements against `--primary` (HSL 240 5.9% 10%, approximately `#18181b`) on some themes/OSes.
3. Is visually inconsistent with all other keyboard-navigable controls.

The button is reachable by keyboard (`tabIndex={showBackToTop ? 0 : -1}`) so this is a live WCAG gap, not just a code style issue.

**Fix:**

```tsx
className={cn(
  "fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] right-6 z-40 p-3",
  "min-h-11 min-w-11 bg-primary text-primary-foreground rounded-full shadow-lg",
  "transition-opacity hover:bg-primary/90",
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  showBackToTop ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
)}
```

---

### DES-16-02 — `image.bit_depth` rendered without `isAdmin &&` guard (LOW / defense-in-depth)

**File:** `apps/web/src/components/photo-viewer.tsx:887-892`
**WCAG:** Not a direct WCAG criterion — defense-in-depth against the `_PrivacySensitiveKeys` invariant
**Confidence:** HIGH

**Evidence.** The EXIF grid in `photo-viewer.tsx` renders source bit depth:

```tsx
{hasExifData(image.bit_depth) && (
    <div>
        <p className="text-muted-foreground text-xs">{t('viewer.sourceBitDepth')}</p>
        <p className="font-medium">{image.bit_depth}-bit</p>
    </div>
)}
```

The symmetric fix locations from cycle-15 (R15C15 SEC-15-01) both carry `isAdmin &&`:

- `info-bottom-sheet.tsx:443`: `{isAdmin && hasExifData(image.bit_depth) && (`
- `color-details-section.tsx:481`: `{isAdmin && image.bit_depth != null && image.bit_depth > 0 && (`

`bit_depth` is confirmed admin-only in `data.ts:461` (`_PrivacySensitiveKeys`) and is excluded from `publicSelectFields` via `_omitBitDepthPublic`. So public routes return `undefined` for `bit_depth`, causing `hasExifData()` to return `false` — there is NO active data leak.

However, this location violates the explicit pattern comment at `color-details-section.tsx:479-480`:
> "R15C15 SEC-15-01: bit_depth is admin-only — gate on isAdmin to match the transfer_function / matrix / color_space siblings."

**Fix:**

```tsx
{isAdmin && hasExifData(image.bit_depth) && (
    <div>
        <p className="text-muted-foreground text-xs">{t('viewer.sourceBitDepth')}</p>
        <p className="font-medium">{image.bit_depth}-bit</p>
    </div>
)}
```

---

## Cleared Areas

### Focus-visible convention (full sweep)

All shadcn `Button` variants — `default`, `sm`, `lg`, `icon`, `icon-sm`, `icon-lg` — carry `outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]` via the `buttonVariants` base class (`ui/button.tsx:8`). Size `sm` has `min-h-11` floor.

Tag filter chip buttons in `tag-filter.tsx` use `Badge asChild` with Radix `Slot`. The Badge `badgeVariants` base class (`ui/badge.tsx:8`) carries `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none` — these classes propagate to the inner `<button>` via Slot. CORRECT.

Skip-link targets `<main id="main-content" tabIndex={-1} className="...focus:outline-none">` in both `app/[locale]/layout.tsx` and `app/[locale]/admin/layout.tsx` intentionally suppress the focus ring on the scroll-target container that only receives programmatic focus from the skip link. CORRECT.

`lightbox-color-pip.tsx:161` uses `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500` — a different visual style than the rest of the app (`ring-[3px]`). Meets WCAG 2.4.11 minimum (blue-500 `#3b82f6` on `bg-black/70` ≈ 5.9:1). Cosmetically inconsistent but not a defect.

No `focus:ring-*` without `focus-visible:` found in any admin `(protected)/**` route file or any component in `components/`.

### Touch targets

All shadcn `Button` sizes confirmed at `min-h-11` (44 px) floor via `ui/button.tsx`. Dashboard pagination (`dashboard-client.tsx:107,139,146,154,161`) uses `size="sm"` which resolves to `min-h-11` — CORRECT. Back-to-top button `home-client.tsx:475` has `min-h-11 min-w-11` — touch target is 44 px; the issue is focus ring only (DES-16-01 above). No sub-44px interactive elements found in any admin page.

### Color contrast (token audit)

All token pairs documented in `globals.css` and verified:

| Token | Light mode | Dark mode | OLED |
|---|---|---|---|
| `--muted-foreground` on `--background` | HSL(240 3.8% 40%) on white ≈ 5.9:1 AA | HSL(240 5% 64.9%) on `#09090b` ≈ 8.0:1 AAA | same as dark |
| `--destructive-text` on `--card` | HSL(0 73.7% 41.8%) on white ≈ 5.9:1 AA | HSL(0 90.6% 70.8%) on `#09090b` ≈ 7.0:1 AA | same as dark |
| `--foreground` on `--background` | ≈ 19:1 AAA | ≈ 19:1 AAA | ≈ 19:1 AAA |

All token pairs exceed WCAG AA (4.5:1 small text). No new contrast defects. The prior F-11 fix (`--muted-foreground` bumped from 46.1% to 40% lightness) holds correctly.

### i18n parity (EN / KO)

Flat-key comparison of all nested keys in `messages/en.json` and `messages/ko.json`:

- Keys in EN missing from KO: **0**
- Keys in KO missing from EN: **0**

Perfect parity. No new strings added without corresponding translations this cycle.

### ARIA roles and labels

- `lightbox.tsx`: `role="dialog" aria-modal="true" aria-label={t('aria.lightbox')}` + `aria-live="polite"` sr-only slide status div. CORRECT.
- `search.tsx`: `role="dialog" aria-modal="true"`, `<Input role="combobox" aria-autocomplete="list" aria-controls aria-expanded aria-activedescendant>`, `aria-live="polite"` result count div, FocusTrap active when open. CORRECT.
- `photo-navigation.tsx`: Prev/Next `h-12 w-12` (48 px), `aria-label` on both, sr-only `aria-live="polite"` nav status. CORRECT.
- `nav-client.tsx`: Mobile toggle `min-w-[44px] min-h-[44px]`, `aria-expanded aria-controls aria-label`. CORRECT.
- `upload-dropzone.tsx:407-413`: `role="button" aria-label aria-disabled tabIndex` for disabled state, `role="progressbar"` with `aria-valuenow/min/max/label`. CORRECT.
- `optimistic-image.tsx:71,76`: Loading overlay `role="status" aria-live="polite" aria-label`, error div `role="status" aria-live="polite"`. CORRECT.
- `login-form.tsx:98`: Error paragraph `role="alert" aria-live="assertive"`. CORRECT.
- `settings-client.tsx:254,303`: Backfill warning `role="status"` live regions. CORRECT.

### Loading, empty, and error states

All loading states carry `role="status"` and `aria-live="polite"`. Error messages use `role="alert"`. The `photo-viewer-loading.tsx` skeleton uses `aria-hidden="true"` on decorative animated divs. The empty-state in `tokens-client.tsx:113` uses a decorative `h-8 w-8` icon (`Key`) in a non-interactive container — correct (decorative, no label needed). All states are complete and accessible.

### prefers-reduced-motion

- `photo-viewer.tsx:82` — `useReducedMotion()` from framer-motion. CORRECT.
- `lightbox.tsx:93-109` — MQ listener with `addEventListener/removeEventListener`, applied to slide transition. CORRECT.
- `image-zoom.tsx:46-58` — ref-based MQ snapshot updated on change, gates smooth-zoom animation. CORRECT.
- `home-client.tsx:468` — one-shot snapshot in click handler for `window.scrollTo` behavior. CORRECT (acceptable for action-triggered, not ambient animation).

**Informational (not a defect):** `optimistic-image.tsx:71-72`, `photo-viewer-loading.tsx:16,19`, `loading.tsx:25-27` all use `animate-spin` / `animate-pulse` without `motion-reduce:animate-none`. WCAG 2.3.3 (Animation from Interactions) is Level AAA. Loading spinners are arguably essential for communicating loading state, which creates an exemption even under AAA. Noted as informational, not blocking.

### Perceived performance (LCP / CLS / INP)

- `home-client.tsx:383`: `fetchPriority={isAboveFold ? "high" : "auto"}` on masonry images — above-fold LCP candidates are correctly prioritized.
- Masonry cards use `aspectRatio` and `containIntrinsicSize` for CLS prevention. CORRECT.
- No heavy synchronous handlers on scroll — masonry resize handler is `requestAnimationFrame`-debounced per CLAUDE.md comment.

---

## Non-findings (explicitly ruled out)

- **DES-15-01** focus-visible fixes in `dialog.tsx`, `sheet.tsx`, `upload-dropzone.tsx`, `topic-manager.tsx` — verified landed and held.
- **DES-15-02** `controlVisibilityProps` in lightbox — ruled NOT A DEFECT per cycle-15 resolution; not revisited.
- **`focus:bg-accent`** in `ui/dropdown-menu.tsx:77,95,131,214` and `ui/select.tsx:112` — Radix UI roving-focus item-highlight classes for `data-[highlighted]` state in menu/listbox context, not element focus rings. Correct and appropriate.
- **Duplicate `aria-label` + `<label htmlFor>` on search input** — shadcn Input convention; low impact; not blocking.
- **`color-details-section.tsx:481`** `bit_depth` — correctly guarded `{isAdmin && image.bit_depth != null && ...}`. DES-16-02 targets only `photo-viewer.tsx:887`.
