# Latest Aggregate Review

Current aggregate: `cycle-1-2026-07-06/_aggregate.md` (run-10 cycle 1/100, reviewed HEAD `657eb024`).

Run-10 cycle 1 was a full 12-lane fresh fan-out after the cycle-85..99 recovery run. It produced 34
deduplicated dispositions: 30 scheduled (mostly narrow fixes plus three larger items — the aged
C77-ARCH-01 restore mutation fence, backup/restore completeness verification, and the first-page
`COUNT(*) OVER()` removal), 3 deferred with exit criteria (mysql2-internals coupling test, broader
source-contract test retirement, multipart RSS measurement + startup TRUST_PROXY fail-loud), and 4
stale-baseline items resolved during the cycle-start git reconciliation (divergence, stray cycle-94
copies, superseded cycle-85 diffs).

Highest-signal items:

- `C1-01` — public `load_more`/`view_record` limiters do DB work for already-saturated callers (3-lane agreement; closes the orphaned cycle-99 architect finding).
- `C1-02` — backup/restore lacks dump-completeness verification (truncated dump can restore "successfully").
- `C1-03` — restore maintenance does not fence non-upload admin writers (deferred C77-ARCH-01, drained this cycle).
- `C1-07` — `COUNT(*) OVER()` on the hot first-page listing (re-opened from deferred C94-11 on 2-lane agreement).
- `C1-08`/`C1-09`/`C1-10` — live-verified admin focus-loss, garbled month-heading accessible names, missing admin `<h1>`s.
- `C1-25` — CLAUDE.md overstates smart collections as admin-manageable; CRUD actions have no UI/API surface.
- `C1-26` — ledger repair: cycle-99 review was orphaned (never aggregated/indexed/scheduled).

## Agent Failures

The first 12-lane fan-out was killed by an API session limit after 4 lanes wrote artifacts; the
remaining 8 lanes were re-spawned per the retry rule and all completed. No lane remains failed.

## Plan Disposition

All 34 dispositions are scheduled or explicitly deferred in `.context/plans/cycle-1-2026-07-06-plan.md`
and `.context/plans/cycle-1-2026-07-06-deferred.md`. Deferred registers remain:
`.context/plans/cycle-96-2026-07-01-deferred.md` (broad carry-forwards) plus the new cycle-1 register.
An age-budget policy for carry-forward deferrals is adopted in `.context/plans/README.md`.
