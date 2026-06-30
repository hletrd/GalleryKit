# Cycle 41/100 Deferred Findings

No new Cycle 41 findings are deferred. All new findings are scheduled in `.context/plans/cycle-41-2026-07-01-plan.md`.

## Carry-forward Deferred Items

- `TV-40-03` - JS operational scripts need semantic checking. Still requires a dedicated script-typing migration plan because the prior direct `tsc --checkJs` probe produced many existing JS typing errors in operational scripts.
- `PERF-C39-03` - Feed and sitemap updated-time indexes: remains migration-shaped work requiring EXPLAIN output, production-cardinality assumptions, rollback notes, and `reconcileLegacySchema` mirroring.
- `PERF-C39-04` - Backfill pipeline-version indexes: remains migration-shaped work requiring query-plan evidence and write-path impact review.
- `AGG-C38-07` - Broad imported-helper side-effect classification: remains deferred until a scanner model can distinguish pure imports from mutating helpers without noisy false positives.
- `AGG-C38-08` - Sidecar keyset pagination: remains deferred until a broader throughput/memory plan defines keyset cursor semantics and regression coverage.
