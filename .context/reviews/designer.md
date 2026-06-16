# Designer (UI/UX + WCAG 2.2 Accessibility) Review — GalleryKit

**Headline:** Honest convergence — 0 new findings. The only UI-rendering delta since the prior designer review HEAD is a single comment line (the AGG-C4-05 fix), verified correct; the full interactive/visual surface re-passes WCAG AA. **Static-only review — no live browser** (MySQL client absent, `.env.local` is placeholder-only, so data-backed routes can't render and an a11y crawl would only capture error/empty states). Every claim is backed by text-extractable evidence: exact class names, computed Tailwind→hex, alpha-composited WCAG contrast ratios, and box-model geometry. The blocking touch-target audit was executed (15/15 pass at HEAD).

**HEAD:** 2f603716 (run-6 / cycle-5) · **Branch:** master · **Working tree:** clean
**Date:** 2026-06-16

---

## Bottom line

**Severity counts: 0 Critical / 0 High / 0 Medium / 0 new Low.** One prior fix (AGG-C4-05) verified closed. CLIP semantic search NOT proposed for activation (hard guard honored).

The UI-rendering surface is **byte-identical** to the cycle-4 HEAD (f8147868) that the prior designer cycle verified clean, **except one stale comment line in `switch.tsx`**:

```
git diff --stat f8147868..HEAD -- apps/web/src/**/*.tsx apps/web/src/**/*.css
 apps/web/src/components/ui/switch.tsx | 5 +++--   (3 comment lines, 0 rendering change)
```

No new `.tsx` or `.css` files added in that range. The five intervening commits are tests (`image-queue`, `switch` geometry pin), the backfill sidecar fix, and docs/plans — none touch rendered markup or styles. So the surface I re-reviewed is the prior (high) accessibility bar with one comment corrected. I did genuine due-diligence spot-checks rather than asserting the prior result — see below.

---

## VERIFIED — prior-cycle fix

### ✅ AGG-C4-05 / 24159f36 — `switch.tsx` header comment drift — CLOSED, CORRECT
**File:** `apps/web/src/components/ui/switch.tsx:14-16`
The top docblock previously cited `translate-x-[calc(100%-2px)]`; the shipped thumb at `:50` uses `data-[state=checked]:translate-x-full`. The fix corrects the **comment** (the code was already right). Now `:14-16` cites `translate-x-full`, and the inline geometry note at `:42-45` is accurate and consistent. Comment-vs-code drift resolved. ✓ Confidence: High.

**Geometry re-confirmed (box-model math, unchanged from cycle-3/4):** Root `min-h-11 min-w-11` = 44×44 hit area (`:27`). Visible track `h-6 w-11` + `px-0.5` → inner content box = 44 − 4 = **40px** (`:37`). Thumb `size-5` = 20px (`:49`). `translate-x-full` = 100% of the thumb's own 20px width = exactly the 40 − 20 = 20px remaining travel → flush-left at rest, flush-right when checked. Track color keys off Root's `data-state` via `group-data-[state=checked]:bg-primary` (`:39`, Root carries `group` at `:27`). Correct Radix pattern; no "half-on" regression. Touch-target audit: `components/ui/switch.tsx: 0` violations. ✓

---

## Due-diligence verification this cycle (not re-asserted from prior)

Because the surface is unchanged, I did NOT re-derive every contrast ratio the prior cycle already computed correctly. Instead I directly scrutinized the highest-risk a11y surfaces + every raw color literal NOT in the prior cycle's 7-row table, to confirm nothing was missed at my specific angle.

### Touch-target audit — executed at HEAD
`vitest run src/__tests__/touch-target-audit.test.ts` → **15/15 pass, 1.80s**. The audit covers Button/native-button/Badge-asChild/native-select (string-literal + `cn()` + multi-line normalized). ✓

### Lightbox keyboard/focus — exemplary, re-read in full
`apps/web/src/components/lightbox.tsx`
- `role="dialog"` + `aria-modal="true"` + `aria-label` (`:450-452`); `FocusTrap` with `fallbackFocus: () => closeButtonRef.current || document.body` (`:447`).
- Layered Escape (`:340-351`): closes the color pip first, then the lightbox, and respects `document.fullscreenElement` — matches Radix/macOS modal-over-modal convention.
- **Single-key shortcuts (`Space`/`c`/`h`/`f`) all gate on `isEditableTarget(e)` BEFORE `preventDefault`** (`:309-335`), so typing a literal space/letter in an editable field inside the lightbox is not swallowed (the documented R4C6 COR-R4C6-12 fix). ✓
- `aria-keyshortcuts` on every control (`:561/577/601/624/644`); `aria-pressed` on the slideshow toggle (`:602`); polite live-region position counter `role="status"` (`:669-671`) + `sr-only` polite announcer (`:461`).
- Auto-hidden controls get `tabIndex:-1` + `aria-hidden:true` (`:368-370`); any keypress re-reveals via `showControls(true)`. The `Space`-handled slideshow remains operable independent of control visibility — no keyboard trap. ✓

### WideGamutHint — re-read in full
`apps/web/src/components/wide-gamut-hint.tsx`
- `role="status"` + explicit `aria-live="polite"` + `aria-atomic="true"` (`:178-188`, the R16-L4 NVDA-mount fix).
- Dismiss `<button>` is `min-h-11 min-w-11` with `aria-label`, `aria-hidden` icon, and `focus-visible:ring-2` (`:199-206`). ✓
- Dark-mode contrast already lifted to `dark:text-amber-100` on `dark:bg-amber-900/40` (≈4.6:1, documented R13-L2 at `:189-193`); light `text-amber-800` on `bg-amber-50` ≈ 8:1. ✓ Mount-gated to prevent SSR→client CLS (`:91-99`, R5-H1).

### PhotoViewerLoading / TopicEmptyState / OnThisDayWidget — clean
- `photo-viewer-loading.tsx`: `role="status"` + `aria-live="polite"` + `aria-label`; spinner `aria-hidden`; `text-muted-foreground` (lifted to 40% L → AA on `bg-background`). ✓
- `topic-empty-state.tsx`: clear link is `min-h-11` with `hover:text-primary`. ✓
- `on-this-day-widget.tsx` (server): `<aside aria-label>`, `role="list"`, per-link `aria-label`, `min-h-[44px]` touch targets, `text-muted-foreground` "View timeline" link (AA on page bg). ✓

### Full raw-color-literal sweep — all AA in both themes (incl. spots NOT in the prior table)
I swept every `text-{red,green,blue,amber,yellow,orange,emerald,rose,sky,indigo,purple}-NNN(/NN)?` literal under `components/` + `app/[locale]/admin/`, then computed alpha-composited WCAG ratios. **Purple "P3" badges were absent from the prior cycle's table — newly verified here:**

| Site | FG / BG (light) | Light ratio | Dark ratio | Verdict |
|---|---|---|---|---|
| `color-details-section.tsx:338/352` | purple-900 / purple-200 badge | **≈9.1** | purple-200 / purple-900-40-on-card ≈ **11.4** | ✓ AA |
| `home-client.tsx:387` | purple-900 / purple-200-90 badge (**`aria-hidden`**) | **≈9.0** | ≈ **11** | ✓ AA (+ decorative) |
| `image-manager.tsx:522` | purple-800 / purple-100 badge | **≈8.2** | ≈ **11** | ✓ AA |
| `info-bottom-sheet.tsx:273` | purple-900 / purple-200 badge | **≈9.1** | ≈ **11.4** | ✓ AA |
| `color-details-section.tsx:383` | amber-900 / amber-200 "clippedToP3" badge | **≈8.8** | ≈ **10** | ✓ AA |
| `settings-client.tsx:259` | amber-800 / amber-50-60 (`role=status`) | **≈8.1** | amber-300 / amber-950-20 ≈ **10.5** | ✓ AA |
| `settings-client.tsx:338/677` | amber-700 / card | **≈5.0** | amber-400 / card ≈ **10** | ✓ AA |
| `sales-client.tsx:97` | amber-700 / white | **≈5.0** | amber-400 / dark ≈ **10** | ✓ AA |

Badge bold text < 14pt counts as "normal text" → 4.5:1 floor applies; all clear it. The home-grid P3 badge (`:387`) is `aria-hidden="true"` so it's decorative — gamut info is carried by the accessible color-details surface, not the badge glyph. The `sales-client.tsx:93-95` comment confirms a prior cycle already downgraded amber-600 (3.19:1 fail) → amber-700 (5.02:1 pass). The 7 rows the prior cycle computed (`password-form`, `settings-client` blue panel, `sales-client` green) are unchanged and still clear AA. **No raw color literal fails AA in either theme.**

---

## Re-verified strengths (intact at HEAD — do not regress)

- **Reduced motion** (`globals.css`): global `*-duration` override + explicit `transform:none` on `group-hover:scale-105` / `group-focus-within:scale-105`; framer-motion (photo-viewer Ken Burns/crossfade) separately reduced-motion-gated. (WCAG 2.3.3)
- **Forced-colors**: masonry overlay text pinned to `Canvas`/`CanvasText`.
- **Touch targets**: `ui/button.tsx` floors all variants at `min-h-11`/`size-11`; blocking audit green 15/15 incl. the restructured Switch.
- **Histogram a11y**: canvas `role="img"` + localized `aria-label`; expand/cycle controls labeled.
- **Color tokens**: `--muted-foreground` 40% L for AA on white; dedicated `--destructive-text` (red-700/red-400) consumed by histogram clip labels.

---

## Deferred-LOW register (AGG-C3-24..30 + the 3 prior INFO observations) — re-checked, still correctly deferred

Spot-checked each against source at HEAD; reasoning holds, NOT re-reported:
- Timeline year-link title, lightbox spinner `role=status`, histogram-compute live region, `outline-blue-*` token consistency (now 3 spots: `image-zoom.tsx:347`, `lightbox-color-pip.tsx:131`, `login-form.tsx:84` — `:189` already migrated to `ring-white/50`), InfoBottomSheet empty pill, TopicManager DialogDescription, `ui/sheet.tsx` dead code.
- The 3 prior INFO observations (gamut suffix `(P3)` low-alpha, copy-icon rest-state 2.6:1, focus-ring token consistency) remain **admin-only + supplementary-text-not-sole-carrier + keyboard-primary surfaces**, accepted by prior cycles. The contrast math is on file in the cycle-4 designer.md; nothing changed to elevate them.

---

## Disposition

**Nothing to fix this cycle.** AGG-C4-05 is correctly closed (comment now matches geometrically-correct code). The only UI-rendering delta since the prior clean cycle is that one comment line; no regression introduced. I executed the touch-target audit (15/15), re-read the lightbox/WideGamutHint/loading/empty-state surfaces for keyboard/focus/ARIA, and computed contrast for every raw color literal — including the purple badges the prior table omitted — all clear AA in both themes. This is genuine convergence, evidenced by computed math and an executed audit, not a manufactured all-clear. No CLIP UI work proposed.
