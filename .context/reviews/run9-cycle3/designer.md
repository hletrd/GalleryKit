# Designer Review — Run 9 Cycle 3

**Reviewer:** designer  
**HEAD:** c2d3857a  
**Scope:** UI/UX + a11y — components/, app/[locale]/(public)/, app/[locale]/admin/

---

## 1. Touch-Target Audit Gate

```
npm test --workspace=apps/web -- touch-target-audit
```

**Result: 15/15 PASS.** All test assertions pass. No regressions.

The scanner coverage remains intact across all interactive tag classes: `<Button>`, `<button>`, `<Link>`, `<a>`, `<select>`, `<Badge asChild>`, and raw `<input type="checkbox|radio">`. Documented blind-spots (arbitrary CSS overrides outside className, runtime-injected classes) unchanged and unchanged in risk profile.

---

## 2. DEF-C11-01 Re-confirmation

**DEF-C11-01 [LOW] — search dialog `<Input>` is 32 px tall (h-8, search.tsx:374)**

Status: **STILL OUT-OF-SCOPE, UNCHANGED.**

- `search.tsx:374` still reads `className="border-0 p-0 h-8 shadow-none ..."` — no change since this deferral was filed.
- `<Input>` (shadcn input primitive) is deliberately excluded from the touch-target-audit scan scope. The audit's `SCAN_ROOTS` cover `components/`, admin route group, and public route group, but the exclusion of bare `<Input>` is intentional per the audit's design (it covers `<Button>/<button>/<Link>/<a>/<select>/<Badge asChild>/checkbox`).
- Re-open criterion unchanged: if `<Input>` is added to the scanner's FORBIDDEN patterns in a future cycle, this would become a blocking failure.

---

## 3. Fresh A11y Sweep

### 3.1 Programmatic Label Association Missing in Bulk-Edit Dialog

**File:** `apps/web/src/components/bulk-edit-dialog.tsx`  
**WCAG:** 1.3.1 Info and Relationships (Level A)  
**Severity:** LOW (admin-only surface, keyboard-primary use)  
**Confidence:** HIGH

Three `<Label>` elements have no `htmlFor` and no `for` attribute, and the controls they describe have no matching `id` or `aria-label`. Radix `LabelPrimitive.Root` renders a native `<label>` element — programmatic association requires either `htmlFor`/`id` pairing or the label physically wrapping the control. In each case a `<div>` sits between the `<Label>` and the conditionally-rendered control, breaking wrapping association.

**Affected triples:**

| Line | Label text key | Control | Control has id/aria-label? |
|------|---------------|---------|---------------------------|
| 174 | `imageManager.topic` | `<SelectTrigger>` (conditional on `topicMode === 'set'`) | No |
| 201 | `imageManager.bulkTitlePrefix` | `<Input>` (conditional on `titleMode === 'set'`) | No |
| 221 | `imageManager.descField` | `<Textarea>` (conditional on `descMode === 'set'`) | No |

Evidence — the Label at line 201:
```tsx
<Label>{t('imageManager.bulkTitlePrefix')}</Label>
<div className="flex items-center gap-2">
    <ModeSelector ... />
    {titleMode === 'set' && (
        <Input
            className="h-11 flex-1"
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            placeholder={t('imageManager.bulkTitlePrefixPlaceholder')}
            // no id, no aria-label, no aria-labelledby
        />
    )}
</div>
```

The `placeholder` attribute provides a text hint visible in the UI, but per WCAG 1.3.1 and WCAG 2.4.6 a placeholder is not a reliable accessible name substitute (it disappears on input and has lower AT announcement priority). Screen readers announce the Input as unlabelled when `titleMode === 'set'`.

**Fix:** Add `aria-label` to each conditionally-rendered control. Minimal diff:

```tsx
// Line ~208
<Input
    aria-label={t('imageManager.bulkTitlePrefix')}
    className="h-11 flex-1"
    ...
/>

// Line ~229
<Textarea
    aria-label={t('imageManager.descField')}
    ...
/>

// Line ~185 (SelectTrigger inside topicMode === 'set')
<SelectTrigger className="h-11 flex-1" aria-label={t('imageManager.topic')}>
```

Alternatively, add `htmlFor` to each `<Label>` and matching `id` to each control; the `aria-label` approach is simpler given the conditional rendering.

**Notes on the other `<Label>` instances:**
- Line 241 (`imageManager.bulkApplyAltSuggested`): the `<SelectTrigger>` at line 246 already has `aria-label={t('imageManager.bulkApplyAltSuggested')}` — self-labelled, fine.
- Lines 260 and 273 (`bulkAddTags`, `bulkRemoveTags`): `<TagInput>` receives the `ariaLabel` prop which wires `aria-label` on the internal `<input>` — fine.

---

### 3.2 Analytics Tables — Missing `scope="col"` on `<th>` Elements

**File:** `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx`  
**Lines:** 96-98, 138-139, 169-170, 206-207, 246-247  
**WCAG:** 1.3.1 Info and Relationships (advisory best practice for simple tables)  
**Severity:** LOW (admin-only, simple two-to-three-column tables, UA heuristics cover this)  
**Confidence:** MEDIUM

All five data tables in the analytics client use `<th>` elements without `scope="col"`. Example:

```tsx
<th className="px-4 py-3 text-left font-medium">{t.colPhoto}</th>
<th className="px-4 py-3 text-left font-medium">{t.colTopic}</th>
<th className="px-4 py-3 text-right font-medium">{t.colViews}</th>
```

The HTML spec allows user agents to infer column scope for `<th>` elements in a single-row `<thead>`, and all major screen readers (NVDA, JAWS, VoiceOver) handle simple tables correctly without explicit `scope`. The tables are properly structured with `<thead>`/`<tbody>`. This is a low-confidence finding: the structural heuristics are reliable for these simple layouts, so this is advisory rather than a firm failure.

**Fix (advisory):** Add `scope="col"` to each `<th>` in `<thead>` rows:

```tsx
<th scope="col" className="px-4 py-3 text-left font-medium">{t.colPhoto}</th>
```

---

### 3.3 No Additional Findings

The following were checked and found clean:

- **Lightbox** (`lightbox.tsx`): `role="dialog"`, `aria-modal="true"`, `aria-label`, FocusTrap, focus-on-mount, focus-restore-on-close, all icon buttons labelled, `aria-pressed` on slideshow toggle, `aria-keyshortcuts` on keyboard-shortcut buttons, `aria-live="polite"` for slideshow state, position counter with `role="status"`.
- **Search dialog** (`search.tsx`): `role="dialog"`, `aria-modal`, combobox pattern fully wired (`role="combobox"`, `aria-autocomplete="list"`, `aria-controls`, `aria-expanded`, `aria-activedescendant`), `role="listbox"` on results list, `role="option"` on each result, live region for result count.
- **Nav** (`nav-client.tsx`): `aria-label` on `<nav>`, labelled hamburger toggle, labelled theme + locale buttons.
- **Tag filter** (`tag-filter.tsx`): `role="group"` + `aria-label`, `aria-pressed` on each tag button.
- **Tag input** (`tag-input.tsx`): combobox ARIA fully wired (`aria-autocomplete`, `aria-expanded`, `aria-controls`, `aria-activedescendant`), `role="listbox"` + `role="option"` on suggestions, `aria-selected`, remove-tag buttons labelled.
- **Photo viewer** (`photo-viewer.tsx`): `<h1 className="sr-only">` for screen readers, semantic `<h2>`/`<h3>` for info panel, prev/next with aria-labels and live region.
- **Lightbox color pip** (`lightbox-color-pip.tsx`): `aria-expanded`, `aria-label`, `focus-visible` rings on all interactive elements, 44 px touch targets confirmed.
- **Color details section** (`color-details-section.tsx`): `role="img"` + `aria-label` on decorative icons, copy button labelled.
- **Histogram** (`histogram.tsx`): canvas `role="img"` + `aria-label` with mode info, toggle and cycle buttons labelled.
- **On-this-day widget** (`on-this-day-widget.tsx`): `<aside aria-label>`, `role="list"`, photo links labelled.
- **Upload dropzone** (`upload-dropzone.tsx`): `role="button"`, `aria-disabled`, `role="progressbar"` with min/max/now, `role="alert"` on errors, `htmlFor` on topic/tag labels.
- **Admin icon-only buttons**: all `size="icon"` Buttons across categories, tags, settings, tokens pages carry `aria-label` attributes.
- **Heading hierarchy**: all pages use a single `<h1>` per route with logically descending `<h2>`/`<h3>` — no skipped levels found.
- **Skip link**: present in `app/[locale]/layout.tsx:119`.
- **Hardcoded color values**: no hardcoded hex/rgb color values found in className or inline style outside of CSS variable references.
- **Focus rings**: all interactive elements in lightbox, nav, search, and color pip carry `focus-visible:ring-*` or `focus-visible:outline-*` classes.

---

## 4. Summary

| ID | Severity | File:Lines | Issue |
|----|----------|-----------|-------|
| DES-R9C3-01 | LOW | `bulk-edit-dialog.tsx:174,201,221` | Label not programmatically associated with conditional Input/Select/Textarea (WCAG 1.3.1) |
| DES-R9C3-02 | LOW (advisory) | `analytics-client.tsx:96-98,138-139,169-170,206-207,246-247` | `<th>` elements missing `scope="col"` (simple tables, UA heuristics cover in practice) |

**Touch-target gate:** 15/15 PASS.  
**DEF-C11-01:** Confirmed still out-of-scope, unchanged.

