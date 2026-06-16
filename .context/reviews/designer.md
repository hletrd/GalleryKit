# Designer (UI/UX + WCAG 2.2 Accessibility) Review — GalleryKit

**HEAD:** `4eb83aab` · **Agent:** designer · **Date:** 2026-06-17 · **Branch:** master · **Working tree:** clean (only `.context/reviews/*` + `plan/*` staged)
**Mode:** **Static source review.** No live browser — MySQL client absent + `apps/web/.env.local` is the placeholder example, so data-backed routes (`/`, `/p/[id]`, `/g`, `/s`, admin) cannot render. I did not attempt to boot `npm run dev` for data routes. Every claim below is text-extractable: exact file+line, Tailwind class → hex, alpha-composited WCAG ratios computed with the sRGB relative-luminance formula, ARIA roles, and box geometry. The one blocking visual gate I CAN run headless — the touch-target audit — was executed at HEAD (15/15 pass).

**Severity counts: 0 Critical / 0 High / 1 Medium / 0 Low.**

The single Medium is a **real, deterministic WCAG 1.4.3 (Contrast Minimum, AA) failure** on the visible "HDR" badge glyph: **white text on a light amber→orange gradient = 1.44:1–2.26:1** where the 4.5:1 normal-text floor applies. Present at **four admin-only render sites**. It is a **pre-existing latent defect** (introduced 2026-05-08 by `e444f30e`, mislabeled a "contrast bump"), **not a regression introduced this cycle** — the UI surface is byte-identical to the last clean baseline. I verified the math independently rather than inheriting the prior cycle's number. The rest of the interactive/visual surface re-passes AA in both themes and is clean on keyboard / focus / ARIA / reduced-motion / forced-colors.

---

## UI delta since the last clean baseline

Prior clean designer baseline = HEAD `2f603716` (cycle-5). At my angle:

```
git diff --stat 2f603716..4eb83aab -- 'src/**/*.tsx' 'src/**/*.css' 'messages/'
 (empty — ZERO UI-rendering files changed)
```

Widening to the cycle-4 base `f8147868..4eb83aab`, the only `.tsx`/`.css` change is `src/components/ui/switch.tsx` (+5/−? lines — the thumb-travel + comment fix already verified in cycles 4–5) plus its new `switch-geometry-contract.test.ts`. **No `messages/` (i18n) change, no `globals.css` change, no other component change.** So the rendered UI is byte-identical to the cycle-5 clean baseline.

**Consequence:** the Medium below is NOT something this cycle's commits introduced. It is a latent defect that has shipped since `e444f30e` and was carried through every cycle as "shipped / high-contrast" without anyone running the contrast calculator on a *gradient* background. I re-derived it at my angle and it survives skeptical scrutiny.

---

## MEDIUM

### DES-C6-M1 — HDR badge: white glyph on light amber→orange gradient fails WCAG 1.4.3 (AA), 1.44:1, four sites

**WCAG:** 1.4.3 Contrast (Minimum), Level AA. The text is `text-xs` (12px) or `text-[10px]` (10px) `font-bold`. Bold does **not** promote 10–12px to WCAG "large text" (large = ≥18.66px bold / ≥24px regular), so the **4.5:1 normal-text floor applies** — not 3:1.

**Measured 1.44:1 (left gradient stop) → 2.26:1 (right stop).** Severe, not borderline.

**Four sites, all carrying the identical failing class `bg-gradient-to-r from-amber-300 to-orange-400 text-white` (grep-exact at HEAD):**

| # | File:line | Surface | Render gate | ARIA on glyph | AT impact | Sighted impact |
|---|---|---|---|---|---|---|
| 1 | `src/components/color-details-section.tsx:526` | Photo-viewer sidebar accordion | `isAdmin && isHdr` | `role="img"` + `aria-label` + `title` | none (label wins) | low-contrast glyph |
| 2 | `src/components/lightbox-color-pip.tsx:151` | Lightbox closed-pip chip row | `isAdmin && isHdr` | `aria-hidden="true"` (label on parent button) | none (hidden) | low-contrast glyph |
| 3 | `src/components/info-bottom-sheet.tsx:278` | Mobile peek-state color chip | `isAdmin && (pq\|hlg)` | **none** | **glyph IS the only label** | low-contrast glyph |
| 4 | `src/components/image-manager.tsx:526` | Admin image-table gamut cell | `image.is_hdr` (admin page) | **none** | **glyph IS the only label** | low-contrast glyph |

**Independent contrast evidence** (sRGB relative-luminance per WCAG; Tailwind **v3.4.19** confirmed, which interpolates `bg-gradient-*` in **sRGB** — NOT oklab — so the geometric-midpoint math is the right model; v4's oklab interpolation does not apply here):

```
Tailwind v3 palette:  amber-300 #fcd34d   orange-400 #fb923c
Left  stop amber-300 #fcd34d  vs white = 1.44:1
Mid   (t=.5) #fcb345          vs white = 1.80:1
Right stop orange-400 #fb923c vs white = 2.26:1     ← every stop far below the 4.5:1 floor
```

No `text-shadow`/`drop-shadow` rescues the glyph. `globals.css` `.hdr-badge` (`:195-220`) sets only `display` + a `forced-colors` override (`background: Highlight; color: HighlightText` — correct for Windows HC mode and unaffected by this finding). `shadow-sm` on each span is a **box**-shadow, not a text-shadow — it does nothing for glyph legibility.

**Why this is a real defect, not a nitpick:**
- **Git-confirmed regression lineage.** `e444f30e` (2026-05-08, "feat(ui): ✨ restyle HDR badge with gradient, white text, shadow (P3-15)") replaced a passing `bg-amber-100 text-amber-700` (≈4.5:1) with the failing white-on-light-gradient. The cycle-2 RPF log recorded it as "P3-15 | HDR badge contrast bump | Shipped." The "bump" inverted the contrast. Every later reference ("high-contrast amber gradient") inherited that label and never re-measured.
- **WCAG 1.4.3 applies to visually presented text regardless of ARIA role.** `role="img"` / `aria-hidden` exempts the glyph from the *accessible-name* computation but NOT from the *visual-contrast* obligation. Sites 3 and 4 have **no** ARIA wrapper at all — the failing glyph is the sole label a sighted admin reads.
- **The badge is the audit signal** that the source carries a PQ/HLG transfer the SDR pipeline will not pass through (WI-09 honesty surface). A label a sighted admin can't read defeats the exact purpose the surface exists for — and it's hardest to read on the amber-300 left edge (1.44:1) where the text starts.
- **Admin-scoped, no public leak (verified):** all four spans gate on `isAdmin`/admin-page context, and `force_show_color_chips` only flips `.hdr-badge` `display` — it does not remove the `isAdmin` JSX gate. Confirmed.

**Secondary observation (not a separate finding, note for the fixer):** the four sites are inconsistently gated by the `.hdr-badge` CSS class. Sites 1 and 2 carry `hdr-badge` (so `globals.css:195` `display:none` hides them unless `@media (dynamic-range: high)` or the force toggle), while sites 3 and 4 do **not** carry the class and render whenever their JSX condition is true. This means sites 3 (mobile peek) and 4 (admin table) are the ones a sighted admin most reliably sees the low-contrast glyph on, on any display. Not worth a code change on its own, but it raises the practical exposure of the contrast bug above "HDR-display-only."

**Fix (trivial, preserves the gradient aesthetic — swap white → dark text at all four sites):**

```diff
- ...bg-gradient-to-r from-amber-300 to-orange-400 text-white...
+ ...bg-gradient-to-r from-amber-300 to-orange-400 text-amber-950...
```

Verified worst-stop ratios for candidate dark colors (worst stop = orange-400 right edge):

```
text-amber-950 #451a03 → left 10.39 / mid 8.33 / right 6.62  → WORST 6.62  PASS (AA normal)
text-orange-950 #431407 → left 10.85 / mid 8.70 / right 6.92 → WORST 6.92  PASS
text-black             → left 14.56 / mid 11.67 / right 9.28 → WORST 9.28  PASS
text-amber-900 #78350f → left  6.29 / mid 5.04 / right 4.01  → WORST 4.01  ✗ FAIL — do NOT use
```

> **Pin:** use `text-amber-950` (or `text-orange-950` / `text-black`). **Do NOT use `text-amber-900`** — its orange-400 stop is **4.01:1 < 4.5**. The `forced-colors` rule at `globals.css:204-209` already overrides color to `HighlightText` in Windows HC mode, so the dark text only applies in normal color modes — no HC regression.

To stop this from silently regressing through another 5 cycles (the exact way it slipped), add a one-line fixture that asserts white-vs-`orange-400` fails 4.5:1 and the chosen dark color passes — analogous to `switch-geometry-contract.test.ts`. The defect persisted precisely because no test put the gradient through the calculator.

**Confidence: High.** Ratios are deterministic sRGB math (independently recomputed, not inherited); the four occurrences are grep-exact at HEAD; the regression lineage is git-confirmed; Tailwind-v3 sRGB-interpolation assumption verified against `package.json`.

---

## Verified clean this cycle (re-derived at my angle, not re-asserted)

**Touch-target audit — executed at HEAD `4eb83aab`:** `vitest run src/__tests__/touch-target-audit.test.ts` → **15/15 pass, 214ms.** The blocking 44×44px gate is green. Covers Button / native `<button>` / `Badge asChild` / native `<select>` (string-literal + `cn()` composite + multi-line-normalized).

**Targeted contrast sweep — the HDR badge is the ONLY offender:** `grep text-white` across `src/components/` + `src/app/[locale]/admin/` intersected with light backgrounds/gradients (`from-amber|yellow|orange|lime|green-1xx|white|slate-1xx|...`) returns the four HDR-badge lines and **nothing else**. The defect is isolated; there is no second white-on-light surface hiding elsewhere.

**`--destructive-text` token (keystone of the recent error-text a11y fixes) — AA in all themes** (HSL→sRGB, computed):
- Light `0 73.7% 41.8%` = `#b91c1c` on white card = **6.47:1** PASS
- Dark `0 90.6% 70.8%` = `#f87171` on `#0a0a0a` bg = **7.19:1** PASS
- OLED on `#0a0a0a` card = **7.16:1** PASS

So histogram clip labels (`histogram.tsx:671,674` `text-destructive-text`, recent fix `60c54346`), login/upload/password error text, and the error boundaries are all sound. The histogram sRGB-clipped hint (`:608` `text-amber-700 dark:text-amber-300`) re-passes AA in both themes.

**`switch.tsx` — geometry + comment correct:** Root `min-h-11 min-w-11` (44px hit area); visible track `h-6 w-11` + `px-0.5` → 40px inner; thumb `size-5` (20px); `data-[state=checked]:translate-x-full` = 20px travel = flush-left ↔ flush-right. Comment at `:42-45` matches code at `:50`. Pinned by `switch-geometry-contract.test.ts`. The unchecked track relies on `bg-input` + the thumb's `shadow-lg` boundary (shadcn standard, graphical-object 1.4.11) — not a regression. ✓

**Reduced-motion (WCAG 2.3.3) — thorough:** `globals.css:291-317` zeroes animation/transition durations globally AND specifically suppresses the `group-hover:scale-105` / `group-focus-within:scale-105` photo-card transform entirely (`:313-316`) so vestibular-sensitive users get no instantaneous scale snap, while leaving the ImageZoom (inline-ref transform) working. Ken Burns slideshow keyframes (`:281-289`) are covered by the duration override. ✓

**Forced-colors (Windows HC) — thorough:** `.hdr-badge`, `.gamut-p3-badge`, `.lightbox-color-pip` (`:203-220`) and masonry card text overlays (`:327-337`) all pin to system `Canvas`/`CanvasText`/`Highlight` pairs with `forced-color-adjust: none` and suppress gradients that would otherwise flatten to an illegible system color. ✓

**Lightbox / pip / color-details / wide-gamut-hint — keyboard, focus, ARIA, contrast:** re-read at HEAD; unchanged from the cycle-5 clean baseline and consistent with the documented audit-surface contract (role="dialog"+aria-modal+FocusTrap+layered Escape+aria-keyshortcuts in lightbox; `aria-expanded`/`aria-controls`+44px full-row toggle in color-details; `role="status"`+`aria-live="polite"` in WideGamutHint; purple P3 badges ≈9:1 both themes; amber clip badge ≈8.8:1). Only the gradient HDR badge fails. ✓

---

## Hard guards honored

- Did **not** propose `import 'server-only'` on `@/db` (not my area; tracked as AGG-C5-01 by architect).
- Did **not** propose activating CLIP/semantic search.
- Re-checked the cycle-1..5 deferred UI register (AGG-C3-24..30: timeline year-link `title`, lightbox spinner role, histogram-compute live region, `outline-blue-*` token inconsistency, InfoBottomSheet empty pill, TopicManager DialogDescription, `ui/sheet.tsx` dead code). Reasoning holds at HEAD; **not re-reported.**

---

## Disposition

**One Medium to fix: DES-C6-M1** — change `text-white` → `text-amber-950` on the four HDR-badge spans (`color-details-section.tsx:526`, `lightbox-color-pip.tsx:151`, `info-bottom-sheet.tsx:278`, `image-manager.tsx:526`), and add a worst-stop contrast fixture so it can't regress again. It is a genuine, independently-quantified WCAG 1.4.3 AA failure (1.44:1) on visible functional text — admin-scoped and AT-safe on two of the four sites, but a clear measurable defect that was mislabeled a "contrast bump" and slipped through 5+ cycles unmeasured.

This is a latent carry-forward, not a fresh regression: the UI surface is byte-identical to the cycle-5 clean baseline. The honest convergence call held for everything that was ever *measured*; the gradient badge is the one surface no prior cycle put through the calculator. Everything else re-passes AA in both themes, the touch-target audit is 15/15 green, and the lightbox / forms / error / settings / histogram / switch surfaces are clean on keyboard, focus, ARIA, reduced-motion, and forced-colors.
