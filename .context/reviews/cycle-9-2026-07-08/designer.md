# GalleryKit UI/UX + A11y Review — Cycle 9 (2026-07-08)

**Reviewer:** designer lane (UI/UX, IA, WCAG 2.2)
**HEAD at review:** `6efd737b` ("fix(cycle18): harden review-plan-fix findings")
**Method:** hybrid. Static source review of `components/` and `app/[locale]/**`, plus live
verification against a running dev server (`localhost:3000`, DB reachable, E2E seed data —
2 photos, topic "E2E Smoke", tags `e2e`/`landscape`/`portrait`) via `agent-browser`
(accessibility snapshots, live DOM/attribute inspection through `eval`, and real click
interaction). A peer session is concurrently editing this same repo, so every live-DOM
observation below was cross-checked with a plain `document.querySelectorAll` + attribute
read (not just the accessibility-tree `snapshot` command, which I found to be unreliable in
this session — see the methodology note at the end) before being written up as a finding.

## Scope and baseline

This repo has an exceptionally deep designer-review lineage; the most recent prior pass
(`cycle-8-2026-07-07/designer.md`) found **zero** new issues after an exhaustive sweep (touch
targets, positive tabIndex, autoFocus, image alt coverage, icon-button aria-label coverage,
i18n key parity, dialog-close-during-mutation guards, live regions, reduced motion,
focus-visible rings). Per the task brief, the following are already tracked by the peer
cycle-18 register and are **not** re-reported here: mobile home tag-wall pushing the first
photo below the fold, admin table-first IA (not a photo workbench), flat admin nav strip,
credentialed-admin responsive validation, and RTL support.

Given how thoroughly the last several cycles have scoured the obvious surfaces (nav, tag
filter, search dialog, upload dropzone, admin dialogs, touch targets, contrast tokens
including the `.oled` theme, i18n parity), this cycle focused on: (1) components not
explicitly re-verified byte-for-byte in the last few cycles (`on-this-day-widget.tsx`,
`load-more.tsx`, `home-client.tsx`, `map/map-client.tsx` + `/map/page.tsx`, `tag-filter.tsx`,
`tag-input.tsx`, `image-zoom.tsx`), and (2) a systematic grep for stateful toggle/disclosure
controls across the toolbar-heavy photo viewer and lightbox, cross-checked against how the
same codebase handles equivalent controls elsewhere (it turns out to have a clear, consistent
convention — which is what exposed the one real gap below).

## Findings

### DES9-01 — Photo-viewer "Info" panel controls (desktop pin toggle + mobile disclosure trigger) expose their open/closed state only via a changing text label, never via `aria-pressed`/`aria-expanded` [SEV: MEDIUM | CONF: High]

**Where:**
- Desktop toggle: `apps/web/src/components/photo-viewer.tsx:652-667` — the `hidden lg:flex`
  `<Button>` that pins the info panel open (`variant={isPinned ? "default" : "outline"}`,
  icon `PanelRightOpen`/`PanelRightClose`, label `t('viewer.info')` ("Info") ↔
  `t('viewer.infoPinned')` ("Pinned")). This directly controls `showInfo = isPinned`
  (`photo-viewer.tsx:203`), which shows/hides the adjacent info column in the
  `grid-cols-1 lg:grid-cols-[1fr_350px]` layout (`photo-viewer.tsx:671-673`).
- Mobile trigger: `apps/web/src/components/photo-viewer.tsx:602-615` — the `lg:hidden`
  `<Button ref={mobileInfoButtonRef}>` (`onClick={() => setShowBottomSheet(true)}`) that opens
  `info-bottom-sheet.tsx`'s `role="dialog" aria-modal="true"` sheet
  (`info-bottom-sheet.tsx:266-268`).

**Problem:** Both buttons are genuine two-state controls (closed/open) whose ONLY
programmatically-exposed signal of state is the accessible name switching text ("Info" ↔
"Pinned" on desktop; the mobile button's name never changes at all even though the sheet it
opens is either mounted or not). Neither carries `aria-pressed` (desktop, a toggle button) nor
`aria-expanded`/`aria-controls` (mobile, a disclosure trigger for the sheet). Live-verified on
`/en/p/112` (1440×900 viewport): both the mobile and desktop "Info" buttons return
`aria-pressed: null` and `aria-expanded: null` before any interaction, and grepping the whole
file confirms zero `aria-pressed`/`aria-expanded` occurrences anywhere in `photo-viewer.tsx`.

This is a real inconsistency, not a stylistic choice — the same codebase gets this right
elsewhere on the very same page: `lightbox.tsx:634` sets `aria-pressed={isSlideshowActive}` on
its play/pause toggle, `info-bottom-sheet.tsx:301` sets
`aria-expanded={sheetState === 'expanded'}` on its own internal expand handle, and
`nav-client.tsx:183-184` sets `aria-expanded={isExpanded}` +
`aria-controls="primary-nav-topics primary-nav-controls"` on the mobile nav's expand toggle.
The Info-panel pair is the one stateful control on this page that doesn't follow the
established pattern.

**Who it affects:** Screen reader and switch/voice-control users. A sighted mouse user gets
instant visual confirmation of state via the color/icon swap; a screen reader user only hears
the button's accessible name once (on focus) and has no reliable way to know — without
re-reading it after every interaction — whether the info panel is currently open or the last
click actually changed anything. This is the exact case `aria-pressed`/`aria-expanded` exist
to solve (state should be programmatically determinable, not inferred from a name that happens
to change).

**WCAG:** 4.1.2 Name, Role, Value (Level A). Secondary: ARIA APG toggle-button and disclosure
patterns (best-practice reference, not a numbered SC).

**Suggested fix:**
- Desktop button: add `aria-pressed={isPinned}`. Optionally add `aria-controls` pointing at the
  info column's container (it doesn't currently have an `id`; one would need to be added).
- Mobile button: add `aria-expanded={showBottomSheet}` and `aria-controls="<sheet-id>"`
  (`info-bottom-sheet.tsx`'s dialog root at line 266 doesn't have an `id` yet either — add one
  and reference it from both `mobileInfoButtonRef`'s button and the sheet's own
  `aria-labelledby`/`aria-controls` wiring).

**Confidence:** High — confirmed by static grep (zero `aria-pressed`/`aria-expanded` in the
file) and by live DOM attribute inspection on the running dev server before and after
interaction; cross-referenced against three other stateful controls in the same file/route
that do this correctly, ruling out "the codebase doesn't do this" as an explanation.

## Methodology note (tooling caveat, for whoever picks this up next)

While investigating this cycle, `agent-browser snapshot` intermittently omitted entire
landmarks (the `<nav>` and all masonry-grid photo links) from its accessibility tree on the
home page, even though a fresh SSR `curl` and a live `document.querySelectorAll` both showed
the elements present and correctly attributed. Likewise, `find role button click`/`find role
link click` occasionally reported "Element not found" for links a raw DOM query confirmed
existed, and one long-lived browser session accumulated a stuck client-side transition (a
photo page wedged on `loading.tsx`'s "Loading photo…" fallback, with `PhotoNavigation`'s
buttons reporting a zero-size bounding rect) that did **not** reproduce in a fresh session —
i.e., a false lead I initially suspected was a broken "Next photo" button turned out to be
accumulated dev-session/HMR state, not a product bug (confirmed by closing the browser,
reopening fresh, and successfully clicking through `/p/113` → `/p/112`). Recommend treating the
accessibility-tree `snapshot`/`find role` commands as advisory only in this environment and
cross-checking anything load-bearing with a direct `eval` + `querySelectorAll` before reporting
it, and preferring a fresh browser session over a long-lived one for click-through testing.

## Summary

| Category | Count |
|---|---|
| CRIT | 0 |
| HIGH | 0 |
| MEDIUM | 1 (DES9-01) |
| LOW | 0 |

**1 new finding this cycle** (DES9-01, WCAG 4.1.2, High confidence). No new sub-44px touch
targets, no new missing-alt/missing-label defects, no i18n key drift, and no regression in
anything the last several cycles verified. The map page's interactive-map accessibility
(skip link, sr-only region label/instructions, and a full text-list fallback of every marker
at `app/[locale]/(public)/map/page.tsx:80-110`) and the tag-input combobox
(`tag-input.tsx:200-296`, correct `role="combobox"`/`aria-activedescendant`/`role="option"`
pattern) were both re-verified fresh this cycle and remain correct — called out here since
they hadn't been read closely in the last few cycles' "Pass" lists.
