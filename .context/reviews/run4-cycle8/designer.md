# Run-4 Cycle 8 — designer (UI/UX) angle

Method note: this cycle's designer pass combines code-level UX review
with three headless-Chromium experiments (playwright fixtures) whose
results are text-extractable evidence (network request lists,
`currentSrc`/`naturalWidth` reports, probe load/error events) per the
multimodal caveat. The app-level e2e suite (role/name selectors)
runs in PROMPT 3 as the interactive regression layer.

## UX impact assessment of the cross-angle findings
- **COR-R4C8-02 (dead AVIF probe)** — photographer-facing audit UI
  silently shows sRGB-clipped histogram data on P3 displays with the
  source label reading "JPEG" and no "(sRGB clipped)" hint. The UI is
  truthful about WHAT it shows but the product intent (P3-accurate
  audit) never engages. Gamut/HDR badges are unaffected (they gate on
  display capability, not the probe).
- **COR-R4C8-04 (histogram blanks at 768 px)** — rotating a tablet or
  resizing a desktop window across the breakpoint leaves an empty black
  box where the histogram was, with clip-percentage labels still
  rendered below it (stale-but-present text next to a blank canvas is
  actively confusing).
- **COR-R4C8-05 (broken-image tile)** — during a backfill window after
  a pipeline bump, the photo viewer / lightbox show the browser's
  broken-image glyph on a black field for affected photos. The masonry
  grid (R20-M1) renders fine, so the failure appears exactly when the
  visitor commits to viewing the photo full-screen — the worst surface
  for it.
- **PERF-R4C8-03 (preload waste)** — on mobile data connections the
  `fetchPriority="high"` neighbor preloads compete with the photo the
  visitor is actually looking at; perceived LCP of the main image
  degrades while bytes are spent on photos that may never be viewed.

## Designer-specific observations (LOW — recorded, not scheduled)
1. **Paid-download GET error taxonomy is bare `text/plain`**
   (`api/download/[imageId]/route.ts` validation branches). The happy
   path now renders a polished localized interstitial (c7), so an
   expired/used token presents a jarring unstyled ASCII line on the
   SAME customer journey ("Token already used"). Cycle 7 deliberately
   preserved the taxonomy verbatim; converting error bodies to the
   interstitial shell (status codes unchanged) is a contained follow-up.
   Re-open criterion: any customer-confusion report, or the next time
   the route is touched.
2. **Interstitial double-submit** — the confirmation `<form>` has no JS
   (CSP `default-src 'none'`), so a double-click fires two POSTs; the
   loser navigates to the plain-text 410 while the download proceeds.
   Mitigated by single-use atomicity (no integrity risk). Acceptable;
   noted for the same follow-up as (1).
3. **ImageZoom `preventDefault` in React touch handlers is a no-op**
   (React attaches root touch listeners passively); actual scroll
   suppression comes from `touch-action: none`, so behavior is correct,
   but Chromium logs an intervention warning per gesture frame.
   Cosmetic console noise; fold into any future zoom refactor.
4. **Dynamic Tailwind `columns-${n}` classes in home-client.tsx:237
   are safelisted only by a code comment** (the literal class strings
   live in the AGG1L-LOW-02 comment block; the runtime-built strings
   are invisible to the scanner). The breakpoint cascade happens to
   cover every clamped value today, but deleting that comment breaks
   small-gallery layouts. Re-open criterion: any Tailwind config
   change or comment cleanup touching home-client.

## Verified-good
- Interstitial page (c7): dark-mode aware, 44 px submit target,
  `lang` attribute localized, viewport meta present, system font stack
  — consistent with the product shell despite being a standalone
  document.
- Lightbox/viewer keyboard map (F/I/C/H/Space/Esc/arrows) remains
  coherent with aria-keyshortcuts annotations and the c6 focus-trap
  fixes; Escape layering (pip → fullscreen → close) per R28-UX-HIGH-1
  intact.
- Touch-target floor: all new/touched controls this cycle inherit
  h-11/min-h-11 patterns; the audit fixture passes on the clean tree.
