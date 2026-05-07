# UI/UX Review — Cycle 6 Round 2 (2026-04-19)

## Reviewer: designer
## Scope: Full repository, focus on settings page, admin nav, component consistency

---

### C6R2-U01: Settings page toggle uses custom button instead of Switch component (MEDIUM)

**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:211-219`

The GPS strip toggle is a hand-coded `<button role="switch">` with inline Tailwind classes. Issues:
- No `Switch` component in `components/ui/` — needs to be added from shadcn/ui
- Missing `aria-label` — the button has `id="strip-gps"` and `role="switch"` but no descriptive label for screen readers
- Dark mode colors are manually specified (`bg-primary`, `bg-input`) rather than inheriting from the component
- The thumb animation uses `transition-colors` on the track and `transition-transform` on the thumb, but no `transition` on both — this creates a visual mismatch during color/position change

**WCAG 2.2 violations:**
- 4.1.2 Name, Role, Value: The switch lacks an accessible name. `aria-labelledby` pointing to the label above would fix this.
- 2.1.1 Keyboard: Works via native `<button>` (space/enter), so this passes.

**Fix:** Add shadcn/ui Switch component. Use `Label` component's `htmlFor` to associate with the Switch.

**Confidence:** HIGH

---

### C6R2-U02: Native `<select>` for storage backend instead of shadcn/ui Select (MEDIUM)

**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:277-286`

The storage backend dropdown uses a native `<select>` with manually-applied Tailwind classes to mimic the shadcn/ui `Select` styling. Issues:
- Inconsistent appearance with other admin form controls
- No custom option rendering (can't show icons or descriptions)
- Missing Radix UI keyboard navigation (type-ahead, arrow keys with visual focus management)
- Native `<select>` renders differently across browsers, especially on macOS

**Fix:** Use shadcn/ui `Select` component.

**Confidence:** HIGH

---

### C6R2-U03: Native checkboxes in image-manager.tsx (carry-forward from C4-F02/C6-F04) (LOW)

**File:** `apps/web/src/components/image-manager.tsx:301-327`

Native `<input type="checkbox">` used instead of shadcn/ui `Checkbox` component. This is a carry-forward finding — the visual inconsistency is known and deferred.

**Confidence:** HIGH (same as C6-F04)

---

### C6R2-U04: Settings page save button doesn't indicate which fields changed (LOW)

**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:59-62`

The save button is always enabled (only disabled during pending state). There's no indication of which settings have been modified since the last save. This makes it easy to accidentally save unchanged settings or forget to save after making changes.

**Fix:** Track dirty state per-field. Show a dot/badge on the save button when there are unsaved changes. Optionally show which fields changed.

**Confidence:** LOW

---

### Previously Confirmed UI/UX Findings

- C6-F04/C4-F02: Native checkboxes — deferred per existing policy
