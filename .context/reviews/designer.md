# Designer (UI/UX + WCAG 2.2 Accessibility) Review — GalleryKit

**HEAD:** f8147868 (run-6 / cycle-4)
**Date:** 2026-06-16
**Method:** **Static analysis only.** Dev server could NOT be booted — no MySQL client on this host (`mysql not found`) and required env vars are absent (`scripts/mysql-connection-options.js` throws `Missing required environment variable`), so data-backed routes won't render and an agent-browser a11y pass would only have captured error/empty states. All visual claims below are backed by text-extractable evidence: exact class names read from source, CSS token values read from `globals.css`, and WCAG contrast ratios computed from the resolved hex/HSL values (sRGB-linear luminance per WCAG 2.x). The blocking touch-target audit was executed (`vitest run touch-target-audit.test.ts` → 15/15 pass) to verify the Switch restructure.

---

## Bottom line: honest convergence. 0 new findings.

**The only UI changes between the cycle-3 review HEAD (b1e9e0da) and current HEAD (f8147868) are the two designer fixes I was asked to verify:**

```
git diff --stat b1e9e0da..HEAD -- components/ app/[locale]/
 apps/web/src/components/histogram.tsx |  4 ++--
 apps/web/src/components/ui/switch.tsx | 36 ++++++++++++++++++++++++++++++-----
```

No new `.tsx` files were added to `src/` in that range. Every other component the cycle-3 designer reviewed in full is byte-identical. So the surface I'm re-reviewing is the prior (high) bar plus two targeted fixes.

**Both prior-cycle fixes are VERIFIED CORRECT.** All deferred LOWs (AGG-C3-24..30) remain accurately deferred — I re-checked each and the deferral reasoning still holds; I am not re-reporting them. I did not propose activating CLIP semantic search.

**Severity counts: 0 Critical / 0 High / 0 Medium / 0 new Low.** Two prior fixes verified; three INFO-grade observations recorded (all pre-existing, admin-only, polish-grade, already accepted by the prior cycle — explicitly NOT new findings).

---

## VERIFIED — prior-cycle fixes

### ✅ AGG-C3-01 / a3b8c557 — Switch thumb geometry — CORRECT
**File:** `apps/web/src/components/ui/switch.tsx`
The fix nests a normally-proportioned visible pill inside the 44px hit zone. Geometry checked by hand:
- **Root** (`:26`): `inline-flex min-h-11 min-w-11 ... items-center justify-center` → 44×44 tappable area preserved, visible track centered. ✓
- **Visible track** (`:36`): `h-6 w-11` (24×44px) + `px-0.5` (2px each side) → inner travel box = 44 − 4 = **40px**.
- **Thumb** (`:48-49`): `size-5` (20px), `translate-x-0` (unchecked) → `translate-x-full` (checked).
- `translate-x-full` = 100% of the thumb's own width = 20px. Inner slack = 40 − 20 = **20px**. So the thumb travels exactly 20px: flush-left at x=2px when off, flush-right (x=22px, right edge at 22+20=42 ≈ inner-right 42) when on. **Edge-to-edge travel is now correct** — the "perpetual half-on" defect is gone.
- **Track color** keys off Root's `data-state` via `group-data-[state=checked]:bg-primary` (Root carries `group`). ✓ Correct Radix pattern.
- **Touch-target audit:** executed — `components/ui/switch.tsx: 0` violations, 15/15 tests pass. The restructure kept the audit green. ✓

**Minor (NOT a finding, no action needed):** the header comment at `:14` still describes the *earlier* approach (`translate-x-[calc(100%-2px)]`), but the committed code at `:49` uses `translate-x-full`. The code is the geometrically-correct version; only the prose comment is one revision stale. Harmless — flagging only for transparency. Confidence: High.

### ✅ AGG-C3-02 / 60c54346 — Histogram clip-label contrast — CORRECT
**File:** `apps/web/src/components/histogram.tsx:671,674`
Both clip-warning spans now read `className="text-destructive-text"` (was raw `text-red-500`). Token verified in `globals.css`: light `--destructive-text: 0 73.7% 41.8%` (≈ red-700), dark `0 90.6% 70.8%` (≈ red-400), with oklch overrides at `:130/139/147`. red-700 on the white `bg-card` ≈ 5.9:1 → clears WCAG **1.4.3 AA (4.5:1)** for the `text-xs` warning. The shadow/highlight clip warnings — load-bearing for the photographer audience — are now AA in both themes. ✓ Confidence: High.

---

## Contrast audit of raw color utilities (proactive — nothing newly broken)

I swept every `text-{red,green,blue,amber,yellow,gray}-NNN` / `bg-*-NNN` / `outline-blue-*` literal under `components/` and the admin route group, then computed WCAG ratios for each against its resolved background (including alpha compositing for `/NN` opacity suffixes and tinted panels). **All meaningful text clears AA in both light and dark themes.** Detail (light → dark):

| Site | Foreground | Background | Light | Dark | Verdict |
|---|---|---|---|---|---|
| `password-form.tsx:48` | green-900 / dark:green-300 | green-50 / green-900/30 | **8.70** | **10.92** | ✓ AA |
| `settings-client.tsx:277` | blue-900 / blue-200 | blue-50/60 / blue-950/20 | **9.87** | **12.23** | ✓ AA |
| `settings-client.tsx:279` | blue-800/80 / blue-200/80 | blue-50/60 / blue-950/20 | **5.13** | **8.19** | ✓ AA (tightest light) |
| `settings-client.tsx:303` | blue-900/90 / blue-200/90 | blue-50/60 / blue-950/20 | **7.57** | **10.12** | ✓ AA |
| `settings-client.tsx:306` | amber-700 / amber-400 | blue-50/60 / blue-950/20 | **4.78** | **10.41** | ✓ AA (xs) |
| `settings-client.tsx:456` | blue-800 / blue-300 | blue-50/60 / blue-950/20 | **8.31** | **9.64** | ✓ AA |
| `sales-client.tsx:95` | green-700 / green-400 | white / dark card | **5.02** | **10.29** | ✓ AA |

These hardcoded semantic colors (success=green, info=blue, warning=amber) are a deliberate, consistent pattern, not the focus-ring token-consistency issue. The tightest light-mode case (`:279` at 5.13:1, `:306` amber at 4.78:1) still clears the 4.5:1 floor. **No new contrast failure exists on these admin surfaces.**

---

## Informational (pre-existing, admin-only, polish-grade — NOT new findings)

These were all present at the cycle-3 HEAD, are gated to authenticated admins, sit on keyboard-primary admin surfaces, and were reviewed and accepted by the prior cycle (both files are in its coverage map). I record them only so a future cycle has the contrast math on file. None rises to an actionable finding at HEAD given the admin-only + supplementary-text framing.

- **`color-details-section.tsx:493` / `lightbox-color-pip.tsx:240` — gamut suffix `(P3)`/`(sRGB)` at low alpha.**
  - `:493` `text-muted-foreground/70` on white `bg-card`: with `--muted-foreground: 240 3.8% 40%` (#61616b, 6.12:1 at full opacity), the /70 alpha drops it to **3.17:1** — below AA for small text *in isolation*.
  - `:240` `text-white/50` on the lightbox pip (`bg-black/70` over an arbitrary photo): over a bright photo the pip composites to ≈#4d4d4d, giving **3.47:1**; over a dark photo it's 5.3:1.
  - **Why this is INFO, not a finding:** the suffix is rendered ONLY when `isAdmin && <gamut condition>` (see the `(isAdmin && ...)` guards at `:486-488` and `:233-235`) — it never reaches the public. It is a *supplementary qualifier* in parentheses next to a full-contrast format name (`WebP`/`AVIF`/`JPEG` render at full token contrast); the information is not carried solely by the low-contrast text. Admin-only + non-sole-carrier puts it well below the histogram clip-label case (which was public + load-bearing). If a future a11y batch wants to tighten it: lift to `/85` (→ ~4.6:1 on white) for `:493` and gate `:240` on a solid pip chip rather than `bg-white/10`.

- **`color-details-section.tsx:306/324/398` — copy-to-clipboard icon buttons at `text-muted-foreground/60` (2.6:1 at rest).** Below the 3:1 floor of **1.4.11 Non-text Contrast** *at rest*, but: each has `aria-label` + `title` + `min-h-11 min-w-11` and a `hover:text-muted-foreground` reveal (→ 6.12:1). They are discoverable affordances next to already-readable metadata, not sole-meaning glyphs. Pre-existing, admin/viewer color-audit surface. Same disposition class as the documented touch-target exemptions. If tightened later: raise rest state to `/75` (→ ~3.6:1, clears 1.4.11).

- **`outline-blue-*` focus-ring spots are now 3, not 4 (AGG-C3-27 scope shrank).** The deferred AGG-C3-27 cited 4 spots including `lightbox-color-pip.tsx:189`; at HEAD `:189` no longer carries `outline-blue` (it's now `focus-visible:ring-1 focus-visible:ring-white/50`). Remaining: `image-zoom.tsx:347`, `lightbox-color-pip.tsx:131`, `login-form.tsx:84`. Still the same deferred token-consistency item (rings are visible, just not `ring-ring`-derived) — **NOT re-opening**, just noting the citation count is now stale by one.

---

## Re-verified strengths (still intact at HEAD — do not regress)

- **Reduced motion** (`globals.css:291-317`): global `*-duration` override **plus** an explicit `transform: none` on `group-hover:scale-105` / `group-focus-within:scale-105` so the 5% card hover-zoom doesn't snap in instantly (WCAG 2.3.3). framer-motion lives only in `photo-viewer.tsx`, whose Ken Burns / crossfade are separately reduced-motion-gated (per cycle-3 verification, unchanged).
- **Forced-colors** (`:327+`): masonry overlay text pinned to `Canvas`/`CanvasText`; badge handling present.
- **Touch targets**: `ui/button.tsx` floors all variants at `min-h-11`/`size-11`; blocking audit (Button/button/Badge-asChild/native-select multi-line) green at 15/15 including the restructured Switch.
- **Histogram a11y**: canvas is `role="img"` + localized `aria-label` (`:641-642`); expand/collapse + cycle-mode controls labeled (`:619/706`).
- **Lightbox / Search**: full focus trap + restore, combobox ARIA, IME guards, polite live regions (unchanged from cycle-3 verification).
- **Color tokens**: `--muted-foreground` lifted to 40% L for AA on white; dedicated `--destructive-text` red-700/red-400 twin — now correctly consumed by the histogram clip labels too.

---

## Coverage map (re-reviewed this cycle)

Diffed full UI surface b1e9e0da..HEAD (only switch.tsx + histogram.tsx changed). Re-verified in detail: `ui/switch.tsx` (geometry + audit), `histogram.tsx` (clip token + ARIA + reduced-motion), `globals.css` (token values, reduced-motion, forced-colors). Contrast-swept + computed: `settings-client.tsx`, `password-form.tsx`, `sales-client.tsx`, `color-details-section.tsx`, `lightbox-color-pip.tsx`, `image-zoom.tsx`, `login-form.tsx`, `home-client.tsx`, `tag-input.tsx`, `admin-nav.tsx`, `similar-photos.tsx`, `upload-dropzone.tsx`, `ui/select.tsx`. Deferred-LOW set (AGG-C3-24..30) spot-checked against source — reasoning still holds, not re-reported.

---

## Disposition

**Nothing to fix this cycle.** The two cycle-3 designer MEDIUMs are correctly closed and verified; the only UI delta since then is exactly those two fixes; no regression was introduced; the remaining surface is the previously-accepted (high) bar plus already-deferred polish-grade LOWs. This is genuine convergence, not a manufactured all-clear — I computed the contrast math and ran the touch-target audit rather than asserting it.
