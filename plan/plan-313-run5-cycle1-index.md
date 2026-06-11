# Run-5 Cycle 1 — Plan Index

**Date:** 2026-06-11 · **Input:** `.context/reviews/_aggregate.md` (93 merged findings from 11 agents, 125 raw)

## Counts

| Document | Work items | Finding IDs covered |
|---|---|---|
| `plan-314-run5-cycle1-fixes.md` | 17 | 18 (2 CRIT + 15 HIGH + 1 LOW fold: COR-R5C1-04) |
| `plan-315-run5-cycle1-medium.md` | 33 | 35 (33 MED + 2 LOW folds: TRC-R5C1-01, COR-R5C1-05) |
| `plan-316-run5-cycle1-low-docs.md` | 5 work units | 33 (28 LOW + 5 MED doc-only, severity preserved) |
| `plan-317-run5-cycle1-deferred.md` — deferred | 6 entries | 6 (PERF-R5C1-05, PERF-R5C1-04, PERF-R5C1-06, TRC-R5C1-02, TRC-R5C1-13, DES-R5C1-24) |
| `plan-317-run5-cycle1-deferred.md` — verified non-issue (planner) | 1 entry | 1 (DES-R5C1-02 — HIGH claim disproved: `ui/button.tsx` floors every variant at ≥44 px) |
| **Total** | | **93 / 93 indexed findings accounted** ✓ |

Plus 23 aggregate-classified documented-intentional / verified non-issues recorded with provenance in `plan-317-run5-cycle1-deferred.md` (not part of the 93).

## What cycle 1 implements first

1. **All of `plan-314-run5-cycle1-fixes.md`** in its dependency order: the `retryFailedImage` auth one-liner → upload original-leak fix → fail-closed `semantic_search_mode` → `[AUTO]` public-title leak → dead HDR scaffolding removal → backfill batching → analytics-index migration 0021 → the six security-test-hardening items → the four a11y HIGHs.
2. **Then `plan-315-run5-cycle1-medium.md`** as budget allows, prioritizing sections A (security/correctness) and B (pipeline correctness) before C/D/E. Note the hard dependency: plan-502 item 12 (view-event retention) requires plan-501 item 7 (indexes) to have landed.
3. **Then `plan-316-run5-cycle1-low-docs.md`**, Unit A (documentation truth pass) first — it is zero-regression-risk and clears the verifier's doc-drift findings for the next cycle.

## What rolls to later cycles

- Anything in 502/503 that doesn't fit this cycle's budget (record per-item status in the plan files as work proceeds).
- The 6 deferred entries, each with a concrete exit criterion (see `plan-317-run5-cycle1-deferred.md`): the `revalidate=0` ISR design task, two perf items awaiting EXPLAIN/slow-log evidence, two needs-manual-validation traces (one gated behind the plan-502 SW rework), and the optional EXIF-label polish.
- TEST-R5C1-11 (paid-download e2e) has an in-plan fallback: split into a route-level integration test this cycle if e2e entitlement seeding proves heavy.

## Archived plan files (moved to `done/`, never deleted)

- `47-cycle8-rpf-photographer.md` → `.context/plans/done/` — verified complete: its single action item (C8-A1, archive plan 46) is done (`done/46-cycle7-rpf-photographer.md` exists), the doc itself records C7-A1/A2/A3 confirmed shipped and the cycle-8 convergence note closes at zero new findings.

**Left in place (verified-incomplete or deliberately kept):** `35/36/37-*.md` (kept-for-history per plan 37's own predecessor note), `48-photographer-r4-followup.md` (self-labelled "Plan only"; no in-doc completion record), `cycle1/cycle3-rpf-photographer-r28-followon.md` (reconciliation notes pointing at photographer-r27/r28 phase dirs with open phases), `jpeg-xl-scoping.md` / `mastering-metadata-schema.md` / `wi09-readiness.md` (forward-looking scoping docs), `plan-409-c13-nonce-header-fix.md.bak` (instructed: leave alone), and all run/cycle subdirectories (out of scope for root-file archiving; when in doubt, leave in place).
