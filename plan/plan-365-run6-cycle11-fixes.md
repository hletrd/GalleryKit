# Plan 365 — Run-6 Cycle-11 Fixes

**Created:** 2026-06-17
**HEAD at planning:** `a7de3ebd`
**Source:** `.context/reviews/_aggregate.md` (cycle-11 fan-out, 11/11 agents) + per-agent reviews.
**Status:** SCHEDULED. One LOW, test-only finding this cycle. Honest convergence — 10/11 agents at ZERO, no security/correctness/data-loss/HIGH/MEDIUM finding.

This plan schedules the single schedulable cycle-11 finding (AGG-C11-01). The deferred register is `plan-366-run6-cycle11-deferred.md`.

---

## TASK-1 [LOW] — Pin the semantic similarity-selector source contract (AGG-C11-01)

**Finding (test-engineer TE-C11-01):** `apps/web/src/app/api/search/semantic/route.ts:271` —
```ts
const similarity = isProd ? dotProduct : cosineSimilarity;
```
is a documented load-bearing invariant (comment lines 267-270: production vectors are L2-normalized so `dotProduct === cosine` and is faster; stub vectors are raw `[-1,1]`, NOT normalized, so stub MUST use `cosineSimilarity` or rankings corrupt). No test pins this branch selector. The behavioral 200-path test uses `fill(0.5)`/`fill(0.1)` mock embeddings whose magnitudes make `dotProduct` ≈ `cosineSimilarity`, so it passes regardless of which function is selected. A future "perf simplification" to `const similarity = dotProduct` (unconditional) would silently corrupt stub-mode rankings with zero failing test.

**Severity:** LOW. Current runtime is CORRECT (debugger + tracer independently verified the line behaves correctly). The risk is a silent future refactor on a LIVE-feature invariant. Stub mode is double-gated out of production by `semanticSearchMode` (`SEMANTIC_SEARCH_ALLOW_PRODUCTION` + DB row, both heal to `disabled`), so even a stub-ranking regression cannot reach prod — but the documented invariant deserves a guard, matching the established cycle pattern (AGG-C9-02 short-query source-contract guard, `clip-model-contract.test.ts` server-only-absence guard, `image-queue-embed-wiring.test.ts`).

**Fix (test-only, NO behavioral/runtime change):**
Add a source-contract test that reads `src/app/api/search/semantic/route.ts` and asserts:
1. It contains the guarded ternary `const similarity = isProd ? dotProduct : cosineSimilarity` exactly (regex-tolerant of whitespace).
2. It does NOT contain `const similarity = dotProduct` unconditionally (the corrupting refactor shape).

Place it either in a new tiny test file (e.g. `apps/web/src/__tests__/semantic-similarity-selector-contract.test.ts`) or fold into an existing semantic-route source-contract test. Mirror the `readFileSync(join(process.cwd(), 'src/...'), 'utf8')` pattern already used by `search-short-query-guard.test.ts`.

**Acceptance criteria:**
- New test present and passing.
- Test fails (verified by a quick local mental/edit check or temporary mutation) if the selector is changed to `const similarity = dotProduct`.
- Full gate suite stays green: ESLint 0, typecheck 0, Vitest all pass (now 2228+), 3 lint gates 0.
- `npm run typecheck --workspace=apps/web` run before committing (per repo rule for test changes).

**HARD GUARDS preserved:** No change to `clip-model.ts` (no `server-only`), no change to `semantic_search_mode` default, no change to the route's runtime logic — test-only.

**Progress:**
- [x] TASK-1 implemented — `apps/web/src/__tests__/semantic-similarity-selector-contract.test.ts` added (3 assertions: guarded ternary present, unconditional `dotProduct` assignment absent, documented invariant comment present). Verified by temporary mutation that changing the selector to `const similarity = dotProduct` fails the test. typecheck + full Vitest + 3 lint gates green. Committed.

---

## Coverage assertion

- AGG-C11-01 (LOW, test-only) → TASK-1 (scheduled + implemented).
- DEF-C11-01 (LOW, carried) → deferred in plan-366.
- REJ-C11-01 (carried) → rejected, recorded in aggregate + plan-366.
- No security, correctness, or data-loss finding scheduled or deferred (none surfaced).
