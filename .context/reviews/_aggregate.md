# Latest Aggregate Review

Current aggregate: `cycle-71-2026-07-01/_aggregate.md`

Cycle 71 produced five deduplicated findings:

- `C71-01` - Sidecar backfills can mutate the DB while durable restore maintenance is active.
- `C71-02` - Disk-recovery runbook hardcodes the deploy SSH target.
- `C71-03` - Runtime env template omits `DB_SSL_CA`.
- `C71-04` - Semantic embedding snapshot contract is stale and mostly source-string based.
- `C71-05` - Cycle 70 plan/index still mark a completed pushed/deployed cycle as active.

Cycle 71 schedules all five findings. No new Cycle 71 findings are deferred. `C65-02`, `C61-06`, `C61-07`, `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08` remain explicitly deferred.
