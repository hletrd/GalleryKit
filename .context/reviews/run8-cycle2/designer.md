# Designer Review — Run-8 Cycle-2 (HEAD `f63af3b9`)

**Date:** 2026-06-21
**Reviewer:** Designer (UI/UX + a11y)
**Scope:** paid-download removal blast radius in photo-viewer.tsx (~927-974),
info-bottom-sheet.tsx (~491-520), settings-client.tsx, bulk-edit-dialog.tsx;
general sweep for touch-target regressions, ARIA/label correctness on the
now-unconditional download UI, focus management, dangling purchase/buy/license/$
copy in components and messages.

---

## Pre-flight diff check

```
git diff ea372e41..f63af3b9 --name-only
→ apps/web/public/sw.js
```

**The only file changed between the cycle-1 HEAD (`ea372e41`) and the current
HEAD (`f63af3b9`) is the compiled service-worker build artifact `sw.js`.**
All component files, message files, settings-client, and bulk-edit-dialog are
byte-identical to the cycle-1 state that the full 11-agent review already
covered. There is nothing new to examine in the UI layer.

---

## Evidence trail (confirming cycle-1 findings remain resolved)

### Residual paid-download copy — CLEAN

```
grep -rn "purchase|licens|entitlement|checkout|stripe|downloadToken" \
  apps/web/src/components/
→ (no output)
```

No purchase/buy/license/$/entitlement/checkout/stripe copy in any component.

### downloadPage i18n namespace — ALREADY DELETED (FIND-R8C1-01 RESOLVED)

```
grep -n "downloadPage|after purchase|single.use|expiryNote" \
  apps/web/messages/en.json apps/web/messages/ko.json
→ (no output)
```

Commit `7fade6df` ("chore(i18n): remove orphaned downloadPage namespace") already
removed both blocks. Confirmed clean.

### bulk-edit-dialog.tsx:287 "sales" reference — NOT a dangling UI ref

The word "sales" at line 287 appears inside a dev comment
(`/* DES-R4C16-05: role="alert" — … Precedent: C4-RPF-09 (sales load-error
region). */`) citing a historical review cycle as precedent for the pattern.
This is documentation provenance, not a functional reference to any deleted
sales route or UI. Not actionable.

### Touch-target audit — PASS, KNOWN_VIOLATIONS budget UNCHANGED

Download section controls:

| Element | File:line | Class | Computed px |
|---|---|---|---|
| `DropdownMenuTrigger > Button` | photo-viewer.tsx:932 | `min-h-11` | ≥ 44 px |
| `DropdownMenuItem (JPEG)` | photo-viewer.tsx:941 | `h-auto min-h-11 py-2` | ≥ 44 px |
| `DropdownMenuItem (AVIF)` | photo-viewer.tsx:951 | `h-auto min-h-11 py-2` | ≥ 44 px |
| `Button asChild (simple)` | photo-viewer.tsx:964 | `w-full gap-2 min-h-11` | ≥ 44 px |
| `DropdownMenuTrigger > Button` | info-bottom-sheet.tsx:497 | `min-h-11` | ≥ 44 px |
| `DropdownMenuItem (JPEG)` | info-bottom-sheet.tsx:506 | `h-auto min-h-11 py-2` | ≥ 44 px |
| `DropdownMenuItem (AVIF)` | info-bottom-sheet.tsx:516 | `h-auto min-h-11 py-2` | ≥ 44 px |
| `Button asChild (simple)` | info-bottom-sheet.tsx:529 | `w-full gap-2 min-h-11` | ≥ 44 px |

All eight interactive download controls meet the 44 px minimum. No new sub-44
element introduced. KNOWN_VIOLATIONS budget (image-manager: 1, admin-user-manager: 2,
admin-header: 1, all others: 0) is unchanged.

### ARIA correctness — functionally correct, no regression

Both `DropdownMenuTrigger asChild` usages render a `<Button>` that Radix
decorates with `aria-haspopup="menu"` + `aria-expanded` (toggled on open/close)
+ `aria-controls` pointing to the menu content id. The trigger button text
contains the download label and a `<ChevronDown>` icon, giving screen readers
sufficient context. The absence of an explicit `aria-label` was noted in cycle-1
as a non-finding (optional only) and remains unchanged — not re-filed.

`DropdownMenuItem asChild` wraps native `<a download>` anchors. Radix assigns
`role="menuitem"` to the slot root, producing `role="menuitem"` on the `<a>`.
The visible text (`downloadSrgbJpeg` / `downloadP3Avif` + their description
spans) is present in DOM, so screen readers announce label + format description.
No aria-label gap.

The `info-bottom-sheet.tsx` sheet root carries `role="dialog"` + `aria-label`
(line 201/203); the drag handle carries `aria-label` (line 237); the close
button carries `aria-label` (line 249). Focus trap is `<FocusTrap>` (line 543).
No regression.

### Focus management — unchanged from cycle-1 verified state

`photo-viewer.tsx` uses `useRef`-based focus management with no change in the
download section. `info-bottom-sheet.tsx` FocusTrap is unchanged.

### Conditional rendering after removal — CORRECT

`{downloadHref && (…)}` at photo-viewer.tsx:927 and info-bottom-sheet.tsx:492
gates on `image.filename_jpeg` non-null (line 176/154 respectively). The inner
ternary `{isWideGamutSource && avifDownloadHref ? <DropdownMenu> : <Button>}`
is the only branching. No entitlement/license/token conditional remains anywhere
in either component. Structurally correct.

---

## NEW FINDINGS: 0

No new UI/UX or a11y findings. All cycle-1 confirmed findings (FIND-R8C1-01
through FIND-R8C1-05) were implemented between the cycle-1 and cycle-2 heads
(commits `7fade6df`, `1d1cc118`, `8bfa0873`, `56a4cc32`, `4e72d0f4`). The
component layer is byte-identical to the cycle-1 state that passed the
11-agent review. No new interactive elements, no touch-target regressions, no
dangling paid-download copy, no broken ARIA, no conditional-rendering residue.

### DEF-C11-01 carry-forward (unchanged)

Search dialog `<Input>` at `search.tsx:374` remains `h-8` (32 px). Out of
touch-target-audit scope by design. Exit criteria unchanged. Not re-raised.
