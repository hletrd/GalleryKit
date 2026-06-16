# Designer (UI/UX + WCAG 2.2 Accessibility) Review — GalleryKit

**HEAD:** `a7758ef0` · **Agent:** designer · **Cycle:** run-6 cycle-7 · **Date:** 2026-06-17 · **Branch:** master · **Working tree:** clean
**Mode:** **Static source review** + executable a11y gates. MySQL client absent + `apps/web/.env.local` is the placeholder example, so data-backed routes (`/`, `/p/[id]`, `/g`, `/s`, admin) cannot render; I did not boot `npm run dev` for data routes. Every contrast claim below is recomputed independently with the WCAG sRGB relative-luminance formula (not inherited from prior cycles or commit messages). The two blocking visual gates I CAN run headless — the touch-target audit and the new HDR-badge contrast fixture — were executed at HEAD (27/27 pass).

## Severity counts: 0 Critical / 0 High / 0 Medium / 0 Low — ZERO findings.

**This is the expected convergence outcome.** The cycle-6 Medium (DES-C6-M1, HDR badge `text-white` on amber→orange gradient = 1.44:1) was fixed in `5af25dc7` and the fix is **independently verified to meet WCAG 1.4.3 AA at every gradient stop** (worst stop 6.62:1). The fix is now locked by a non-vacuous regression fixture. No other AA failure, focus trap, keyboard-inaccessible control, missing accessible name, or sub-44 px touch target exists at HEAD. The findings trend across this run is now **11 → 45 → 14 → 5 → 1 → 2 → 0.**

---

## UI delta since the last clean baseline (exact scope)

```
git diff --stat 2f603716..a7758ef0 -- 'src/**/*.tsx' 'src/**/*.css' 'messages/'
  color-details-section.tsx | 2 +-
  image-manager.tsx         | 2 +-
  info-bottom-sheet.tsx     | 2 +-
  lightbox-color-pip.tsx    | 2 +-
  4 files changed, 4 insertions(+), 4 deletions(-)
```

`2f603716` was the cycle-5 clean designer baseline. The **only** UI-rendering change since then is the four one-token HDR-badge color swaps (`text-white` → `text-amber-950`) from `5af25dc7`. The other two commits since the cycle-6 baseline `4eb83aab` are `204e8594` (a test-only boundary-classifier follow-up — not UI) and `a7758ef0` (docs). **No globals.css change, no `messages/` (i18n) change, no new component, no new interactive element, no new gradient.** The rendered UI surface is therefore byte-identical to the cycle-5 clean baseline except for the now-fixed HDR badge text color. There is no new surface to audit beyond confirming the fix.

---

## DES-C6-M1 (HDR badge contrast) — VERIFIED FIXED, now AA-compliant + test-locked

**Cycle-6 finding:** `text-white` on `bg-gradient-to-r from-amber-300 to-orange-400` measured 1.44:1 (light stop) / 2.26:1 (right stop), failing WCAG 1.4.3 (Contrast Minimum, AA) for the 10–12 px bold glyph (not "large text", so the 4.5:1 floor applies). Four sites.

**Fix at HEAD:** all four sites carry `text-amber-950` (grep-exact; zero `text-white` on this gradient remains):

| File:line | Surface | Class at HEAD |
|---|---|---|
| `src/components/color-details-section.tsx:526` | Photo-viewer sidebar accordion | `hdr-badge … from-amber-300 to-orange-400 text-amber-950 …` |
| `src/components/lightbox-color-pip.tsx:151` | Lightbox closed-pip chip row | `hdr-badge … from-amber-300 to-orange-400 text-amber-950 …` |
| `src/components/info-bottom-sheet.tsx:278` | Mobile peek-state color chip | `… from-amber-300 to-orange-400 text-amber-950 …` |
| `src/components/image-manager.tsx:526` | Admin image-table gamut cell | `… from-amber-300 to-orange-400 text-amber-950 …` |

**Independent contrast verification (WCAG sRGB luminance; Tailwind `^3.4.19` confirmed → sRGB gradient interpolation, so the worst-stop midpoint model is correct, not v4 oklab):**

```
Gradient: amber-300 #fcd34d → orange-400 #fb923c   (sRGB midpoint #fcb345)

text-amber-950 #451a03 (THE FIX):
  vs amber-300 (left)   : 10.39:1  PASS
  vs midpoint           :  8.33:1  PASS
  vs orange-400 (right) :  6.62:1  PASS  ← worst stop, still 47% above the 4.5:1 floor

text-white (OLD failing value, for reference):
  vs amber-300  : 1.44:1  FAIL
  vs orange-400 : 2.26:1  FAIL

text-amber-900 #78350f (explicitly avoided in the fix):
  vs orange-400 : 4.01:1  FAIL  ← correctly NOT used
```

The fix clears AA at the worst gradient stop with comfortable margin and correctly avoided `text-amber-900` (which would still fail at 4.01:1). **DES-C6-M1 is genuinely closed.**

**Regression guard verified non-vacuous:** `src/__tests__/hdr-badge-contrast.test.ts` (added in the same commit) inspects all four components and asserts, per site: (1) the gradient is present (non-vacuity — a refactor that removes the badge fails this rather than silently passing), (2) the gradient class does NOT contain `text-white` (negative pin), (3) it DOES contain `text-amber-950` and NOT `text-amber-900` (positive pin). This is exactly the gradient-background blind-spot test that was missing for 5+ cycles. **Executed at HEAD: 12/12 pass.** This was the precise mechanism by which the defect slipped; it can no longer regress silently.

**Forced-colors interaction confirmed safe:** `globals.css:203-206` `.hdr-badge { background: Highlight; color: HighlightText }` under `@media (forced-colors: active)` still overrides the inline `text-amber-950` in Windows HC mode, so the dark text only applies in normal color modes. No HC regression from the fix.

---

## Re-verified clean at HEAD (recomputed at my angle, not re-asserted)

**Blocking gates executed (`vitest run`, root `node_modules/.bin/vitest`):**
- `touch-target-audit.test.ts` → **15/15 pass** — the 44×44 px floor holds (Button / native `<button>` / `Badge asChild` / native `<select>`, string-literal + `cn()` composite + multi-line-normalized). No NEW interactive element below floor (there are no new interactive elements — UI delta is 4 token swaps).
- `hdr-badge-contrast.test.ts` → **12/12 pass** (above).
- Combined: **27/27 pass, 216 ms.**

**Targeted white/light-text contrast sweep — zero offenders.** `grep text-white` across `src/components/` + `src/app/[locale]/admin/` returns 24 occurrences; intersected with any light background/gradient = **NONE**. Every `text-white` sits on a dark surface, verified by inspecting each:
- lightbox.tsx (`:550,570,594,668`), photo-viewer.tsx (`:799`), lightbox-color-pip.tsx (`:159` panel): `bg-black/70`–`bg-black/80` → white ≥ ~5:1.
- lightbox.tsx `:617,637`: `hover:bg-black/20` is on the **invisible full-height hit-zone wrapper**; the visible chevron sits inside `<span … bg-black/50 hover:bg-black/70>` — white-on-black/50-over-photo is the real contrast surface. Sound.
- home-client.tsx `:395,396,401,404`: `text-white` / `text-white/80` over `bg-gradient-to-b from-black/75 to-transparent` (mobile, anchored top) and `from-black/70 to-transparent` (desktop hover, anchored bottom) scrims; text region sits at the dark end of the scrim. Forced-colors masonry-overlay rules (`globals.css:327-337`) pin these to system colors in HC mode.
- upload-dropzone.tsx `:475`, badge.tsx `:17`: `bg-destructive`/`bg-destructive/60` (dark red).
- photo-navigation.tsx icons: white glyph inside `bg-black/70` pills.

No light-on-light base text class exists: `grep text-(amber|yellow|lime|orange|gray|slate|...)-(200|300|400)` excluding `dark:`/`hover:`/`focus`/`group-hover:` returns **zero** — every light shade is a dark-mode or interaction variant, so the light-theme base color is always darker.

**Design-token contrast — all PASS in all three themes (light / dark / OLED), HSL→sRGB recomputed:**

```
muted-foreground (183 uses, the largest secondary-text surface):
  LIGHT #62626a on white       6.04:1   on muted bg 5.50:1   PASS
  DARK  #a1a1aa on dark bg      7.76:1   on muted bg 5.81:1   PASS
  OLED  #a1a1aa on #000         8.19:1   on muted bg 6.86:1   PASS   (worst overall = 5.50:1, light muted-fg on muted bg)
foreground (body text):  LIGHT 19.90:1   DARK 19.06:1
destructive-text (error/clip labels, login/upload/password errors, histogram clip):
  LIGHT #b91c1c on white  6.47:1   DARK #f87171 on dark 7.19:1   OLED on #000 7.59:1 / on card#0a 7.16:1   PASS
```

So the `text-muted-foreground` secondary-text surface (description text, captions, EXIF rows, settings hints — the single most-used non-primary color) clears AA everywhere, and the `--destructive-text` keystone of the prior error-text fixes re-passes in all three themes including OLED.

**Reduced-motion (WCAG 2.3.3) — intact:** `globals.css:291` `@media (prefers-reduced-motion: reduce)` zeroes durations globally AND specifically suppresses the `group-hover:scale-105` / `group-focus-within:scale-105` photo-card transform (`:313-314`) so vestibular-sensitive users get no instantaneous scale snap. Unchanged from clean baseline.

**Forced-colors (Windows HC) — intact:** `.hdr-badge` (`:203-206`), `.gamut-p3-badge`, `.lightbox-color-pip`, and masonry card-text overlays (`:327-337`) pin to system `Canvas`/`CanvasText`/`Highlight`/`HighlightText` pairs and suppress gradients that would flatten to an illegible system color. Unchanged.

**Modal focus management — intact (unchanged code paths):** lightbox.tsx and info-bottom-sheet.tsx carry FocusTrap + `role="dialog"` + `aria-modal`; lightbox-color-pip is a slide-up panel inside the lightbox (documented contract, not an independent modal). The badge fix touched only the inline color token in these files — the surrounding ARIA, focus-trap wiring, and keyboard handlers are byte-identical to the verified-clean baseline, so the prior-cycle keyboard/focus/ARIA verification holds without re-derivation.

---

## Hard guards honored

- Did **not** propose `import 'server-only'` on `@/db`.
- Did **not** propose activating CLIP/semantic search.
- Re-checked the cycle-1..5 deferred UI register (timeline year-link `title`, lightbox spinner role, histogram-compute live region, `outline-blue-*` token inconsistency, InfoBottomSheet empty pill, TopicManager DialogDescription, `ui/sheet.tsx` dead code). Reasoning holds at HEAD; not re-reported (none are AA failures).

---

## Disposition

**Zero findings — honest convergence reached on the UI/a11y surface.** The cycle-6 Medium (HDR badge contrast) is independently confirmed fixed: `text-amber-950` clears AA at every gradient stop (worst 6.62:1 vs the 4.5:1 floor), and a non-vacuous source-inspection fixture now locks it against the exact gradient-background blind spot that let it slip 5+ cycles. The rendered UI is byte-identical to the cycle-5 clean baseline apart from that fix, so there is no new surface to fault. The full contrast/token/touch-target/focus/keyboard/ARIA/reduced-motion/forced-colors surface re-passes AA in all three themes, with every contrast value recomputed at my angle rather than inherited. Touch-target audit 15/15 green, HDR-badge contrast fixture 12/12 green.
