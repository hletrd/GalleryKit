# Designer (UI/UX + WCAG 2.2 Accessibility) Review — GalleryKit

**Run:** review-plan-fix cycle 8 · **HEAD:** `9c40d261` · **Date:** 2026-06-14
**Reviewer:** Designer (UI/UX + accessibility) · **Working tree:** CLEAN at review start
**Method:** Static-source analysis of every interactive surface (public route group, all `components/`, lightbox, photo-viewer, nav, search, map, all admin forms, error/empty/loading states) + global CSS / tailwind token audit + live audit-gate execution (`npx vitest run touch-target-audit` → **15/15 pass**) + en/ko i18n key-parity verification (**837/837, zero drift**).

**NET-NEW UI/UX FINDINGS THIS CYCLE: 0.**
**Cycle-7 NEW finding DES-C7-1 (admin-header brand link): VERIFIED FIXED (commit `b47cdbb6`).**
**Prior-deferred DES-C5-2 / DES-C5-3 / DES-C5-4: RE-CONFIRMED OPEN, UNCHANGED — not re-escalated.**

This is a near-converged, heavily a11y-hardened surface. After eight cycles the recurring bare-link theme is now **fully closed on both public and admin sides**. No genuine new UI/UX defect exists against HEAD `9c40d261`; this review is primarily a re-verification pass.

---

## Cycle-7 fix verification — the recurring bare-link theme is now CLOSED

### DES-C7-1 / AGG-C7-01 — admin header brand/logo `<Link>` → **VERIFIED CLEAN** (commit `b47cdbb6`)

The cycle-7 NEW finding (the recurring bare-back-nav theme's last untouched instance, on the admin side) is fixed at HEAD. `components/admin-header.tsx:16` (verbatim):

```tsx
<Link className="mr-6 flex items-center space-x-2 font-bold min-h-11" href={localizePath(locale, '/admin/dashboard')}>
    <span>{t('nav.admin')}</span>
</Link>
```

`min-h-11` (44 px) is now present, matching the public counterpart `nav-client.tsx:85` (`min-h-[44px]`) and the adjacent `AdminNav` links (`admin-nav.tsx:38`, `min-h-11`). Commit `b47cdbb6` ("fix(a11y): ♿ admin-header brand link needs a 44px tap area") landed it. The brand link is centered in the `min-h-14` (56 px) bar and now presents a 44 px tap target. The separate Logout `<Button size="sm">` at `:24` remains the file's single budgeted `KNOWN_VIOLATIONS=1` entry (renders `min-h-11` at runtime via the Button primitive floor — belt-and-braces); the fix did not change that count.

**The recurring "sibling missed when its counterpart was fixed" theme is now exhausted:** public side (g/[key] → timeline/home/topic-empty → s/[key]/year) all closed in cycles 5–6; the admin twin closed in cycle 7. No bare sub-44 interactive `<Link>`/`<a>`/`<button>` remains anywhere in the scanned surface (re-swept this cycle — see compliance table).

### Touch-target gate — live run at HEAD `9c40d261`

```
npx vitest run touch-target-audit → 15/15 pass (12.70s)
```

The count grew 14 → 15 in cycle-7's `99071d76` (the scale-token catch-all was extended to `<Link>`/`<a>`/`<select>`, closing the AGG-C7-03 blind spot). The Link/a/select patterns now carry the same `(?<!max-)(?:min-h|min-w|size|h|w)-(?:[1-9]|10)` catch-all that Button/button had, so a future `<Link className="h-7">` (28 px) would now be flagged by the blocking gate.

---

## Findings

**None net-new this cycle.** Severity legend retained for reference: **HIGH** = WCAG A/AA failure on public/shipped surface · **MED** = AA failure on admin surface, or repo-44 px-floor failure on public surface · **LOW** = AAA / polish / consistency.

---

## Prior-deferred items — RE-CONFIRMED OPEN (no change, no re-escalation)

### DES-C5-2 — Nav theme/locale/expand `<button>`s + title/topic `<Link>`s have no `focus-visible` ring — **LOW** — UNCHANGED

`nav-client.tsx:85,93,122,155,166` — re-read verbatim at HEAD `9c40d261`. All five carry `min-h-[44px]`/`min-w-[44px]` (touch-targets fine), but none carries `focus-visible:ring-*`; there is no `focus-visible` declaration anywhere in `nav-client.tsx`. The UA-default focus outline still applies → **not a hard WCAG 2.4.7 failure**, but visually inconsistent with the ~19 ring sites elsewhere in the component tree (lightbox, color-pip, histogram, info-sheet, color-details, login password-toggle, upload-dropzone all use `focus-visible:ring-2`/`outline-2`) and with shadcn Button's `focus-visible:ring-[3px]`. Status: **DEFERRED** (plan-340/342, unchanged). Fix when a UI-polish pass runs: add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none` to the five nav interactive elements.

### DES-C5-3 — Color-pip `text-white/50` gamut suffix (thinnest margin) + histogram dotted-underline affordance — **LOW** — UNCHANGED

- `lightbox-color-pip.tsx:237` — `<span className="ml-0.5 text-white/50">({fmt.gamut})</span>` — re-read at HEAD. `text-white/50` (`#ffffff` at 50% α) over the `bg-black/70` pip resolves to ≈ **5.15:1** (passes 4.5:1 AA, the thinnest margin in the app; `text-[10px]`). Unchanged.
- `histogram.tsx:691` — `decoration-dotted decoration-muted-foreground/40` — ~2:1 decoration cue on a `cursor-help` tooltip trigger. Unchanged. The trigger TEXT is `text-muted-foreground` (passes AA — `--muted-foreground` is `40%` lightness in light mode ≈ 6.1:1 per the F-11 doc); only the dotted underline decoration is faint, and an underline decoration is not itself a WCAG contrast target (non-text, decorative).

Status: **DEFERRED** (plan-340/342, unchanged). Optional polish: `text-white/70` / `decoration-muted-foreground/70`.

### DES-C5-4 — Info-sidebar topic `<Badge>` renders raw slug — **LOW** — UNCHANGED

`photo-viewer.tsx:816` — `<Badge variant="outline">{image.topic}</Badge>` — re-read at HEAD. Still renders the raw slug (e.g. `music-festival`) rather than the humanized `image.topic_label || image.topic`. The sibling Back button already uses the humanized form (`t('viewer.backTo', { topic: image.topic_label || image.topic })`), and the sidebar tag chips below it (`:822-828`) route through `humanizeTagLabel` — so this Badge is the lone raw-slug surface in the photo-viewer. Cosmetic only (no a11y impact; the slug is still a valid accessible name). Status: **DEFERRED** (plan-340/342, unchanged). Fix: `{image.topic_label || image.topic}`.

---

## Surfaces audited and found COMPLIANT (re-verified at HEAD `9c40d261`)

### Touch-targets — every interactive element confirmed ≥ 44 px (no exceptions remaining)

Re-swept this cycle via tag-based grep + sizing-token cross-check (`grep -E "<(Button|button|Link|a|select)" -A3` → only `min-h-11` / `h-11` / `min-h-[44px]` / `h-12` height tokens appear on interactive tags; `h-4` appears only on icons *inside* buttons, not the targets). Representative coverage:

| Surface | File:line | Sizing token | Verdict |
|---|---|---|---|
| Public nav brand | `nav-client.tsx:85` | `min-h-[44px]` | ✓ |
| **Admin header brand** | `admin-header.tsx:16` | `min-h-11` | ✓ **(DES-C7-1 fix, `b47cdbb6`)** |
| Nav expand / theme / locale btns | `nav-client.tsx:93,155,166` | `min-w-[44px] min-h-[44px]` | ✓ |
| Nav topic pills | `nav-client.tsx:122` | `min-h-[44px]` | ✓ |
| Admin nav links | `admin-nav.tsx:38` | `min-h-11` | ✓ |
| Admin Logout button | `admin-header.tsx:24` | `size="sm"` → `min-h-11` at runtime (Button floor) | ✓ (budgeted `KNOWN_VIOLATIONS=1`, runtime-safe) |
| Footer GitHub / Admin links | `footer.tsx:47,52` | `min-h-11` | ✓ |
| Login submit + password toggle | `login-form.tsx:102,84` | `h-11` / `w-11 h-11` | ✓ |
| Search trigger / close btns | `search.tsx:290,359` | `h-11 w-11` | ✓ |
| Lightbox close/share/pip/slideshow/prev/next | `lightbox.tsx:547,568,592,615,635` | `h-11 w-11` / full-height `w-16` edge | ✓ |
| Photo-viewer back/buy/info/share/pin/download | `photo-viewer.tsx:601,617,662,679,708,1030` | `h-11` / `min-h-11` | ✓ |
| Color-details / color-pip / histogram controls | `color-details-section.tsx`, `lightbox-color-pip.tsx`, `histogram.tsx` | `min-h-11 min-w-11` / `min-h-[44px]` | ✓ |
| Home FAB / clear-filter / P3 badge | `home-client.tsx:441,434,387` | `min-h-11 min-w-11` / `min-h-11` | ✓ |
| Tag-filter chips | `tag-filter.tsx:65,83` | `min-h-11` | ✓ |
| Timeline / year / shared-group back links + chips | `timeline:131,152`, `year:107`, `g/[key]:140,172`, `s/[key]:105` | `h-11` / `min-h-11` | ✓ |
| Map marker popup button | `map/map-client.tsx:128` | `min-h-[44px] min-w-[44px]` | ✓ |
| Error / not-found / global-error actions | `error.tsx`, `not-found.tsx`, `global-error.tsx` | `min-h-11` | ✓ |
| Settings/SEO/tokens/password/topic/tag form controls | admin `(protected)/**` | shadcn `Input`/`Select`/`Button`/`Switch` primitives (floored ≥ 44 px) | ✓ |
| p/[id] prev/next prefetch links | `p/[id]/page.tsx:305,310` | `className="hidden" tabIndex={-1} aria-hidden` | ✓ (intentionally non-interactive prefetch hints) |

### Forms (admin) — labels + error states re-verified

- **Login** (`login-form.tsx`): persistent visible `<label htmlFor>` per input, `autoComplete`, password-visibility toggle with `aria-pressed`/`aria-label` (44 px), error in `role="alert" aria-live="assertive"` styled with the contrast-safe `text-destructive-text` token. **Exemplary.**
- **Settings** (`settings-client.tsx`): every input has `<Label htmlFor>` AND every `<Switch>` *additionally* carries `aria-label` (belt-and-braces) — `force-srgb-derivatives`, `allow-hdr-ingest`, `force-show-color-chips`, `strip-gps`, `auto-alt-text-enabled` all double-labeled.
- **seo / tokens / password / topic-manager / tag-manager**: all carry `htmlFor`/`aria-label` references; password-form and seo/page carry `role="alert"`/`aria-live`/`aria-invalid` error surfaces.
- **db/page**: file-upload + action-button surface (not a text-input form) — label count of 1 is expected, no gap.

### Images — alt text complete

Every shipped `<img>` / `<Image>` JSX tag carries a real `alt`: masonry (`home-client.tsx:352,367` → `altText`), lightbox (`lightbox.tsx:494` → `getConcisePhotoAltText`), photo-viewer (`photo-viewer.tsx:490` → next/image with alt), upload preview (`upload-dropzone.tsx:486` → `file.name`), search thumbnail (`search.tsx:74`), nav topic avatar (`nav-client.tsx:134` → `alt="" aria-hidden` decorative). No missing-alt gap.

### Non-native interactive elements — keyboard-accessible

- `image-zoom.tsx:359` — `role="button"`, `tabIndex={0}`, `aria-label`, `onKeyDown` (Enter/Space → `preventDefault` + toggle). Wired. (Carries no `focus-visible` ring — but it IS the photo image itself; a ring around the whole image would be unconventional and this was accepted in prior cycles. NOT a new finding.)
- `upload-dropzone.tsx:408` — `role="button"`, `aria-label`, `aria-disabled`, conditional `tabIndex`, `focus-visible:ring-2 focus-visible:ring-offset-2` when enabled. Wired.
- **Zero** `onClick` on raw `<div>`/`<span>`/`<label>`/`<li>`/`<tr>`/`<td>` — no inaccessible click handlers anywhere.

### Global CSS / theming — hardened

`app/[locale]/globals.css` re-audited in full:
- **`prefers-reduced-motion`** global reset (`:291-300`) zeroes `animation-duration`/`transition-duration` + `animation-iteration-count: 1` for all elements — kills the infinite `skeleton-shimmer` and Ken Burns animations under reduced-motion. JS-driven motion (`image-zoom`, `home-client` scroll-to-top, `lightbox` Ken Burns/slideshow, `photo-viewer` framer-motion) *additionally* gates on `matchMedia('(prefers-reduced-motion: reduce)')` / `useReducedMotion()` — defense in depth, not CSS-only.
- **`forced-colors: active`** handling for `.hdr-badge` / `.gamut-p3-badge` / `.lightbox-color-pip` (`:203-220`) and masonry text overlays (`:310-321`) — Windows High Contrast Mode legibility addressed.
- **Contrast-tuned tokens** with documented ratios: `--muted-foreground` bumped to 40% L (F-11, ≈ 6.1:1 on white); `--destructive-text` red-700/red-400 split (≈ 5.9:1 light / ≈ 7:1 dark, AGG-R8c3-04); OLED `--foreground` 19.3:1, `--muted-foreground` ≈ 5.7:1. Three themes (light / .dark / .oled) all documented AA+.
- **oklch wide-gamut overrides** under `@supports (color: oklch(…))` — perceptually-equivalent to HSL fallbacks on sRGB, smoother on P3. Legacy browsers stay on HSL.
- **P3/HDR badge gating** driven by `data-display-gamut` (set by the layered `useDisplayCapability` detection) + `force_show_color_chips` admin override — the raw `@media (color-gamut: p3)` rule was deliberately removed to avoid the Firefox false-positive R9-R1 closed.

### i18n / responsive

- **en.json / ko.json = 837 keys each, zero missing in either direction.** ICU-plural asymmetry (en `{count, plural, …}` vs ko fixed `{count}장`) is the documented intentional convention (DOC-R5C3-07) — not a defect. No hardcoded user-facing strings found in the interactive components reviewed.
- Responsive: nav collapses below `md` (768px) with a 44 px expand toggle + horizontal-scroll topic strip; photo-viewer info-sidebar fades/slides at `lg`; landscape-mobile orientation query pins the photo-viewer toolbar sticky. No truncation/overflow gaps surfaced in static review (RTL not applicable — en/ko are both LTR).

---

## Summary / priority for the plan

**NET-NEW: 0.** No genuine new UI/UX issue exists against HEAD `9c40d261`. The surface is clean to the repo's own self-imposed 44 px (WCAG 2.5.5 AAA) standard.

**Verified this cycle:**
1. **DES-C7-1 (MED) — CLOSED.** `admin-header.tsx:16` brand link now carries `min-h-11` (commit `b47cdbb6`). The recurring bare-link theme is fully exhausted on both public and admin sides. Touch-target gate 15/15 GREEN.
2. **DES-C5-2 / DES-C5-3 / DES-C5-4 (LOW, all DEFERRED, UNCHANGED):** nav `focus-visible` ring (5 elements, `nav-client.tsx` — UA outline still applies, not a hard 2.4.7 failure); color-pip `text-white/50` thin-margin suffix (`lightbox-color-pip.tsx:237`, 5.15:1 passes AA) + histogram dotted-underline (`histogram.tsx:691`, decorative); photo-viewer sidebar topic `<Badge>` raw slug (`photo-viewer.tsx:816`, cosmetic). Confirm deferred — fold into a future UI-polish pass.

**Convergence note.** Eight cycles of a11y hardening have produced a surface where every interactive element across the public route group, all components, lightbox, photo-viewer, nav, search, map, all admin forms, and every error/empty/loading state is ≥ 44 px, properly focus-managed (FocusTrap + `focus-visible` on lightbox/search/dialogs), label-associated, alt-tagged, reduced-motion-guarded, forced-colors-aware, and contrast-tuned with documented ratios. **No cosmetic findings were manufactured.** The three deferred LOW items are the only remaining UI/UX polish opportunities, and none is a WCAG A/AA failure. The designer surface is at convergence.
