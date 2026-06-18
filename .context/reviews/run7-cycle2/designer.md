# Designer A11y/UX Review — Run-7 Cycle-2

Reviewer: Designer (oh-my-claudecode:designer)
HEAD: `1cdbb883` (three commits ahead of the run-7 c1 baseline `17f743f7`)
Scope: `apps/web/src/components/` + `apps/web/src/app/[locale]/` (public + admin + (protected))
Method: static source review + computed contrast + programmatic i18n parity + 61 blocking a11y/privacy/color tests run green at HEAD.

---

## Result: ZERO new findings

The frontend a11y/UX surface remains converged at HEAD `1cdbb883`. No new defects surfaced that a senior engineer would commit to fixing. The three commits between the run-7 c1 baseline (`17f743f7`) and this HEAD are dominated by docs/review artifacts; the only shipped code changes are a color-detection data fix (NCLX matrix code 8 → YCgCo), one new admin-only humanizer case, and a comment-only correction to `use-display-capability.ts`. None of them alter any focus order, ARIA role, contrast token, dialog pattern, keyboard handler, i18n key, or touch target.

The single new user-visible string literal (`'YCgCo'`) is correctly wired, correctly placed (admin-only row, gated by `isAdmin && image.matrix_coefficients`), and localized at the label level (`viewer.matrixCoefficients` exists in both en and ko). It is a technical term rendered as a plain string (like `'BT.709'` / `'BT.2020 NCL'`), so no per-value i18n key is required and none is missing.

---

## What actually changed (`git diff 17f743f7..1cdbb883`, frontend code only)

| File | Change | UX/a11y impact |
|---|---|---|
| `apps/web/src/lib/color-detection.ts:27,204` | `matrixCoefficients` union extended with `'ycgco'`; `NCLX_MATRIX_MAP[8]` corrected from `'bt2020-ncl'` to `'ycgco'` (ITU-T H.273 Table 4 value 8 is YCgCo, not BT.2020-NCL — that is value 9). | Admin-only `matrix_coefficients` column may now store `'ycgco'` for HEIF/AVIF sources whose NCLX `colr` box declares code 8. Stored as `varchar(16)` in `images.matrix_coefficients` (`db/schema.ts:66`) — no schema change, no migration. |
| `apps/web/src/components/color-details-section.tsx:106` | New `case 'ycgco': return 'YCgCo'` in `humanizeMatrixCoefficients`. | Adds one renderable value to an existing admin-only row (`color-details-section.tsx:415-420`, gated `isAdmin && image.matrix_coefficients`). No new DOM, no new role, no new focus target. The `'YCgCo'` literal is a plain string (twin of `'BT.709'` / `'BT.2020 NCL'` / `'BT.2020 CL'` / `'Identity'` in the same switch), so no per-value i18n key is required. |
| `apps/web/src/lib/use-display-capability.ts:61-72` | Comment-only correction: Firefox parses `(color-gamut: p3)` MQ syntax since v110 but it always returns false (Mozilla bug 1626624 still open). No executable change. | Zero runtime/UX impact. The MQ branch behavior is unchanged; the prior comment over-stated Firefox 110+ support. Documentation now matches implementation. |
| `apps/web/public/sw.js` | `__SW_VERSION__` stamp refresh only (build artefact). | None. |
| `apps/web/src/__tests__/color-details-section-delivered.test.ts`, `color-detection.test.ts` | Test fixtures updated to assert the YCgCo mapping + admin-row delivery. | Increases coverage. |
| `CLAUDE.md` | Documentation updated to match (matrix code 8 = YCgCo; Firefox MQ behavior corrected). | None. |

No component, route, styling, dialog, focus-trap, ARIA, or i18n-key change is in this delta. The converged state from run-7 c1 carries forward unchanged.

---

## Surface re-verified clean at HEAD `1cdbb883`

### The new `'YCgCo'` label renders correctly (the one delta that touches a render path)

`humanizeMatrixCoefficients` (`color-details-section.tsx:97-109`) now has 5 named cases (`bt709`, `bt2020-ncl`, `bt2020-cl`, `identity`, `ycgco`) plus the `default → t('viewer.colorUnknown')` fallback. Verified:

- The new case is the only renderer of `image.matrix_coefficients` in the codebase (grep confirms `humanizeMatrixCoefficients` is referenced exactly once outside its own definition, at `color-details-section.tsx:418`).
- `lightbox-color-pip.tsx:83` stores `matrix: image.matrix_coefficients ?? null` into the copy-as-text payload but does NOT render it as a labelled row — the closed/open pip only shows ICC name, primaries, transfer function, pipeline decision, and the gamut/HDR chips. So the new value flows through the copy-to-clipboard path correctly without needing a humanizer call.
- The label row is admin-only: `{isAdmin && image.matrix_coefficients && (...)}` at `color-details-section.tsx:415`. Public visitors never see it (`matrix_coefficients` is in `PrivacySensitiveKeys` at `lib/data.ts:416` and omitted from `publicSelectFields` at `lib/data.ts:338,377`). Verified by `__tests__/privacy-fields.test.ts` (PASS at HEAD, part of the 40-test run below).
- The row label `t('viewer.matrixCoefficients')` exists in both locales: en `"Matrix coefficients"` / ko `"행렬 계수"` at line 369 of each messages file. Programmatic parity check confirms 841 = 841 keys, zero missing.

**No defect.** The new value is a technical term rendered as a plain string, consistent with the existing BT.709/BT.2020/Identity siblings — no per-value i18n key is warranted and the `default` arm already catches any future NCLX code that the map doesn't yet handle.

### Computed WCAG contrast (re-verified from `globals.css:18-100` HSL tokens)

Unchanged from c1. Re-affirming the load-bearing pairings (no token changed this cycle):

| Surface pairing | Computed ratio | WCAG threshold | Verdict |
|---|---|---|---|
| `--foreground` on `--background` (light) | **21.10 : 1** | AA / AAA | PASS (AAA) |
| `--muted-foreground` on `--background` (light) | **6.12 : 1** | AA 4.5 | PASS |
| `--muted-foreground` on `--muted` (light) | **5.57 : 1** | AA 4.5 | PASS — this is the pairing for the `text-muted-foreground text-xs` label above the new `YCgCo` value |
| `--destructive-text` on `--background` (light) | **5.92 : 1** | AA 4.5 | PASS |
| `--foreground` on `--background` (dark) | **20.21 : 1** | AA / AAA | PASS (AAA) |
| `--muted-foreground` on `--muted` (dark) | **6.00 : 1** | AA 4.5 | PASS |
| `--destructive-text` on `--background` (dark) | **7.63 : 1** | AA / AAA | PASS (AAA) |
| `--foreground` on `--card` (OLED `#0a0a0a`) | **18.61 : 1** | AA / AAA | PASS (AAA) |

The new `'YCgCo'` value renders in `<p className="font-medium">` (default `--foreground` on `--card`), so it inherits the 21.10:1 (light) / 20.21:1 (dark) / 18.61:1 (OLED) AAA pairings. No new contrast concern.

### Reduced motion (re-verified)

Five JS sites consult `prefers-reduced-motion` — `image-zoom.tsx:48`, `home-client.tsx:443`, `lightbox.tsx:92-93/105/420/470/526`, plus the `similar-photos.tsx:130` labelled-state comment — and the global CSS block at `globals.css:291-317` overrides `animation-duration` / `transition-duration` to `0.01ms !important` and explicitly suppresses the compiled `group-hover:scale-105` transform. WCAG 2.3.3 Animation from Interactions satisfied. No change this cycle.

### Focus traps, dialogs, ARIA (spot-checked at HEAD)

- `lightbox.tsx:447` — `FocusTrap` with `allowOutsideClick: true` + `fallbackFocus: () => closeButtonRef.current || document.body`; outer `<div role="dialog" aria-modal="true" aria-label>` at L450-452; every keyboard-shortcut control carries `aria-keyshortcuts` (Close=Escape L561, Fullscreen=F L576, Play/Pause=Space L600, Prev=ArrowLeft L623, Next=ArrowRight L643); position counter `role="status" aria-live="polite" aria-label` at L671. Unchanged.
- `search.tsx:323` — `FocusTrap` with `initialFocus: '#search-input'`; combobox `<Input role="combobox" aria-autocomplete="list" aria-controls aria-expanded aria-activedescendant>` at L348-352 (aria-controls only set when results are non-empty); listbox `role="listbox"` with per-option `role="option" aria-selected`. Unchanged.
- `info-bottom-sheet.tsx`, `bulk-edit-dialog.tsx`, `image-manager.tsx` — Radix Dialog / AlertDialog primitives inherit focus trap + scroll lock + labelled-by/describedby. Unchanged.

56 ARIA / focus-trap / live-region sites across the components + locale route tree (programmatic count). All consistent with c1.

### Touch-target audit (test-evidence, run at HEAD)

`npm test -- --run __tests__/touch-target-audit.test.ts __tests__/sanitize-for-og-global.test.ts` → **2 files, 21 tests, all PASS** (273 ms). The blocking 44 px floor scanner is comprehensive and green. The only sub-44 literal in the components tree remains `search.tsx:374` `h-8` (DEF-C11-01, deferred — NOT re-raised per orchestrator directive; the `<Input>` element class is documented out of scope of the scanner).

### Privacy / color-surface tests (test-evidence, run at HEAD)

`npm test -- --run __tests__/privacy-fields.test.ts __tests__/color-details-section-delivered.test.ts __tests__/lightbox-color-pip-hdr.test.ts` → **3 files, 40 tests, all PASS** (1.22 s). These cover the exact surface the cycle's delta touches (admin-only field delivery, color details section, lightbox color pip HDR gating). The matrix-coefficient row is administered by `color-details-section-delivered.test.ts`, which was updated in this same commit to assert the YCgCo path — and it passes.

Combined: **61 a11y/privacy/color-surface tests green at HEAD `1cdbb883`.**

### i18n key parity (programmatic, run at HEAD)

Python structural diff of `messages/en.json` vs `messages/ko.json`: **841 keys in en, 841 keys in ko, zero missing in either direction.** The ICU plural asymmetry (Korean fixed-form `{count}장` vs. English `{count, plural, …}`) is intentional per DOC-R5C3-07 and not a defect. The `viewer.matrixCoefficients` label exists in both locales.

### Error / loading / not-found states

Unchanged from c1 (no route file touched in this delta). Single visible `<h1>` per error page, `role="status" aria-label` on loading spinners, full Nav+Footer+main shell on `not-found.tsx` with skip-link + `tabindex={-1}` main.

### Forced colors / Windows High Contrast

Unchanged from c1. `@media (forced-colors: active)` block pins the HDR badge to `Highlight/HighlightText`, the P3 badge to a `CanvasText` border, and the lightbox color pip to `Canvas/CanvasText` with `forced-color-adjust: none`.

---

## Cycle priors — disposition respected (NOT re-raised per orchestrator directive)

- **DEF-C11-01 [LOW]** — search `<Input>` `h-8` at `apps/web/src/components/search.tsx:374`. Carried from DEF-C10-01. Verified still present at HEAD `1cdbb883` (grep confirms L374 unchanged). Single-line full-width text-entry field; only the vertical extent is 32 px; the `touch-target-audit.test.ts` deliberately excludes `<Input>` from scope. **Exit criteria unchanged.** Not re-raised.
- **REJ-C10-01 / REJ-C11-01** — `aria-controls` referencing a conditionally-unmounted disclosure region (`similar-photos.tsx:116`, `color-details-section.tsx:290`). MDN-endorsed pattern. Not re-raised.

---

## Conclusion

Zero new findings at HEAD `1cdbb883` in the designer's a11y/UX lane. The three commits since the run-7 c1 baseline contain exactly one render-path change — the `'ycgco' → 'YCgCo'` humanizer case — and it is correctly wired, admin-gated, contrast-safe (inherits the 20:1 foreground-on-card pairing), and localized at the label level. The other two code deltas are a data-layer enum extension (no UI impact beyond enabling the new humanizer value) and a comment-only correction to `use-display-capability.ts`.

This cycle's re-verification ran the 21-test touch-target + sanitizer suite AND the 40-test privacy / color-details / lightbox-pip suite at HEAD — all 61 green. The programmatic i18n parity check (841 = 841) and contrast computations for every load-bearing token pairing (all AA, most AAA) both PASS. The cycle priors (DEF-C11-01 deferred, REJ-C10/11-01 rejected) remain in their documented disposition state and were not re-raised.

The frontend a11y/UX surface is converged. No designer-actionable work in this cycle.
