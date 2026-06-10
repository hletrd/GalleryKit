# Plan 282 — Run-4 Cycle 5 deferred findings ledger

**Source review:** `.context/reviews/run4-cycle5/_aggregate.md`
Every finding from the run-4 cycle-5 reviews is either scheduled in
`plan/plan-281-run4-cycle5-fixes.md` or recorded here. Severity/confidence
preserved from the original review (no downgrades). Deferred work remains
bound by repo policy (GPG-signed commits, Conventional Commits + gitmoji,
no `--no-verify`, Node 24 / TS 6 toolchain) when picked up.

## Deferred items

**None.** All 8 cycle-5 findings (COR-R4C5-01, SEC-R4C5-02, I18N-R4C5-03,
COR-R4C5-04, LOW-R4C5-05, TEST-R4C5-06, TEST-R4C5-07, DOC-R4C5-08) are
scheduled in plan-281; the two test gaps fold into their parent fix tasks.
Security/correctness findings were NOT deferred.

## Accepted trade-offs recorded this cycle (not deferrals — no exit criterion owed)

- `getImagesForSmartCollection` keeps its `COUNT(*) OVER()` column on the
  cursor path (the action discards `totalCount` there). Dropping it would
  fork the select shape for a negligible win at personal-gallery scale;
  the architect angle explicitly endorsed not forking
  (`.context/reviews/run4-cycle5/perf-reviewer-architect.md`).
- `dumpDatabase`/`runRestore` `close`-handler `code` parameter can be
  `null` after a signal kill; the localized message would render "code
  null". Cosmetic, reachable only via operator-issued kill; not scheduled
  (re-raise if an operator-facing report ever shows it).

## Standing deferrals re-audit (from prior cycles — still valid, exit criteria un-triggered)

- **DEF-R4C1-01** (plan-274) — LR route `revalidateAllAppData()` breadth.
  Exit criterion: ISR reintroduction on any public route, or profiling
  showing measurable cost. Checked this cycle: every public page still
  exports `revalidate = 0` (grep evidence in
  `.context/reviews/run4-cycle5/document-specialist.md`). Remains deferred.
- **DEF-R4C2-01** (plan-276) — tokens UI grants all three scopes.
  Exit criterion: first endpoint consuming `lr:read` / `lr:delete` lands.
  Checked this cycle: the scopes appear only in `lib/admin-tokens.ts`
  declarations; the only consuming route remains `api/admin/lr/upload`
  (`lr:upload`). Remains deferred.
- **DEF-R4C3-01** (plan-278) — LR upload ROUTE error strings hardcoded
  English (machine-client surface). Exit criterion: LR plugin gains
  localization or a browser consumer calls the route. Checked this cycle:
  neither happened. Remains deferred. NOTE: cycle 5's I18N-R4C5-03 fixes
  ACTION-boundary strings on browser-reachable surfaces (collections /
  embeddings) — different class, does not alter this deferral's scope.
