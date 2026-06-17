# Designer Review — Cycle 10 (Run 6)

Reviewer: DESIGNER
HEAD at review time: `0502ae86`
Scope: UI/UX + accessibility final sweep (semantic search, similar-photos, photo viewer, lightbox, color pip, histogram, masonry, admin settings, upload)

---

## Summary

Two real defects found. All other audited surfaces are clean. Nothing from cycles 1–9 is re-reported.

---

## Verified Clean

The following surfaces were examined and have no actionable WCAG AA, touch-target, i18n, or broken-interaction defects:

- **i18n key parity** (`en.json` vs `ko.json`): Zero keys missing in either direction. ICU plural asymmetry (en uses `{count, plural, ...}`, ko uses a flat form) is correct per project convention.
- **Lightbox** (`lightbox.tsx`): All controls `h-11 w-11` (44px). `aria-expanded`, `aria-pressed`, `aria-keyshortcuts`, `aria-label` correctly set. FocusTrap with `fallbackFocus` on close button. Position counter uses `role="status"` + `aria-live="polite"`. `controlVisibilityProps` correctly sets `tabIndex: -1` + `aria-hidden: true` when controls are hidden.
- **Lightbox color pip** (`lightbox-color-pip.tsx`): Toggle button `aria-expanded` + `aria-label` correct. DCI-P3 tooltip trigger and copy button both `min-h-11 min-w-11` (44px).
- **Tag filter** (`tag-filter.tsx`): All chips `min-h-11`. Container uses `role="group"` + `aria-label`.
- **On-this-day widget** (`on-this-day-widget.tsx`): Photo links `min-h-[44px]`, `aria-label` present.
- **Search combobox ARIA** (`search.tsx`): `role="combobox"`, `aria-autocomplete="list"`, `aria-controls` correctly set to `'search-results'` only when `results.length > 0` (matches ARIA APG combobox spec — `aria-controls` may be omitted when the listbox is absent). `aria-live="polite"` region announces state changes. FocusTrap sends focus to `#search-input` on open, returns to `triggerRef` on close.
- **Masonry grid**: `alt` text present on all images (`title ?? ''` fallback). Grid container has correct landmark.
- **Photo viewer** (`photo-viewer.tsx`): `<h1 className="sr-only">` for heading navigation, `<h2>` for image title. Download and back buttons `min-h-11`.
- **Upload dropzone**: `aria-label` present. Dropzone zone is keyboard-activatable.
- **Admin settings forms** (semantic-search toggle, backfill trigger): `Switch` has `aria-label` and `Label` association. Backfill button is full-width with `min-h-11`.
- **Color details section heading** (`color-details-section.tsx`): Toggle button uses `min-h-11`. `aria-expanded` is correctly set. `aria-label` includes the section name.

---

## Findings

### FIND-D1 — `aria-controls` references an element that is not in the DOM when collapsed

**Severity: HIGH**
**WCAG criterion: 4.1.2 Name, Role, Value (Level AA)**
**Confidence: HIGH**

**Affected files and lines:**

1. `apps/web/src/components/similar-photos.tsx`
   - Line 116: `aria-controls="similar-photos-results"` is always set on the toggle button
   - Lines 126–155: `{open && (<div id="similar-photos-results" ...>)}` — the referenced element is only rendered when `open === true`

2. `apps/web/src/components/color-details-section.tsx`
   - Line 290: `aria-controls={colorDetailsId}` is always set on the accordion button (`colorDetailsId = \`color-details-${image.id}\``)
   - Line 329 (approx): `{showColorDetails && (<div id={colorDetailsId} ...>)}` — the referenced element is only rendered when `showColorDetails === true`

**Failure:** The ARIA Authoring Practices Guide (APG, disclosure pattern) states: "Authors SHOULD ensure that the element referenced by `aria-controls` is present in the document." When the controlled region is unmounted, JAWS generates an "invalid ID" warning in virtual cursor mode and NVDA may silently fail to navigate to the controlled region on activation. This is a violation of WCAG 4.1.2 — the programmatic relationship between the button and its controlled content is broken when collapsed.

**User impact:** Screen reader users who activate the "Similar Photos" disclosure button or the "Color Details" accordion cannot navigate to the revealed region using the AT-provided `aria-controls` traversal. The affordance set by the cycle-8 fix (`aria-controls` wiring) only works when the referenced element is present in the document.

**Fix (two equivalent options):**

Option A — always render the container, conditionally hide it with the `hidden` attribute:

```tsx
// similar-photos.tsx: render the div always; the `hidden` attribute removes it from tab order + display
<div id="similar-photos-results" hidden={!open} className="mt-2">
  {open && ( /* inner content */ )}
</div>
```

Option B — remove `aria-controls` and rely solely on `aria-expanded`:

```tsx
// Remove aria-controls from the button. aria-expanded alone is
// sufficient for the disclosure pattern when button and content
// are adjacent siblings that AT reaches by sequential navigation.
<button type="button" aria-expanded={open} ...>
```

Option A is preferred because it preserves the explicit AT navigation path from toggle to region. Option B is acceptable when button and content are adjacent siblings.

Apply the same fix to `color-details-section.tsx`.

---

### FIND-D2 — Search dialog Input is 32px tall (`h-8`), below the 44px touch-target floor; not caught by the audit test

**Severity: MEDIUM**
**WCAG criterion: 2.5.5 Target Size (Enhanced, Level AAA); 2.5.8 Target Size (Minimum, Level AA)**
**Confidence: MEDIUM** (the surrounding `p-4` flex container provides extra click area outside the element boundary on desktop, partially mitigating on pointer devices; mobile tap targets are the primary failure surface)

**Affected file and line:**

`apps/web/src/components/search.tsx`, line 374:
```tsx
className="border-0 p-0 h-8 shadow-none focus-visible:ring-0 ..."
```
`h-8` = 32px. The wrapping `flex p-4` container does NOT extend the Input element's own tappable area — padding on the parent does not enlarge a child's hit box.

**Why the audit test does not catch it:**

`apps/web/src/__tests__/touch-target-audit.test.ts` scans for `<Button>`, `<button>`, `<Badge asChild>`, and native `<select>` patterns. A shadcn `<Input>` element is not in the `FORBIDDEN` regex set. This is a genuine blind spot.

**User impact:** On touch devices (iOS/Android), users tapping the search input frequently miss the 32px target and instead activate the adjacent overlay or close button. Most pronounced on smaller viewports (iPhone SE, Android mid-range).

**Fix:**

1. In `search.tsx` line 374, change `h-8` to `h-11` (44px) or add `min-h-11`. The `border-0`, `shadow-none`, and `focus-visible:ring-0` modifiers are unaffected.

2. In `apps/web/src/__tests__/touch-target-audit.test.ts`, extend the FORBIDDEN patterns to include `<Input>` elements with sub-44px explicit heights (`h-8`, `h-9`, `h-10`) to prevent future regressions, mirroring the existing `<button className="...h-8` pattern.

---

## Non-Findings (explicitly checked, ruled out)

- **`search.tsx` `aria-controls` on combobox input**: Setting `aria-controls` to `undefined` when `results.length === 0` is CORRECT per the ARIA combobox APG pattern. The listbox must not be referenced when not present. This is the right behavior.
- **Color pip `aria-controls`**: The pip toggle in `lightbox-color-pip.tsx` uses `aria-expanded` only (no `aria-controls`). No missing referenced element.
- **Histogram canvas**: Canvas is `aria-hidden` with a screen-reader-only text summary adjacent. Correct.
- **`role="status"` in similar-photos loading state**: `role="status"` + `aria-live="polite"` on the loading indicator (line 131) is correct per WCAG 4.1.3.
- **Admin backfill `aria-describedby`**: Wired on the trigger button pointing to the status text element. Correct.
