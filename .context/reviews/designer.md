# Designer Review — Cycle 2

Date: 2026-07-18 KST
Review HEAD: `ba4bc60a`
Role: designer
Mode: static + live browser review

## Inventory and runtime method

I read `AGENTS.md`, `CLAUDE.md`, and the complete instructions for the
`agent-browser`, configuration, interaction, query, visual, debug, network, and
wait skills. I inventoried the 61 components, 80 app route/page files, English
and Korean messages, global/Tailwind styling, 374 unit/e2e files, touch-target
and focus audits, and public/admin state components. The review covered IA,
affordances, focus/keyboard, WCAG 2.2, responsive/reflow, loading/empty/error,
form feedback, light/dark/system theme, i18n, RTL applicability, and perceived
performance.

Live production checks covered desktop 1280x800 and mobile 320x700/393x852,
collapsed and expanded nav, full accessibility snapshots, computed boxes,
Tab/Escape focus behavior, search/no-results, theme switching, screenshots,
console/page errors, and a fresh-context resource timeline. The current locales
are English and Korean and both are LTR; RTL is therefore not a currently
reachable product state rather than an exercised language path.

## New finding

### DES-C2-01 — Search announces an expanded combobox even when no popup exists

- Severity: **Medium** (WCAG 4.1.2 / ARIA state semantics)
- Confidence: **High**
- Status: Confirmed new finding with live accessibility/DOM evidence
- Regions: `apps/web/src/components/search.tsx:402-414,444-453,493-520`;
  positive test pin at `apps/web/src/__tests__/search-status-source.test.ts:29-40`

The input has `role="combobox"` and `aria-expanded={isOpen}`. `isOpen` describes
the outer search dialog, not the combobox popup. As soon as the dialog opens,
the combobox reports expanded even before a result list exists; for an empty
query or settled no-results state there is no `#search-results` listbox and no
`aria-controls` target at all.

Runtime evidence at 320px: after searching `zzzznotfound`, visible feedback was
"No results", no `role=listbox` existed, `aria-controls` was absent, but the
input's `aria-expanded` remained `true`. The source test explicitly requires
this mismatch and rejects `aria-expanded={hasDisplayedResults}`.

Concrete failure scenario: a screen-reader user hears that the combobox is
expanded, tries list navigation, but there is no popup or controlled element.
The state conflates the modal dialog with the result suggestion popup and makes
the widget's available interaction unclear.

Suggested fix: set combobox `aria-expanded={hasDisplayedResults}` (or another
boolean that exactly tracks listbox presence), and keep the trigger button's
separate `aria-haspopup="dialog"`/expanded state for the modal. Update the
source test and add live accessibility assertions for empty, loading,
no-results, results, and closed states.

## Revalidated responsive/perceived-performance issue

### DES-C2-R1 — Mobile cold start spends bandwidth on four below-fold cards

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed new implementation regression, shared with PERF-C2-01
- Regions: `apps/web/src/components/home-client.tsx:94-108,299-309` and
  `apps/web/src/components/masonry-card.tsx:121-124,143-145`

At 320px the first five 640px AVIFs began together before hydration, totaling
about 409 KiB, while only the first card remained eager/above-fold. On a slow
mobile connection this competes with the content the visitor can actually see.
Use a pre-hydration responsive priority mechanism and test cold request counts
at mobile and desktop breakpoints.

## Verified design behavior / non-findings

- The cycle-1 320px zero-width-home-link failure is closed: collapsed nav had
  no horizontal overflow; the home link was 88x44 and every visible control was
  at least 44x44 without overlap. The visible title is truncated to `ATIK.K...`
  at the minimum width, but retains a meaningful visible brand fragment and the
  full accessible name, so I did not classify it as a WCAG defect.
- Expanded 320px nav exposes full branding/topics and 44px controls; DOM focus
  order follows the visual control order.
- Search is a full-height mobile dialog, focuses the input, locks background
  scroll, traps focus, closes with Escape, and restores focus to its trigger.
- Mobile cards provide visible titles without hover; empty/no-result feedback,
  touch targets, light/dark surfaces, and the exercised Korean/English paths
  showed no overflow or page/console error.

## Final missed-issue sweep

The final sweep revisited navigation hierarchy, landmarks/headings, accessible
names, focus-visible treatment, keyboard-only paths, control sizing, text
contrast fixtures, 320px reflow, desktop/mobile loading, errors/empty states,
forms, theme persistence, bilingual strings, and current LTR directionality.
Admin authentication was not mutated because credentials were not part of the
review scope; admin state coverage therefore also used its static/e2e source.
No additional confirmed designer issue survived the sweep.
