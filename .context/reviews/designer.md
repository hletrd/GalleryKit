# Designer Review — Cycle 3

Date: 2026-07-18 KST
Review HEAD: `afa11cf4`
Role: designer
Mode: source inventory + live production browser review

## Inventory and method

I read `AGENTS.md`, `CLAUDE.md`, the prior designer/UI reviews and carry-forward
register, plus the complete instructions for the `agent-browser` core,
configuration, interaction, query, visual, debug, network, state, and wait
skills. The UI inventory covered all localized public and protected-admin route
surfaces, 61 component files (including UI primitives), global theme and motion
CSS, English/Korean messages, 12 Playwright files, and the unit/source-contract
tests for touch targets, focus indicators, ARIA, contrast, i18n, and error
shells.

Live read-only checks used `agent-browser` 0.22.2 against
`https://gallery.atik.kr`:

- Desktop `/en` at 1536x900: accessibility tree, card geometry and image
  priority attributes, resource hints, theme state, timings, errors/console,
  screenshot, and trace.
- Mobile `/en` at 393x852 in both reused and fresh cache-busted sessions:
  reflow/overflow, touch boxes, collapsed/open tag disclosure, expanded nav Tab
  sequence, and hit testing.
- Mobile search: initial/results states, combobox ownership, ArrowDown, Escape,
  scroll lock, focus trap, and trigger focus restoration.
- `/en/admin`: labels, required/autocomplete states, password visibility, and
  target sizes. No login was submitted and protected admin pages were not live
  tested because credentials were not supplied.
- `/en/p/348`: viewer landmarks, controls, photo loading attributes, and
  keyboard-facing affordances.

Browser artifacts were kept outside the repository at
`/tmp/c3-mobile-fresh.png`, `/tmp/c3-desktop-light.png`, and
`/tmp/cycle3-designer-trace.json`. The CLI's media emulation reported success
but did not change `matchMedia`, and a later locale-switch session timed out;
reduced motion and locale direction therefore have source/test evidence rather
than a trustworthy emulated runtime result. Network monitoring was enabled too
late to retain the cold request log, so the performance finding below relies on
live DOM geometry/resource hints and attributes, not claimed byte timing.

## New findings

### DES-C3-01 — Closed mobile tag disclosure leaves its flex panel laid out under the photo grid

- Severity: **High**
- Confidence: **High**
- Status: **New cycle-3 finding**; not present in prior review history
- Region: `apps/web/src/components/tag-filter.tsx:143-160`

The closed `<details>` contains a panel with the author utility `flex`. That
author declaration overrides Chromium's user-agent rule that hides non-summary
children of closed details. In a fresh 393px production session, before any
interaction, `details.open` was `false`, the summary was 361x44 at y=180, but
the chip group still computed to `display:flex` with a 361x200 rectangle at
y=232. The closed details box itself remained only 44px tall, and the first
masonry card began at y=256.

This produces two inconsistent layers: the closed disclosure removes the tag
buttons from the accessibility tree and tab sequence, while its panel still
takes visual geometry under the following grid. Hit testing a nominal chip
coordinate returned the photo overlay/image rather than the tag button. The
fresh screenshot consequently showed the collapsed summary followed by photos,
with the leaked chip layer painted underneath them. Opening the disclosure
made the details box 252px tall, exposed the chips to accessibility/Tab, and
pushed the first card to y=464; closing reproduced the broken geometry.

Concrete failure: a mobile visitor sees the intended compact filter affordance,
but the hidden panel remains a 200px overlapping layer whose controls cannot be
read or activated. Layout and accessibility disagree about whether the content
exists.

Suggested fix: make the panel explicitly hidden until open, for example
`hidden group-open:flex flex-wrap gap-2`, or add a precise
`details:not([open]) > [role="group"] { display: none; }` rule. Add a real
mobile browser regression that asserts the closed group has no rendered box or
hit target, then asserts opening exposes its buttons and moves the grid down
without overlap. A source-only check for `<details>` would not catch the CSS
cascade failure.

### DES-C3-02 — Expanded mobile menu reveals links before the toggle in DOM order, so Tab skips them

- Severity: **Medium** (WCAG 2.4.3 focus order / disclosure usability)
- Confidence: **High**
- Status: **New cycle-3 finding**; prior tests cover collapsed order only
- Region: `apps/web/src/components/nav-client.tsx:112-167,169-216`;
  incomplete regression at
  `apps/web/src/__tests__/client-source-contracts.test.ts:64`

The topic links render before the search/theme/locale controls and menu toggle
in DOM order. Collapsed mobile presentation is sensible because those links are
hidden and the controls precede the toggle visually. Once the toggle reveals
the topic region above the controls, however, focus remains on the toggle even
though the newly visible links are earlier in DOM order.

Live mobile sequence: activate **Expand menu**, then press Tab. Focus moved
directly from **Collapse menu** into the main-content **Filter by tag** summary;
it skipped the now-visible TWS/TXT links. Escape also left the menu expanded.
Pointer users can see and select the links, but a keyboard user who opened the
disclosure must reverse-tab through unrelated header controls to reach the
content just revealed.

Suggested fix: use a DOM structure whose order remains logical in both states
(for example, place the controlling toggle before its controlled topic panel),
or deliberately focus the first revealed link after keyboard activation.
Support Escape to collapse and restore focus to the toggle. Add mobile
Playwright coverage for open -> Tab/Shift+Tab -> Escape; the existing
source-contract assertion that controls precede the toggle protects only the
collapsed bar.

### DES-C3-03 — CSS-column geometry and image-priority scheduling disagree about the visual first row

- Severity: **Medium** (LCP/perceived-performance regression)
- Confidence: **High**
- Status: **New cycle-3 finding**, independently shared with
  `PERF-C3-01`, code review, architecture, and tracer lanes
- Regions: `apps/web/src/components/home-client.tsx:129-169,272-314,363-375`;
  `apps/web/src/components/masonry-card.tsx:121-145`

The scheduling helpers treat DOM indices `0..columnCount-1` as above-fold and
preload indices 1-4 at desktop breakpoints. CSS multi-column layout flows and
balances content column-major, so those indices are not the leaders of the
visual columns.

At 1536px production rendered five 288px columns. Cards 0-4 were all in the
left column and marked eager/high, while the second-column leader was card 6 at
y=196 and remained lazy/auto. Four media-qualified image preload links also
targeted indices 1-4. An isolated Chromium proof with 20 equal cards similarly
placed top-row DOM indices at 0/5/10/15, not 0/1/2/3. Thus the browser is asked
to prioritize below-fold left-column images while later-column LCP candidates
keep default priority.

Suggested fix: keep explicit priority to the universally visible first item
unless layout placement becomes deterministic. If multiple column leaders must
be accelerated, derive explicit columns/grid from known image dimensions or
measure actual geometry before issuing opportunistic hints. Add a cold-cache
browser test that correlates requested/preloaded image IDs with each card's
`getBoundingClientRect().top`; count-only or source-string assertions cannot
prove the visual invariant.

## Revalidated behavior and carry-forward

- Search now correctly reports `aria-expanded=false` with no popup and switches
  to `true` only when a controlled `#search-results` listbox exists
  (`search.tsx:402-453,493-520`). With results, ArrowDown updated
  `aria-activedescendant`; Escape closed the modal and restored focus to the
  search trigger. This closes the cycle-2 designer finding.
- At 393px there was no horizontal overflow. Visible nav, filter, photo, search,
  and login controls were at least 44px. Desktop/mobile accessibility snapshots
  had named navigation/main regions, a single page H1, unique photo-link names,
  and labelled theme/language/search controls.
- Theme switching exercised system/dark/light states and updated both document
  classes and accessible labels. Dark and light foreground/background pairs
  were high contrast in the sampled pages. Global reduced-motion suppression
  and no-hover-scale rules remain at `apps/web/src/app/[locale]/globals.css:276-323`;
  the CLI emulation limitation above prevents claiming a live reduced-motion
  pass.
- Login fields have persistent labels, required/autocomplete semantics,
  `aria-invalid`/described errors, a 44px show-password toggle, and a persistent
  alert path (`apps/web/src/app/[locale]/admin/login-form.tsx:55-133`).
  Authenticated admin surfaces remain a live-validation limitation.
- English and Korean message/key surfaces were inspected; both shipped locales
  are LTR. The root derives direction for future locale support, but no RTL
  locale is currently reachable, so RTL was assessed as future compatibility,
  not a live product state.
- Existing carry-forward items were not re-filed as new: keyboard-pannable zoom
  (`C94-06/C93-09`), mobile admin navigation/workbench redesign
  (`C94-07/C93-10`, `C94-08/C93-11`), SEO field-level recovery (`C96-09`), and
  restore oversize inline recovery (`C96-11`) remain registered in
  `.context/plans/deferred-carry-forward.md:125-138`.

## Required-area coverage

- **IA and affordances:** public nav, expanded topics, search, tag filtering,
  footer/browse routes, photo controls, and admin login reviewed. Findings
  DES-C3-01/02 affect the two mobile disclosures.
- **Keyboard, focus, ARIA, WCAG:** skip link, focus rings, focus order, modal
  trap/restoration, combobox/listbox state, live regions, touch targets,
  disclosure state, and reduced motion reviewed. Search passed; expanded nav
  did not.
- **Responsive behavior:** 393px and 1536px reflow, overflow, control boxes,
  masonry geometry, mobile full-screen search, and login layout exercised.
- **Loading, empty, error, and validation:** home/search empty states, photo
  loading shell, route/global/admin error components, load-more status, login
  validation, and protected-admin source patterns reviewed. No new distinct
  issue beyond registered admin carry-forward survived.
- **Theme, contrast, i18n, RTL:** live theme cycling plus token/forced-colors/
  reduced-motion source, EN/KO messages, and locale-derived direction reviewed.
- **Perceived performance:** live FCP was about 328ms, TTFB about 64ms, and no
  layout-shift entry appeared in the sampled warm desktop trace. These are
  diagnostic samples, not a benchmark. DES-C3-03 is supported by actual card
  placement and priority attributes and remains material despite the fast warm
  trace.

## Final missed-issue sweep

The final pass revisited landmarks/headings, control names and states, visible
focus, Tab/Shift+Tab/Escape paths, modal containment, 44px targets, contrast and
forced colors, 393px reflow, desktop masonry placement, loading/empty/error
copy, form recovery, dark/light/system theme, reduced motion, bilingual strings,
RTL applicability, and LCP/CLS/INP-facing behavior. It also searched prior
reviews/plans before assigning new status. No fourth current designer issue had
enough distinct evidence to file.
