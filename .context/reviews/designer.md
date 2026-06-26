# Designer UI/UX Review — Cycle 13

**Date:** 2026-06-27
**Reviewer:** Designer agent (Sonnet 4.6)
**Scope:** Static analysis of React component + route surface — information architecture, affordances, WCAG 2.2, keyboard nav, focus management, touch targets, responsive layout, loading/empty/error states, i18n, perceived performance
**Deferred carry-overs NOT re-reported:** search combobox `h-8`, lightbox swipe `aria-roledescription`, position-counter live-region, image-zoom forced-colors cursor

---

## Summary

0 CRITICAL · 0 HIGH · 2 MEDIUM · 5 LOW

The codebase continues to mature. Touch-target coverage (44 px floor) is thorough across all interactive surfaces including tag-filter chips, nav links, bottom-sheet drag handle, and color-details accordion buttons. ARIA roles on dialogs, comboboxes, live regions, and status messages are largely correct. The two MEDIUM findings are precise ARIA semantic issues: a broken `aria-describedby` reference on mobile and an incorrect `aria-expanded` value on the search combobox input. The LOWs are polish-level gaps.

---

## Findings

---

### DES-13-01 — MEDIUM
**`aria-describedby` on photo-viewer keyboard shortcut hint targets a `display:none` element on mobile**

**File:** `apps/web/src/components/photo-viewer.tsx`

The photo-viewer renders a keyboard-shortcut paragraph that is shown on desktop and hidden on mobile:

```tsx
// photo-viewer.tsx ~line 557 (the outermost focus-container div):
aria-describedby="photo-viewer-shortcuts"

// ~line 570 — the referenced element:
<p id="photo-viewer-shortcuts" className="hidden md:block text-xs text-muted-foreground ...">
    {/* keyboard shortcut hints */}
</p>
```

`hidden md:block` compiles to `display: none` at viewport widths below the `md` breakpoint (768 px). The Accessible Name and Description Computation algorithm (ACCNAME-1.2, §4.3) skips elements that are `display: none` — they are not in the flat accessibility tree, so the `aria-describedby` reference resolves to an empty string on mobile.

**Effect:** On mobile screen readers (VoiceOver iOS, TalkBack), the viewer container's accessible description is empty even though an `aria-describedby` ID is present. The reference is not harmful but is silently broken — the shortcut hint copy is never announced on the primary touch surface. If the `<p>` text ever moves to contain non-shortcut information (e.g., a description of the current photo), mobile SR users would be silently excluded.

**Fix:** Replace `hidden md:block` with `sr-only md:not-sr-only` so the element stays in the accessibility tree on all viewports while only rendering visually on `md+`:

```tsx
<p id="photo-viewer-shortcuts" className="sr-only md:not-sr-only text-xs text-muted-foreground ...">
    {/* keyboard shortcut hints */}
</p>
```

---

### DES-13-02 — MEDIUM
**Combobox `aria-expanded` on search input reflects result count, not popup-open state**

**File:** `apps/web/src/components/search.tsx`

The search input inside the dialog is wired as an ARIA combobox:

```tsx
// search.tsx ~line 350-360:
<Input
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={results.length > 0}     // ← incorrect
    aria-controls={results.length > 0 ? "search-results-listbox" : undefined}
    ...
/>
```

ARIA 1.2 combobox pattern (§6.3.4) requires `aria-expanded` to reflect whether the popup listbox is **currently visible**, not whether it contains items. The current implementation sets `aria-expanded={false}` in two cases where it should arguably be `true`:

1. User has focused the input and is typing, but the async search has not returned results yet (loading state) — the listbox may already be showing a spinner or skeleton.
2. User has typed a query that produced zero results — the results panel may still show a "no results" empty state, but `aria-expanded` reads `false`.

The `aria-controls` attribute also being conditionally omitted (set only when `results.length > 0`) compounds this: the SR may not know where to find the listbox even when results arrive immediately after the flag flips.

**Effect:** Screen readers (NVDA + Firefox in browse mode, VoiceOver in form mode) use `aria-expanded` on `role="combobox"` to announce whether the suggestion popup is open. When a user begins typing and `aria-expanded` is `false` during the async fetch, NVDA can announce "collapsed" mid-session, contradicting the visible loading indicator.

**Fix:** Introduce an explicit `isOpen` state that tracks popup visibility based on whether the user has typed at least one character, then use that for both `aria-expanded` and `aria-controls`:

```tsx
const isOpen = query.trim().length > 0;
<Input
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={isOpen}
    aria-controls={isOpen ? "search-results-listbox" : undefined}
    ...
/>
```

---

### DES-13-03 — LOW
**Color-details accordion uses DOM insertion/removal instead of a CSS transition, creating abrupt content shift**

**File:** `apps/web/src/components/color-details-section.tsx`, line 355

```tsx
{showColorDetails && (
    <div id={colorDetailsId} className="grid grid-cols-2 gap-y-3 ...">
        ...
    </div>
)}
```

The accordion expand/collapse is instant — the panel is added/removed from the DOM with no transition. On a slow repaint (mobile CPU or heavy grid) surrounding content shifts position instantaneously. The shadcn `<Accordion>` primitive uses `animate-accordion-down` / `animate-accordion-up` CSS keyframes for a smooth height transition; this component uses a manual `useState` toggle instead.

**Effect:** Not WCAG-blocking. Affects perceived polish and spatial continuity — users who toggle the accordion lose track of their reading position because adjacent EXIF rows jump up/down without animation. Noticeable in the photo-viewer sidebar where multiple data rows sit below the accordion.

**Recommendation:** Wrap the panel in a `<motion.div>` (already imported elsewhere via `framer-motion`) with `initial={{ height: 0, opacity: 0 }}` / `animate={{ height: "auto", opacity: 1 }}` and `exit={{ height: 0, opacity: 0 }}` inside `<AnimatePresence>`. Guard with `useReducedMotion()` per existing project convention — when reduced-motion is preferred, skip the animation and keep the instant toggle behavior.

---

### DES-13-04 — LOW
**Theme toggle button does not communicate the current active theme in its accessible name**

**File:** `apps/web/src/components/nav-client.tsx`, ~lines 155–165

```tsx
<button
    onClick={() => setTheme(nextTheme(...))}
    aria-label={t('aria.toggleTheme')}     // fixed label: "Toggle theme"
    title={t(`theme.${theme}`)}             // tooltip: "Dark", "Light", etc.
>
    {theme === 'light' && <Sun />}
    {theme === 'dark' && <Moon />}
    {theme === 'oled' && <Circle />}
    {(!theme || theme === 'system') && <Monitor />}
</button>
```

The accessible name is always `"Toggle theme"` (or its Korean equivalent). A screen reader user cannot determine the **current** theme state from the button alone — the `title` tooltip is inaccessible without pointing a mouse at the element. WCAG SC 4.1.2 requires stateful controls to expose their state. The icon changes (Sun/Moon/Monitor) but these are decorative `aria-hidden` SVGs and convey nothing to SR users.

**Effect:** A VoiceOver or NVDA user navigating the nav bar hears "Toggle theme, button" with no indication of whether they are currently in Dark or Light mode. They must activate the button to discover the state change by noticing what the label has become, or rely on other cues.

**Recommendation:** Include the current theme in the accessible name:

```tsx
aria-label={t('aria.toggleThemeWithCurrent', { current: t(`theme.${theme ?? 'system'}`) })}
// e.g. "Toggle theme (currently Dark)"
```

Add the corresponding i18n key to `messages/en.json` and `messages/ko.json`. Alternatively use `aria-describedby` pointing to a sr-only span that states the current theme, keeping the action label short.

---

### DES-13-05 — LOW
**Masonry card P3 gamut badge is `aria-hidden="true"` with no accessible alternative in the card link label**

**File:** `apps/web/src/components/home-client.tsx`, ~lines 409–418

```tsx
{isWideGamutPrimary(image.color_primaries) && (
    <div className="absolute top-2 right-2 z-10">
        <span
            className="gamut-p3-badge ... rounded-full backdrop-blur-sm"
            aria-hidden="true"
        >
            P3
        </span>
    </div>
)}
```

The P3 badge is suppressed from the accessibility tree via `aria-hidden="true"`. The containing `<Link>` has `aria-label={t('aria.viewPhoto', { title: displayTitle })}` which does not include gamut information. SR users cannot learn from the masonry grid that a photo is wide-gamut; they must navigate into the detail page to discover it.

**Effect:** Low — the detail page fully discloses color metadata via the Color Details accordion. However, for a gallery designed for color-critical photography, gamut is a first-class property photographers use to identify photos. A screen reader user browsing the grid cannot differentiate wide-gamut shots from sRGB shots without entering each one.

**Recommendation (low-effort):** Add a visually hidden supplemental note inside the card link when the image is wide-gamut:

```tsx
{isWideGamutPrimary(image.color_primaries) && (
    <span className="sr-only">{t('aria.wideGamutPhoto')}</span>
)}
```

This appends to the link's computed accessible name without duplicating the badge visually. Add `aria.wideGamutPhoto = "wide-gamut P3 photo"` (en) and the Korean equivalent to the message files.

---

### DES-13-06 — LOW
**Info bottom-sheet drag handle uses binary `aria-expanded` for a three-state control**

**File:** `apps/web/src/components/info-bottom-sheet.tsx`, ~lines 219–238

```tsx
type SheetState = 'collapsed' | 'peek' | 'expanded';

<button
    aria-expanded={sheetState === 'expanded'}   // true only for 'expanded'
    aria-label={sheetState === 'expanded'
        ? t('viewer.collapseSheet')
        : t('viewer.expandSheet')}
    // handles all three states
>
    <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
</button>
```

The drag handle transitions between three positions: `collapsed` (only 28 px drag bar visible), `peek` (~140 px partial reveal), and `expanded` (full sheet). `aria-expanded` only distinguishes `expanded` from the other two. Both `collapsed` and `peek` states receive `aria-expanded="false"` and the identical label `t('viewer.expandSheet')`, giving no indication that the sheet is currently partially revealed versus fully hidden.

**Effect:** A VoiceOver user who has dragged the sheet to `peek` state and then navigates to the drag handle hears "Expand sheet info, collapsed button" — identical to what they hear when the sheet is fully hidden. The distinction between peek and collapsed states is invisible to SR users.

**Recommendation:** Update the `aria-label` to reflect all three states distinctly:

```tsx
aria-label={
    sheetState === 'expanded'
        ? t('viewer.collapseSheet')
        : sheetState === 'peek'
            ? t('viewer.expandSheetFromPeek')  // "Expand photo info (partially shown)"
            : t('viewer.expandSheet')           // "Expand photo info"
}
```

Add `viewer.expandSheetFromPeek` to `messages/en.json` and `messages/ko.json`.

---

### DES-13-07 — LOW
**LoadMore button uses `h-11` (exact height) instead of `min-h-11`**

**File:** `apps/web/src/components/load-more.tsx`, line 147

```tsx
<Button type="button" variant="outline" onClick={loadMore} disabled={loading} className="h-11">
```

The shadcn `Button` component's `default` size variant already applies `min-h-11` internally (`apps/web/src/components/ui/button.tsx`). The explicit override `className="h-11"` replaces the floor with an exact 44 px height. If the button text wraps at narrow viewports (e.g., a long Korean translation), the fixed height clips the text. All other call sites in the codebase use `min-h-11` or rely on the variant's built-in floor.

**Effect:** At narrow viewport widths (~360 px) or with a long locale string, the button label may be clipped vertically. Not a current visible failure, but a defensive-coding gap that conflicts with the codebase's consistent `min-h-11` pattern.

**Fix:** Change `className="h-11"` to `className="min-h-11"` (one-character delta). The Button variant already supplies `min-h-11`, so this explicit override becomes idempotent and consistent with the rest of the codebase.

---

## Coverage

Components reviewed in this cycle:

- `photo-viewer.tsx` (1032 lines) — full read
- `search.tsx` (475 lines) — full read
- `lightbox.tsx` (680 lines) — full read
- `lightbox-color-pip.tsx` (295 lines) — full read
- `info-bottom-sheet.tsx` (545 lines) — full read
- `color-details-section.tsx` (588 lines) — full read
- `home-client.tsx` (485 lines) — full read
- `nav.tsx` + `nav-client.tsx` (14 + 177 lines) — full read
- `tag-filter.tsx` (119 lines) — full read
- `wide-gamut-hint.tsx` (209 lines) — full read
- `load-more.tsx` (158 lines) — full read
- `image-manager.tsx` (partial, 120 lines)
- `admin-nav.tsx` (grep pass)
- `ui/button.tsx` (62 lines) — full read

Components not re-audited (clean from prior cycles; no new changes flagged by git log since last designer review):
- `histogram.tsx`, `image-zoom.tsx`, `bulk-edit-dialog.tsx`, `tag-input.tsx`, `photo-navigation.tsx`, `upload-dropzone.tsx`, `on-this-day-widget.tsx`, `similar-photos.tsx`, `footer.tsx`
- Admin route group pages: dashboard, categories, tags, settings, analytics, db, users, tokens

---

## Prior Deferred LOWs (unchanged, not re-reported)

| Finding | Status |
|---------|--------|
| Search input `h-8 = 32px` (`search.tsx:375`) | Deferred — explicitly out of scope, AGG-R12-12 |
| Lightbox swipe container missing `aria-roledescription` (`lightbox.tsx`) | Deferred — platform swipe gesture, no normative requirement |
| Position counter live-region vs `opacity:0` hide (`lightbox.tsx:668`) | Deferred — polite live region, low SR disruption |
| Image-zoom `forced-colors` cursor (`image-zoom.tsx`) | Deferred — Windows HC mode edge case, non-blocking |
