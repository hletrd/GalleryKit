# Designer — Run-8 Cycle-1 UI/UX Review (HEAD 47b1e21f)

**Scope:** Stripe paid-download REMOVAL (commits 6c5e0b61..47b1e21f).  
**Files changed:** `photo-viewer.tsx` (-108), `info-bottom-sheet.tsx` (-2), `bulk-edit-dialog.tsx` (-42), `settings-client.tsx` (-56), `sales-client.tsx` + `sales/page.tsx` DELETED.  
**Deferred register consulted:** `.context/plans/run7-cycle6/deferred.md` — MED-R7C2-01, REJ-R7C3-01, NCLX pin class, DEF-C11-01 NOT re-filed.

---

## Summary

| Severity | Count |
|----------|-------|
| CRIT     | 0     |
| HIGH     | 0     |
| MED      | 1     |
| LOW      | 1     |
| INFO     | 2     |

**Touch-target gate: PASS.**  
**KNOWN_VIOLATIONS budget delta: 0** (sales-client.tsx was never in the budget; total remains 17 across 8 files).  
**Dangling /sales links: NONE FOUND.**  
**Highest-signal item:** MED-R8C1-01 — `downloadPage` i18n namespace is dead UI copy with no route, no component, and no deletion intent documented.

---

## Axis 1 — Touch-Target Audit

**Result: PASS. No new violations introduced.**

### Desktop photo-viewer.tsx (lines 927–974)

All four interactive download elements carry explicit `min-h-11` (44 px floor):

| Element | className evidence | Passes |
|---|---|---|
| `DropdownMenuTrigger > Button` | `className="w-full gap-2 min-h-11"` | ✓ |
| `DropdownMenuItem` (sRGB JPEG) | `className="h-auto min-h-11 py-2"` | ✓ |
| `DropdownMenuItem` (P3 AVIF) | `className="h-auto min-h-11 py-2"` | ✓ |
| Single-option fallback `Button asChild` | `className="w-full gap-2 min-h-11"` | ✓ |

### Mobile info-bottom-sheet.tsx (lines 492–539)

Identical gamut-aware download block. Same four elements, same `min-h-11` / `h-auto min-h-11 py-2` tokens confirmed at lines 497, 506, 516, 529. All pass.

### KNOWN_VIOLATIONS budget

`touch-target-audit.test.ts` lines 112–245: KNOWN_VIOLATIONS map has **no entry for `sales-client.tsx`** (confirmed by `grep -n "sales"` returning zero hits). The deleted file was never counted. Budget stays at **17 violations across 8 files**, unchanged.

The single pre-existing `settings-client.tsx: 1` exemption (line 236 in test) covers the back-arrow `<Button size="icon">` at `settings-client.tsx:230`. This is the same exemption that existed in run-7; removal of the pricing section did not touch that button.

---

## Axis 2 — Dangling Nav Link Check

**Result: CLEAN. No dangling /sales links.**

`admin-nav.tsx` defines the full nav link array:
```
dashboard / categories / tags / seo / settings / password / users / db / analytics
```
No `sales`, `stripe`, `pricing`, or `entitlements` entry. Grep of all `src/app/[locale]/admin/` `.tsx`/`.ts` files for `sales|stripe|entitl|pricing|license|tier` returns zero hits. The `sales/` route directory is fully absent from `src/app/[locale]/admin/(protected)/`.

---

## Axis 3 — Free-Download Dropdown UX Coherence

**Result: COHERENT. Gate logic correct, i18n complete in both locales.**

### Gate logic

```tsx
{isWideGamutSource && avifDownloadHref ? (
    <DropdownMenu>…</DropdownMenu>
) : (
    <Button asChild …>…</Button>
)}
```

`isWideGamutSource = isWideGamutPrimary(image.color_primaries)` and `avifDownloadHref` requires `image.filename_avif` to be non-null. Both conditions must be true — so an sRGB photo, or any photo whose AVIF file is missing (e.g. mid-processing), correctly degrades to the plain single-button path. No empty-dropdown scenario is possible.

### Trigger label

```tsx
{isP3Pipeline(image.color_pipeline_decision)
    ? t('viewer.downloadP3Jpeg')
    : t('viewer.downloadJpeg')}
```

Wide-gamut P3 sources show "Download (8-bit Display P3 JPEG)" on the trigger; sRGB sources (which never reach the dropdown branch anyway) would show "Download 8-bit JPEG". The trigger label correctly identifies the delivered JPEG gamut.

### i18n key parity (all 6 keys, both locales)

| Key | en.json | ko.json |
|---|---|---|
| `viewer.downloadJpeg` | ✓ line 337 | ✓ line 337 |
| `viewer.downloadSrgbJpeg` | ✓ line 338 | ✓ line 338 |
| `viewer.downloadSrgbJpegDesc` | ✓ line 339 | ✓ line 339 |
| `viewer.downloadP3Jpeg` | ✓ line 340 | ✓ line 340 |
| `viewer.downloadP3Avif` | ✓ line 341 | ✓ line 341 |
| `viewer.downloadP3AvifDesc` | ✓ line 342 | ✓ line 342 |

All 6 keys present in both locales. No missing translations.

---

## Axis 4 — settings-client.tsx Layout After Pricing Section Removal

**Result: CLEAN. No orphaned section headers, empty cards, or dangling labels.**

Post-removal card inventory (from CardHeader grep of the 686-line file):

1. Image Processing (line 244) — fully populated, contains backfill controls
2. Privacy (line 544) — fully populated
3. Slideshow (line 578) — fully populated
4. Auto Alt-Text (line 605) — fully populated
5. Semantic Search (line 633) — fully populated

No `<Card>` with an empty `<CardContent>`. No floating `<CardTitle>` without a parent card. The `settings-client.tsx: 1` KNOWN_VIOLATIONS entry (the back-arrow `size="icon"` Button at line 230, outside any card) is unchanged and correctly budgeted.

---

## Axis 5 — i18n Orphan Analysis

### MED-R8C1-01 — `downloadPage` namespace is dead UI copy with no deletion

**File:** `apps/web/messages/en.json` lines 63–69; `apps/web/messages/ko.json` lines 63–69  
**Issue:** The `downloadPage` namespace (4 keys: `title`, `description`, `descriptionNoTitle`, `button`, `expiryNote`) was the copy for the Stripe single-use download link page. That page and its client component are deleted. No source file in `src/` references `downloadPage.` (grep returns zero hits). The keys are therefore dead weight — they persist in both locale files with no consumer.  
**Evidence:** `grep -rn "downloadPage\." src/` returns 0 results. The keys occupy lines 63–69 in both `en.json` and `ko.json`.  
**Severity:** MED — not a runtime error, but orphaned translation keys create maintenance confusion and will be incorrectly included in any future i18n completeness tooling.  
**Fix:** Delete lines 63–69 from both `en.json` and `ko.json` (the entire `downloadPage` object). Run `npm run lint --workspace=apps/web` to confirm no remaining references.  
**Confidence:** HIGH.

### INFO-R8C1-01 — `viewer.downloadPage` namespace name collision risk (informational)

**File:** `en.json`, `ko.json`  
**Note:** The `downloadPage` namespace at the root level is separate from the `viewer.download*` keys. There is no naming collision at runtime. This is purely an informational note that the dead namespace shares a conceptual name with the live `viewer` download keys — no action required beyond the MED finding above.

---

## Axis 6 — a11y on Rewritten Download Control

**Result: ACCEPTABLE. One LOW finding on accessible name source.**

### LOW-R8C1-01 — DropdownMenuTrigger lacks explicit `aria-label`; relies on icon + text content

**File:** `apps/web/src/components/photo-viewer.tsx` lines 932–939; `apps/web/src/components/info-bottom-sheet.tsx` lines 497–504  
**Issue:** The `DropdownMenuTrigger`'s accessible name is computed from its child Button content: `<Download icon> + t('viewer.downloadP3Jpeg') + <ChevronDown icon>`. Radix renders the trigger as `role="button"`. The icon elements are `aria-hidden` by Lucide's default, so the accessible name resolves to the text label only (e.g. "Download (8-bit Display P3 JPEG)"). This is functional but does not communicate the "has options" aspect to screen-reader users who have not yet interacted with it.  
**Evidence:** No `aria-label`, `aria-haspopup`, or `aria-expanded` on the trigger element in JSX. Radix `DropdownMenuTrigger` automatically sets `aria-haspopup="menu"` and `aria-expanded` on the underlying button element, so ARIA role and state ARE handled by the primitive.  
**Reassessment:** Radix `DropdownMenuTrigger` injects `aria-haspopup="menu"` and toggles `aria-expanded` correctly at runtime. The button content (text + ChevronDown visual) provides sufficient context. The `ChevronDown` icon (`h-4 w-4 ml-auto`) provides a visual affordance. This is LOW, not MED — the a11y primitives are correctly wired by Radix; only the visible chevron gives the "expandable" affordance without explicit `aria-label` enrichment.  
**Fix (optional):** Add `aria-label={t('viewer.downloadOptionsLabel')}` to the trigger Button and add a new i18n key `viewer.downloadOptionsLabel` ("Download options") in both locales. Low priority — Radix handles the semantic states.  
**Confidence:** HIGH (that it is LOW severity, not a blocking issue).

### Keyboard operability

- `DropdownMenuTrigger`: Enter/Space opens the menu (Radix default behavior). ✓
- `DropdownMenuItem asChild`: Arrow keys navigate between items, Enter activates. ✓
- `FocusTrap` in `info-bottom-sheet.tsx`: wraps the entire sheet correctly; focus lands on the close button on open (line 196). ✓
- Escape key: handled at the sheet level (`handleKeyDown` at line 136) and by Radix DropdownMenu natively. ✓

---

## INFO-R8C1-02 — bulk-edit-dialog.tsx: license-tier field removal is clean

**File:** `apps/web/src/components/bulk-edit-dialog.tsx`  
**Finding:** No orphaned license, tier, pricing, stripe, or entitlement field references remain. Grep for those terms returns only a comment at line 287 that uses "sales" in an inline code comment referencing a past RPF cycle (`C4-RPF-09 (sales…)`). This is doc debt, not a rendered UI element. No visible artifact.  
**Severity:** INFO — no action required.

---

## Evidence Traceability

| Claim | Source |
|---|---|
| All download Button `min-h-11` | `photo-viewer.tsx:929,940,950,966`; `info-bottom-sheet.tsx:497,506,516,529` |
| KNOWN_VIOLATIONS no sales entry | `touch-target-audit.test.ts` grep: 0 hits for "sales" |
| Budget = 17, unchanged | `touch-target-audit.test.ts` lines 112–245 |
| Admin nav: no /sales entry | `admin-nav.tsx` links array: 9 entries, none matching sales |
| All 6 viewer.download* keys in en+ko | grep confirmed 1 hit each in both files |
| `downloadPage` namespace: zero consumers | `grep -rn "downloadPage\." src/` → 0 results |
| settings-client: 5 cards, all populated | grep CardHeader → 5 hits; no empty CardContent |
| Radix ARIA on DropdownMenuTrigger | Radix UI primitive contract (aria-haspopup, aria-expanded automatic) |
