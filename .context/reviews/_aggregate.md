# Aggregate review — latest (cycle 5 rpl)

This file is the orchestrator-requested aggregate. The detailed cycle-5 rpl aggregate is at `.context/reviews/_aggregate-cycle5-rpl.md`; this file duplicates the consolidated findings for discoverability.

Generated: 2026-04-24. HEAD: `0000000789a97f7afcb515eacbe40555cee7ca8f`.

Per-agent source files (cycle 5, this run):
- `.context/reviews/code-reviewer-cycle5-rpl.md`
- `.context/reviews/security-reviewer-cycle5-rpl.md`
- `.context/reviews/perf-reviewer-cycle5-rpl.md`
- `.context/reviews/critic-cycle5-rpl.md`
- `.context/reviews/verifier-cycle5-rpl.md`
- `.context/reviews/test-engineer-cycle5-rpl.md`
- `.context/reviews/tracer-cycle5-rpl.md`
- `.context/reviews/architect-cycle5-rpl.md`
- `.context/reviews/debugger-cycle5-rpl.md`
- `.context/reviews/document-specialist-cycle5-rpl.md`
- `.context/reviews/designer-cycle5-rpl.md`

## Consolidated findings

### AGG5R-01 — `check-action-origin.ts` only scans `FunctionDeclaration` — silently passes arrow-function mutating actions
- LOW / HIGH. `apps/web/scripts/check-action-origin.ts:85-86`.
- Signal: code-reviewer, security-reviewer, verifier, critic, tracer, debugger (6 agents).
- Action: extend scanner to visit `VariableStatement` + `ArrowFunction`/`FunctionExpression`; add fixture-based unit test.

### AGG5R-02 — `check-api-auth.ts` file discovery misses `.tsx`/`.mjs`/`.cjs` route files
- LOW / HIGH. `apps/web/scripts/check-api-auth.ts:18-23`.
- Signal: code-reviewer, verifier, architect (3 agents).
- Action: include `.tsx`, `.mjs`, `.cjs`.

### AGG5R-03 — SQL restore scanner doesn't block `CALL proc_name(...)`
- LOW / MEDIUM. `apps/web/src/lib/sql-restore-scan.ts:1-36`.
- Signal: security-reviewer, tracer.
- Action: add `/\bCALL\s+\w+/i`.

### AGG5R-04 — SQL restore scanner doesn't block `RENAME USER` / `REVOKE`
- LOW / MEDIUM.
- Signal: security-reviewer, tracer.
- Action: add `/\bRENAME\s+USER\b/i` and `/\bREVOKE\s/i`.

### AGG5R-05 — `ACTION_FILES` allow-list hard-coded in `check-action-origin.ts`; no doc guidance
- LOW / HIGH. `apps/web/scripts/check-action-origin.ts:19-28`.
- Signal: architect, document-specialist.
- Action: glob-discover action files OR add CLAUDE.md guidance for contributors.

### AGG5R-06 — Lint helpers have no unit test harness
- LOW / HIGH.
- Signal: test-engineer.
- Action: add fixture-based tests for `check-action-origin.ts` and `check-api-auth.ts`.

### AGG5R-07 — `getImages` (JOIN+GROUP BY) near-dead code vs `getImagesLite` (scalar subquery)
- LOW / MEDIUM. `apps/web/src/lib/data.ts:318-418`.
- Signal: code-reviewer, verifier.
- Disposition: defer refactor.

### AGG5R-08 — `check-action-origin.ts` header comment vs reality drift
- LOW / HIGH. `apps/web/scripts/check-action-origin.ts:31-37, 41`.
- Signal: document-specialist.
- Action: tighten comment; consider replacing auto-exemption regex with explicit opt-out markers.

### AGG5R-09 — Lint helpers live in generic `scripts/` without load-bearing banner
- LOW / LOW.
- Signal: architect.
- Disposition: hygiene; defer.

### AGG5R-10 — `deleteImages` revalidation `> 20` threshold is undocumented magic number
- LOW / LOW.
- Signal: critic.
- Disposition: cosmetic; defer.

### AGG5R-11 — Repetitive auth+origin+maintenance preamble
- LOW / LOW.
- Signal: critic.
- Disposition: observational; explicit repetition aids audit.

### AGG5R-12 — No `lint:action-maintenance` gate
- LOW / MEDIUM.
- Signal: architect, critic.
- Disposition: defer; new gate design.

### AGG5R-13 — Pool-connection `'connection'` handler only fires for new connections
- LOW / HIGH.
- Signal: code-reviewer.
- Disposition: bootstrap window vanishingly small; observational.

### AGG5R-14 — `warnedMissingTrustProxy` has no test reset helper
- LOW / MEDIUM.
- Signal: code-reviewer.
- Disposition: test-infra; defer.

### AGG5R-15 — `stripControlChars` doesn't strip Unicode format controls
- LOW / LOW.
- Signal: code-reviewer.
- Disposition: defense-in-depth; defer.

### AGG5R-16 — `deleteImages` ≤20 branch revalidates stale IDs
- LOW / MEDIUM.
- Signal: code-reviewer.
- Disposition: minor; defer.

### AGG5R-17 — `getTopicBySlug` alias lookup uses 2 SELECTs
- LOW / HIGH.
- Signal: perf-reviewer.
- Disposition: benchmark-gated; defer.

### AGG5R-18 — `cleanOrphanedTmpFiles` readdir failures silently swallowed
- LOW / MEDIUM.
- Signal: debugger.
- Disposition: tiny; defer.

### AGG5R-19 — `restoreDatabase` temp file leak on sync throw
- LOW / LOW.
- Signal: debugger.
- Disposition: edge case; defer.

## Signals of cross-agent agreement

- 6 agents flag AGG5R-01 (lint:action-origin arrow-export gap).
- 3 agents flag AGG5R-02 (lint:api-auth file-discovery gap).
- 2 agents each flag AGG5R-03, AGG5R-04, AGG5R-05, AGG5R-07, AGG5R-12.

## Agent failures

None.

## Summary totals

- 0 HIGH / MEDIUM findings
- 19 LOW findings
- 6 should-fix this cycle (lint-gate hardening cluster)
- 13 defer (observational, matches existing backlog, or scoped refactor)
