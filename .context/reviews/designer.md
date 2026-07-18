# Cycle 7 Designer / UI-UX Review

Date: 2026-07-18 KST
Review HEAD: `ec7fc46f`

## Method and coverage

This is a web UI, so I used the required agent-browser core, interaction,
query, wait, network, visual/debug, state, and configuration workflows against
`https://gallery.atik.kr`. I inspected accessibility snapshots, DOM order,
computed styles, box geometry, ARIA/state, console/errors, network state, and
responsive behavior at 320, 393, 1,536, and 2,560 CSS pixels in light/dark and
reduced-motion modes. I exercised search open/Escape, mobile navigation
expansion, pointer/keyboard focus behavior, tag disclosure, gallery/card
navigation, source selection, and touch targets. I also reviewed public/admin
source for loading/empty/error states, forms, focus traps, i18n, and responsive
breakpoints. Korean/English are both LTR, so an RTL rendering claim is not
applicable to the shipped locale set.

## Finding

### UX-01 — Virtualized masonry over-reserves cold card geometry by up to 70%

- Severity / confidence / status: **Medium / High / Confirmed live UX defect**
- Regions: `apps/web/src/components/home-client.tsx:22-79,231-249`;
  `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`;
  `apps/web/src/components/masonry-card.tsx:60-76`;
  `apps/web/src/app/[locale]/globals.css:231-235`
- Text evidence: at 320 px, the masonry grid box was exactly `x=16,
  width=288`; landscape cards rendered at about `288x192`, but computed
  `contain-intrinsic-size` was `auto 224px`. A portrait card rendered 431.75
  px high but advertised 504 px. The estimator uses a 336 px rounded viewport
  bucket and never subtracts the layout's 16 px padding on each side.
- Ultrawide evidence: at 2,560 px, a two-photo filter rendered a centered
  1,504 px grid and two
  744x496 cards, but computed intrinsic height was 843 px (70% high) because
  the estimator continued growing past the container's cap.
- User impact: these values are the cold fallback for
  `content-visibility:auto`; after a card has rendered, the `auto` keyword can
  retain its actual size. First-time skipped cards still define too much
  virtual scroll extent and contract when activated, shifting later scroll
  targets. The error is material at both the narrow inset and ultrawide cap.
- Fix: measure/bucket the actual masonry content box and base intrinsic height
  on its effective column width. Add live 320 px and 2,560 px regressions.

## Other UX results and final sweep

- Information architecture and landmarks were coherent; skip link, nav, main,
  footer, H1/H2/H3 structure, and photo link names were present.
- Mobile controls and visible tag/nav actions measured at least 44x44 px.
- Keyboard activation of the mobile disclosure deliberately focuses the first
  revealed link and Escape restores the toggle; pointer activation correctly
  keeps pointer focus behavior stable.
- Search opened as a modal dialog, focused its input, and closed on Escape.
- No horizontal overflow, uncaught page error, or new console failure appeared
  at tested breakpoints. Dark/light tokens remained legible in computed state.
- Loading, empty, error, validation, focus-trap, reduced-motion, and i18n
  source paths had dedicated handling and existing tests. No second new UX
  issue survived the final missed-issue sweep.
