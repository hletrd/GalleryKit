# Plan 294 — Run-4 Cycle 11 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle11/_aggregate.md`

The one scheduled finding (COR-R4C11-01) is FIXED, not deferred, per the
non-deferrable rule for correctness. This ledger records the LOW UI/UX
observation deferred this cycle and re-audits the standing deferrals.
Severity/confidence preserved (no downgrades). Deferred work remains bound by
repo policy (GPG-signed commits, Conventional Commits + gitmoji, no
`--no-verify`, Node 24 / TS 6) when picked up.

## New deferrals this cycle (none security/correctness/data-loss)

- **DEF-R4C11-A — `photo-navigation.tsx` aria-live region holds a constant
  string** (`apps/web/src/components/photo-navigation.tsx:247-249`; designer
  angle, LOW/Medium). The `aria-live="polite"` node renders the SAME
  `t('aria.photoNavStatus')` string for every photo, so prev/next navigation
  does not change its text and most screen readers announce nothing on
  navigation — the live region is effectively inert for announcing the new
  photo position. Pre-existing (NOT a regression this cycle). Reason for
  deferral: a correct fix interpolates a changing value (photo title or index)
  and therefore changes the i18n string contract (new placeholder in `en.json`
  / `ko.json`), which is a behavior + translation change outside this cycle's
  single-fix HARD-SCOPE budget; zero privacy/correctness risk. Exit criterion:
  a screen-reader-user report on photo navigation, OR a dedicated photo-viewer
  a11y pass.

## Standing deferrals re-audit (all exit criteria un-triggered this cycle)

- **DEF-R4C10-A** (plan-292) — `stripGpsFromOriginal` tier routing trusts the
  user-supplied extension. Checked: no change to `stripGpsFromOriginal` this
  cycle; privacy never compromised (tier-2 strips all metadata). Remains
  deferred. (LOW/Medium)
- **DEF-R4C10-B** (plan-292) — OnThisDay "today" is the server's calendar day.
  Checked: no change to `on-this-day-widget.tsx`. Remains deferred. (LOW/Medium)
- **DEF-R4C1-01** (plan-274) — LR route `revalidateAllAppData()` breadth.
  Checked: `p/[id]` and `g/[key]` still `revalidate = 0`. Remains deferred.
- **DEF-R4C2-01** (plan-276) — tokens UI grants all three scopes. Checked:
  sole consuming route remains `api/admin/lr/upload` (`allowTokenScope:
  'lr:upload'`). Remains deferred.
- **DEF-R4C3-01** (plan-278) — LR upload route error strings hardcoded
  English (machine-client surface). Checked: no LR plugin localization or
  browser consumer appeared. Remains deferred.
- **OPS-R4C6-01** (plan-284) — production host nginx lacks the repo's
  `/uploads/` location block (MED/High preserved). Checked: no host-level
  nginx maintenance this cycle; `next.config.ts headers()` remains the
  serving authority. Remains deferred with the plan-284 runbook intact.
- **DEF-R4C8-A/B** (plan-288) — paid-download GET error bodies unlocalized;
  interstitial double-submit plain 410. Checked: no change to
  `api/download/[imageId]` or `lib/download-interstitial.ts` this cycle.
  Remain deferred.
- **DEF-R4C8-C** (plan-288) — ImageZoom passive-listener `preventDefault`
  no-ops. Checked: no ImageZoom gesture refactor. Remains deferred.
- **DEF-R4C8-D** (plan-288) — dynamic Tailwind `columns-${n}` comment-only
  safelist. Checked: no Tailwind config change. Remains deferred.
- **Histogram mode-cycle aria-label** (carried since plan-286, LOW/Medium).
  Re-open criterion unchanged (SR-user feedback or fresh designer finding).
  Remains deferred.
