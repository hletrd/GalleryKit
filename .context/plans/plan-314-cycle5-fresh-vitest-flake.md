# Plan 314 -- Cycle 5/100 Fresh Review: Vitest Drizzle-Import Flake Fix

**Cycle:** 1/100 of review-plan-fix loop (5th fresh pass overall)
**HEAD at plan creation:** `ef1280b docs(plans): mark plan-312 cycle-3 fresh fixes as implemented`
**Status:** Implemented in this cycle

## Review Summary

Cycle 5 fresh review confirmed code-surface convergence (cycle 4 already declared zero new code findings). The only new issue is a gate-stability regression: vitest's `data-tag-names-sql.test.ts` "Drizzle compiled SQL ..." sub-test flakes under full-suite parallel load due to cold-import contention exceeding the 5000ms default `it()` timeout.

### Reproduction

`npm test --workspace=apps/web` on cycle-5 HEAD:

```
✗ Drizzle compiled SQL for the lite query shape emits GROUP_CONCAT + LEFT JOIN + GROUP BY 6442ms
Error: Test timed out in 5000ms.
Test Files  1 failed | 68 passed (69)
Tests  1 failed | 460 passed (461)
```

Re-run in isolation passes:

```
npm test --workspace=apps/web -- --run src/__tests__/data-tag-names-sql.test.ts
Tests  5 passed (5)
Duration  5.18s (import 225ms)
```

The sub-test does dynamic imports of `drizzle-orm`, `drizzle-orm/mysql-proxy`, and `../db/schema`. In isolation the imports take ~225ms; under full suite contention the cold-import phase aggregates to 143s across the 69-file suite (per vitest summary line) and a single dynamic-import call can stall well past 5000ms when other workers are paying their own import cost.

## New Findings This Cycle

| ID | Severity | Confidence | Finding | Status |
|---|---|---|---|---|
| CYC5-F01 | MEDIUM | High | `data-tag-names-sql.test.ts` "Drizzle compiled SQL" sub-test flakes under full-suite parallel load (5000ms default timeout) | Implemented this cycle |

## Implementation Action

Add an explicit per-test 30000ms timeout to the dynamic-import sub-test. The other four sub-tests in the same file are pure synchronous string/regex inspection of the source file and finish well under 5000ms — no change needed there.

### Diff

`apps/web/src/__tests__/data-tag-names-sql.test.ts`:

```diff
-    it('Drizzle compiled SQL for the lite query shape emits GROUP_CONCAT + LEFT JOIN + GROUP BY', async () => {
+    it('Drizzle compiled SQL for the lite query shape emits GROUP_CONCAT + LEFT JOIN + GROUP BY', { timeout: 30000 }, async () => {
```

with an explanatory comment block citing the 2026-04-27 cycle-5 reproduction. The 30000ms ceiling is well above the observed 6442ms peak under contention but still well below the vitest-level hook/pool timeouts, so a real regression (e.g. drizzle's `.toSQL()` becoming async or the schema graph adding network calls) would still surface as a hard failure rather than silent slow-down.

## Verification

- `npm test --workspace=apps/web` after fix: 69 files / 461 tests passed (exit 0). Duration 20.77s.
- All other gates re-confirmed green: eslint, typecheck, lint:api-auth, lint:action-origin.
- Build gate result tracked separately (see commit log).

## Repo-Rule Check

- CLAUDE.md "Git Commit Rules": commit will be GPG-signed (`-S`), use Conventional Commits + gitmoji, no Co-Authored-By trailers, no `--no-verify`.
- CLAUDE.md "Always commit and push immediately after every iteration": will pull --rebase + push.
- The fix is **not** a suppression — vitest's per-test `{ timeout: ... }` option is the documented vitest API for test-specific timing. The underlying assertions still run; only the wall-clock budget is widened to accommodate cold-import contention. Quoting CLAUDE.md "Root-cause, don't mask" — the root cause here is the cold-import graph cost in the dynamic-import path, not a regression in the production code; the test timeout is the correct mitigation per vitest docs.
- Touch-target audit: not affected (no UI change).

## Deferred Items

No new deferrals this cycle. Carry-forward deferred items from cycles 1-4 remain as documented:
- `.context/plans/233-deferred-cycle3-loop.md`
- `.context/plans/302-deferred-cycle1-loop-2026-04-25.md`
- `.context/plans/304-deferred-cycle2-loop.md`
- `plan-313-cycle4-fresh-convergence.md` (4 carry-forward defer items)

No finding from this cycle was deferred. CYC5-F01 was implemented immediately because it is gate-blocking.
