# Run-4 Cycle 4 — document-specialist angle

Inventory: CLAUDE.md (full re-read of Testing / Lint Gates / Color pipeline /
Operational playbook sections against code), AGENTS.md quality-gates section,
`settings-hash.ts` docstring vs `serve-upload.ts` behavior, route-level doc
comments in the five R4C3-touched files, README paid-downloads workflow vs
webhook behavior, plan/README conventions.

## Findings

### DOC-R4C4-08 — the blocking typecheck gate is documented nowhere (LOW / High confidence)
The repo's CI/loop gate set includes `npm run typecheck --workspace=apps/web`
(present in `apps/web/package.json:15` as `typecheck:app` + the
`typecheck:scripts` js-script checker, and blocking in this loop's GATES).
But:
- CLAUDE.md "Testing" lists only `npm test`, `npm run test:e2e`,
  `npm run lint`.
- AGENTS.md's quality-gates block lists the three scanners and eslint; no
  typecheck line (verified by grep — zero hits for "typecheck").
Same omission class as DOC-R4C1-08 (the then-missing 4th lint gate, fixed in
`8950a82d`). A contributor following the documented gate list ships type
errors that `tsconfig.typecheck.json` (which includes `__tests__`) rejects —
exactly what bit cycle 3 (`b7681b9a` was a typecheck-only fix discovered at
gate time, not documented anywhere as a required check). Fix: add the
typecheck line to CLAUDE.md "Testing" and AGENTS.md's gate list, noting it
covers `__tests__` via `tsconfig.typecheck.json`.

### DOC concur on PERF-R4C4-01 — serve-upload debounce docstring overclaims
`serve-upload.ts:34-36` ("On fetch failure we serve the last known hash …
so a misbehaving DB cannot stall image responses") is inaccurate while the
refresh is awaited inline: a hung (not failing-fast) DB stalls every image
response for the duration of each attempt. The SWR fix makes the sentence
true; until then the doc and behavior disagree. Folded into the
PERF-R4C4-01 fix (update the comment with the code).

### Verified-accurate (spot checks)
- CLAUDE.md "Lint Gates" now says **Four** lint scripts and documents
  `lint:public-route-rate-limit` with its fixture path — matches
  `scripts/` and `package.json` (R4C1 DOC fix landed fully).
- CLAUDE.md key-files table: all listed paths exist; `IMAGE_PIPELINE_VERSION
  = 7` claim matches `gallery-config-shared.ts`.
- Backfill runbook (`--rm` sidecar) and migration runbook steps match
  `scripts/migrate.js` current behavior (journal-hash post-condition
  present).
- README paid-downloads operator workflow matches webhook behavior incl.
  the R4C3 true-insert log gating (the grep-the-log workflow description
  remains valid; the loser line no longer exists, which IMPROVES the doc's
  accuracy — no edit needed).
- `mysql-datetime.ts` module doc vs usage: all `datetime(mode:'string')`
  writers go through `toMySqlDateTime` (failed_at fix held; no new
  violators).
- Deferral ledgers plan-274/276/278: all three deferred items' exit
  criteria remain un-triggered (no ISR reintroduction, no lr:read/lr:delete
  consumer endpoints, no LR plugin localization) — deferrals stay valid.
