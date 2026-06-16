# Designer (UI/UX + Accessibility) Review — GalleryKit

**Cycle:** 3
**HEAD:** b1e9e0da
**Method:** Static code analysis (no dev server). Full inventory of `components/*.tsx`, `components/ui/*.tsx`, and `app/[locale]/**` pages. Contrast ratios computed against the actual CSS tokens in `app/[locale]/globals.css` + `tailwind.config.ts`.

## Executive summary

This is a mature, heavily-hardened UI. ~58 prior findings (a large a11y batch) are genuinely closed at HEAD: 44px touch targets are floored in `ui/button.tsx` (`min-h-11`/`size-11` across every size variant) and enforced by the blocking touch-target audit; `useDisplayCapability` correctly gates P3/HDR badges; `prefers-reduced-motion` is respected globally and the hover-scale transform is explicitly suppressed; forced-colors mode is handled; focus is trapped + restored in lightbox/search/bottom-sheet; combobox ARIA (`aria-activedescendant`, `role=listbox/option`) is correct in Search and TagInput; every form input has an associated `<label>` + `aria-describedby`; live regions announce slideshow/search/loading state; i18n is complete (no hardcoded English strings found in JSX text).

I verified against current HEAD and did **not** re-report closed touch-target items, and did **not** propose activating CLIP semantic search.

The remaining findings are mostly polish-grade. The two that matter most: a **Switch thumb/track geometry mismatch** that makes every toggle in the app look half-engaged (Medium, visual), and a **sub-AA red** on the histogram clip labels in light mode (Medium, contrast — and it hits exactly the photographer audience). The rest are Low.

---

## Findings

### DSGN3-MED-01 — Switch thumb travel doesn't match the widened 44px track (toggle looks half-on) — Medium / High
**File:** `apps/web/src/components/ui/switch.tsx:16-25`
**Evidence:**
- Root: `inline-flex min-h-11 min-w-11 ... px-0 rounded-full` → forces the track to **44×44px minimum** (the touch-target retrofit).
- Thumb: `size-5` (20px) with `data-[state=checked]:translate-x-5` (20px) / `data-[state=unchecked]:translate-x-0`.
- Geometry: in a 44px-wide track with a 20px thumb, the "on" thumb occupies roughly the **20–40px** band — it never reaches the right edge (≈4px gap), and the "off" thumb leaves a ≈24px void on the right. The track was widened to 44px for WCAG 2.5.5 but the thumb size and travel were not adjusted proportionally, so the control reads as perpetually mid-toggle.

Standard shadcn switch is a `w-8 h-[1.15rem]` pill with thumb travel `translate-x-[calc(100%-2px)]`; the touch target is provided by an invisible padded hit-area, not by stretching the visible track to a 44px square.

**Used in 7 places** (no width override anywhere): `search.tsx:423`, `settings-client.tsx:414/430/446/560/621`, `topic-manager.tsx:243`. So every visible toggle (force-sRGB, allow-HDR, force-show-chips, strip-GPS, auto-alt-text, semantic search, map-visible, category map toggles) shows this.

**WCAG/UX:** Not a WCAG failure (target size is satisfied), but a clear visual-affordance defect — a toggle whose thumb never reaches either end undermines the on/off mental model (Nielsen "visibility of system status").
**Affects:** every admin using settings/categories, plus the public search semantic toggle.
**Fix:** Keep the 44px *hit area* but render a normal-proportioned visible pill. Either (a) give the track an explicit visible width (`w-11`) and bump the thumb to `size-9` (36px) with `data-[state=checked]:translate-x-[calc(2.75rem-2.25rem-2px)]`, or (b) revert the visible track to shadcn defaults (`w-8 h-[1.15rem]`, thumb `size-4`, `translate-x-[calc(100%-2px)]`) and provide the 44px target via a wrapping label/padding (the pattern `search.tsx:436` already gestures at). Lock the chosen geometry with a fixture so the next touch-target sweep doesn't re-stretch it.

---

### DSGN3-MED-02 — Histogram clip-percentage labels are sub-AA red on light backgrounds — Medium / High
**Files:** `apps/web/src/components/histogram.tsx:671`, `:674`
**Evidence:**
```tsx
<span className="text-red-500">{t('viewer.histogramBelowBlack', { pct: ... })}</span>
<span className="text-red-500">{t('viewer.histogramAboveWhite', { pct: ... })}</span>
```
- `text-red-500` = `#ef4444`. The histogram renders inside the photo-viewer info sidebar (`bg-card` = `#fff` light) and the mobile bottom sheet (`bg-card` = `#fff` light).
- Computed contrast: **`#ef4444` on `#fff` = 3.76:1** → below WCAG 1.4.3 AA (4.5:1) for small text. (Dark mode is fine: 5.26:1 on the near-black card.)
- These labels convey the *shadow/highlight-clipping warning* — load-bearing information for the exact photographer audience the color pipeline targets.

**Note:** prior cycles fixed the related red text-token problem by introducing `--destructive-text` (red-700 `#b91c1c` = 5.9:1 on white) for UI red text — but the histogram clip labels were never migrated and still use the raw Tailwind `text-red-500`.
**WCAG:** 1.4.3 Contrast (Minimum) — Level AA, fail (light mode).
**Affects:** sighted photographers on light theme reading clip warnings (the primary craft surface).
**Fix:** swap `text-red-500` → `text-destructive-text` (the existing token, already theme-aware and AA on both white and dark cards). One-line change at both lines; no new token needed.

---

### DSGN3-LOW-01 — Timeline & Year masonry cards show no photo title on touch devices (inconsistent with home/topic) — Low / High
**Files:** `apps/web/src/app/[locale]/(public)/timeline/page.tsx:243`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:195`
**Evidence:** the only caption region on each card is:
```tsx
<div className="absolute inset-x-0 bottom-0 hidden ... sm:block sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 ...">
  <h3 className="text-white font-medium truncate">{displayTitle}</h3>
</div>
```
- Below `sm` (phones): `hidden` → no title at all.
- At `sm`+ : title is `opacity-0` until `group-hover` / `group-focus-within`. Touch devices cannot hover, so the title appears only on focus (Tab), never on tap-browse.

By contrast `home-client.tsx:394-399` renders a *second* always-visible mobile overlay (`absolute inset-x-0 top-0 sm:hidden ...`) so home + topic (which delegates to `HomeClient`, `[topic]/page.tsx:214`) show titles on phones. Timeline and year render their own bespoke grids and omit this, so those two surfaces are captionless on the most common browsing modality.

**UX principle:** consistency & recognition-over-recall — the same card type behaves differently across surfaces, and the timeline (a date-driven browse) is exactly where a quick caption helps.
**Mitigation already present:** the wrapping `<Link>` carries `aria-label={displayTitle}`, so SR users and the accessibility tree are fine; this is a sighted-touch discoverability gap, not an a11y failure.
**Affects:** mobile/tablet visitors browsing `/timeline` and `/year/[year]`.
**Fix:** port the `sm:hidden` top-gradient title overlay from `home-client.tsx` into the timeline and year card markup (or, better, factor the masonry card into a shared component so all four surfaces stay in lockstep).

---

### DSGN3-LOW-02 — Lightbox-active loading spinner is an empty (silent) live region — Low / Medium
**File:** `apps/web/src/app/[locale]/(public)/p/[id]/loading.tsx:18-27`
**Evidence:**
```tsx
<div className="fixed inset-0 ... bg-black" role="status" aria-live="polite">
  <div className="h-10 w-10 animate-spin ... border-t-transparent" aria-hidden="true" />
</div>
```
The spinning div is `aria-hidden`, and the `role="status"`/`aria-live` container has **no text and no `aria-label`** → screen readers announce nothing while a deep-linked lightbox route loads. Every other loading surface in the app pairs the spinner with text or a label: `app/[locale]/loading.tsx:8` (`aria-label={t('loading')}` + visible text), `image-manager.tsx:466-469` (spinner + visible loading text), `photo-viewer-loading.tsx`.
**WCAG:** 4.1.3 Status Messages — the status region exists but is empty, so the "is it loading?" state is not conveyed.
**Affects:** screen-reader users following a shared/deep link directly into the lightbox.
**Fix:** add `aria-label={t('common.loading')}` to the `role="status"` container. Mirror `loading.tsx:8`.

---

### DSGN3-LOW-03 — Histogram "computing" overlay has no announced status — Low / Medium
**File:** `apps/web/src/components/histogram.tsx:631-635`
**Evidence:** while the worker computes, the overlay is a plain `<span>{t('common.loading')}</span>` with no `role="status"`/`aria-live`; the canvas itself is correctly `role="img"` + `aria-label` (`:641-642`), but during the compute window the canvas is blank. A keyboard/SR user who opens the histogram panel gets no signal that data is being computed.
**WCAG:** 4.1.3 (minor — visible text exists, just not in a live region).
**Affects:** SR users auditing the histogram.
**Fix:** wrap the loading branch in `role="status" aria-live="polite"` (matches `similar-photos.tsx:122`, which does exactly this for its loading state).

---

### DSGN3-LOW-04 — Non-token focus rings (`outline-blue-500`) diverge from the app's `ring-ring` standard — Low / High
**Files:** `apps/web/src/components/image-zoom.tsx:347`, `apps/web/src/components/lightbox-color-pip.tsx:131` & `:189`, `apps/web/src/app/[locale]/admin/login-form.tsx:84`
**Evidence:** these elements use `focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400`, whereas the rest of the app (and all `ui/*` primitives) use the theme token `focus-visible:ring-ring` / `focus-visible:ring-[3px]`. `#3b82f6` (blue-500) is visible against both the white login card and the black lightbox, so this is not a visibility failure — it's a consistency/themability defect: the OLED theme and the oklch `--ring` override (`globals.css:127/136/145`) don't apply to these four spots, and the ring won't track future brand changes.
**WCAG:** 2.4.7 Focus Visible is satisfied; this is design-system consistency, not a violation.
**Affects:** anyone customizing the theme; visual consistency on lightbox pip / zoom / login.
**Fix:** replace the hardcoded blue outline with the standard `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. The lightbox surface may keep a light ring color but should derive it from a token.

---

### DSGN3-LOW-05 — `InfoBottomSheet` peek-state color chip can render as an empty pill on sRGB displays — Low / Medium
**File:** `apps/web/src/components/info-bottom-sheet.tsx:270-283`
**Evidence:** the peek-row color indicator is gated by `isNonTrivialColor` (`:270`), but its inner P3 chip carries the `gamut-p3-badge` class (`:273`), which `globals.css:190` sets to `display:none` unless `[data-display-gamut="p3"|"rec2020"]`. On an sRGB display viewing a wide-gamut photo, `isNonTrivialColor` is `true` (wide-gamut primaries) but the chip is hidden, so the wrapping `<span className="inline-flex items-center gap-1">` renders with no visible content — an empty inline box plus the leading flex `gap`. (The admin HDR pill at `:278` is unconditional, so admin rows are fine; this only bites the public/non-admin sRGB case.)
**Impact:** purely cosmetic — a stray gap in the peek summary row; no broken layout, no a11y issue (the span has no semantics).
**Fix:** gate the wrapper on display capability too (compute `isP3Display` via `useDisplayCapability` and only render the chip wrapper when the chip would actually show), or hoist the `gamut-p3-badge` gating to the wrapper so the empty span collapses. Low priority.

---

### DSGN3-LOW-06 — `TopicManager` create/edit dialogs have no `DialogDescription` (Radix a11y warning + no described-by) — Low / Medium
**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:189-213` (create), `:294-367` (edit)
**Evidence:** both `<DialogContent>` render only a `<DialogTitle>` with no `<DialogDescription>` and no explicit `aria-describedby={undefined}` opt-out. Radix Dialog logs a development warning ("Missing `Description` or `aria-describedby`") and, more substantively, the dialog purpose isn't described to AT beyond the title. `admin-user-manager.tsx:104` and `image-manager.tsx:599` correctly include `<DialogDescription>` — so this is an inconsistency, not a systemic gap.
**WCAG:** borderline 4.1.2/1.3.1 — the title gives an accessible name, so it's not a hard failure; adding a description is best practice for a dialog that contains a form.
**Affects:** SR admins creating/editing categories; dev-console noise.
**Fix:** add a short `<DialogDescription>` (e.g. `t('categories.addDesc')` / `editDesc`) to both, matching the user-manager pattern. The i18n keys may need adding.

---

## Informational (not active bugs at HEAD)

- **`ui/sheet.tsx` is unused** (no importers outside the file). Its close button (`sheet.tsx:84`) lacks any size/min-height class, so it would render a ~16px tap target — **below the 44px floor** that `ui/dialog.tsx:82` correctly applies (`h-11 w-11`). Since the component never renders, this is dead-code, not a live a11y bug — but if Sheet is ever adopted it will silently introduce a sub-44 control that the touch-target audit (which scans rendered usage, not unused primitive internals) may not catch. Recommend deleting the file, or pre-fixing the close button to `inline-flex h-11 w-11 items-center justify-center` to match Dialog.
- **HDR badge gating uses raw `@media (dynamic-range: high)`** (`globals.css:196`) rather than the `data-display-gamut` attribute path the P3 badge uses (`:191`). This is **documented and intentional** per CLAUDE.md (Firefox HDR-detection gap), with `force_show_color_chips` (`:200`) as the escape hatch. No action.
- **Masonry dynamic column classes** (`home-client.tsx:259`, `columns-${colBase}`…`2xl:columns-${col2xl}`) are **safelisted** in `tailwind.config.ts:11-16`, so they compile correctly. Verified, not a bug.
- **`backgroundColor: 'hsl(var(--muted))'`** inline (`home-client.tsx:292`, `timeline:206`, `year`) is valid: `--muted` is stored as raw HSL components (`globals.css:28`) and `tailwind.config.ts` wraps tokens in `hsl(...)`, matching the established convention. No action.
- **Toaster (sonner)** is theme-aware with rich status icons and renders its own polite live region by default (`ui/sonner.tsx`). Error/success toasts are announced. No action.
- **Skip-to-content link** present and correct (`app/[locale]/layout.tsx:124` → `#main-content`, target `tabIndex={-1}` in public + not-found layouts). No action.

---

## Strengths worth preserving (do not regress)

- **Lightbox** (`lightbox.tsx`): exemplary modal — `role="dialog"`/`aria-modal`, focus trap with `fallbackFocus` (`:447`), focus restoration (`:431-444`), body-scroll lock, `aria-keyshortcuts` on every control, Escape closes the nested color-pip before the lightbox (`:346-350`), auto-hide chrome blurs mouse-focused controls before applying `aria-hidden` so it never lands on a focused element (`:153-174`, WCAG 4.1.2), reduced-motion gates Ken Burns + crossfade, position counter in a polite `role="status"`.
- **Search** (`search.tsx`): full combobox ARIA, focus trap + restore (`:256-267`), IME-composition guards on Escape/arrows/Enter, request-id race protection across both awaits, polite results-count live region (`:371-381`).
- **Color tokens** (`globals.css`): contrast-tuned (`--muted-foreground` lifted to 40% L for AA on white; dedicated `--destructive-text` twin red-700/red-400 documented at 5.9:1 / 7:1), oklch overrides behind `@supports`, OLED theme, forced-colors handling for badges + card-overlay text (`:202-220`, `:327-338`).
- **Touch targets**: `ui/button.tsx` floors all variants at `min-h-11`/`size-11`; the blocking audit covers Button/button/Badge-asChild/native-select multi-line forms.
- **CLS discipline**: masonry cards reserve `aspect-ratio` + `containIntrinsicSize` from real dimensions with a guarded `1/1` fallback for non-positive dims (`home-client.tsx:278-282`); LCP uses `fetchPriority="high"` + `loading="eager"` for above-fold cards synced to the live column count.

---

## Coverage map (reviewed)

`photo-viewer.tsx`, `lightbox.tsx`, `nav-client.tsx`, `nav.tsx`, `search.tsx`, `tag-filter.tsx`, `photo-navigation.tsx`, `wide-gamut-hint.tsx`, `color-details-section.tsx`, `histogram.tsx`, `image-zoom.tsx`, `tag-input.tsx`, `upload-dropzone.tsx`, `home-client.tsx`, `image-manager.tsx`, `admin-user-manager.tsx`, `similar-photos.tsx`, `on-this-day-widget.tsx`, `topic-empty-state.tsx`, `info-bottom-sheet.tsx`, `footer.tsx`, `admin-nav.tsx`, `lightbox-color-pip.tsx`, `lazy-focus-trap.tsx`, `settings-client.tsx`, `topic-manager.tsx`, `login-form.tsx`; primitives `button/input/label/dialog/select/switch/sheet/sonner`; pages `error.tsx` (public+admin), `not-found.tsx`, `loading.tsx` (locale + photo), `timeline`, `year`, `[topic]` (→ HomeClient), `g/[key]` shell; `globals.css`, `tailwind.config.ts`. Read in full or grepped for the relevant patterns; the items above are the only deviations from the established (high) bar.
