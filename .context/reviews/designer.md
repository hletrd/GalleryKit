# Cycle 4 Designer Review

Review HEAD: `01d39653`. I read and used the complete agent-browser core,
interact, query, wait, network, visual, debug, state, and config skills. The
deployed app was exercised at 393x852, 320x700, and 1536x900 with accessibility
snapshots, keyboard focus, search states, computed rectangles/styles, dark
theme, request/debug buffers, trace, and full-page captures. Raw screenshots
were not used as evidence.

## DES-C4-01 — The masonry browser test does not preserve its visual-layout contract

- Severity / confidence: **Medium / High**
- Status: **Confirmed test/evidence defect; current production behavior itself
  was not observed broken**
- Region: `apps/web/e2e/masonry-priority.spec.ts:20-32`
- Browser evidence: at 1536x900 the top edge was `y=196`; visual leaders
  included non-contiguous DOM indices 0, 6, 13, and 16. Only index 0 carried
  `loading=eager` / `fetchpriority=high`, as intended. At 393x852 index 0 was
  the sole top leader. The committed spec never collects these rectangles, so
  its desktop and mobile variants do not distinguish their actual layouts.
- Failure scenario: a breakpoint or masonry-class regression moves index 0
  away from the top edge while leaving its attributes unchanged; the test
  passes and explicit priority targets a below-fold card again.
- Fix: derive visual leaders from `getBoundingClientRect()` at each viewport,
  assert index 0 is a leader, assert multiple/non-contiguous leaders exist on
  desktop, then assert only index 0 owns explicit priority.

## Live UX sweep

- Mobile tag disclosure was collapsed with a 44px summary and no rendered tag
  panel; opening/collapsing preserved flow.
- Keyboard Enter on **Expand menu** focused the first revealed topic; Escape
  restored the toggle. Topic controls were 44px tall.
- Search correctly exposed a dialog, combobox/listbox ownership, result count,
  arrow-key guidance, and body scroll lock; Escape closed it.
- Dark theme produced the expected dark root/background. Global reduced-motion
  CSS remains present; this CLI build did not successfully emulate the media
  query, so no finding depends on that unverified runtime state.
- No page errors were captured. Authenticated admin, RTL (unsupported locales),
  and a true cold-cache performance profile remain manual-validation limits.

## Final sweep

No additional fresh IA, affordance, focus, WCAG 2.2, responsive, empty/error,
theme, i18n, or perceived-performance defect survived source and live checks.
