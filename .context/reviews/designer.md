# Designer — Cycle 6 Provenance

Review target: `6e4c25c8`. Web UI review used the required agent-browser core, interact, query, wait, network, visual, debug, state, and config instructions. No local server was running, so I inspected the live production app that exposes the Cycle 5 policy. Evidence came from accessibility snapshots, textual DOM, computed styles/boxes, currentSrc, console/errors, interactions, and ephemeral `/tmp` screenshots; no screenshot was committed.

## Browser coverage

- 393×852 DPR 3: one-column 361 px cards, `100vw`, 1536w selected; mobile tag disclosure closed; nav expanded/collapsed with 44×44 control and focus moved into the disclosure; search dialog occupied 393×852, input 285×44, close 44×44, focus on input, body scroll locked.
- 768×900 DPR 2: three columns, 736 px grid, 234.66 px card, min-width `33vw` policy, 640w selected; only card 0 eager/high.
- 1,024×900 DPR 2 timeline: three columns, 992 px grid, 320 px card, aligned archive sizes.
- 1,536×900 DPR 2: five columns, 1,504 px grid, 288 px card, 640w selected. Accessibility tree preserved H1 → hidden H2 → card H3 hierarchy and disambiguated photo link names.

## NEW Cycle 6 finding

### DES-C6-01 — Sparse desktop cards reserve the wrong virtualized height

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed computed-style mismatch; visible jump likely/manual-validation**
- Regions: `apps/web/src/components/home-client.tsx:231-274`; `apps/web/src/components/masonry-card.tsx:52-77`; `apps/web/src/app/[locale]/globals.css:231-235`

On a production filter with exactly two photos at 1,536 px, DOM/computed-style evidence showed two columns, a 1,504 px grid, 744×496 cards, correct `50vw` sources and 1536w candidates, but `content-visibility:auto` with `contain-intrinsic-size:auto 196px`. The visual card is correct once rendered; the virtualized stand-in is not.

Concrete failure: in a short-height viewport or a layout where the grid begins beyond the relevance region, the page can reserve around 300 px too little per 3:2 card and shift scroll geometry as the cards become relevant. The common 900 px viewport painted them immediately, so I did not claim an observed jump there.

Fix: derive intrinsic width from the item-capped effective columns or observed grid width, and add short-viewport sparse browser coverage.

## Revalidated and final UI sweep

The Cycle 5 responsive download defect is visibly/runtime closed. Mobile navigation, search focus/scroll lock, touch targets, headings, link names, theme/language controls, tag disclosure containment, and first-card scheduling behaved correctly; page error buffers were empty. Prior mobile-admin/product redesign and browser-matrix items remain carry-forward. No second new designer finding survived.
