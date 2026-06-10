# Plan 280 — Run-4 Cycle 4 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle4/_aggregate.md`
Every finding from the run-4 cycle-4 reviews is either scheduled in
`plan/plan-279-run4-cycle4-fixes.md` or recorded here. Severity/confidence
preserved from the original review (no downgrades). Deferred work remains
bound by repo policy (GPG-signed commits, Conventional Commits + gitmoji, no
`--no-verify`, Node 24 / TS 6 toolchain) when picked up.

## Deferred items

**None.** All 15 cycle-4 findings (PERF-R4C4-01, COR-R4C4-02, COR-R4C4-03,
UX-R4C4-04, I18N-R4C4-05, COR-R4C4-06, HARD-R4C4-07, DOC-R4C4-08,
LOW-R4C4-09, TEST-R4C4-10…15) are scheduled in plan-279; the six test gaps
are folded into their parent fix tasks. Security/correctness findings were
NOT deferred.

## Standing deferrals re-audit (from prior cycles — still valid, exit criteria un-triggered)

- **DEF-R4C1-01** (plan-274) — LR route `revalidateAllAppData()` breadth.
  Exit criterion: ISR reintroduction on any public route, or profiling
  showing measurable cost. Checked this cycle: all public routes still run
  `revalidate = 0`; criterion un-triggered. Remains deferred.
- **DEF-R4C2-01** (plan-276) — tokens UI grants all three scopes.
  Exit criterion: first endpoint consuming `lr:read` / `lr:delete` lands.
  Checked this cycle: the only scope-consuming route remains
  `api/admin/lr/upload` (`lr:upload`); criterion un-triggered. Remains
  deferred.
- **DEF-R4C3-01** (plan-278) — LR upload ROUTE error strings hardcoded
  English (machine-client surface). Exit criterion: LR plugin gains
  localization or a browser consumer calls the route. Checked this cycle:
  neither happened; criterion un-triggered. Remains deferred. NOTE: cycle
  4's I18N-R4C4-05 (the lr-tokens ACTION strings on the BROWSER tokens
  page) is a different surface and is being FIXED in plan-279 Task 5 — it
  does not alter this deferral's scope.
