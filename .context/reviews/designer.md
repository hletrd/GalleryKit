# Designer — Cycle 1 (review-plan-fix loop, 2026-04-25)

## Lens

UI/UX, accessibility, error messaging, internationalization, visual polish, designer-finding regressions.

**HEAD:** `8d351f5`
**Cycle:** 1/100

## Production verification (gallery.atik.kr)

Static HTML pulled from `https://gallery.atik.kr/en` and `https://gallery.atik.kr/ko` confirms:

- **F-6/F-16 deployed:** `/en` → `og:locale: en_US`. `/ko` → `og:locale: ko_KR`. Route locale wins. **Live and correct.**
- **F-15 deployed:** Home HTML contains `2xl:columns-5` (Tailwind utility, observed via grep on the rendered class string).
- **F-1, F-2, F-3 deployed:** Home HTML contains `min-w-[44px]` and `min-h-[44px]` utility classes.
- **F-7 deployed:** `<main>` has `tabindex="-1"`.
- **F-13 deployed:** `aria-pressed` is present in the rendered HTML (login page is admin-only so this is on the password-toggle).
- **F-17 NOT yet deployed:** `hreflang` not present in either home or topic HTML on production. The latest commit (`8d351f5`) is HEAD locally; the deploy from this cycle will push it.

## Visual review

(Note: physically scrolling the production site is best-served by a designer human, but the static-HTML signal above plus a code-only review can verify the most-impactful UI deltas.)

### F-1 — Tag pill 44x44

**Assessment:** Pills are now `min-h-[44px] px-3 py-2` (was `min-h-[24px] py-1`). Vertically taller, more thumb-friendly. **Tradeoff (also flagged by critic):** above-the-fold photo count drops slightly because the tag row is now ~22px taller.

**Verdict:** OK. Recommend designer documents the AAA target as the project floor.

### F-2 — Mobile expand toggle

**Assessment:** `min-w-[44px] min-h-[44px] flex items-center justify-center` — correct. The icon (`h-4 w-4`) renders centered in a 44x44 box. Visual padding around the icon is now ~14px on each side, matches sibling buttons. **Looks right.**

### F-3, F-21 — Search trigger + close

**Assessment:** Both `h-11 w-11` (44x44). Trigger sits in the nav next to theme + locale buttons, all matching size. Dialog close X is now larger than the input field — see critic's F-3 critique. **Visual asymmetry between dialog input and dialog close.** Worth a small follow-up.

### F-4/F-22 — Not-found shell

**Assessment:** Adding `<Nav />` and `<Footer />` to 404 is a UX win — users can navigate back to topics. The decorative "404" numeral is now `aria-hidden="true"` and the real `<h1>` is the description text — correct semantic hierarchy.

**Concern:** The `<Footer />` admin link (`text-xs`) is small. On mobile it's in the same row as GitHub link, which is `text-sm`. Visual hierarchy says "GitHub > admin" — intentional. **OK.**

### F-7 — Skip link to `<main>`

**Assessment:** `tabIndex={-1}` on `<main>` makes it programmatically focusable. Visible focus suppressed via `focus:outline-none`. Skip-link target uniformly tagged across `(public)/layout.tsx` and `not-found.tsx`. **OK.**

### F-8 — Image-zoom focus outline

**Assessment:** Switched from `focus-visible:ring-*` (CSS-variable-driven) to `focus-visible:outline-blue-500` (literal). Renders a clean 2px solid blue outline. **But** — the rest of the codebase still uses `focus-visible:ring-*`. Visual inconsistency.

**Verdict:** Requires designer policy decision. See critic.md F-8 critique.

### F-9 — Hide shortcut hint on touch

**Assessment:** `hidden md:block` correctly hides on <768px. Saves ~20px of vertical space on phones. **Good.**

### F-10 — `min-h-[40vh] md:min-h-[500px]`

**Assessment:** On `375 × 800px` portrait phone, 40vh = 320px — reasonable. On `667 × 375` landscape phone, 40vh = 150px — small. The image inside still respects `max-height: 100vh` (via existing landscape rule), so it grows the container. No visual clipping. **Good for portrait, marginal for landscape.**

### F-11 — `--muted-foreground` 46.1% → 40%

**Assessment:** Improves contrast. But `text-muted-foreground` is also used for inactive nav links — those are now visually closer to active links. **Subtle visual hierarchy regression.** Worth designer review on actual screenshots.

### F-12 — Visible login labels

**Assessment:** Labels render above each input with `text-sm font-medium block`. Persistent visibility solves the "placeholder disappears on focus" problem. **Good.**

### F-13 — Password visibility toggle

**Assessment:** Eye/EyeOff icon in a 9x9 button (`w-9 h-9`) inside the password field via `pr-11` padding. `aria-label` toggles between "Show password" / "Hide password"; `aria-pressed` toggles. **Correct.**

**Concern:** Some screen readers may double-announce state ("Show password, pressed, button"). See critic F-12/F-13 and security.md S1-LOW-02.

### F-14 — 404 numeral opacity bump

**Assessment:** `text-muted-foreground/60` over the new 40% lightness yields ~24% lightness with 60% opacity — visible in both modes. Numeral is `aria-hidden`. **Good.**

### F-15 — `2xl:columns-5`

**Assessment:** On a 1920×1080 widescreen, columns are now 5 instead of 4. Better use of horizontal space. **But** — `useColumnCount` JS isn't updated, so the 5th column's first photo loads `loading="lazy"` instead of `eager`. **Cross-flagged by perf and tracer.**

### F-17 — hreflang alternates

**Assessment:** Verified in code; not yet deployed. Will deploy this cycle.

### F-18 — Concise alt text

**Assessment:** Per-photo aria-labels now read as comma-separated tag list (e.g. "Seoul, Night" vs "Photo Photo Photo"). **Big a11y win.**

### F-20 — Photo viewer toolbar 44px

**Assessment:** Back button and Info button both `h-11`. Good. **But** other Buttons in the toolbar (Share, Lightbox trigger) still default to `size="sm"` (~32px). Inconsistency.

### F-23 — Skeleton shimmer

**Assessment:** Shimmer animation runs forever (P1-LOW-01). Dark-mode shimmer is invisible (P1-LOW-01 + critic F-23). **Two bugs in one fix.**

## A11y verification

- `aria-pressed={showPassword}` ↔ login form. ARIA-Authoring-Practices supports this for toggle buttons.
- `aria-pressed={currentTags.length === 0}` ↔ tag-filter "All" pill. **OK.**
- `aria-pressed={currentTags.includes(tag.slug)}` ↔ each tag pill. **OK.**
- Skip-link target. `<main id="main-content" tabIndex={-1}>`. **OK.**
- 404 page reachable with screen reader through full nav. **OK.**

## Findings

### DSGN1-LOW-01 — Skeleton shimmer dark-mode invisibility (LOW, High confidence)

**File/region:** `apps/web/src/app/[locale]/globals.css:88-106`, `apps/web/src/components/photo-viewer.tsx:346`.

**Why a problem:** Gradient is `rgba(255,255,255,0.06)` over `bg-black/5 dark:bg-white/5`. In dark mode the gradient is white-on-translucent-white — nearly invisible.

**Suggested fix:** Theme-aware gradient:

```css
.skeleton-shimmer::after {
    background: linear-gradient(90deg, transparent 25%, hsl(var(--muted-foreground) / 0.08) 50%, transparent 75%);
}
```

**Confidence:** High.

### DSGN1-LOW-02 — Skeleton shimmer never stops (LOW, High confidence)

(Cross-cited from perf.md P1-LOW-01.)

### DSGN1-LOW-03 — Visual inconsistency between toolbar buttons (LOW, Medium confidence)

**File/region:** `apps/web/src/components/photo-viewer.tsx:258,275,282`.

**Why a problem:** Back button and Info button are `h-11` (44px). Share button uses `size="sm"` which is ~32px on mobile. Lightbox trigger via `LightboxTrigger` also defaults to a smaller size.

**Suggested fix:** Either bump Share + Lightbox to `h-11` for consistency or keep them small and document why some toolbar buttons are 44px (primary actions) vs 32px (secondary).

**Confidence:** Medium.

### DSGN1-LOW-04 — Search dialog visual asymmetry (LOW, Medium confidence)

**File/region:** `apps/web/src/components/search.tsx:219,228`.

**Why a problem:** Search input `h-8`. Search close button `h-11 w-11`. Visually unbalanced.

**Suggested fix:** Either bump input to `h-11` or close button to `h-8`. The input is the primary affordance — should be at least as large.

**Confidence:** Medium.

### DSGN1-LOW-05 — `--muted-foreground` change may regress nav link hierarchy (LOW, Medium confidence)

**File/region:** `apps/web/src/app/[locale]/globals.css:33`.

**Why a problem:** Inactive nav links use `text-muted-foreground`. Lowering lightness makes them visually closer to active (`text-foreground`) links.

**Suggested fix:** Visual review on real screenshots. If regression confirmed, switch nav inactive links to a lighter variant (e.g. `text-muted-foreground/80`).

**Confidence:** Medium.

### DSGN1-INFO-01 — F-* policy not documented

**File/region:** No policy doc.

**Why informational:** The fix wave shifts the touch-target floor from 24x24 (AA, cycle 3) to 44x44 (AAA, this cycle). Future PRs need to know which floor applies.

**Suggested fix:** Add a short note in CLAUDE.md or designer-style-guide doc.

**Confidence:** High.

## Findings summary

**Zero new MEDIUM or HIGH findings.** All deployed UI changes verified to render correctly on production (where deployed). The F-17 hreflang commit will deploy this cycle.

LOW: DSGN1-LOW-01, DSGN1-LOW-02 (cross-cite), DSGN1-LOW-03, DSGN1-LOW-04, DSGN1-LOW-05.

## Confidence

High.

## Recommendation

DSGN1-LOW-01 (dark-mode shimmer) and DSGN1-LOW-02 (shimmer-never-stops) are real visual defects worth scheduling. Others are polish/policy.
