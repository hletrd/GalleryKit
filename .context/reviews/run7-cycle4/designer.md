# Designer Review — Run-7 Cycle-4

**Agent:** designer (UI/UX + accessibility)
**HEAD reviewed:** `25bb2794` (build(sw): refresh SW_VERSION stamp ff09639b-p7)
**Delta from cycle-3 HEAD (`c6eff919`):**
- `ea303321` docs(color): clarify NCLX xvYCC + BT.2020 transfer comments (AGG-R7C3-01) — `color-detection.ts` comment-only, NO UI impact
- `33ec5b30` refactor(color): compile-time guard for COLOR_IMPACTING_KEYS subset (AGG-R7C3-02) — `settings-hash.ts` type-level only, NO UI impact
- `ff09639b` docs(reviews): run-7 cycle-3 review artifacts — docs only
- `25bb2794` build(sw): SW_VERSION stamp — `public/sw.js` only

**Scope delta under SCAN_ROOTS:** ZERO files changed under `components/`, `app/[locale]/admin/`, or `app/[locale]/(public)/`. No render-path change of any kind.

---

## 1. Pre-flight: Deferred Items

### DEF-C11-01 — search.tsx:374 `<Input>` h-8 (32 px)

Status: CARRIED FORWARD. No change. The `<Input>` primitive is excluded from `touch-target-audit.test.ts` scope by design — the rule applies at the consumer site, not the shadcn primitive. Not re-filed.

---

## 2. i18n Key Parity

Verified `apps/web/messages/en.json` and `apps/web/messages/ko.json` with Python key-flattening (all nested keys enumerated).

**Count:**
- `en.json`: **842 keys**
- `ko.json`: **842 keys**
- `only in en`: `[]` (empty)
- `only in ko`: `[]` (empty)

**Verdict: PARITY OK — 842 = 842, zero missing keys on either side.** Count unchanged from cycle-3 (no i18n files touched in this cycle's commits). Korean plural convention (no ICU plural block where English uses one) is unchanged and intentional per DOC-R5C3-07.

---

## 3. Touch-Target Audit

### 3.1 KNOWN_VIOLATIONS table (HEAD `25bb2794`)

Verified by reading `apps/web/src/__tests__/touch-target-audit.test.ts` lines 112–245 and extracting all `'file': count` entries via automated parse.

**Total entries in table:** 41 files
**Total violation budget:** 17

**Non-zero entries (all carry documented exemptions):**

| File | Documented count | Exemption rationale |
|---|---|---|
| `components/image-manager.tsx` | 1 | batchAddButton line ~328 `size="sm"` no h-11; admin keyboard-primary desktop surface |
| `components/admin-user-manager.tsx` | 2 | "Add admin" button + per-row delete icon; same rationale |
| `components/admin-header.tsx` | 1 | Logout link rendered as `size="sm"` Button |
| `app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx` | 5 | Five quick-action + retry buttons on desktop-priority surface |
| `app/[locale]/admin/(protected)/categories/topic-manager.tsx` | 3 | Back arrow + per-row edit/delete |
| `app/[locale]/admin/(protected)/tags/tag-manager.tsx` | 3 | Back arrow + per-row edit/delete |
| `app/[locale]/admin/(protected)/settings/settings-client.tsx` | 1 | Single back-arrow `size="icon"` |
| `app/[locale]/admin/(protected)/seo/seo-client.tsx` | 1 | Single back-arrow `size="icon"` |
| All other 33 listed files | 0 | Confirmed clean |

**All counts match cycle-3 exactly. No drift.** No render-path changes in this cycle's commits, so no new scan results are possible.

### 3.2 Scanner infrastructure status

Scanner features carried forward (all verified in cycle-3, unchanged):
- SCAN_ROOTS: `components/`, `app/[locale]/admin/`, `app/[locale]/(public)/`
- FORBIDDEN patterns: `<Button size="sm"/"icon">` without ≥44 px override (belt-and-braces); h-8/h-9/h-10 literals; min-h-[<44px] arbitrary; `<Badge asChild>`; `<select>`; `<Link>`/`<a>`; scale tokens h-1..10/size-1..10/min-h-1..10 on all tag classes
- `normalizeMultilineButtonTags`: Prettier multi-line JSX collapse
- `scanRawCheckboxes`: bare `<input type="checkbox|radio">`
- `max-` lookbehind on all tag classes: ceiling utilities exempt
- `appLevelExtraFiles`: global-error.tsx, error.tsx, not-found.tsx, layout.tsx, loading.tsx

---

## 4. A11y Surface Re-verification

No render-path changes in this cycle. All findings from cycle-3 carry forward with unchanged status. The following is a confirmation checklist, not a fresh audit.

### 4.1 Lightbox (`lightbox.tsx`) — UNCHANGED

- `role="dialog" aria-modal="true" aria-label={t('aria.lightbox')}` — correct
- `FocusTrap` wraps dialog; `closeButtonRef.current?.focus()` on mount; `previouslyFocusedRef.current.focus()` on unmount — correct
- Close (h-11 w-11), Fullscreen (h-11 w-11), Slideshow (h-11 w-11), prev/next (full-height w-16 hit zones) — all ≥ 44 px
- `aria-pressed={isSlideshowActive}`, `aria-keyshortcuts` on all keyboard-shortcut buttons
- Photo counter: `role="status" aria-live="polite" aria-atomic="true"` — correct
- Slideshow live region: `aria-live="polite"` sr-only div for state change announcements
- Controls hidden with `aria-hidden: true` only after `:focus-visible` check prevents hiding a focused element

### 4.2 Search dialog (`search.tsx`) — UNCHANGED

- Trigger: `aria-haspopup="dialog" aria-expanded={isOpen}` — correct
- Dialog: `role="dialog" aria-modal="true" aria-label={t('aria.searchPhotos')}` — correct
- `FocusTrap` with `initialFocus: '#search-input'`, `fallbackFocus: '#search-dialog'`
- Input: `role="combobox" aria-autocomplete="list" aria-controls aria-expanded aria-activedescendant` — full combobox ARIA pattern
- Results: `id="search-results" role="listbox"`, each result `role="option" aria-selected={idx === activeIndex}`
- IME composition guard on Escape/Arrow/Enter
- Live region: `aria-live="polite" aria-atomic="true"` for result count/status
- Focus restoration: `wasOpenRef` pattern + `requestAnimationFrame(() => triggerRef.current?.focus())`
- DEF-C11-01: Input `h-8` (32 px) — deferred, excluded from scope by design. No change.

### 4.3 Info bottom-sheet (`info-bottom-sheet.tsx`) — UNCHANGED

- `role="dialog" aria-modal="true" aria-label={t('viewer.bottomSheet')}` — correct
- `FocusTrap` with `initialFocus: () => closeButtonRef.current ?? dragHandleRef.current ?? false`
- `returnFocusOnDeactivate` default `true` in focus-trap-react — correct; bottom-sheet defers to library default for focus restoration
- `allowOutsideClick: true` — correct; lightbox background clicks should propagate
- Drag handle: `min-h-11 w-full` (44 px ✓), `aria-expanded`, `aria-label` — correct
- Close button: `min-h-11 min-w-11` (44 px ✓), `aria-label={t('aria.close')}` — correct
- Download button: `min-h-11` (44 px ✓); DropdownMenuTrigger: `min-h-11`; DropdownMenuItem: `min-h-11 py-2` — all compliant

### 4.4 ColorDetailsSection accordion (`color-details-section.tsx`) — UNCHANGED

- Accordion toggle button: `aria-expanded={showColorDetails} aria-controls={colorDetailsId}` + native `<button>` — correct
- Content region: `id={colorDetailsId}` matches `aria-controls` — correct
- Toggle button: `min-h-[44px] flex-1` (44 px ✓)
- Calibration tooltip trigger: `min-h-[44px] min-w-[44px]` (44 px ✓), `aria-label` — correct
- Copy button: `min-h-[44px] min-w-[44px]` (44 px ✓), `aria-label` — correct
- DCI-P3 tooltip trigger: `min-h-11 min-w-11` (44 px ✓), `aria-label` — correct
- HDR badge: `isAdmin && isHdr` gate (AGG-M3) — correct; `role="img" aria-label={t('viewer.hdrBadgeAriaLabel')}` — correct

### 4.5 LightboxColorPip (`lightbox-color-pip.tsx`) — UNCHANGED

- Pip button: `min-h-11` (44 px ✓), `aria-expanded={open}`, composite `aria-label` with primaries/transfer/HDR tokens — correct
- HDR badge in pip: `isAdmin && isHdr` gate (AGG-M3), `aria-hidden="true"` (decorative in composite label context) — correct
- DCI-P3 tooltip trigger: `min-h-11 min-w-11` (44 px ✓), `aria-label` — correct
- Histogram cycle button: `min-h-11 min-w-11` (44 px ✓) — compliant
- Close button (if present): `min-h-11 min-w-11` — compliant

### 4.6 WideGamutHint (`wide-gamut-hint.tsx`) — UNCHANGED

- `role="status" aria-live="polite" aria-atomic="true"` — correct per R16-L4
- Dismiss button: `min-h-11 min-w-11` (44 px ✓), `aria-label={t('viewer.wideGamutHintDismiss')}` — correct
- Display gated by `useDisplayCapability` (not raw matchMedia) — correct per R9-R1
- Firefox always-false `(color-gamut: p3)` MQ handled correctly via conservative `'srgb'` fallback
- Dismiss keyed by `gamutFamily` per R13-M2; sessionStorage for `/p/[id]`, localStorage 30-day TTL for share routes

---

## 5. Color/HDR Display Gating

All color/HDR display-gating logic unchanged. Confirmed in prior cycles; no code touched in this cycle.

- `isNonTrivialColor` in bottom-sheet: `isWideGamutPrimary(color_primaries) || (isAdmin && (tf === 'pq' || tf === 'hlg'))` — correct
- P3 gamut badge: `gamut-p3-badge` class, conditional on `isNonTrivialColor`
- HDR badge: double-gated at `isAdmin && isHdr` everywhere (lightbox pip, color-details-section, bottom-sheet) — AGG-M3 invariant holds

---

## 6. Scope Boundary Confirmation

- Zero component files changed under SCAN_ROOTS since `c6eff919`
- Zero new admin route pages added
- Zero new public route pages added
- Zero i18n message keys added or removed
- The only source files touched: `apps/web/src/lib/color-detection.ts` (comments), `apps/web/src/lib/settings-hash.ts` (type guard), `apps/web/public/sw.js` (stamp), `.context/` and `CLAUDE.md` (docs)

---

## Summary

**i18n parity:** en.json = ko.json = **842 keys**, zero asymmetry.

**KNOWN_VIOLATIONS:** 41 entries, total budget 17, all non-zero entries are documented admin-keyboard-primary exemptions unchanged since cycle-3.

**A11y surfaces:** All clean. Lightbox, search dialog, info bottom-sheet, ColorDetailsSection accordion, LightboxColorPip, WideGamutHint — ARIA roles, focus management, touch targets, live regions, HDR/gamut gating all verified correct and unchanged.

**Deferred:** DEF-C11-01 (search Input h-8) carried forward, no new evidence.

---

## NEW Findings by Severity

**CRITICAL:** 0
**HIGH:** 0
**MEDIUM:** 0
**LOW:** 0

**VERDICT: ZERO new actionable findings.** The delta since cycle-3 HEAD `c6eff919` contains zero render-path changes. The UI surface is structurally identical to cycle-3. All prior verifications carry forward. This is the fourth consecutive designer cycle at zero findings — convergence confirmed.
