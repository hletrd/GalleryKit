# Critic Review — Cycle 13

Review target: `8bd8999f`. Review only.

## Inventory and challenge method

After reading the repository instructions and current/historical plan state, I inventoried the complete maintained app, test, script, migration, build, deploy, and documentation surface: 3,705 tracked files, 631 maintained TS/TSX/JS source files, 372 unit-test files, 13 Playwright specs, 30 scripts, and 34 migrations. I challenged stated guarantees against executable behavior across archive/date semantics, schema convergence, privacy, auth/admission, uploads/deletes/restores, responsive delivery, cache behavior, and publication provenance rather than treating green gates or comments as proof by themselves.

## Findings

### CRIT-C13-01 — The new “executable date semantics” proof omits the boundary its range model cannot represent

- Severity: **Medium**
- Confidence: **High**
- Label: **Confirmed validation defect with confirmed runtime consequence**
- Exact regions: acceptance claim `.context/plans/cycle-12-2026-07-18-plan.md:88-104,116-128`; MySQL probe `apps/web/scripts/check-schema-convergence.mjs:151-227`; helper tests `apps/web/src/__tests__/data-timeline-behavior.test.ts:59-91`; route/source tests `apps/web/src/__tests__/data-timeline.test.ts:100-130`; implementation `apps/web/src/lib/data-timeline.ts:97-107`

Cycle 12 says MySQL itself proves capture-date semantics, but the live probe covers February 29 in ordinary years and the helper tests cover only 2025 month/year ranges. No test exercises the accepted lower/upper year domain. The half-open range helper always calculates `year + 1`, so its advertised 1..9999 domain has no representation for the upper endpoint.

Concrete scenario: every focused archive/schema test passes (25/25), yet `archiveRange(9999)` yields the invalid MySQL literal `10000-01-01 00:00:00`; a MySQL 8.4 execution fails with error 1525. Thus the green proof specifically misses the counterexample that breaks both public archive consumers.

Fix: add table-driven boundary tests to the pure helper, behavior tests that compile/execute the real query at the supported extremes, and public-route assertions for invalid/maximum years. Phrase the acceptance claim in terms of the exact tested domain. Prefer a shared `parseArchiveYear` contract so tests do not separately preserve inconsistent route rules.

### CRIT-C13-02 — The release ledger again stops one fact short of its own source history

- Severity: **Low**
- Confidence: **High**
- Label: **Confirmed for publication; deployment manual-validation**
- Exact regions: `.context/plans/cycle-12-2026-07-18-plan.md:5,101-114`; `.context/plans/README.md:34-48`; commits `0c49d53b`, `83bb17c5`, `267ed7d7`, `8bd8999f`

The plan requires remote equality as acceptance, but still says signed publication is pending after four GPG-good commits reached `origin/master`. This is the same recurring terminal-evidence gap the prior cycle planned to correct.

Concrete scenario: a recovery loop selects the stale plan status instead of the remote history and repeats push/release work. No deploy conclusion follows from Git and none should be invented.

Fix: make the next-cycle bootstrap or orchestrator own a small post-push status update, recording signed push and deploy as separate facts. Reconcile Cycle 12's push now and leave deploy unknown without host evidence.

## Final missed-issue sweep

The final challenge pass revisited every current plan assertion, the disposable-MySQL upgrade lane, schema repair definitions, the privacy field symmetry, request/action guards, background connection ownership, file/DB dual writes, dynamic public pages, image source descriptors, service-worker freshness, and all open carry-forward rows. No third distinct critic finding met the evidence threshold.
