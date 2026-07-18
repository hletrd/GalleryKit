# Designer — Cycle 5 Provenance

Review target: `4926a3e4`. I read and used the applicable agent-browser core,
configuration, query, interaction, visual, and debug skills. Production was
loaded and interacted with at 320×700 DPR2, 393×852, 768×852 DPR2,
769×852 DPR2, and 1536×900. Evidence included accessibility snapshots, keyboard
focus, disclosure/search/theme states, computed geometry, responsive source
selection/currentSrc, errors, and full/viewport captures.

The UI inventory covered all localized public/admin route files, 61 components,
global theme/motion CSS, English/Korean messages, all Playwright specs, and the
touch/focus/ARIA/contrast/i18n source-contract tests. Authenticated protected
admin workbenches, RTL (no shipped RTL locale), real color/HDR display hardware,
and exact production build SHA remain manual-validation limits.

## New finding

### DES-C5-01 — Common exact-width tablet view downloads a desktop-sized masonry derivative

- Severity / confidence: **Medium / High**
- Status: **Confirmed live** on the main gallery; archive/share siblings are likely from source parity
- Regions: `apps/web/src/components/masonry-card.tsx:21,94-109`; archive duplicates at `timeline/page.tsx:229,259-285` and `year/[year]/page.tsx:191,218-244`; shared-group policy at `g/[key]/page.tsx:187,218-244`

At 768px the rendered gallery is already three columns, but the responsive image
hint still matches `(max-width: 768px) 50vw`. In a fresh DPR-2 session, the first
card was 234.66px wide and Chromium selected `_1536.avif`. A separate fresh 769px
session rendered the same card width/three-column layout, matched 33vw, and
selected `_640.avif`. The shared gallery similarly advertises slots wider than
its 3/4-column geometry over broad desktop ranges.

Concrete failure: an iPad-class visitor waits for and decodes substantially more
image data at exactly 768 CSS pixels without receiving more visible detail,
hurting perceived gallery paint on constrained networks.

Suggested fix: align `sizes` with the inclusive Tailwind min-width breakpoints,
centralize the main/archive and shared variants, and add high-DPR breakpoint
visual/network regressions.

## Live UX sweep and final missed-issue pass

- At 320px there was no horizontal overflow; nav and first-card geometry stayed
  inside the viewport.
- Mobile tag disclosure was absent while closed and flowed correctly when open.
- Keyboard activation of the menu focused the first revealed link; Escape
  collapsed and restored the toggle.
- Search exposed a named dialog/combobox and restored the search button after
  Escape. Desktop/mobile landmarks and control names were coherent.
- No page errors were captured. Full-page desktop/mobile captures showed no new
  overlap, clipping, empty-state, focus-order, or theme defect.

No additional fresh IA, WCAG, responsive, theme, i18n, or interaction issue
survived the closing sweep.
