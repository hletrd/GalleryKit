# Critic Review — Cycle 3 (RPL loop)

**Date:** 2026-04-23
**Role:** Multi-perspective critique of the whole change surface. Focuses on things that "smell" rather than concrete bugs.

## Critique points

### CRIT3-01 — The photo page lacks a proper semantic structure [MEDIUM]
On a photo gallery app, the photo itself is the primary content object. Yet `/p/[id]` has no `<h1>`, no `<article>` wrapper, and the photo title lives inside a `CardTitle` `<div>` in a sidebar that is `display: none` on mobile. The page's semantics are carried almost entirely by the `<img alt="...">`, which is inadequate for heading-based navigation and screen-reader orientation. A content-first app should have content-first markup.

**Action:** see C3R-UX-01 / CQ3-01.

### CRIT3-02 — The locale switcher says "KO" to a Korean-unaware user [MEDIUM]
The locale-switch button renders `KO` in English UI (and `EN` in Korean UI). A Korean-speaking user sees `EN` and knows that means "switch to English." But a monolingual English user sees `KO` and may not recognize this as "Korean." For inclusive UX, full-name rendering (`한국어` / `English`) plus aria-label would be friendlier.

**Action:** see C3R-UX-02 / CQ3-02. Minimum: add aria-label.

### CRIT3-03 — Touch targets are bang-on at the WCAG minimum, not comfortably above [LOW]
Tag pills at 22px fail 2.5.8 AA by 2px. Footer "Admin" link at 16px fails by 8px. The app consistently uses `text-xs` (12px) for secondary UI, which compounds touch-target pressure. A 4-8px increase is cheap and brings comfort headroom.

### CRIT3-04 — Heading hierarchy is inconsistent across the app [LOW]
- Home: H1 → H3 (skips H2)
- Photo: nothing on mobile, H3 (EXIF label) on desktop in sidebar
- Admin pages: generally H1 (page title) → H3 (card titles, which are `<div>` but some pages use real headings)
- 404: H1 only

No app-wide heading policy — individual authors picked levels ad hoc. This is a systemic cleanup opportunity.

### CRIT3-05 — Low-contrast "hidden" admin affordance pattern is debatable [LOW]
`text-muted-foreground/50` on the footer "Admin" link is a deliberate way to de-emphasize the admin entry. It passes WCAG AA at 4.83:1 (barely), fails AAA. For a single-user personal gallery, this is a reasonable tradeoff. For a multi-admin deployment, it might hinder admins who expect a visible entry point. Worth documenting as a design choice.

### CRIT3-06 — Destructive-action confirmation is inconsistent [LOW]
Most destructive actions use a styled `AlertDialog`; DB restore uses `window.confirm()`. Inconsistency hurts user trust — one dialog looks polished, the next looks like a browser popup.

### CRIT3-07 — Blur placeholder is cargo-culted [LOW]
`blurDataURL="data:image/png;base64,...TRANSPARENT 1x1..."` provides no visual cue during image load. Either generate a real per-image low-res blur at upload time OR remove the field entirely (and rely on `bg-muted/20`). The current middle ground is tech debt disguised as polish.

## Totals

- **2 MEDIUM** (CRIT3-01, CRIT3-02) — overlap with core findings
- **5 LOW** (CRIT3-03 through CRIT3-07)
- All map to existing design/UX findings; no brand-new critique beyond them.
