# Designer Review — Cycle 8

Date: 2026-07-18 KST
Review HEAD: `ff8c5f48`
Role: designer
Mode: source inventory + live production browser review

## Inventory and browser method

I read the complete instructions for the `agent-browser` core, interaction,
query, wait, network, visual, debug, state, and configuration skills before
testing. The design inventory covered all public and protected-admin route
surfaces, 61 component files and UI primitives, global theme/motion/forced-
colors CSS, English/Korean messages, responsive image/layout helpers, 369 unit
test files, 16 Playwright files, governing docs, prior reviews, and the
carry-forward register.

Live read-only checks used isolated `agent-browser` 0.22.2 session
`cycle8-designer` against `https://gallery.atik.kr`:

- `/en` at 320x900: accessibility tree, overflow/reflow, touch boxes, closed
  and open tag disclosure, keyboard-expanded nav, Escape focus restoration,
  search dialog/combobox keyboard flow, light/dark theme, and Load more.
- `/ko` at 320x900: Korean landmarks/control names, `lang`, `dir`, and
  horizontal overflow.
- `/en/admin` at 320x900: login form labels, required/autocomplete attributes,
  password toggle, target sizes, and responsive width. Protected admin pages
  were not mutated or live-tested because credentials were not supplied.
- `/en/timeline` at 1,536 and 2,560 CSS px with DPR 2: real grid/card boxes,
  source `sizes`, selected `currentSrc`, loading priority, FCP/LCP/CLS, a sampled
  interaction duration, console/errors, screenshot, and trace.
- `/en` at 2,560/DPR 2 after Load more expanded the initial four-card response
  to 30 cards: effective columns, card width, `sizes`, `currentSrc`, and image
  loading/priority attributes.

Ephemeral artifacts were kept outside the repository:
`/tmp/c8-mobile.png`, `/tmp/c8-timeline-2560.png`,
`/tmp/c8-designer-trace.json`, and `/tmp/c8-designer-state.json`. The saved
state contained only public theme/locale storage. The CLI request monitor did
not retain navigation requests, so candidate evidence below uses the live
`HTMLImageElement.currentSrc` URL and computed DOM geometry rather than a
claimed byte waterfall. Production had no valid `Abc234Def5` shared-group
fixture, so shared-grid impact is source/geometry validation, explicitly not a
live shared-page claim.

## New finding

### DES-C8-01 — Ultrawide image hints ignore the capped gallery container

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed live on main and archive grids; shared-grid policy confirmed in source with conditional candidate impact**
- Regions: `apps/web/src/lib/responsive-masonry.ts:1-6,42-64`;
  `apps/web/src/components/home-client.tsx:257-272,350-360`;
  `apps/web/src/components/masonry-card.tsx:91-110`;
  `apps/web/src/app/[locale]/(public)/timeline/page.tsx:230-285`;
  `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:192-245`;
  `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:180-245`;
  `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`

Cycle 7 correctly made main-card intrinsic geometry follow the observed grid,
but every responsive source hint still uses viewport fractions (`20vw`,
`25vw`, `33vw`, and so on). The public layout stops growing at a 1,536px
container and its padding leaves a 1,504px main content box. Above that cap,
the rendered cards remain fixed while the declared image slot keeps growing.

Live evidence:

- At 1,536/DPR 2, Timeline rendered a 1,504px grid, five columns, and a 288px
  card. `20vw` was close enough to reality and `currentSrc` selected `_640.avif`.
- At 2,560/DPR 2, the same Timeline geometry remained 1,504px/five columns/
  288px, but `20vw` declared 512 CSS px and every sampled card selected
  `_1536.avif`. The real card needs only 576 source pixels, so 640w is
  sufficient.
- The main page initially exposed four cards, then Load more produced 30 and
  five columns. Each card measured 288px, every sampled source advertised the
  same `20vw`, and newly loaded lazy/auto cards also selected `_1536.avif`.
  This rules out first-card priority and archive-only code as explanations.

Concrete failure: a visitor with an ultrawide DPR-2 display downloads the
1536w AVIF/WebP/JPEG derivative for 288px masonry tiles where the 640w asset
meets the rendered resolution. Pixel area is about 5.8 times larger; byte cost
varies by photograph and codec. This delays useful gallery paint on constrained
connections without improving visible detail.

Archive/year grids share `ARCHIVE_MASONRY_SIZES`, so the live Timeline proof
applies directly to both. Shared groups use the same viewport-owned approach
with `SHARED_GROUP_MASONRY_SIZES` and an additional nested padded container.
At exactly 2,560/DPR 1, `25vw` equals 640px and the two-candidate ladder does
not yet over-select; above that boundary it selects 1536w for an approximately
356px four-column card. Because no live share fixture was available, that
shared-group statement is a source-derived conditional result, not runtime
production evidence.

Suggested fix: generate server-emittable `sizes` expressions from the capped
container, padding, column gaps, and effective column count, for example with
CSS `min()`/`calc()` rather than a hydration-time measurement. Reuse one helper
for main, archive/year, and shared-grid container variants. Add browser cases
for a normal five-column main/archive grid at 2,560/DPR 2 expecting 640w, plus
a shared-grid viewport just above 2,560 at DPR 1. The present 2,560 test has
only two 744px cards, which legitimately require 1536w and therefore cannot
detect this failure.

## Revalidated design behavior and limitations

- **Information architecture and affordances:** named main navigation, main,
  headings, tag disclosure, unique photo links, Load more, and footer were
  present. Timeline/Map/topics live in the expanded mobile navigation rather
  than crowding the collapsed bar.
- **Keyboard/focus/ARIA:** keyboard activation of Expand menu focused the first
  revealed topic (`TWS`); Escape collapsed and restored focus to the toggle.
  The closed tag group computed `display:none`/zero height, while opening it
  exposed nine buttons and moved the first card down. These close the Cycle 3
  disclosure findings.
- **Search:** opening focused `#search-input`, locked body scroll, and reported
  combobox expanded=false with no listbox. Searching `TWS` created the
  controlled listbox, ArrowDown set `aria-activedescendant`, and Escape closed
  the dialog and restored the trigger.
- **WCAG 2.2 responsive/touch:** at 320px, document and body widths were 320px
  with no horizontal overflow. Visible home/nav/search/tag/photo/login controls
  were at least 44px; the login form remained within the viewport with labelled
  required username/password fields and correct autocomplete values.
- **Theme/contrast:** live light used white with `rgb(9,9,11)` foreground; dark
  used `rgb(9,9,11)` with `rgb(250,250,250)` foreground. Theme classes and
  accessible labels advanced together. Forced-colors and reduced-motion rules
  remain at `apps/web/src/app/[locale]/globals.css:165-181,276-323`; reduced
  motion was source-reviewed because the documented CLI media command exposes
  color scheme, not reduced-motion emulation.
- **Loading, empty, error, validation:** search/loading/no-results, Load more
  announcements, photo loading shell, public/admin error boundaries, map
  fallback, home/shared empty states, and persistent login/admin validation
  patterns were reviewed. No new distinct state defect survived. Authenticated
  admin workflows remain a live-validation limitation.
- **i18n/RTL:** Korean rendered `lang=ko`, `dir=ltr`, localized landmarks and
  controls, and no 320px overflow. English and Korean are the only shipped
  locales and both are LTR; RTL is future compatibility rather than a reachable
  product state.
- **LCP/CLS/INP-facing behavior:** sampled warm production Timeline at
  2,560/DPR 2 produced LCP around 356ms, CLS 0, no long task, and a theme-toggle
  interaction event duration around 40ms. Mobile samples also produced CLS 0.
  These are diagnostics, not a benchmark; the selected LCP URL itself ended in
  `_1536.avif`, reinforcing DES-C8-01 despite the fast warm sample.
- **Errors/debugging:** exercised pages produced no uncaught page error or
  console warning. Network-monitor output was empty as noted above, so it was
  not used as positive evidence.

Existing keyboard-pannable zoom, mobile admin navigation/workbench, field-level
admin recovery, topology, and browser-matrix items remain in
`.context/plans/deferred-carry-forward.md` and were not re-filed as new.

## Final missed-issue sweep

The final sweep revisited route hierarchy, landmarks/headings, names and states,
Tab/Shift+Tab/Escape flow, focus restoration, disclosure containment, modal
behavior, touch targets, light/dark/forced-colors/reduced motion, 320/1,536/
2,560 reflow, loading/empty/error/form states, EN/KO and RTL applicability,
image candidate selection, LCP/CLS/INP-facing behavior, source/test history,
and protected-admin limitations. No second current designer finding had enough
distinct evidence to file.
