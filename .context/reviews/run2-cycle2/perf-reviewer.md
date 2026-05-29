# Perf Reviewer — Run-2 Cycle 2 (HEAD 317126cf)

Angle: performance, concurrency, CPU/memory/UI responsiveness.

No new performance findings. Carryover items re-verified as still deferred:

- PERF/DEF-02 (`fetchCandidates` loads all candidate rows, no LIMIT):
  unchanged. LOW at personal-gallery scale; exit criterion (backfill OOM /
  >50k un-migrated rows) not fired. Note the runner's `fetchCandidates`
  (`admin-backfill-runner.ts:159-169`) and the script's `db.execute`
  (`:238-244`) both `ORDER BY id ASC` with no LIMIT — acceptable for target
  scale.
- PERF/DEF-03 (runner per-row UPDATE vs script batched transaction):
  unchanged. The detection-failure-branch fix (CR2-01) adds at most one extra
  small UPDATE per failed-detection row on the script side, which is the rare
  path; no perf regression. Naturally folds into DEF-01 unification when that
  is picked up.
- DEF-04 (non-atomic progress counters under concurrency > 1): unchanged,
  log-only, default concurrency 1.

## Verified clean
- No N+1 introduced; analytics queries index-backed and `GROUP BY`-aggregated.
- The CR2-01 fix is perf-neutral (one extra UPDATE only on the rare
  detection-failure branch).
