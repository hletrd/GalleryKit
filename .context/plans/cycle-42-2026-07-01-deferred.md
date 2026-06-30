# Cycle 42/100 Deferred Findings

One new Cycle 42 finding is deferred. All other new findings are scheduled in `.context/plans/cycle-42-2026-07-01-plan.md`.

## New Deferred Item

### `PA-42-02` - Production CLIP web-process catch-up lacks the semantic backfill lock

Severity: Medium. Confidence: Medium-High.

The sidecar backfill path uses `LOCK_SEMANTIC_EMBEDDING_BACKFILL`, but `bootstrapMissingActiveEmbeddings()` can run production CLIP catch-up from the web process without that advisory lock or a per-boot cap. This can duplicate sidecar work and compete with request handling after production semantic search is enabled.

Deferred reason: a safe fix needs a runtime-coordination decision, not just a small local guard. The next plan should decide whether production web catch-up is disabled, non-blockingly lock-guarded, capped with `SEMANTIC_SCAN_LIMIT`, or split between stub-mode/recent-upload recovery and sidecar-only bulk production backfill.

Exit criterion: schedule a design-backed change that defines the production web bootstrap policy, includes tests/source contracts proving it cannot run concurrent bulk CLIP work beside the sidecar/restore lock, and preserves recent-upload embedding recovery behavior.

## Carry-forward Deferred Items

- `TV-40-03` - JS operational scripts need semantic checking. Cycle 42 only made discovery fail closed; semantic `checkJs` migration remains broader because the prior probe produced many existing JS typing errors.
- `PERF-C39-03` - Feed and sitemap updated-time indexes: remains migration-shaped work requiring EXPLAIN output, production-cardinality assumptions, rollback notes, and `reconcileLegacySchema` mirroring.
- `PERF-C39-04` - Backfill pipeline-version indexes: remains migration-shaped work requiring query-plan evidence and write-path impact review.
- `AGG-C38-07` - Broad imported-helper side-effect classification: remains deferred until a scanner model can distinguish pure imports from mutating helpers without noisy false positives.
- `AGG-C38-08` - Sidecar keyset pagination: remains deferred until a broader throughput/memory plan defines keyset cursor semantics and regression coverage.
