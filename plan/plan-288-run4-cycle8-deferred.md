# Plan 288 — Run-4 Cycle 8 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle8/_aggregate.md`
All 10 numbered findings are scheduled in
`plan/plan-287-run4-cycle8-fixes.md`. Security/correctness findings
(COR-R4C8-01/02/04/05/06/07) are fixed, not deferred, per the
non-deferrable rule. This ledger records (a) the 4 designer-angle LOW
observations deferred this cycle, (b) the fresh re-audit of standing
deferrals. Severity/confidence preserved (no downgrades). Deferred work
remains bound by repo policy (GPG-signed commits, Conventional Commits
+ gitmoji, no `--no-verify`, Node 24 / TS 6 toolchain) when picked up.

## New deferrals this cycle (all LOW; none security/correctness/data-loss)

- **DEF-R4C8-A — paid-download GET error bodies are unlocalized
  text/plain** (`apps/web/src/app/api/download/[imageId]/route.ts`
  validation branches; designer angle, LOW/High). The c7 interstitial
  polished the happy path; 400/403/404/410 remain bare ASCII on the
  same customer journey. Cycle 7 deliberately preserved the taxonomy
  verbatim and the method-contract suite pins response shapes. Reason
  for deferral: cosmetic on a tokened edge path; changing bodies
  touches the locked contract tests and deserves its own pass. Exit
  criterion: any customer-confusion report, or the next change to the
  download route.
- **DEF-R4C8-B — interstitial double-submit lands the second POST on a
  plain 410** (`lib/download-interstitial.ts`; designer angle,
  LOW/High). No integrity risk (atomic claim); JS-free page under
  `default-src 'none'` cannot disable the button client-side. Exit
  criterion: same as DEF-R4C8-A (fold both into one route follow-up).
- **DEF-R4C8-C — ImageZoom `preventDefault` in React touch handlers is
  a passive-listener no-op** (`apps/web/src/components/image-zoom.tsx`
  touchmove/touchend paths; designer angle, LOW/Medium). Behavior is
  correct via `touch-action: none`; the calls only produce Chromium
  intervention console noise during gestures. Reason: cosmetic;
  removing the calls without a gesture-matrix retest risks regressing
  iOS Safari edge cases for zero user-visible gain. Exit criterion:
  any future ImageZoom gesture refactor, or a user report of console
  noise in support bundles.
- **DEF-R4C8-D — dynamic Tailwind `columns-${n}` classes safelisted
  only by a comment** (`apps/web/src/components/home-client.tsx:237` +
  the AGG1L-LOW-02 comment block; designer angle, LOW/Medium). The
  clamp cascade currently yields correct layouts for every item count
  because clamped values are monotonic across breakpoints and missing
  classes fall back to the lower breakpoint's equal value. Reason:
  no user-visible defect today; the right fix (static class map or
  Tailwind safelist) is a refactor of a working surface. Exit
  criterion: any Tailwind config change, any edit to that comment
  block, or a masonry column-count bug report.

## Carried non-scheduled LOW observation (from cycle 7, unchanged)
- Histogram mode-cycle button aria-label omits the current mode
  (`components/histogram.tsx`, LOW/Medium; plan-286). The adjacent
  `role="img"` canvas label announces the mode. Re-open criterion
  unchanged (SR-user feedback or fresh designer finding).

## Standing deferrals re-audit (all exit criteria un-triggered this cycle)
- **DEF-R4C1-01** (plan-274) — LR route `revalidateAllAppData()`
  breadth. Checked: all public pages still export `revalidate = 0`
  (p/[id] and g/[key] re-verified in this cycle's reads). Remains
  deferred.
- **DEF-R4C2-01** (plan-276) — tokens UI grants all three scopes.
  Checked: sole consuming route remains `api/admin/lr/upload`
  (`lr:upload`). Remains deferred.
- **DEF-R4C3-01** (plan-278) — LR upload route error strings hardcoded
  English (machine-client surface). Checked: no LR plugin
  localization, no browser consumer. Remains deferred.
- **OPS-R4C6-01** (plan-284) — production host nginx lacks the repo's
  `/uploads/` location block (original severity MED/High preserved).
  Checked: no host-level nginx maintenance occurred this cycle; the
  `next.config.ts headers()` policy remains the serving authority.
  Remains deferred with the plan-284 runbook intact.
