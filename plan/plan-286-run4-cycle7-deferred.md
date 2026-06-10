# Plan 286 — Run-4 Cycle 7 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle7/_aggregate.md`
Every cycle-7 finding is scheduled in `plan/plan-285-run4-cycle7-fixes.md`;
**no new deferral is created this cycle.** This ledger exists to (a) record
that fact explicitly so no finding is silently dropped, and (b) carry the
fresh re-audit of the standing deferrals from prior cycles. Severity/
confidence preserved from the original reviews (no downgrades). Deferred
work remains bound by repo policy (GPG-signed commits, Conventional
Commits + gitmoji, no `--no-verify`, Node 24 / TS 6 toolchain) when picked
up.

## New deferrals this cycle
None. All 6 findings land in plan-285 (TEST-R4C7-05 and DOC-R4C7-06 fold
into Tasks 1-3; security/correctness findings COR-R4C7-01/02/03 are fixed,
not deferred, per the non-deferrable rule).

## Non-scheduled LOW observations (recorded, not deferred work items)
- **Histogram mode-cycle button aria-label** omits the current mode from
  the accessible name (`components/histogram.tsx` ~line 724,
  LOW/Medium). The adjacent `role="img"` canvas label announces the
  active mode, so SR users are not blind to state; WCAG 2.5.3 exposure
  is minimal because the visible label (the mode name) is not
  contradicted by the accessible name. Re-open criterion: SR-user
  feedback or a fresh designer-angle finding that the canvas label is
  insufficient in practice. (Designer angle, run4-cycle7/designer.md.)

## Standing deferrals re-audit (from prior cycles — all exit criteria un-triggered; fresh evidence in `.context/reviews/run4-cycle7/document-specialist.md`)
- **DEF-R4C1-01** (plan-274) — LR route `revalidateAllAppData()` breadth.
  Exit criterion: ISR reintroduction on any public route, or profiling
  showing measurable cost. Checked this cycle: all public pages still
  export `revalidate = 0`. Remains deferred.
- **DEF-R4C2-01** (plan-276) — tokens UI grants all three scopes.
  Exit criterion: first endpoint consuming `lr:read` / `lr:delete`.
  Checked: sole consuming route remains `api/admin/lr/upload`
  (`lr:upload`). Remains deferred.
- **DEF-R4C3-01** (plan-278) — LR upload route error strings hardcoded
  English (machine-client surface). Exit criterion: LR plugin gains
  localization or a browser consumer calls the route. Checked: neither
  happened. Remains deferred.
- **OPS-R4C6-01** (plan-284) — production host nginx lacks the repo's
  `/uploads/` location block (non-code ops runbook item; original
  ARCH-R4C6-06 severity MED/High preserved). Exit criterion: next
  host-level nginx maintenance window or origin CPU pressure from image
  serving. Checked: no host maintenance occurred; the code-side
  `next.config.ts headers()` policy from plan-283 Task 5 remains the
  serving authority in production. Remains deferred with the plan-284
  runbook intact.
