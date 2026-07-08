# Run-10 Cycle 31 Architect / Performance Review

Reviewer: architect/performance
Date: 2026-07-08 KST
HEAD: `707470083a27c78e1c9d1da176ade75f94ad6af4`
Branch: `master`
Scope: architecture boundaries, deployment/ops contracts, concurrency budgets, database/query performance, CPU/memory/UI responsiveness, scalability regressions, and current ledger consistency.

## Inventory First

| Surface | Files inspected | Result |
| --- | --- | --- |
| Recent run10 context and dedupe base | `.context/plans/run10-cycle27/plan.md`, `.context/plans/run10-cycle27/deferred.md`, `.context/plans/run10-cycle28/plan.md`, `.context/plans/run10-cycle28/deferred.md`, `.context/plans/run10-cycle29/plan.md`, `.context/plans/run10-cycle29/deferred.md`, `.context/plans/run10-cycle30/plan.md`, `.context/plans/run10-cycle30/deferred.md`, `.context/reviews/run10-cycle29/architect-perf-reviewer.md`, `.context/reviews/run10-cycle30/perf-reviewer.md`, `.context/plans/deferred-carry-forward.md` | Prior background-pool, vector-scan, proxy/nginx, restore-ordering, and admin-e2e items remain tracked. Not re-filed. |
| Current HEAD delta | `git diff 4bab5270fad3cdce6be288dda94a7322fb6997f1..HEAD` | Current HEAD adds review/plan docs, boundary-test walker widening, `archiveRange()` December fix, and CLAUDE/index docs. No new production query path or runtime worker lane was added. |
| Timeline/date query path | `apps/web/src/lib/data-timeline.ts:93-104`, `apps/web/src/lib/data-timeline.ts:199-219`, `apps/web/src/__tests__/data-timeline-behavior.test.ts` | December range fix is correct and remains sargable via inclusive/exclusive capture-date bounds. Focused tests passed. |
| Client/server boundary test path | `apps/web/src/__tests__/client-server-only-boundary.test.ts:142-166`, `apps/web/src/__tests__/client-server-only-boundary.test.ts:168-240` | The test now follows value `@/components` edges while preserving the deliberate `@/app` server-action exception. Focused tests passed. |
| Loop-B plan/deferred consistency | `.context/plans/cycle-10b-2026-07-08-plan.md:93-106`, `.context/plans/cycle-10b-2026-07-08-plan.md:126-147`, `.context/plans/cycle-10b-2026-07-08-deferred.md:99-122`, `.context/plans/deferred-carry-forward.md:319-323` | Deferred perf/test items are recorded, but terminal gate/deploy state is internally inconsistent. New finding below. |
| Deployment/ops ledger | `.context/plans/README.md:34-39`, `.context/plans/cycle-10b-2026-07-08-plan.md:145-147`, `.context/plans/run10-cycle30/plan.md:46-64` | README claims active Cycle 10b has full gates, signed push, and per-cycle deploy; the authoritative Cycle 10b plan still records build running, e2e pending, and commit/push/deploy pending. |

## Findings

### C31-01 - Cycle 10b release ledger claims completion in the index while the plan still shows gates/deploy pending

- **Severity/Confidence:** Medium / High.
- **Citations:** `.context/plans/README.md:34-39` lists Cycle 10b as an active ledger with "full gates, signed push, per-cycle deploy"; `.context/plans/cycle-10b-2026-07-08-plan.md:93-106` requires full gates, e2e, commit/push, and per-cycle deploy; `.context/plans/cycle-10b-2026-07-08-plan.md:145-147` still says build is running, e2e is pending, and commit/push/deploy will happen after those pass. The adjacent Cycle 30 plan also still shows signed push and deploy unchecked at `.context/plans/run10-cycle30/plan.md:46-64`.
- **Scenario:** the next planner or deploy reviewer reads the index and assumes Cycle 10b production closure is complete, while another reads the cycle plan and treats build/e2e/deploy as still pending. That breaks the deploy/ops contract that every pushed iteration has an honest terminal record, and it can lead either to skipped smoke evidence or unnecessary duplicate deployment.
- **Fix:** update the authoritative Cycle 10b plan with exact terminal evidence, including final build/e2e result, signed commit hashes, push state, deploy command result, and live-smoke result. If that evidence was not actually captured, change the index to say the committed plan lacks deploy/e2e evidence and name the later cycle/deploy that supersedes it. Close the stale Cycle 30 checkbox/status at the same time or explicitly mark it superseded.
- **Dedupe notes:** this is the same class as prior release-ledger closure findings, but it is not a duplicate of Cycle 27/28/29/30 because it refers to the newly added Cycle 10b plan at current HEAD (`70747008`). Older items are already resolved or recorded in their own plan files; this finding should not re-open them.

## Deferred Items Checked, Not Re-filed

- `D10b-05 / AGG-C10b-03` (`deleteImages` sequential pending-file-deletion inserts) remains open in `.context/plans/cycle-10b-2026-07-08-deferred.md:99-122` and consolidated at `.context/plans/deferred-carry-forward.md:323`. It is unchanged at HEAD and not counted as new.
- `C27-02`, `C27-04`, `C27-05`, `C28-05`, and `C28-08` remain represented in `.context/plans/deferred-carry-forward.md:309-313`; their exit criteria were not observed during this pass.
- Existing broad scale items for vector scans, background DB-pool overlap, public search/map scaling, and service-worker cache costs remain carried forward from older registers. Current HEAD did not introduce a new unbounded query, worker lane, or request-path CPU loop.

## Validation Evidence

- `npm test --workspace=apps/web -- --run src/__tests__/data-timeline-behavior.test.ts src/__tests__/client-server-only-boundary.test.ts` passed: 2 files, 17 tests.
- `git diff --check HEAD` passed.
- Worktree was clean before writing this review artifact.

Full lint, typecheck, build, full Vitest, Playwright e2e, production deploy, host-nginx validation, and load testing were not run for this read-only review artifact.

## Final Sweep

No new architecture boundary, database/query performance, concurrency-budget, CPU/memory, UI-responsiveness, or scalability regression was confirmed in product code at current HEAD. One new deployment/ops ledger finding is filed above. All known open items from run10 Cycle 27 through Cycle 30 and loop-B deferred carry-forward were deduped rather than re-counted.
