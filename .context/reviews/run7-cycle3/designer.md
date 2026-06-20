# Designer Review — Run-7 Cycle-3

**Agent:** designer (UI/UX + accessibility)
**HEAD reviewed:** `c6eff919` (build(sw): refresh SW_VERSION stamp 6bb5a49a-p7)
**Delta from cycle-2 HEAD (`1cdbb883`):**
- `ae5e82cb` fix(color): correct NCLX transfer code 5 from gamma22 to gamma28 (AGG-R7C2-01)
- `eff5d8d6` test(images): pin browser-upload GPS-strip-on-upload guard (AGG-R7C2-02)
- `c6eff919` build(sw): SW_VERSION stamp refresh

**Scope delta:** Only `apps/web/src/components/color-details-section.tsx` changed under SCAN_ROOTS since `1cdbb883`. All other component files are identical to cycle-2.

---

## 1. Pre-flight: Deferred Items from Cycle-2

### DEF-C11-01 — search.tsx:374 `<Input>` h-8 (32 px)

Status: CARRIED FORWARD. No change. The `<Input>` is out of `touch-target-audit.test.ts` scope (shadcn primitive; rule applies at consumer site). Not re-filed.

### MED-R7C2-01 — Histogram clip-blink math

Status: REFUTED in cycle-2 by three independent reviewers. NOT re-raised — no new evidence.

---

## 2. i18n Key Parity

Checked `apps/web/messages/en.json` and `apps/web/messages/ko.json`.

**Count:** Both files have **842 keys** (cycle-2 was 841; +1 for `transferGamma28`).

**Gamma28 key (AGG-R7C2-01 fix):**
- `en.json` line 365: `"transferGamma28": "Gamma 2.8 (BT.470 BG / PAL·SECAM)"`
- `ko.json` line 365: `"transferGamma28": "감마 2.8 (BT.470 BG / PAL·SECAM)"`

**Verdict:** PARITY OK. No missing keys on either side. Korean plural convention (no ICU plural block where English uses one) is unchanged and intentional per DOC-R5C3-07.

---

## 3. Color/HDR UI Honesty

### 3.1 gamma28 humanizer — AGG-R7C2-01 fix verification

`apps/web/src/components/color-details-section.tsx` `humanizeTransferFunction` (lines 66–82):

```
case 'gamma28': return t('viewer.transferGamma28');
```

Confirmed present. Both i18n files carry the key. Fix is complete and wired end-to-end.

### 3.2 WideGamutHint — display-capability gating

`apps/web/src/components/wide-gamut-hint.tsx` line 149:
```ts
const { colorGamut } = useDisplayCapability();
const isSrgbDisplay = colorGamut === 'srgb';
if (!mounted || !isWideGamut || !isSrgbDisplay || dismissed) return null;
```

Uses `useDisplayCapability` (not raw matchMedia). The `mounted` guard prevents SSR→client CLS (R5-H1). Firefox conservative fallback to `'srgb'` is correctly inherited through the hook, NOT a false positive. Dismiss button: `min-h-11 min-w-11 inline-flex` — compliant.
ARIA: `role="status" aria-live="polite" aria-atomic="true"` — correct.

### 3.3 HDR badge gate — admin-only (AGG-M3)

`color-details-section.tsx` line 525: `{isAdmin && isHdr && (` — confirmed. HDR badge is not exposed to public visitors. `role="img" aria-label={t('viewer.hdrBadgeAriaLabel')}` — correct.

### 3.4 LightboxColorPip — display-capability gating

`apps/web/src/components/lightbox-color-pip.tsx`: pip button uses `min-h-11` (line 131), close button uses `min-h-11 min-w-11` (line 189), histogram cycle button uses `min-h-11 min-w-11` (line 271). All compliant.

No raw matchMedia usage found for display-capability decisions — confirmed via grep (earlier session).

---

## 4. Touch-Target Audit

### 4.1 Scanner coverage verification

`apps/web/src/__tests__/touch-target-audit.test.ts`:
- SCAN_ROOTS: `components/`, `app/[locale]/admin/`, `app/[locale]/(public)/`
- FORBIDDEN patterns cover: `<Button size="sm"/"icon">` without h-11/h-12/min-h-11/size-11/size-12 override; h-8/h-9/h-10 literals; min-h-[<44px] arbitrary values; `<Badge asChild>`; hand-styled `<select>`; `<Link>`; `<a>`; scale tokens (h-1..10, size-1..10, min-h-1..10) on all tag classes
- `normalizeMultilineButtonTags` handles Prettier multi-line JSX (cycles 3+)
- `scanRawCheckboxes` covers bare `<input type="checkbox|radio">`
- `max-` lookbehind prevents ceiling utilities (max-h-X, max-w-X) from triggering false positives on all tag classes
- Scale-token catch-all for `<Link>`/`<a>` added at AGG-C7-03

### 4.2 KNOWN_VIOLATIONS count verification (HEAD c6eff919)

All counts verified against live files:

| File | Documented | Actual unguarded |
|---|---|---|
| `components/image-manager.tsx` | 1 | 1 (line 328 `<Button variant="secondary" size="sm">` — batchAddButton, no h-11) |
| `components/admin-user-manager.tsx` | 2 | 2 |
| `components/admin-header.tsx` | 1 | 1 (line 24 `<Button variant="ghost" size="sm">` logout) |
| `app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx` | 5 | 5 |
| `app/[locale]/admin/(protected)/categories/topic-manager.tsx` | 3 | 3 |
| `app/[locale]/admin/(protected)/tags/tag-manager.tsx` | 3 | 3 |
| `app/[locale]/admin/(protected)/settings/settings-client.tsx` | 1 | 1 |
| `app/[locale]/admin/(protected)/seo/seo-client.tsx` | 1 | 1 |
| All other listed files | 0 | 0 (confirmed) |

**All counts match. No drift detected.**

### 4.3 New interactive elements — broad sweep

Grep for `h-8|h-9|h-10|size-8|size-9|size-10` across `components/` and `[locale]/` returned no unguarded hits outside KNOWN_VIOLATIONS.

Key components verified manually:

- **lightbox.tsx**: close (h-11 w-11), fullscreen (h-11 w-11), slideshow (h-11 w-11), prev/next (full-height w-16 hit zone). All ≥ 44 px.
- **lightbox-color-pip.tsx**: pip button `min-h-11`, close `min-h-11 min-w-11`, histogram cycle `min-h-11 min-w-11`. All compliant.
- **nav-client.tsx**: hamburger `min-w-[44px] min-h-[44px]`, theme toggle `min-w-[44px] min-h-[44px]`, locale switch `min-w-[44px] min-h-[44px]`, home Logo link `min-h-[44px]`. All compliant.
- **wide-gamut-hint.tsx**: dismiss button `min-h-11 min-w-11`. Compliant.
- **color-details-section.tsx**: accordion toggle `min-h-[44px]`, info tooltip `min-h-[44px] min-w-[44px]`, copy button `min-h-[44px] min-w-[44px]`, DCI-P3 tooltip `min-h-11 min-w-11`. All compliant.
- **info-bottom-sheet.tsx**: drag handle `min-h-11 w-full`, close button `min-h-11 min-w-11`. Compliant.
- **similar-photos.tsx**: toggle button `min-h-11` (documented in source comment). Compliant.
- **search.tsx**: search trigger `size="icon"` (shadcn floor ≥44 px), close button `h-11 w-11`, semantic toggle `<Switch>` (shadcn primitive — consumer site rule). Compliant.
- **photo-viewer.tsx**: Back button `h-11`, share/download buttons `h-11`. Compliant.

**No new sub-44 px interactive elements found.**

---

## 5. Keyboard Navigation and ARIA

### 5.1 Lightbox (`lightbox.tsx`)

- `role="dialog" aria-modal="true" aria-label={t('aria.lightbox')}`
- `FocusTrap` wraps the dialog; `closeButtonRef.current?.focus()` on mount; `previouslyFocusedRef.current.focus()` on close.
- Arrow key nav (prev/next): `aria-keyshortcuts="ArrowLeft"` / `"ArrowRight"`, `aria-label` on each button.
- Close: `aria-keyshortcuts="Escape"`, `aria-label={t('aria.close')}`.
- Fullscreen: `aria-keyshortcuts="F"`, `aria-label` dynamic on isFullscreen.
- Slideshow: `aria-pressed={isSlideshowActive}` correctly reflects toggle state.
- Photo counter: `role="status" aria-live="polite" aria-atomic="true"`.
- `aria-live="polite" aria-atomic="true"` region for photo change announcements (line 461).
- `prefers-reduced-motion`: initialized from matchMedia at mount; event listener keeps it current. Ken Burns pauses when true.
- Focus management: WCAG 4.1.2 comment at line 141 — blur before hiding controls so `aria-hidden` never lands on a focused element. Correct.

### 5.2 Search dialog (`search.tsx`)

- Search trigger: `aria-haspopup="dialog" aria-expanded={isOpen} aria-label`.
- Dialog: `role="dialog" aria-modal="true" aria-label`.
- `FocusTrap` with `fallbackFocus: '#search-dialog'`.
- Input: `role="combobox" aria-autocomplete="list" aria-controls aria-expanded aria-activedescendant` — full combobox ARIA pattern implemented.
- Results: `role="listbox"`, each result `role="option" aria-selected={idx === activeIndex}`.
- Arrow key navigation with IME composition guard (`isImeComposingReactEvent`).
- Live region: `aria-live="polite" aria-atomic="true"` for result count/status announcements.
- Focus restoration: `triggerRef.current?.focus()` on close.

### 5.3 Info bottom sheet (`info-bottom-sheet.tsx`)

- `role="dialog" aria-modal="true" aria-label={t('viewer.bottomSheet')}`.
- `FocusTrap` with `initialFocus` on close button (once per open, not on sheetState changes — correct, DES-R5C1-04).
- Drag handle: `aria-expanded={sheetState === 'expanded'} aria-label` — correctly reflects collapsed/expanded state.
- Close button: `min-h-11 min-w-11`, `aria-label={t('aria.close')}`.
- Escape key: `window.addEventListener('keydown', handleKeyDown)` with `e.stopPropagation()` to prevent lightbox Escape from also firing.

### 5.4 Color details accordion (`color-details-section.tsx`)

- Toggle button: `aria-expanded={showColorDetails} aria-controls={colorDetailsId}`.
- Content region uses matching `id={colorDetailsId}`.
- Keyboard-accessible: native `<button>` element.

---

## 6. Contrast Audit (spot check)

- `wide-gamut-hint.tsx` dark-mode lift (R13-L2): `dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700/60` — documented in source as ≈ 4.6:1 (above AA 4.5:1).
- Text-on-black UI (lightbox controls): white text on `bg-black/50` — white on 50% black overlay on dark photo background provides sufficient contrast in practice; these are interactive chrome, not body copy.
- Tailwind design tokens (muted-foreground, foreground, etc.) are CSS variables from shadcn/ui new-york theme — these inherit the theme's contrast-compliant defaults and are unchanged since cycle-2.

No new contrast-critical token changes introduced in this cycle's two commits.

---

## 7. Scope Boundary Notes

- No new components added to SCAN_ROOTS since `1cdbb883`.
- No new admin route pages added.
- No new public route pages added.
- Only file changed under SCAN_ROOTS: `color-details-section.tsx` (gamma28 fix).

---

## Summary

**Tests referenced:** i18n parity (842=842), touch-target KNOWN_VIOLATIONS audit (all counts match), ARIA pattern verification across lightbox / search / bottom-sheet / color-accordion.

**AGG-R7C2-01 follow-up:** gamma28 humanizer case is in place, i18n keys are present in both en.json and ko.json, admin gate (AGG-M3) unchanged. Fully resolved.

---

## NEW Findings by Severity

**CRITICAL:** 0
**HIGH:** 0
**MEDIUM:** 0
**LOW:** 0

**Verdict: ZERO new actionable findings.** The UI surface is stable. All cycle-2 fixes landed correctly. Touch-target coverage, i18n parity, color/HDR gating, keyboard navigation, and ARIA roles are all clean at HEAD `c6eff919`. Deferred items (DEF-C11-01) remain deferred with no new evidence. Refuted item (MED-R7C2-01) is not re-raised.
