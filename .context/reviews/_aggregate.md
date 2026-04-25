# Cycle 7 — Aggregate Review (review-plan-fix loop, 2026-04-25)

Review pass executed by a single subagent (the Task fan-out tool is not callable inside this nested subagent context). Per-perspective files written for provenance under `.context/reviews/{architect,code-reviewer,perf-reviewer,security-reviewer,critic,test-engineer,tracer,debugger,document-specialist,verifier,designer}.md`.

## Theme

Per-cycle directive: "look beyond Unicode bidi/invisible-character hardening." Reviewers explicitly excluded the Unicode lineage (now consolidated through `containsUnicodeFormatting`) and audited perf, race conditions, auth boundaries, data flow, UX, doc drift, test gaps, and dependency hygiene.

## Aggregated findings (deduplicated)

| ID | Description | Severity | Confidence | Agreement | Action |
|----|-------------|----------|------------|-----------|--------|
| **C7L-FIX-01** | Duplicate `tagsString.split(',')` parse in `images.uploadImages` (lines 141-149). Brittle parallel parsing; duplicate allocation. | LOW | High | code-reviewer + perf-reviewer + critic + debugger + tracer + architect (6 lanes) | IMPLEMENT — single split, derive `tagNames` and count from one source. |
| C7L-DOC-01 | `upload-tracker.ts:14` parameter named `ip` but real callers pass `${userId}:${ip}`. Cosmetic rename to `key`. | INFO | Medium | tracer + document-specialist | BUNDLE with C7L-FIX-01 if cycle time allows; otherwise defer. |
| C7L-CR-04 / C7L-SEC-03 | Audit-log catch sites use `console.debug`, swallowing infra failures in production NODE_ENV=production filter sets. | LOW | High | code-reviewer + security-reviewer | DEFER — promote to `console.warn` in a follow-up plan, not this cycle (logging behavior change deserves its own dedicated cycle). |
| C7L-PERF-02 | `getSharedGroupKeysForImages` always runs JOIN even if no shares. | INFO | Medium | perf-reviewer | DEFER — low priority. |
| C7L-PERF-03 | Sequential per-file upload loop. | INFO | Low | perf-reviewer | DEFER — out of scope. |
| C7L-CR-05 | Stale lineage IDs in `topics.ts` comments. | INFO | Low | code-reviewer | DEFER — cosmetic. |
| C7L-CRIT-02 | `withAdminMutation()` boilerplate-reduction refactor. | INFO | High | critic | DEFER — large refactor, not bug-class. |
| C7L-CRIT-03 | Bootstrap state-flag combinatorial complexity. | INFO | Medium | critic | DEFER — document; no rewrite. |
| C7L-CRIT-04 / C7L-UX-02 | Partial-success messaging on uploads. | INFO | Medium | critic + designer | DEFER — pre-existing UX concern. |
| C7L-UX-01 | Generic `invalidTagNames` error. | LOW | Medium | designer + critic | DEFER — i18n churn risk. |
| C7L-TE-01 | No test for `images.ts:147` count-mismatch branch. | LOW | Medium | test-engineer | BUNDLE with C7L-FIX-01 (add test that exercises the same code path). |
| C7L-TE-02 | No `toHaveBeenCalledTimes(1)` assertion for `settleUploadTrackerClaimMock`. | INFO | High | test-engineer | OPTIONAL — small add; bundle with C7L-FIX-01 if useful. |
| C7L-SEC-02 | `tagsString` 1000-char cap is generous. | LOW | Medium | security-reviewer | DEFER — out of cycle scope. |
| C7L-SEC-05 | Silent drop on deep-pagination DoS attempt. | INFO | Medium | security-reviewer | DEFER — out of scope. |
| C7L-CR-03 | `loadMoreImages` re-reads map after set. | INFO | Medium | code-reviewer | DEFER — cosmetic. |
| C7L-DBG-01 | Same as C7L-FIX-01 from debugger lens. | LOW | High | debugger | COVERED by C7L-FIX-01. |
| C7L-ARCH-01 | Same as C7L-FIX-01 from architect lens. | LOW | High | architect | COVERED by C7L-FIX-01. |
| C7L-PERF-01 | Same as C7L-FIX-01 from perf lens. | LOW | High | perf-reviewer | COVERED by C7L-FIX-01. |

## Closed findings (not bugs)

- **AGG7R-21** ("double-call" of `settleUploadTrackerClaim`) — re-audited. The two call sites at `images.ts:391` and `:397` are mutually exclusive (the first branch returns at line 393). Verified by verifier lane (V-1). **Recommend closing the deferred plan entry in this cycle's plan.**

## Cross-agent agreement

- **C7L-FIX-01** is the only finding with six-lane agreement and a concrete, low-risk fix. It's the natural cycle-7 implementation candidate.
- All other findings are INFO/LOW and either already correctly handled or naturally deferred per repo policy (cosmetic, large refactor, or out of scope).

## Plan

- Schedule a single new plan: `plan-100-cycle7-loop-fixes.md` covering C7L-FIX-01 + bundled test (C7L-TE-01) + parameter rename (C7L-DOC-01) + AGG7R-21 closure note.
- Record all other findings as deferred with citations.

## Gate baseline (before fixes)

- ESLint: previously clean (cycle-6 baseline)
- Typecheck: previously clean
- lint:api-auth, lint:action-origin: clean (CI gates)
- Vitest: passing baseline carried from cycle 6

## AGENT FAILURES

The Task fan-out tool is not available inside this nested subagent context, so all agent perspectives were authored sequentially by the orchestrating agent. Per-perspective files exist under `.context/reviews/` for full provenance. No agent failures otherwise.
